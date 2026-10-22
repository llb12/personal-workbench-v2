'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const canonical = value => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
const inside = (value, root) => value === root || value.startsWith(root + path.sep);
function validateProfile(app) {
  if (!app.commandLine.hasSwitch('user-data-dir')) throw new Error('PILOT_EXPLICIT_PROFILE_REQUIRED');
  const profile = path.resolve(app.commandLine.getSwitchValue('user-data-dir'));
  const formal = path.join(app.getPath('appData'), 'personal-workbench-optimized');
  if (inside(canonical(profile), canonical(formal))) throw new Error('PILOT_FORMAL_PROFILE_FORBIDDEN');
  if (canonical(fs.realpathSync(profile)) !== canonical(profile)) throw new Error('PILOT_LINKED_PROFILE_FORBIDDEN');
  const marker = JSON.parse(fs.readFileSync(path.join(profile, 'profile-marker.json'), 'utf8'));
  if (marker.kind !== 'personal-workbench-isolated-pilot-v1' || canonical(marker.expectedUserData) !== canonical(profile)) throw new Error('PILOT_PROFILE_MARKER_INVALID');
  if (canonical(app.getPath('userData')) !== canonical(profile)) throw new Error('PILOT_ELECTRON_PROFILE_MISMATCH');
  return { profile, formal };
}
function activate(app, session) {
  const location = validateProfile(app);
  const profile = canonical(location.profile), formal = canonical(location.formal);
  const audit = { active: true, version: typeof app.getVersion === 'function' ? app.getVersion() : null, formalAccessBlocked: 0, writesOutsideProfileBlocked: 0, networkBlocked: 0, permissionsDenied: 0, applicationWindows: 0 };
  const writeAudit = fs.writeFileSync.bind(fs);
  function check(value, write) {
    if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof URL)) return;
    const target = canonical(value instanceof URL ? require('node:url').fileURLToPath(value) : String(value));
    if (inside(target, formal)) { audit.formalAccessBlocked++; throw Object.assign(new Error('PILOT_FORMAL_ACCESS_BLOCKED'), { code: 'EACCES' }); }
    if (write && !inside(target, profile)) { audit.writesOutsideProfileBlocked++; throw Object.assign(new Error('PILOT_WRITE_OUTSIDE_PROFILE_BLOCKED'), { code: 'EACCES' }); }
  }
  for (const name of ['readFileSync', 'readFile', 'statSync', 'stat', 'lstatSync', 'lstat', 'existsSync', 'readdirSync', 'readdir', 'realpathSync', 'realpath', 'accessSync', 'access', 'createReadStream']) {
    const original = fs[name]; if (typeof original === 'function') fs[name] = function (file, ...args) { check(file, false); return original.call(this, file, ...args); };
    if (original.native) fs[name].native = fs[name];
  }
  for (const name of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'unlinkSync', 'unlink', 'rmSync', 'rm', 'rmdirSync', 'rmdir', 'truncateSync', 'truncate', 'createWriteStream']) {
    const original = fs[name]; if (typeof original === 'function') fs[name] = function (file, ...args) { check(file, true); return original.call(this, file, ...args); };
  }
  for (const name of ['renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync', 'cp']) {
    const original = fs[name]; if (typeof original === 'function') fs[name] = function (from, to, ...args) { check(from, name.startsWith('rename')); check(to, true); return original.call(this, from, to, ...args); };
  }
  for (const name of ['openSync', 'open']) {
    const original = fs[name]; fs[name] = function (file, flags, ...args) { check(file, typeof flags === 'number' ? flags !== 0 : /[wa+]/.test(String(flags))); return original.call(this, file, flags, ...args); };
  }
  function blockedRequest() {
    audit.networkBlocked++;
    const request = new EventEmitter(); request.setTimeout = () => request; request.write = () => true; request.destroy = () => request;
    request.end = () => { process.nextTick(() => request.emit('error', Object.assign(new Error('PILOT_OFFLINE'), { code: 'ECONNREFUSED' }))); return request; };
    return request;
  }
  for (const transport of [require('node:http'), require('node:https')]) { transport.request = blockedRequest; transport.get = () => { const r = blockedRequest(); r.end(); return r; }; }
  globalThis.fetch = async () => { audit.networkBlocked++; throw new Error('PILOT_OFFLINE'); };
  function protect(current) {
    current.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'] }, (details, callback) => {
      if (!details.url.startsWith('file:')) { audit.networkBlocked++; callback({ cancel: true }); return; }
      try { check(new URL(details.url), false); callback({ cancel: false }); } catch (_) { callback({ cancel: true }); }
    });
    current.setPermissionRequestHandler((_web, _permission, callback) => { audit.permissionsDenied++; callback(false); });
    current.setPermissionCheckHandler(() => false);
  }
  app.on('session-created', (...args) => { const current = args.find(value => value && value.webRequest); if (current) protect(current); });
  app.once('ready', () => protect(session.defaultSession));
  app.on('browser-window-created', (_event, window) => {
    audit.applicationWindows++;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:')) event.preventDefault(); });
  });
  function persist() { writeAudit(path.join(location.profile, 'pilot-audit.json'), JSON.stringify(audit, null, 2) + '\n', 'utf8'); }
  app.on('will-quit', persist);
  return { active: true, profile: location.profile, audit, persist };
}
module.exports = { activate, validateProfile };
