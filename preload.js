'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load-data'),
  save: (data) => ipcRenderer.invoke('save-data', data),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  parseNoticeAI: (text) => ipcRenderer.invoke('parse-notice', text),
  notify: (title, body) => ipcRenderer.send('notify', title, body)
});

// V2.1 的 AI 边界：页面只拿到无密钥的配置状态，实际请求由主进程完成。
contextBridge.exposeInMainWorld('workbench', {
  background: {
    choose: () => ipcRenderer.invoke('background-choose'),
    remove: (managedPath) => ipcRenderer.invoke('background-remove', managedPath),
    directory: () => ipcRenderer.invoke('background-directory')
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai-get-config'),
    saveConfig: (config) => ipcRenderer.invoke('ai-save-config', config),
    clearKey: () => ipcRenderer.invoke('ai-clear-key'),
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
