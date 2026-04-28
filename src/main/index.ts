import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { spawnSync } from 'child_process';
import { initDatabase } from './database';
import { setupIPC, stopAllProcesses } from './ipc';
import { initScheduler } from './scheduler';

function resolvePythonPath(): string {
  for (const candidate of ['python3', 'python']) {
    try {
      const result = spawnSync(candidate, ['--version'], { timeout: 3000 });
      if (result.status === 0) return candidate;
    } catch {
      // try next candidate
    }
  }
  return 'python3';
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#111827',
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDatabase(app.getPath('userData'));

  createWindow();

  if (mainWindow) {
    const pythonPath = resolvePythonPath();
    setupIPC(mainWindow, pythonPath);
    initScheduler(mainWindow, pythonPath);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAllProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllProcesses();
});
