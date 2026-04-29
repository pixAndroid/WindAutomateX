import cron from 'node-cron';
import { BrowserWindow } from 'electron';
import { getTasks, getTask, getSteps, createRun, updateRun, updateTask, getSettings } from './database';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import type { Task, TaskStep } from '../shared/types';

const scheduledTasks = new Map<number, cron.ScheduledTask>();
const runningScheduledProcesses = new Map<number, { proc: ChildProcess; runId: number }>();
const stoppedTaskIds = new Set<number>();
let mainWindowRef: BrowserWindow | null = null;
let pythonPathRef = '';
let runningCount = 0;
const MAX_CONCURRENCY = 3;

export function initScheduler(mainWindow: BrowserWindow, pythonPath: string): void {
  mainWindowRef = mainWindow;
  pythonPathRef = pythonPath;
  loadAndScheduleAll();

  // Run startup tasks once after initialization
  const tasks = getTasks();
  for (const task of tasks) {
    if (task.enabled && task.schedule_type === 'startup') {
      setTimeout(() => runTask(task.id), 5000);
    }
  }
}

export function loadAndScheduleAll(): void {
  // Clear existing schedules
  for (const [, task] of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.clear();

  const tasks = getTasks();
  for (const task of tasks) {
    // 'once' tasks must not be re-fired on every startup; they run only when
    // explicitly triggered (enabled toggle or schedule save in the UI).
    if (task.enabled && task.schedule_type !== 'once') {
      scheduleTask(task);
    }
  }
}

export function scheduleTask(task: Task, triggerNow = false): void {
  if (scheduledTasks.has(task.id)) {
    scheduledTasks.get(task.id)!.stop();
    scheduledTasks.delete(task.id);
  }

  if (!task.enabled) return;

  let cronExpression: string | null = null;

  switch (task.schedule_type) {
    case 'startup':
      // Only runs at actual app startup via initScheduler, not on UI toggle/save
      return;
    case 'once':
      // Run immediately, exactly once — no schedule value required.
      runTask(task.id);
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
    case 'interval': {
      // schedule_value = interval in minutes
      if (task.schedule_value) {
        const intervalMin = parseInt(task.schedule_value, 10);
        if (!isNaN(intervalMin) && intervalMin > 0 && intervalMin <= 59) {
          cronExpression = `*/${intervalMin} * * * *`;
        } else if (!isNaN(intervalMin) && intervalMin >= 60) {
          // For intervals >= 60 minutes, convert to an hourly cron expression.
          // e.g. 60 min -> "0 */1 * * *", 120 min -> "0 */2 * * *"
          const hours = Math.max(1, Math.floor(intervalMin / 60));
          cronExpression = `0 */${hours} * * *`;
        }
      }
      break;
    }
  }

  if (cronExpression) {
    try {
      const scheduled = cron.schedule(cronExpression, () => {
        runTask(task.id);
      }, { runOnInit: false });
      scheduledTasks.set(task.id, scheduled);
      notifyScheduleChanged();

      if (triggerNow) {
        runTask(task.id);
      }
    } catch (err) {
      console.error(`Failed to schedule task ${task.id} with expression "${cronExpression}":`, err);
    }
  }
}

export function getScheduledTaskIds(): number[] {
  return Array.from(scheduledTasks.keys());
}

function notifyScheduleChanged(): void {
  if (mainWindowRef) {
    mainWindowRef.webContents.send('scheduler:changed', Array.from(scheduledTasks.keys()));
  }
}

export function unscheduleTask(taskId: number): void {
  if (scheduledTasks.has(taskId)) {
    scheduledTasks.get(taskId)!.stop();
    scheduledTasks.delete(taskId);
    notifyScheduleChanged();
  }
}

export function stopScheduledTask(taskId: number): void {
  // Stop the cron schedule so the task doesn't re-fire on the next tick
  unscheduleTask(taskId);

  const entry = runningScheduledProcesses.get(taskId);
  if (entry) {
    // Mark as intentionally stopped so the 'close' handler skips retry/status overwrite
    stoppedTaskIds.add(taskId);
    runningScheduledProcesses.delete(taskId);
    runningCount = Math.max(0, runningCount - 1);
    // Persist stopped status before killing so the DB is consistent even if the
    // process exits synchronously before the next event-loop tick.
    updateRun(entry.runId, { status: 'stopped', ended_at: new Date().toISOString() });
    try {
      entry.proc.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
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
  const settings = getSettings();
  const python = settings.python_path || pythonPathRef || (process.platform === 'win32' ? 'python' : 'python3');
  const proc = spawn(python, [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });

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

  proc.on('error', (err: Error) => {
    runningCount--;
    runningScheduledProcesses.delete(taskId);
    const errMsg = `Failed to start Python process: ${err.message}\n`;
    logBuffer += errMsg;
    updateRun(run.id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      log_text: logBuffer,
    });
    if (mainWindowRef) {
      mainWindowRef.webContents.send('run:update', { ...run, status: 'failed' });
      mainWindowRef.webContents.send('log:update', { runId: run.id, line: errMsg });
    }
  });

  proc.on('close', (code: number) => {
    // If stopScheduledTask already handled this process, skip further processing
    if (stoppedTaskIds.has(taskId)) {
      stoppedTaskIds.delete(taskId);
      return;
    }
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
    } else {
      // Auto-disable 'once' tasks after they complete (success) or exhaust retries,
      // so they truly run only once and don't re-fire on a subsequent enabled toggle.
      const task = getTask(taskId);
      if (task && task.schedule_type === 'once') {
        updateTask(taskId, { enabled: false });
        if (mainWindowRef) {
          mainWindowRef.webContents.send('task:updated', { id: taskId, enabled: false });
        }
      }
    }

    if (mainWindowRef) {
      mainWindowRef.webContents.send('run:update', { ...run, status });
    }
  });
}
