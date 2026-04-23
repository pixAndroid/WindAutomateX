import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pickerAPI', {
  sendResult: (coords: { x: number; y: number } | null) =>
    ipcRenderer.send('picker:result', coords),
});
