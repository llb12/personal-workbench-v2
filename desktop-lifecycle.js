'use strict';

// Electron desktop-only settings. Never stores business data, tasks, reminders or secrets.
// This module takes Electron dependencies as arguments to permit isolated Node tests.
function createDesktopLifecycle(deps) {
  const {app, screen, Tray, Menu, nativeImage, fs, path, iconPath, getWindow, onQuickCapture} = deps;
  const platform = deps.platform || process.platform;
  const settingsFile = path.join(app.getPath('userData'), 'desktop-ui.json');
  const defaultSettings = { closeToTray: false, bounds: null };
  let settings = { ...defaultSettings };
  let tray = null;
  let quitting = false;
  let saveTimer = null;
  let currentWindow = null;

  function validBounds(value) {
    if (!value || typeof value !== 'object') return null;
    const keys = ['x','y','width','height'];
    if (!keys.every(key => Number.isInteger(value[key]) && Math.abs(value[key]) < 100000)) return null;
    const {x,y,width,height} = value;
    if (width < 520 || height < 440 || width > 6000 || height > 5000) return null;
    return {x,y,width,height};
  }

  function readSettings() {
    try {
      if (!fs.existsSync(settingsFile)) return;
      const raw = fs.readFileSync(settingsFile, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > 4096) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      settings.closeToTray = parsed.closeToTray === true;
      settings.bounds = validBounds(parsed.bounds);
    } catch (error) {
      // Invalid settings cannot stop the app from launching or alter business data.
      console.warn('[desktop-ui] settings ignored:', error && error.code || 'invalid-json');
    }
  }
  readSettings();

  function persistSettings() {
    try {
      const dir = path.dirname(settingsFile);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = settingsFile + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
      fs.renameSync(tmp, settingsFile);
      return {ok: true};
    } catch (error) {
      console.warn('[desktop-ui] settings save failed:', error && error.code || 'unknown');
      return {ok: false, error: '桌面设置保存失败，请检查用户目录权限'};
    }
  }

  function flushWindowBounds() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (currentWindow && !currentWindow.isDestroyed() &&
      !currentWindow.isMaximized() && !currentWindow.isMinimized()) {
      const bounds = validBounds(currentWindow.getNormalBounds());
      if (bounds) settings.bounds = bounds;
    }
    return persistSettings();
  }
  function scheduleWindowBounds() {
    if (!currentWindow || currentWindow.isDestroyed() ||
      currentWindow.isMaximized() || currentWindow.isMinimized()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushWindowBounds, 350);
  }

  function getWindowBounds() {
    const candidate = validBounds(settings.bounds);
    if (!candidate) return {};
    // Reject stale/off-screen coordinates after monitor changes.
    const displays = screen.getAllDisplays();
    if (!Array.isArray(displays) || !displays.length) return {};
    for (const display of displays) {
      const work = display.workArea;
      if (!work) continue;
      const left = Math.max(work.x, candidate.x);
      const top = Math.max(work.y, candidate.y);
      const right = Math.min(work.x + work.width, candidate.x + candidate.width);
      const bottom = Math.min(work.y + work.height, candidate.y + candidate.height);
      if (right - left >= 160 && bottom - top >= 100) {
        // Keep the title bar and a usable window region on-screen.
        return {
          ...candidate,
          x: Math.min(Math.max(candidate.x, work.x), work.x + work.width - Math.min(candidate.width, 160)),
          y: Math.min(Math.max(candidate.y, work.y), work.y + work.height - Math.min(candidate.height, 100))
        };
      }
    }
    return {};
  }

  function showWindow() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  function quickCapture() {
    showWindow();
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    // Listener is installed by the renderer after initialization.
    const send = () => {
      if (win.isDestroyed()) return;
      if (typeof onQuickCapture === 'function') onQuickCapture(win);
      else win.webContents.send('desktop-quick-capture');
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }

  function ensureTray() {
    if (tray) return true;
    if (platform !== 'win32') return false;
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img || img.isEmpty()) return false;
      tray = new Tray(img);
      tray.setToolTip('个人工作台');
      tray.setContextMenu(Menu.buildFromTemplate([
        {label: '打开个人工作台', click: showWindow},
        {label: '快速记录', click: quickCapture},
        {type: 'separator'},
        {label: '退出个人工作台', click: () => { quitting = true; app.quit(); }}
      ]));
      tray.on('double-click', showWindow);
      return true;
    } catch (error) {
      console.warn('[desktop-ui] tray unavailable:', error && error.code || 'unknown');
      if (tray) { try { tray.destroy(); } catch (_) {} }
      tray = null;
      return false;
    }
  }

  function attachWindow(win) {
    currentWindow = win;
    win.on('move', scheduleWindowBounds);
    win.on('resize', scheduleWindowBounds);
    win.on('close', event => {
      // Flush normal bounds before either hiding or quitting.
      flushWindowBounds();
      if (!quitting && settings.closeToTray && tray) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => { if (currentWindow === win) currentWindow = null; });
  }

  function getSettings() {
    return { closeToTray: settings.closeToTray && !!tray, trayAvailable: !!tray };
  }
  function setSettings(input) {
    if (!input || typeof input.closeToTray !== 'boolean') return {ok:false,error:'桌面设置参数无效'};
    if (input.closeToTray && !tray) return {ok:false,error:'当前环境不支持系统托盘，请保持关闭时退出'};
    const previous = settings.closeToTray;
    settings.closeToTray = input.closeToTray;
    const result = persistSettings();
    if (!result.ok) settings.closeToTray = previous;
    return {...result, ...getSettings()};
  }
  function beforeQuit() {
    quitting = true;
    flushWindowBounds();
    if (tray) { try { tray.destroy(); } catch (_) {} tray = null; }
  }

  return {
    getWindowBounds, attachWindow, ensureTray, getSettings, setSettings,
    showWindow, quickCapture, beforeQuit,
    // Diagnostics for isolated tests; never exported to renderer.
    _settingsPath: settingsFile
  };
}

module.exports = { createDesktopLifecycle };
