'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load-data'),
  save: (data) => ipcRenderer.send('save-data', data),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  parseNoticeAI: (text) => ipcRenderer.invoke('parse-notice', text),
  notify: (title, body) => ipcRenderer.send('notify', title, body)
});
