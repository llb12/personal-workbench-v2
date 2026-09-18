'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { analyzeInboxWithAI, testAIConnection, runAIAction } = require('./ai-adapter');

// 普通运行使用独立的优化版目录；显式 --user-data-dir 供便携/干净用户测试隔离数据。
const defaultUserDataPath = app.getPath('userData');
const hasExplicitUserDataDir = typeof app.commandLine.hasSwitch === 'function' && app.commandLine.hasSwitch('user-data-dir');
app.setPath('userData', hasExplicitUserDataDir ? defaultUserDataPath : path.join(app.getPath('appData'), 'personal-workbench-optimized'));

// 启动路径和缓存路径都固定在用户可写目录，避免 Windows 临时目录或权限异常导致
// Electron 启动时出现 cache/sessionData 错误；这里只创建目录，不清理任何业务数据。
const sessionDataPath = path.join(app.getPath('userData'), 'sessionData');
const cachePath = path.join(app.getPath('userData'), 'cache');
try { fs.mkdirSync(sessionDataPath, { recursive: true }); } catch (_) { /* 启动时再由 Electron 报出实际错误 */ }
try { fs.mkdirSync(cachePath, { recursive: true }); } catch (_) { /* 启动时再由 Electron 报出实际错误 */ }
try { app.setPath('sessionData', sessionDataPath); } catch (_) { /* keep Electron default if unavailable */ }
try { app.commandLine.appendSwitch('disk-cache-dir', cachePath); } catch (_) { /* keep Electron default if unavailable */ }

// 单实例：重复点击启动脚本时只聚焦已有窗口，不创建第二份工作台。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.exit(0);

// 数据文件：%APPDATA%/personal-workbench-optimized/data.json
function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

function aiConfigFile() {
  return path.join(app.getPath('userData'), 'ai-config.json');
}

function backgroundsDir() {
  return path.join(app.getPath('userData'), 'backgrounds');
}

const DEFAULT_AI_CONFIG = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  timeoutMs: 30000,
  privacyMode: 'compact',
  maxContextItems: 80,
  maxHistoryDays: 30,
  maxMessageLength: 4000
};
let volatileAIKey = '';

function readAIConfig() {
  try {
    const f = aiConfigFile();
    if (!fs.existsSync(f)) return { ...DEFAULT_AI_CONFIG };
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...DEFAULT_AI_CONFIG };
    return {
      enabled: obj.enabled === true,
      baseUrl: typeof obj.baseUrl === 'string' && obj.baseUrl.trim() ? obj.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
      model: typeof obj.model === 'string' ? obj.model.trim() : '',
      timeoutMs: Number.isFinite(Number(obj.timeoutMs)) ? Math.max(3000, Math.min(120000, Math.round(Number(obj.timeoutMs)))) : DEFAULT_AI_CONFIG.timeoutMs,
      privacyMode: ['full', 'compact', 'confirm'].includes(obj.privacyMode) ? obj.privacyMode : DEFAULT_AI_CONFIG.privacyMode,
      maxContextItems: Number.isFinite(Number(obj.maxContextItems)) ? Math.max(10, Math.min(300, Math.round(Number(obj.maxContextItems)))) : DEFAULT_AI_CONFIG.maxContextItems,
      maxHistoryDays: Number.isFinite(Number(obj.maxHistoryDays)) ? Math.max(1, Math.min(365, Math.round(Number(obj.maxHistoryDays)))) : DEFAULT_AI_CONFIG.maxHistoryDays,
      maxMessageLength: Number.isFinite(Number(obj.maxMessageLength)) ? Math.max(500, Math.min(20000, Math.round(Number(obj.maxMessageLength)))) : DEFAULT_AI_CONFIG.maxMessageLength,
      apiKeyCiphertext: typeof obj.apiKeyCiphertext === 'string' ? obj.apiKeyCiphertext : ''
    };
  } catch (_) {
    return { ...DEFAULT_AI_CONFIG };
  }
}

function isSecureStorageAvailable() {
  try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readAIKey(config) {
  if (volatileAIKey) return volatileAIKey;
  if (!config || !config.apiKeyCiphertext || !isSecureStorageAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(config.apiKeyCiphertext, 'base64')); } catch (_) { return ''; }
}

function publicAIConfig(config) {
  return {
    enabled: !!config.enabled,
    baseUrl: config.baseUrl || DEFAULT_AI_CONFIG.baseUrl,
    model: config.model || '',
    timeoutMs: config.timeoutMs || DEFAULT_AI_CONFIG.timeoutMs,
    privacyMode: config.privacyMode || DEFAULT_AI_CONFIG.privacyMode,
    maxContextItems: config.maxContextItems || DEFAULT_AI_CONFIG.maxContextItems,
    maxHistoryDays: config.maxHistoryDays || DEFAULT_AI_CONFIG.maxHistoryDays,
    maxMessageLength: config.maxMessageLength || DEFAULT_AI_CONFIG.maxMessageLength,
    hasApiKey: !!readAIKey(config),
    secureStorage: isSecureStorageAvailable()
  };
}

function saveAIConfig(input) {
  const current = readAIConfig();
  const next = {
    enabled: !!(input && input.enabled),
    baseUrl: input && typeof input.baseUrl === 'string' && input.baseUrl.trim() ? input.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    model: input && typeof input.model === 'string' ? input.model.trim() : '',
    timeoutMs: input && Number.isFinite(Number(input.timeoutMs)) ? Math.max(3000, Math.min(120000, Math.round(Number(input.timeoutMs)))) : DEFAULT_AI_CONFIG.timeoutMs,
    privacyMode: input && ['full', 'compact', 'confirm'].includes(input.privacyMode) ? input.privacyMode : (current.privacyMode || DEFAULT_AI_CONFIG.privacyMode),
    maxContextItems: input && Number.isFinite(Number(input.maxContextItems)) ? Math.max(10, Math.min(300, Math.round(Number(input.maxContextItems)))) : (current.maxContextItems || DEFAULT_AI_CONFIG.maxContextItems),
    maxHistoryDays: input && Number.isFinite(Number(input.maxHistoryDays)) ? Math.max(1, Math.min(365, Math.round(Number(input.maxHistoryDays)))) : (current.maxHistoryDays || DEFAULT_AI_CONFIG.maxHistoryDays),
    maxMessageLength: input && Number.isFinite(Number(input.maxMessageLength)) ? Math.max(500, Math.min(20000, Math.round(Number(input.maxMessageLength)))) : (current.maxMessageLength || DEFAULT_AI_CONFIG.maxMessageLength)
  };
  const suppliedKey = input && typeof input.apiKey === 'string' && input.apiKey.trim();
  if (input && input.clearApiKey === true) {
    volatileAIKey = '';
    delete next.apiKeyCiphertext;
  } else if (suppliedKey) {
    if (isSecureStorageAvailable()) {
      next.apiKeyCiphertext = safeStorage.encryptString(input.apiKey).toString('base64');
      volatileAIKey = '';
    } else {
      // 不安全时宁可只保留在本次进程内，也不明文写盘。
      volatileAIKey = input.apiKey;
    }
  } else if (current.apiKeyCiphertext) {
    next.apiKeyCiphertext = current.apiKeyCiphertext;
  }
  writeJsonAtomic(aiConfigFile(), next);
  return publicAIConfig({ ...next, apiKeyCiphertext: next.apiKeyCiphertext || '' });
}

function aiRequestConfig(input, stored) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : stored.baseUrl,
    model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : stored.model,
    timeoutMs: Number.isFinite(Number(source.timeoutMs)) ? Number(source.timeoutMs) : stored.timeoutMs
  };
}

function aiFailure(error, fallback) {
  const code = error && error.code ? error.code : '';
  if (code === 'AI_NOT_CONFIGURED') return { engine: 'unconfigured', code, message: '尚未配置 AI 整理' };
  return { engine: 'error', code: code || 'AI_ERROR', message: fallback || 'AI整理失败，原始内容已保留' };
}

const EMPTY = {
  schemaVersion: 3,
  todos: [],
  projects: [],
  events: {},
  inbox: [],
  workLog: [],
  note: '',
  kanban: { todo: [], doing: [], done: [] },
  theme: 'light'
};

// 只有成功完成一次数据加载（包括确认文件不存在）后，才允许写入。
// 读取失败时保持保护态，避免渲染进程把空的初始化数据覆盖到原文件。
let loadState = 'unknown';

function backupBrokenData(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const backupPath = file + '.broken-' + Date.now() + '.bak';
    fs.copyFileSync(file, backupPath);
    return backupPath;
  } catch (_) {
    return null;
  }
}

function loadFailure(code, message, file) {
  loadState = 'failed';
  return {
    __workbenchLoadError: true,
    code,
    error: message,
    backupPath: file ? backupBrokenData(file) : null
  };
}

function readData() {
  let f;
  loadState = 'loading';
  try {
    f = dataFile();
    fs.statSync(f);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      loadState = 'ready';
      return null;
    }
    return loadFailure('DATA_READ_FAILED', '数据文件读取失败，已保护原文件；请重试加载或使用备份恢复。', f);
  }

  let raw;
  try {
    raw = fs.readFileSync(f, 'utf8');
  } catch (_) {
    return loadFailure('DATA_READ_FAILED', '数据文件读取失败，已保护原文件；请重试加载或使用备份恢复。', f);
  }
  if (!raw || !raw.trim()) {
    return loadFailure('DATA_CORRUPT', '数据文件为空或已损坏，已保护原文件；请重试加载或使用备份恢复。', f);
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    return loadFailure('DATA_CORRUPT', '数据文件不是有效的 JSON，已保护原文件；请重试加载或使用备份恢复。', f);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return loadFailure('DATA_CORRUPT', '数据文件根结构无效，已保护原文件；请重试加载或使用备份恢复。', f);
  }
  loadState = 'ready';
  return obj;
}

function writeData(data) {
  if (loadState !== 'ready') {
    return {
      ok: false,
      code: 'DATA_WRITE_BLOCKED',
      error: '数据加载失败，已保护原文件；请先重试加载或恢复可读取的数据。'
    };
  }
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: '保存失败：数据结构无效' };
    }
    const f = dataFile();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 原子写：先写临时文件再改名，避免写一半掉电导致 JSON 损坏
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, f);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: '保存失败：' + (e && e.message ? e.message : '未知错误')
    };
  }
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 920,
    minWidth: 520,
    minHeight: 440,
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

  win.on('closed', () => { win = null; });
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('load-data', () => readData());

ipcMain.handle('save-data', (_evt, data) => writeData(data));

ipcMain.on('flush-data', (event, data) => {
  event.returnValue = writeData(data);
});

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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDateOrEmpty(value) {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isDateTimeOrEmpty(value) {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && !Number.isNaN(new Date(value).getTime()));
}

function validateImportData(obj) {
  if (!isPlainObject(obj)) {
    return '根节点必须是 JSON 对象';
  }

  const known = [
    'schemaVersion', 'todos', 'projects', 'events', 'inbox', 'workLog', 'note', 'kanban', 'theme', 'profile',
    'accent', 'layout', 'noteSample', 'city', 'weather', 'geo',
    'bgPreset', 'bgCustom', 'bgCustomPath', 'bgIntensity', 'bgBlur', 'bgCardOpacity', 'bgMode', 'focusId', 'snap'
  ];
  if (!known.some(key => Object.prototype.hasOwnProperty.call(obj, key))) {
    return '文件中没有可识别的工作台数据';
  }

  if (obj.todos !== undefined) {
    if (!Array.isArray(obj.todos)) return 'todos 必须是数组';
    if (obj.todos.length > 100000) return 'todos 数量超过允许上限';
    for (let i = 0; i < obj.todos.length; i += 1) {
      const t = obj.todos[i];
      if (!isPlainObject(t)) return 'todos[' + i + '] 必须是对象';
      if (t.text !== undefined && typeof t.text !== 'string') {
        return 'todos[' + i + '].text 必须是字符串';
      }
      if (t.pri !== undefined && !['high', 'mid', 'low'].includes(t.pri)) {
        return 'todos[' + i + '].pri 无效';
      }
      if (t.priority !== undefined && !['high', 'mid', 'low'].includes(t.priority)) {
        return 'todos[' + i + '].priority 无效';
      }
      if (t.status !== undefined && !['todo', 'doing', 'waiting', 'followup', 'done', 'archived', 'inbox'].includes(t.status)) {
        return 'todos[' + i + '].status 无效';
      }
      if (!isDateOrEmpty(t.due)) return 'todos[' + i + '].due 日期格式无效';
      if (t.dueMode !== undefined && !['fixed', 'tbd', 'none'].includes(t.dueMode)) {
        return 'todos[' + i + '].dueMode 无效';
      }
      if (t.dueAt !== undefined && !isDateTimeOrEmpty(t.dueAt)) {
        return 'todos[' + i + '].dueAt 日期格式无效';
      }
      if (t.done !== undefined && typeof t.done !== 'boolean') {
        return 'todos[' + i + '].done 必须是布尔值';
      }
      if (t.blocked !== undefined && typeof t.blocked !== 'boolean') {
        return 'todos[' + i + '].blocked 必须是布尔值';
      }
      if (t.sourceId !== undefined && t.sourceId !== null && typeof t.sourceId !== 'string') {
        return 'todos[' + i + '].sourceId 必须是字符串或 null';
      }
      if (t.completedAt !== undefined && !isDateTimeOrEmpty(t.completedAt)) {
        return 'todos[' + i + '].completedAt 日期格式无效';
      }
      if (t.aiMeta !== undefined && !isPlainObject(t.aiMeta)) {
        return 'todos[' + i + '].aiMeta 必须是对象';
      }
    }
  }

  if (obj.projects !== undefined) {
    if (!Array.isArray(obj.projects)) return 'projects 必须是数组';
    if (obj.projects.length > 10000) return 'projects 数量超过允许上限';
    for (let i = 0; i < obj.projects.length; i += 1) {
      const p = obj.projects[i];
      if (!isPlainObject(p)) return 'projects[' + i + '] 必须是对象';
      if (p.name !== undefined && typeof p.name !== 'string') {
        return 'projects[' + i + '].name 必须是字符串';
      }
      if (!isDateOrEmpty(p.due)) return 'projects[' + i + '].due 日期格式无效';
    }
  }

  if (obj.events !== undefined) {
    if (!isPlainObject(obj.events)) return 'events 必须是对象';
    for (const key of Object.keys(obj.events)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'events 中包含无效日期键：' + key;
      if (!Array.isArray(obj.events[key])) return 'events.' + key + ' 必须是数组';
      for (let i = 0; i < obj.events[key].length; i += 1) {
        const event = obj.events[key][i];
        if (typeof event !== 'string' && !isPlainObject(event)) {
          return 'events.' + key + '[' + i + '] 必须是字符串或对象';
        }
        if (isPlainObject(event) && event.text !== undefined && typeof event.text !== 'string') {
          return 'events.' + key + '[' + i + '].text 必须是字符串';
        }
      }
    }
  }

  if (obj.inbox !== undefined) {
    if (!Array.isArray(obj.inbox)) return 'inbox 必须是数组';
    if (obj.inbox.length > 100000) return 'inbox 数量超过允许上限';
    for (let i = 0; i < obj.inbox.length; i += 1) {
      const entry = obj.inbox[i];
      if (!isPlainObject(entry)) return 'inbox[' + i + '] 必须是对象';
      if (entry.rawText !== undefined && typeof entry.rawText !== 'string') {
        return 'inbox[' + i + '].rawText 必须是字符串';
      }
      if (entry.candidates !== undefined && !Array.isArray(entry.candidates)) {
        return 'inbox[' + i + '].candidates 必须是数组';
      }
    }
  }

  if (obj.note !== undefined && typeof obj.note !== 'string') return 'note 必须是字符串';
  if (obj.layout !== undefined && obj.layout !== null && !isPlainObject(obj.layout)) {
    return 'layout 必须是对象';
  }
  return null;
}

ipcMain.handle('import-data', async () => {
  if (loadState !== 'ready') {
    return {
      code: 'DATA_WRITE_BLOCKED',
      error: '当前数据无法读取，已保护原文件；请先重试加载或恢复可读取的数据。'
    };
  }
  const res = await dialog.showOpenDialog(win, {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 20 * 1024 * 1024) {
      return { error: '导入失败：文件超过 20 MB' };
    }
    const obj = JSON.parse(raw);
    const validationError = validateImportData(obj);
    if (validationError) {
      return { error: '文件结构不正确：' + validationError };
    }

    const current = dataFile();
    let backupPath = null;
    if (fs.existsSync(current)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = current + '.before-import-' + stamp + '.bak';
      fs.copyFileSync(current, backupPath);
    }
    return { data: obj, backupPath };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { error: '文件解析失败：不是有效的 JSON' };
    }
    return { error: '导入失败：' + (e && e.message ? e.message : '未知错误') };
  }
});

ipcMain.handle('get-data-path', () => dataFile());

// 自定义背景只复制到应用自己的目录；删除时也只允许删除该目录内的副本。
function managedBackgroundPath(value) {
  const base = path.resolve(backgroundsDir());
  const target = path.resolve(String(value || ''));
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function backgroundExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext) ? ext : null;
}

ipcMain.handle('background-choose', async () => {
  try {
    const res = await dialog.showOpenDialog(win, {
      title: '选择工作台背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
    const source = res.filePaths[0];
    const ext = backgroundExtension(source);
    if (!ext) return { error: '背景图片格式不支持' };
    const stat = fs.statSync(source);
    if (!stat.isFile()) return { error: '所选内容不是文件' };
    if (stat.size > 20 * 1024 * 1024) return { error: '背景图片超过 20 MB' };
    const dir = backgroundsDir();
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, 'background-' + Date.now() + '-' + process.pid + ext);
    fs.copyFileSync(source, destination);
    return { path: destination, url: pathToFileURL(destination).toString() };
  } catch (error) {
    return { error: '背景图片保存失败：' + (error && error.message ? error.message : '未知错误') };
  }
});

ipcMain.handle('background-remove', (_evt, value) => {
  try {
    const target = managedBackgroundPath(value);
    if (!target) return { ok: false, error: '只能清除应用管理的背景副本' };
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: '背景副本清除失败' };
  }
});

ipcMain.handle('background-directory', () => {
  try {
    fs.mkdirSync(backgroundsDir(), { recursive: true });
  } catch (_) { /* 目录创建失败由实际上传时反馈 */ }
  return backgroundsDir();
});

// ---- AI Provider IPC：密钥只在主进程使用，不进入工作台 data.json ----
function aiLogFile() {
  return path.join(app.getPath('userData'), 'ai-logs.jsonl');
}

function appendAILog(entry) {
  // 日志只记录操作元数据，不写入 API Key、完整上下文或 AI 原文。
  try {
    const safe = {
      action: String(entry && entry.action || '').slice(0, 60),
      time: new Date().toISOString(),
      success: entry && entry.success === true,
      failure: entry && entry.success === true ? '' : String(entry && entry.failure || 'AI_ERROR').slice(0, 60),
      model: String(entry && entry.model || '').slice(0, 120),
      durationMs: Math.max(0, Math.round(Number(entry && entry.durationMs) || 0))
    };
    fs.appendFileSync(aiLogFile(), JSON.stringify(safe) + '\n', 'utf8');
  } catch (_) { /* 日志失败不能影响正常任务和 AI 返回 */ }
}

ipcMain.handle('ai-get-config', () => publicAIConfig(readAIConfig()));

ipcMain.handle('ai-save-config', (_evt, input) => {
  try {
    return { ok: true, config: saveAIConfig(input || {}) };
  } catch (_) {
    return { ok: false, message: 'AI 设置保存失败' };
  }
});

ipcMain.handle('ai-clear-key', () => {
  try {
    return { ok: true, config: saveAIConfig({ ...readAIConfig(), clearApiKey: true }) };
  } catch (_) {
    return { ok: false, message: 'API Key 清除失败' };
  }
});

ipcMain.handle('ai-test-connection', async (_evt, input) => {
  const startedAt = Date.now();
  const stored = readAIConfig();
  const source = input && typeof input === 'object' ? input : {};
  const apiKey = typeof source.apiKey === 'string' && source.apiKey ? source.apiKey : readAIKey(stored);
  if (!apiKey) {
    appendAILog({ action: 'testConnection', success: false, failure: 'AI_NOT_CONFIGURED', model: stored.model, durationMs: Date.now() - startedAt });
    return { ok: false, code: 'AI_NOT_CONFIGURED', message: '尚未配置 AI 整理' };
  }
  try {
    await testAIConnection({ config: aiRequestConfig(source, stored), apiKey });
    appendAILog({ action: 'testConnection', success: true, model: stored.model, durationMs: Date.now() - startedAt });
    return { ok: true, message: '连接成功' };
  } catch (error) {
    appendAILog({ action: 'testConnection', success: false, failure: error && error.code, model: stored.model, durationMs: Date.now() - startedAt });
    return { ok: false, ...aiFailure(error, '连接失败，请检查 API 地址、模型名称和 API Key') };
  }
});

ipcMain.handle('ai-organize-inbox', async (_evt, payload) => {
  const startedAt = Date.now();
  const stored = readAIConfig();
  if (!stored.enabled) {
    appendAILog({ action: 'analyzeInbox', success: false, failure: 'AI_DISABLED', model: stored.model, durationMs: Date.now() - startedAt });
    return { engine: 'unconfigured', code: 'AI_DISABLED', message: 'AI 整理尚未启用' };
  }
  const apiKey = readAIKey(stored);
  if (!apiKey) {
    appendAILog({ action: 'analyzeInbox', success: false, failure: 'AI_NOT_CONFIGURED', model: stored.model, durationMs: Date.now() - startedAt });
    return { engine: 'unconfigured', code: 'AI_NOT_CONFIGURED', message: '尚未配置 AI 整理' };
  }
  try {
    const result = await analyzeInboxWithAI({
      text: payload && payload.text,
      currentDate: payload && payload.currentDate,
      projects: payload && payload.projects,
      existingTasks: payload && payload.existingTasks,
      config: stored,
      apiKey
    });
    appendAILog({ action: 'analyzeInbox', success: true, model: stored.model, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    appendAILog({ action: 'analyzeInbox', success: false, failure: error && error.code, model: stored.model, durationMs: Date.now() - startedAt });
    return aiFailure(error, 'AI整理失败，原始内容已保留');
  }
});

ipcMain.handle('ai-run-action', async (_evt, input) => {
  const source = input && typeof input === 'object' ? input : {};
  const action = typeof source.action === 'string' ? source.action.trim() : '';
  const stored = readAIConfig();
  const startedAt = Date.now();
  if (!stored.enabled) {
    appendAILog({ action, success: false, failure: 'AI_DISABLED', model: stored.model, durationMs: Date.now() - startedAt });
    return { engine: 'unconfigured', code: 'AI_DISABLED', message: 'AI 助手尚未启用' };
  }
  const apiKey = readAIKey(stored);
  if (!apiKey) {
    appendAILog({ action, success: false, failure: 'AI_NOT_CONFIGURED', model: stored.model, durationMs: Date.now() - startedAt });
    return { engine: 'unconfigured', code: 'AI_NOT_CONFIGURED', message: '尚未配置 AI 整理' };
  }
  try {
    const result = await runAIAction({
      action,
      payload: source.payload && typeof source.payload === 'object' ? source.payload : {},
      config: stored,
      apiKey
    });
    appendAILog({ action, success: true, model: stored.model, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    appendAILog({ action, success: false, failure: error && error.code, model: stored.model, durationMs: Date.now() - startedAt });
    return aiFailure(error, 'AI 操作失败，原始内容已保留');
  }
});

ipcMain.handle('parse-notice', async function () {
  // 兼容旧面板的 IPC 名称；V2.1 统一走 window.workbench.ai。
  return { engine: 'disabled', error: 'V2 当前仅使用本地整理预览' };
});

// 桌面通知：启动时提醒逾期任务与今日日程
ipcMain.on('notify', (_evt, title, body) => {
  try {
    if (Notification.isSupported()) new Notification({ title: title || '个人工作台', body: body || '' }).show();
  } catch (e) { /* ignore */ }
});
