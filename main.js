'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// 优化版数据独立存放，不与原版互相影响
app.setPath('userData', path.join(app.getPath('appData'), 'personal-workbench-optimized'));

// 数据文件：%APPDATA%/personal-workbench-optimized/data.json
function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

const EMPTY = {
  todos: [],
  events: {},
  note: '',
  kanban: { todo: [], doing: [], done: [] },
  theme: 'light'
};

function readData() {
  try {
    const f = dataFile();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8');
    if (!raw || !raw.trim()) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (e) {
    // JSON 损坏 -> 兜底，不崩溃；同时把损坏文件另存备份
    try {
      const f = dataFile();
      if (fs.existsSync(f)) {
        fs.copyFileSync(f, f + '.broken-' + Date.now() + '.bak');
      }
    } catch (_) { /* ignore */ }
    return null;
  }
}

function writeData(data) {
  try {
    const f = dataFile();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 原子写：先写临时文件再改名，避免写一半掉电导致 JSON 损坏
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, f);
    return true;
  } catch (e) {
    return false;
  }
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: '#eef1f5',
    transparent: false,
    autoHideMenuBar: true,
    title: '个人工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    try {
      fs.writeFileSync(
        path.join(__dirname, 'run.log'),
        'ok ' + new Date().toISOString() + '\n',
        'utf8'
      );
    } catch (_) { /* ignore */ }
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('load-data', () => readData());

ipcMain.on('save-data', (_evt, data) => { writeData(data); });

ipcMain.handle('export-data', async (_evt, data) => {
  const stamp = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name =
    'workbench-backup-' +
    stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) +
    '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json';
  const res = await dialog.showSaveDialog(win, {
    title: '导出备份',
    defaultPath: name,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
    return res.filePath;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('import-data', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { error: '文件格式不正确，不是有效的工作台备份' };
    }
    return { data: obj };
  } catch (e) {
    return { error: '文件解析失败：' + (e && e.message ? e.message : '未知错误') };
  }
});

ipcMain.handle('get-data-path', () => dataFile());

// 桌面通知：启动时提醒逾期任务与今日日程
ipcMain.on('notify', (_evt, title, body) => {
  try {
    if (Notification.isSupported()) new Notification({ title: title || '个人工作台', body: body || '' }).show();
  } catch (e) { /* ignore */ }
});
