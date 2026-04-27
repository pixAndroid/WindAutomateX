import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import {
  getTasks, getTask, createTask, updateTask, deleteTask,
  getSteps, saveSteps,
  getRuns, getRun, createRun, updateRun, clearRuns,
  getCredentials, createCredential, deleteCredential,
  getSettings, saveSettings,
} from './database';
import type { Task, TaskStep, Credential, Settings } from '../shared/types';

const runningProcesses = new Map<number, ChildProcess>();

export function setupIPC(mainWindow: BrowserWindow, pythonPath: string): void {

  // Tasks
  ipcMain.handle('tasks:list', () => getTasks());
  ipcMain.handle('tasks:get', (_e, id: number) => getTask(id));
  ipcMain.handle('tasks:create', (_e, task: Omit<Task, 'id' | 'created_at' | 'updated_at'>) => createTask(task));
  ipcMain.handle('tasks:update', (_e, id: number, task: Partial<Task>) => updateTask(id, task));
  ipcMain.handle('tasks:delete', (_e, id: number) => deleteTask(id));

  // Steps
  ipcMain.handle('steps:list', (_e, taskId: number) => getSteps(taskId));
  ipcMain.handle('steps:save', (_e, taskId: number, steps: Omit<TaskStep, 'id'>[]) => saveSteps(taskId, steps));

  // Runs
  ipcMain.handle('runs:list', (_e, taskId?: number) => getRuns(taskId));
  ipcMain.handle('runs:get', (_e, id: number) => getRun(id));
  ipcMain.handle('runs:clear', () => clearRuns());

  // Credentials
  ipcMain.handle('credentials:list', () => getCredentials());
  ipcMain.handle('credentials:create', (_e, cred: Omit<Credential, 'id'>) => createCredential(cred));
  ipcMain.handle('credentials:delete', (_e, id: number) => deleteCredential(id));

  // Settings
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, settings: Settings) => saveSettings(settings));

  // File dialog — open a single exe/script file
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'sh'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // File dialog — open a single Excel or CSV file
  ipcMain.handle('dialog:openExcelFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Coordinate picker — hides main window, shows a transparent fullscreen overlay; resolves with {x, y} or null
  ipcMain.handle('picker:coordinate', () => {
    return new Promise<{ x: number; y: number } | null>((resolve) => {
      const pickerPath = path.join(app.getAppPath(), 'assets', 'picker.html');
      const pickerPreload = path.join(__dirname, 'picker-preload.js');

      // Hide the main window so it doesn't obstruct coordinate picking
      if (!mainWindow.isDestroyed()) mainWindow.hide();

      const pickerWin = new BrowserWindow({
        fullscreen: true,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: pickerPreload,
        },
      });

      pickerWin.loadFile(pickerPath);

      let settled = false;
      const finish = (coords: { x: number; y: number } | null) => {
        if (settled) return;
        settled = true;
        if (!mainWindow.isDestroyed()) mainWindow.show();
        resolve(coords);
      };

      const resultListener = (_e: Electron.IpcMainEvent, coords: { x: number; y: number } | null) => {
        if (!pickerWin.isDestroyed()) pickerWin.close();
        finish(coords);
      };

      ipcMain.once('picker:result', resultListener);

      pickerWin.on('closed', () => {
        ipcMain.off('picker:result', resultListener);
        finish(null);
      });
    });
  });

  // Task run/stop/pause
  ipcMain.handle('task:run', async (_e, taskId: number) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const steps = getSteps(taskId);
    const run = createRun(taskId);
    mainWindow.webContents.send('run:update', run);

    // Minimize the main window so it doesn't interfere with automation clicks
    if (!mainWindow.isDestroyed()) mainWindow.minimize();

    const stepsJson = JSON.stringify(steps);
    const enginePath = path.join(__dirname, '../../python-engine/ipc_handler.py');
    const settings = getSettings();
    const python = settings.python_path || pythonPath || 'python';

    const proc = spawn(python, [enginePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    runningProcesses.set(run.id, proc);

    // Send execute command
    proc.stdin.write(JSON.stringify({ command: 'execute', task_id: taskId, steps: stepsJson }) + '\n');

    let logBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      logBuffer += text;
      const lines = text.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        mainWindow.webContents.send('log:update', { runId: run.id, line });
        try {
          const msg = JSON.parse(line);
          if (msg.status === 'completed' || msg.status === 'failed') {
            const endedRun = updateRun(run.id, {
              status: msg.status,
              ended_at: new Date().toISOString(),
              log_text: logBuffer,
            });
            mainWindow.webContents.send('run:update', endedRun);
            runningProcesses.delete(run.id);
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      logBuffer += line;
      mainWindow.webContents.send('log:update', { runId: run.id, line });
    });

    proc.on('close', (code: number) => {
      if (runningProcesses.has(run.id)) {
        const status = code === 0 ? 'completed' : 'failed';
        const endedRun = updateRun(run.id, {
          status,
          ended_at: new Date().toISOString(),
          log_text: logBuffer,
        });
        mainWindow.webContents.send('run:update', endedRun);
        runningProcesses.delete(run.id);
      }
      // Restore main window after task finishes
      if (!mainWindow.isDestroyed()) {
        mainWindow.restore();
        mainWindow.show();
      }
    });
  });

  ipcMain.handle('task:stop', (_e, runId: number) => {
    const proc = runningProcesses.get(runId);
    if (proc) {
      proc.kill('SIGTERM');
      updateRun(runId, { status: 'stopped', ended_at: new Date().toISOString() });
      runningProcesses.delete(runId);
    }
  });

  ipcMain.handle('task:pause', (_e, _runId: number) => {
    // Pause not directly supported; could send signal
  });
}

export function stopAllProcesses(): void {
  for (const [, proc] of runningProcesses) {
    proc.kill('SIGTERM');
  }
  runningProcesses.clear();
}
