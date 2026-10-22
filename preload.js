'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load-data'),
  save: (data, options) => ipcRenderer.invoke('save-data', data, options),
  flush: (data) => ipcRenderer.sendSync('flush-data', data),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  parseNoticeAI: (text) => ipcRenderer.invoke('parse-notice', text),
  notify: (title, body) => ipcRenderer.send('notify', title, body)
});

// V2.1 的 AI 边界：页面只拿到无密钥的配置状态，实际请求由主进程完成。
contextBridge.exposeInMainWorld('workbench', {
  weather: { get: (input) => ipcRenderer.invoke('weather-get', input) },
  pilot: {
    active: process.argv.includes('--workbench-offline-pilot'),
    ready: (counts) => ipcRenderer.send('pilot-ready', counts)
  },
  desktop: {
    getSettings: () => ipcRenderer.invoke('desktop-get-settings'),
    setSettings: (settings) => ipcRenderer.invoke('desktop-set-settings', settings),
    onQuickCapture: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = () => handler();
      ipcRenderer.on('desktop-quick-capture', listener);
      return () => ipcRenderer.removeListener('desktop-quick-capture', listener);
    }
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai-get-config'),
    saveConfig: (config) => ipcRenderer.invoke('ai-save-config', config),
    clearKey: (confirmed) => ipcRenderer.invoke('ai-clear-key', confirmed === true),
    testConnection: (config) => ipcRenderer.invoke('ai-test-connection', config),
    organizeInbox: (payload) => ipcRenderer.invoke('ai-organize-inbox', payload),
    run: (action, payload) => ipcRenderer.invoke('ai-run-action', { action, payload }),
    analyzeInbox: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'analyzeInbox', payload }),
    parseQuickCapture: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'parseQuickCapture', payload }),
    planToday: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'planToday', payload }),
    breakDownTask: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'breakDownTask', payload }),
    suggestNextAction: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'suggestNextAction', payload }),
    suggestFollowUp: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'suggestFollowUp', payload }),
    draftFollowUpMessage: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'draftFollowUpMessage', payload }),
    summarizeDay: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'summarizeDay', payload }),
    summarizeWeek: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'summarizeWeek', payload }),
    summarizeMonth: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'summarizeMonth', payload }),
    summarizeProject: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'summarizeProject', payload }),
    askWorkspace: (payload) => ipcRenderer.invoke('ai-run-action', { action: 'askWorkspace', payload })
  }
});
