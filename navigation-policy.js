'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isEntryURL(value, entry) {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' && !url.search && path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(entry).toLowerCase();
  } catch (_) { return false; }
}
function externalURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch (_) { return null; }
}
function protectNavigation(contents, entry, openExternal) {
  contents.setWindowOpenHandler(({ url }) => {
    const allowed = externalURL(url);
    if (allowed && openExternal) Promise.resolve().then(() => openExternal(allowed)).catch(() => {});
    return { action: 'deny' };
  });
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    contents.on(name, (event, url) => {
      const target = typeof url === 'string' ? url : event.url;
      if (!isEntryURL(target, entry)) event.preventDefault();
    });
  }
}
function trustedSender(event, win, entry) {
  if (!win || win.isDestroyed() || !event || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  return !!frame && frame === win.webContents.mainFrame && isEntryURL(frame.url, entry);
}
function protectedIPC(ipcMain, getWindow, entry) {
  const denied = () => ({ ok: false, code: 'IPC_SOURCE_REJECTED', error: '请求来源不受信任' });
  return {
    handle: (channel, handler) => ipcMain.handle(channel, (event, ...args) => trustedSender(event, getWindow(), entry) ? handler(event, ...args) : denied()),
    on: (channel, handler) => ipcMain.on(channel, (event, ...args) => {
      if (!trustedSender(event, getWindow(), entry)) { event.returnValue = denied(); return; }
      return handler(event, ...args);
    })
  };
}
module.exports = { isEntryURL, externalURL, protectNavigation, trustedSender, protectedIPC };
