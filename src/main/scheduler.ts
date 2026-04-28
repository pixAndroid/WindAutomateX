import cron from 'node-cron';
import { BrowserWindow } from 'electron';
import { getTasks, getSteps, createRun, updateRun } from './database';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import type { Task, TaskStep } from '../shared/types';

const scheduledTasks = new Map<number, cron.ScheduledTask>();
const runningScheduledProcesses = new Map<number, { proc: ChildProcess; runId: number }>();
let mainWindowRef: BrowserWindow | null = null;
let pythonPathRef = 'python3';
let runningCount = 0;
const MAX_CONCURRENCY = 3;

export function initScheduler(mainWindow: BrowserWindow, pythonPath: string): void {
  mainWindowRef = mainWindow;
  pythonPathRef = pythonPath;
  loadAndScheduleAll();
}

export function loadAndScheduleAll(): void {
  // Clear existing schedules
  for (const [, task] of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.clear();

  const tasks = getTasks();
  for (const task of tasks) {
    if (task.enabled) {
      scheduleTask(task);
    }
  }
}

export function scheduleTask(task: Task): void {
  if (scheduledTasks.has(task.id)) {
    scheduledTasks.get(task.id)!.stop();
    scheduledTasks.delete(task.id);
  }

  if (!task.enabled) return;

  let cronExpression: string | null = null;

  switch (task.schedule_type) {
    case 'startup':
      // Run immediately at startup
      setTimeout(() => runTask(task.id), 5000);
      return;
    case 'once':
      // Parse ISO date string
      if (task.schedule_value) {
        const runAt = new Date(task.schedule_value);
        const now = new Date();
        if (runAt > now) {
          const delay = runAt.getTime() - now.getTime();
          setTimeout(() => runTask(task.id), delay);
        }
      }
      return;
    case 'daily':
      // schedule_value = "HH:MM"
      if (task.schedule_value) {
        const [hour, minute] = task.schedule_value.split(':');
        cronExpression = `${minute} ${hour} * * *`;
      }
      break;
    case 'weekly':
      // schedule_value = "DOW HH:MM" (e.g., "1 09:00")
      if (task.schedule_value) {
        const parts = task.schedule_value.split(' ');
        if (parts.length === 2) {
          const dow = parts[0];
          const [hour, minute] = parts[1].split(':');
          cronExpression = `${minute} ${hour} * * ${dow}`;
        }
      }
      break;
    case 'monthly':
      // schedule_value = "DAY HH:MM" (e.g., "15 09:00")
      if (task.schedule_value) {
        const parts = task.schedule_value.split(' ');
        if (parts.length === 2) {
          const day = parts[0];
          const [hour, minute] = parts[1].split(':');
          cronExpression = `${minute} ${hour} ${day} * *`;
        }
      }
      break;
    case 'hourly':
      // schedule_value = minute offset (0-59), e.g. "30" runs at :30 of every hour
      if (task.schedule_value !== undefined && task.schedule_value !== '') {
        const minuteOffset = parseInt(task.schedule_value, 10);
        if (!isNaN(minuteOffset) && minuteOffset >= 0 && minuteOffset <= 59) {
          cronExpression = `${minuteOffset} * * * *`;
        }
      } else {
        cronExpression = `0 * * * *`;
      }
      break;
    case 'minutely':
      // schedule_value = interval in minutes (1-59), e.g. "5" runs every 5 minutes
      if (task.schedule_value) {
        const intervalMin = parseInt(task.schedule_value, 10);
        if (!isNaN(intervalMin) && intervalMin > 0 && intervalMin <= 60) {
          cronExpression = `*/${intervalMin} * * * *`;
        } else {
          cronExpression = `* * * * *`;
        }
      } else {
        cronExpression = `* * * * *`;
      }
      break;
    case 'interval':
      // schedule_value = interval in minutes
      if (task.schedule_value) {
        const intervalMin = parseInt(task.schedule_value, 10);
        if (!isNaN(intervalMin) && intervalMin > 0) {
          cronExpression = `*/${intervalMin} * * * *`;
        }
      }
      break;
  }

  if (cronExpression) {
    const scheduled = cron.schedule(cronExpression, () => {
      runTask(task.id);
    });
    scheduledTasks.set(task.id, scheduled);
  }
}

export function unscheduleTask(taskId: number): void {
  if (scheduledTasks.has(taskId)) {
    scheduledTasks.get(taskId)!.stop();
    scheduledTasks.delete(taskId);
  }
}

export function stopScheduledTask(taskId: number): void {
  const entry = runningScheduledProcesses.get(taskId);
  if (entry) {
    try {
      entry.proc.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
    updateRun(entry.runId, { status: 'stopped', ended_at: new Date().toISOString() });
    runningScheduledProcesses.delete(taskId);
    runningCount = Math.max(0, runningCount - 1);
    if (mainWindowRef) {
      mainWindowRef.webContents.send('run:update', { id: entry.runId, task_id: taskId, status: 'stopped' });
    }
  }
}

async function runTask(taskId: number, retryCount = 0): Promise<void> {
  if (runningCount >= MAX_CONCURRENCY) {
    // Retry after 60 seconds
    setTimeout(() => runTask(taskId, retryCount), 60000);
    return;
  }

  const steps = getSteps(taskId);
  const run = createRun(taskId);
  if (mainWindowRef) {
    mainWindowRef.webContents.send('run:update', run);
  }

  runningCount++;
  let logBuffer = '';

  // Build a map of all tasks' steps so the Python engine can execute run_task steps
  const allTasks = getTasks();
  const allTasksMap: Record<string, TaskStep[]> = {};
  for (const t of allTasks) {
    allTasksMap[String(t.id)] = getSteps(t.id);
  }

  const enginePath = path.join(__dirname, '../../python-engine/ipc_handler.py');
  const proc = spawn(pythonPathRef, [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });

  runningScheduledProcesses.set(taskId, { proc, runId: run.id });

  proc.stdin.write(JSON.stringify({ command: 'execute', task_id: taskId, steps: JSON.stringify(steps), all_tasks: allTasksMap }) + '\n');
  proc.stdin.end();

  proc.stdout.on('data', (data: Buffer) => {
    const text = data.toString();
    logBuffer += text;
    if (mainWindowRef) {
      mainWindowRef.webContents.send('log:update', { runId: run.id, line: text });
    }
  });

  proc.stderr.on('data', (data: Buffer) => {
    logBuffer += data.toString();
  });

  proc.on('close', (code: number) => {
    runningCount--;
    runningScheduledProcesses.delete(taskId);
    const status = code === 0 ? 'completed' : 'failed';
    updateRun(run.id, {
      status,
      ended_at: new Date().toISOString(),
      log_text: logBuffer,
    });

    if (status === 'failed' && retryCount < 3) {
      setTimeout(() => runTask(taskId, retryCount + 1), 30000 * (retryCount + 1));
    }

    if (mainWindowRef) {
      mainWindowRef.webContents.send('run:update', { ...run, status });
    }
  });
}
