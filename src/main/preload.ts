import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/types';

const api: ElectronAPI = {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    get: (id) => ipcRenderer.invoke('tasks:get', id),
    create: (task) => ipcRenderer.invoke('tasks:create', task),
    update: (id, task) => ipcRenderer.invoke('tasks:update', id, task),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
  },
  steps: {
    list: (taskId) => ipcRenderer.invoke('steps:list', taskId),
    save: (taskId, steps) => ipcRenderer.invoke('steps:save', taskId, steps),
  },
  runs: {
    list: (taskId) => ipcRenderer.invoke('runs:list', taskId),
    get: (id) => ipcRenderer.invoke('runs:get', id),
    clear: () => ipcRenderer.invoke('runs:clear'),
  },
  credentials: {
    list: () => ipcRenderer.invoke('credentials:list'),
    create: (cred) => ipcRenderer.invoke('credentials:create', cred),
    delete: (id) => ipcRenderer.invoke('credentials:delete', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  task: {
    run: (taskId) => ipcRenderer.invoke('task:run', taskId),
    stop: (taskId) => ipcRenderer.invoke('task:stop', taskId),
    pause: (taskId) => ipcRenderer.invoke('task:pause', taskId),
  },
  scheduler: {
    stopTask: (taskId) => ipcRenderer.invoke('scheduler:stopTask', taskId),
  },
  onRunUpdate: (callback) => {
    ipcRenderer.on('run:update', callback);
  },
  offRunUpdate: (callback) => {
    ipcRenderer.removeListener('run:update', callback);
  },
  onLogUpdate: (callback) => {
    ipcRenderer.on('log:update', callback);
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openExcelFile: () => ipcRenderer.invoke('dialog:openExcelFile'),
    openImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
    readExcelHeaders: (filePath: string, sheetName?: string) => ipcRenderer.invoke('dialog:readExcelHeaders', filePath, sheetName),
  },
  picker: {
    coordinate: () => ipcRenderer.invoke('picker:coordinate'),
    captureScreen: () => ipcRenderer.invoke('picker:captureScreen'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
