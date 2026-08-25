'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');

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

// ---- 通知→待办 AI 解析（桥接到外部 OpenAI 兼容 LLM，密钥仅存本地配置文件）----
function pad2(n) { return String(n).padStart(2, '0'); }
function wbTodayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function wbWeekday() { return ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]; }
function readBridgeConfig() {
  try {
    var f = path.join(__dirname, 'bridge.config.json');
    if (!fs.existsSync(f)) return null;
    var j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j || !j.baseUrl || !j.apiKey) return null;
    return j;
  } catch (e) { return null; }
}
function wbNormalizeDue(s) {
  if (s === null || s === undefined || s === '') return null;
  var str = String(s).trim();
  if (/^null$/i.test(str)) return null;
  var m = str.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) { var y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + pad2(mo) + '-' + pad2(d); }
  var dt = new Date(str);
  if (!isNaN(dt.getTime())) return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  return null;
}
function wbCallLLM(cfg, systemMsg, userMsg) {
  return new Promise(function (resolve, reject) {
    var base = String(cfg.baseUrl).replace(/\/+$/, '');
    var u;
    try { u = new url.URL(base + '/chat/completions'); } catch (e) { return reject(new Error('baseUrl 格式错误')); }
    var body = JSON.stringify({
      model: cfg.model || '',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      temperature: cfg.temperature || 0.2
    });
    var lib = u.protocol === 'https:' ? https : http;
    var req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.apiKey || '') }
    }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          var j = JSON.parse(data);
          var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (typeof c !== 'string') return reject(new Error('LLM 返回格式异常'));
          resolve(c);
        } catch (e) { reject(new Error('解析 LLM 响应失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout((cfg.timeoutMs || 30000), function () { req.destroy(new Error('LLM 请求超时')); });
    req.write(body);
    req.end();
  });
}
function wbBuildSystem() {
  return '你是一个“通知转待办”提取器，专门处理中文公文/通知/工作群消息。\n'
    + '当前日期：' + wbTodayStr() + '（周' + wbWeekday() + '）。\n'
    + '任务：从用户给出的通知正文中，提取所有“需要去执行/办理”的待办事项。\n\n'
    + '规则：\n'
    + '- 只提取可执行动作（含“请/需/要求/于X前/截止/提交/完成/报送/填报/核对/上报/准备/落实/办理/反馈/确认/参加/整改/审批/汇总/整理/撰写”等动词）。\n'
    + '- 忽略：标题/文号、落款署名（如“人力资源部”）、联系方式、见附件说明、此致敬礼、抄送、纯背景描述。\n'
    + '- 每条输出：\n'
    + '  text：精简后的任务描述（去除编号/项目符号，保留核心动作与对象，≤40字）\n'
    + '  pri：优先级 high(紧急/务必/立即/限期/特急/严禁) / low(建议/可选/视情况/可延后/暂不) / mid(其它)\n'
    + '  due：截止日期 ISO YYYY-MM-DD；文中无明确期限则为 null；相对日期（明天/周五/月底/下周三）按当前日期推算\n'
    + '  owner：责任部门或人（文中明确提到才填），否则 null\n'
    + '  note：补充说明（如“详见附件”），否则 null\n'
    + '- 只输出一个 JSON 对象：{"todos":[...]}，不要任何解释、不要 markdown 代码块。';
}
ipcMain.handle('parse-notice', async function (_evt, text) {
  var cfg = readBridgeConfig();
  if (!cfg) return { engine: 'none' };
  try {
    var content = await wbCallLLM(cfg, wbBuildSystem(), String(text || ''));
    if (!content) return { engine: 'none' };
    var raw = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) {
      var mm = raw.match(/\{[\s\S]*\}/);
      if (mm) { try { obj = JSON.parse(mm[0]); } catch (e2) { obj = null; } }
    }
    if (!obj || !Array.isArray(obj.todos)) return { engine: 'ai', todos: [] };
    var todos = obj.todos.filter(function (t) { return t && t.text; }).map(function (t) {
      return {
        text: String(t.text).trim(),
        pri: (/^(high|mid|low)$/.test(t.pri) ? t.pri : 'mid'),
        due: wbNormalizeDue(t.due),
        owner: (t.owner || null),
        note: (t.note || null)
      };
    });
    return { engine: 'ai', todos: todos };
  } catch (e) {
    return { engine: 'none', error: String((e && e.message) || e) };
  }
});

// 桌面通知：启动时提醒逾期任务与今日日程
ipcMain.on('notify', (_evt, title, body) => {
  try {
    if (Notification.isSupported()) new Notification({ title: title || '个人工作台', body: body || '' }).show();
  } catch (e) { /* ignore */ }
});
