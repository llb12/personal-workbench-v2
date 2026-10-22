'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage, Tray, Menu, nativeImage, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { analyzeInboxWithAI, testAIConnection, runAIAction } = require('./ai-adapter');
const { createDesktopLifecycle } = require('./desktop-lifecycle');
const { createWeatherClient } = require('./weather-client');
const weatherClient = createWeatherClient();
const { protectNavigation, protectedIPC } = require('./navigation-policy');
const { createDataWriter, validateData } = require('./data-persistence');
let pilot = { active: false };
if ((app.isPackaged && fs.existsSync(path.join(__dirname, 'pilot-mode.json'))) || app.commandLine.hasSwitch('workbench-pilot')) {
  try { pilot = require('./pilot-runtime').activate(app, session); }
  catch (_) { console.error('PILOT_START_BLOCKED: use the isolated trial launcher and its protected profile'); app.exit(78); throw new Error('PILOT_START_BLOCKED'); }
}

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
  if (pilot.active) return { ...DEFAULT_AI_CONFIG, enabled: false, privacyMode: 'confirm', offlinePilot: true };
  try {
    const f = aiConfigFile();
    if (!fs.existsSync(f)) return { ...DEFAULT_AI_CONFIG };
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...DEFAULT_AI_CONFIG };
    const retained = { ...obj };
    ['apiKey', 'apikey', 'api_key', 'password', 'token', 'secret'].forEach(key => { delete retained[key]; });
    return {
      ...DEFAULT_AI_CONFIG,
      ...retained,
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
    secureStorage: isSecureStorageAvailable(),
    offlinePilot: !!config.offlinePilot
  };
}

function saveAIConfig(input) {
  if (pilot.active) throw new Error('PILOT_OFFLINE');
  const current = readAIConfig();
  const next = {
    ...current,
    enabled: !!(input && input.enabled),
    baseUrl: input && typeof input.baseUrl === 'string' && input.baseUrl.trim() ? input.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    model: input && typeof input.model === 'string' ? input.model.trim() : '',
    timeoutMs: input && Number.isFinite(Number(input.timeoutMs)) ? Math.max(3000, Math.min(120000, Math.round(Number(input.timeoutMs)))) : DEFAULT_AI_CONFIG.timeoutMs,
    privacyMode: input && ['full', 'compact', 'confirm'].includes(input.privacyMode) ? input.privacyMode : (current.privacyMode || DEFAULT_AI_CONFIG.privacyMode),
    maxContextItems: input && Number.isFinite(Number(input.maxContextItems)) ? Math.max(10, Math.min(300, Math.round(Number(input.maxContextItems)))) : (current.maxContextItems || DEFAULT_AI_CONFIG.maxContextItems),
    maxHistoryDays: input && Number.isFinite(Number(input.maxHistoryDays)) ? Math.max(1, Math.min(365, Math.round(Number(input.maxHistoryDays)))) : (current.maxHistoryDays || DEFAULT_AI_CONFIG.maxHistoryDays),
    maxMessageLength: input && Number.isFinite(Number(input.maxMessageLength)) ? Math.max(500, Math.min(20000, Math.round(Number(input.maxMessageLength)))) : (current.maxMessageLength || DEFAULT_AI_CONFIG.maxMessageLength)
  };
  const suppliedKey = input && typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (suppliedKey) {
    if (isSecureStorageAvailable()) {
      next.apiKeyCiphertext = safeStorage.encryptString(suppliedKey).toString('base64');
      volatileAIKey = '';
    } else {
      // 不安全时宁可只保留在本次进程内，也不明文写盘。
      volatileAIKey = suppliedKey;
    }
  }
  writeJsonAtomic(aiConfigFile(), next);
  return publicAIConfig({ ...next, apiKeyCiphertext: next.apiKeyCiphertext || '' });
}

function clearSavedAIKey() {
  if (pilot.active) throw new Error('PILOT_OFFLINE');
  volatileAIKey = '';
  const next = readAIConfig();
  delete next.apiKeyCiphertext;
  writeJsonAtomic(aiConfigFile(), next);
  return publicAIConfig(next);
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
  if (code === 'AI_NOT_CONFIGURED') return { engine: 'unconfigured', code, message: '尚未配置 AI 助手' };
  const messages = {
    AI_CONFIG_INVALID: 'AI 地址或模型名称无效，请检查设置',
    AI_INSECURE_URL: '仅允许 HTTPS 或本机 HTTP 地址',
    AI_AUTH_ERROR: 'API Key 无效或没有调用权限，请检查密钥',
    AI_MODEL_ERROR: '模型不可用或未授权，请检查模型名称和服务权限',
    AI_REQUEST_INVALID: '请求格式不受 AI 服务支持，请检查接口地址、参数兼容性或上下文长度',
    AI_QUOTA_ERROR: 'AI 服务当前限流或额度不足，请稍后重试并检查服务额度',
    AI_RESPONSE_INVALID: 'AI 返回格式不符合要求，自动纠正后仍未通过，请重试或使用本地整理',
    AI_INVALID_RESPONSE: 'AI 返回内容不完整、格式错误或无法读取',
    AI_TIMEOUT: 'AI 请求超时，请检查网络或延长超时时间后重试',
    AI_NETWORK_ERROR: '无法连接 AI 服务，请检查网络及 API 地址',
    AI_HTTP_ERROR: 'AI 服务返回错误，请稍后重试或检查服务状态',
    AI_RESPONSE_TOO_LARGE: 'AI 返回内容过大，请分段整理'
  };
  if (messages[code]) return { engine: 'error', code, message: messages[code] + '；原始内容已保留' };
  return { engine: 'error', code: code || 'AI_ERROR', message: fallback || 'AI 操作失败，原始内容已保留' };
}

const EMPTY = {
  schemaVersion: 4,
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
const dataWriter = createDataWriter({ file: dataFile, fs });

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
      dataWriter.prime(null);
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
  const invalid = validateData(obj, true);
  if (invalid) return loadFailure('DATA_CORRUPT', '数据结构无效，已保护原文件：' + invalid, f);
  dataWriter.prime(Buffer.from(raw, 'utf8'));
  loadState = 'ready';
  return obj;
}

function writeData(data, options) {
  if (loadState !== 'ready') return { ok: false, code: 'DATA_WRITE_BLOCKED', error: '数据加载失败，已保护原文件；请先重试加载。' };
  return dataWriter.write(data, options);
}

let win = null;
let desktop = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 920,
    minWidth: 520,
    minHeight: 440,
    ...(desktop ? desktop.getWindowBounds() : {}),
    backgroundColor: '#eef1f5',
    transparent: false,
    autoHideMenuBar: true,
    title: pilot.active ? '个人工作台 · 隔离试用' : '个人工作台',
    webPreferences: {
      // Keep reminder timers active while an opted-in user hides the window to the tray.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: pilot.active ? ['--workbench-offline-pilot'] : [],
      sandbox: true
    }
  });

  protectNavigation(win.webContents, path.join(__dirname, 'index.html'), pilot.active ? null : url => shell.openExternal(url));
  win.setMenuBarVisibility(false);
  if (pilot.active) win.webContents.on('page-title-updated', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));

  if (desktop) desktop.attachWindow(win);
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
    desktop = createDesktopLifecycle({
      app, screen, Tray, Menu, nativeImage, fs, path,
      // Native tray image must be a real OS file when running from app.asar.
      iconPath: app.isPackaged
        ? path.join(process.resourcesPath, 'tray', 'icon.ico')
        : path.join(__dirname, 'build', 'icon.ico'),
      getWindow: () => win
    });
    createWindow();
    desktop.ensureTray();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (desktop) desktop.beforeQuit(); });
app.on('will-quit', () => { if (desktop) desktop.willQuit(); });

// ---- IPC ----
const ownIPC = protectedIPC(ipcMain, () => win, path.join(__dirname, 'index.html'));
ownIPC.on('pilot-ready', (event, input) => {
  if (!pilot.active || !win || event.sender !== win.webContents) return;
  pilot.audit.ready = true;
  pilot.audit.counts = {};
  for (const key of ['schemaVersion', 'tasks', 'projects', 'records', 'inbox']) {
    const value = input && input[key];
    if (Number.isSafeInteger(value) && value >= 0) pilot.audit.counts[key] = value;
  }
  pilot.persist();
});
// Desktop UI settings are intentionally separate from data.json and AI key storage.
ownIPC.handle('desktop-get-settings', () =>
  desktop ? desktop.getSettings() : { closeToTray:false, trayAvailable:false, appVersion: app.getVersion() });
ownIPC.handle('desktop-set-settings', (_event, input) =>
  desktop ? desktop.setSettings(input) : {ok:false,error:'桌面窗口尚未就绪'});
ownIPC.handle('weather-get', async (_event, input) => {
  if (pilot.active) return { ok: false, error: '隔离预览不联网', offline: true };
  try { return { ok: true, weather: await weatherClient.getWeather(input) }; }
  catch (error) {
    const message = String(error && error.message || '');
    return { ok: false, error: /^(请|未找到|存在|天气|中国|无法连接)/.test(message) && message.length < 100 ? message : '天气服务暂时不可用，请重试' };
  }
});
ownIPC.handle('load-data', () => readData());

ownIPC.handle('save-data', (_evt, data, options) => writeData(data, options));

ownIPC.on('flush-data', (event, data) => {
  event.returnValue = writeData(data);
});

ownIPC.handle('export-data', async (_evt, data) => {
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
  if (obj.schemaVersion !== undefined && (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1 || obj.schemaVersion > 4)) {
    return 'schemaVersion 无效';
  }
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

  if (obj.workLog !== undefined) {
    if (!Array.isArray(obj.workLog)) return 'workLog 必须是数组';
    if (obj.workLog.length > 500000) return 'workLog 数量超过允许上限';
    for (let i = 0; i < obj.workLog.length; i += 1) {
      const entry = obj.workLog[i];
      if (!isPlainObject(entry)) return 'workLog[' + i + '] 必须是对象';
      if (entry.id !== undefined && typeof entry.id !== 'string') return 'workLog[' + i + '].id 必须是字符串';
      if (entry.type !== undefined && typeof entry.type !== 'string') return 'workLog[' + i + '].type 必须是字符串';
      if (entry.taskId !== undefined && entry.taskId !== null && typeof entry.taskId !== 'string') {
        return 'workLog[' + i + '].taskId 必须是字符串或 null';
      }
      if (entry.projectId !== undefined && entry.projectId !== null && typeof entry.projectId !== 'string') {
        return 'workLog[' + i + '].projectId 必须是字符串或 null';
      }
      if (entry.at !== undefined && !isDateTimeOrEmpty(entry.at)) return 'workLog[' + i + '].at 日期格式无效';
      if (entry.snapshot !== undefined && !isPlainObject(entry.snapshot)) return 'workLog[' + i + '].snapshot 必须是对象';
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

ownIPC.handle('import-data', async () => {
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

ownIPC.handle('get-data-path', () => dataFile());

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

ownIPC.handle('ai-get-config', () => publicAIConfig(readAIConfig()));

ownIPC.handle('ai-save-config', (_evt, input) => {
  try {
    return { ok: true, config: saveAIConfig(input || {}) };
  } catch (_) {
    return { ok: false, message: 'AI 设置保存失败' };
  }
});

ownIPC.handle('ai-clear-key', (_evt, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '请先确认清除 API Key' };
  try {
    return { ok: true, config: clearSavedAIKey() };
  } catch (_) {
    return { ok: false, message: 'API Key 清除失败' };
  }
});

ownIPC.handle('ai-test-connection', async (_evt, input) => {
  const startedAt = Date.now();
  const stored = readAIConfig();
  const source = input && typeof input === 'object' ? input : {};
  const formKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : '';
  const apiKey = formKey || readAIKey(stored);
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

ownIPC.handle('ai-organize-inbox', async (_evt, payload) => {
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

ownIPC.handle('ai-run-action', async (_evt, input) => {
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

ownIPC.handle('parse-notice', async function () {
  // 兼容旧面板的 IPC 名称；V2.1 统一走 window.workbench.ai。
  return { engine: 'disabled', error: 'V2 当前仅使用本地整理预览' };
});

// 桌面通知：启动时提醒逾期任务与今日日程
ownIPC.on('notify', (_evt, title, body) => {
  if (pilot.active) return;
  try {
    if (Notification.isSupported()) new Notification({ title: title || '个人工作台', body: body || '' }).show();
  } catch (e) { /* ignore */ }
});
