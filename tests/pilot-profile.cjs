'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { compareFields, relations } = require('../scripts/data-compatibility.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../.integration-evidence/final-pilot-20261020/private-manifest.json'), 'utf8'));
const profile = path.resolve(app.commandLine.getSwitchValue('user-data-dir'));
const relative = path.relative(path.join(manifest.privateRoot, 'profiles'), profile);
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'PRIVATE_PROFILE_REQUIRED');
assert.ok(app.commandLine.hasSwitch('workbench-pilot'), 'PILOT_GUARD_REQUIRED');
assert.equal(fs.realpathSync(profile), profile, 'LINKED_PROFILE_FORBIDDEN');
const baseline = JSON.parse(fs.readFileSync(path.join(manifest.backupDirectory, 'data.json'), 'utf8'));
require('../main.js');
let finished = false;
const timer = setTimeout(() => finish('PILOT_PROFILE_TIMEOUT'), 35000);
function finish(error, result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (error) console.error('PILOT_PROFILE_FAIL:' + error);
  else console.log('PILOT_PROFILE_PASS:' + JSON.stringify(result));
  if (!error && app.commandLine.hasSwitch('pilot-crash-check')) {
    console.log('PILOT_CONTROLLED_ABRUPT_EXIT_AFTER_FLUSH');
    app.exit(23);
  } else {
    app.quit();
    setImmediate(() => app.exit(error ? 1 : 0));
  }
}
(async () => {
  await app.whenReady();
  const started = Date.now();
  let win;
  while (Date.now() - started < 20000) {
    win = BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript("typeof loaded!=='undefined'&&loaded&&dataReady()", true)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(win, 'PILOT_WINDOW_MISSING');
  const rendered = await win.webContents.executeJavaScript('JSON.parse(JSON.stringify(data))', true);
  const fields = compareFields(baseline, rendered);
  assert.equal(fields.lostFields + fields.changedFields + fields.lostEntities, 0, 'PILOT_READ_FIELD_LOSS');
  const links = relations(rendered);
  const saved = await win.webContents.executeJavaScript('(function(){prepareDataForSave();var r=window.api.flush(JSON.parse(JSON.stringify(data)));return !!(r&&r.ok)})()', true);
  assert.equal(saved, true, 'PILOT_SAVE_FAILED');
  const disk = JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'));
  const savedFields = compareFields(baseline, disk);
  assert.equal(savedFields.lostFields + savedFields.changedFields + savedFields.lostEntities, 0, 'PILOT_SAVE_FIELD_LOSS');
  const config = await win.webContents.executeJavaScript('window.workbench.ai.getConfig()', true);
  assert.equal(config.offlinePilot, true, 'PILOT_OFFLINE_NOT_ACTIVE');
  assert.equal(config.hasApiKey, false, 'PILOT_KEY_MUST_BE_ABSENT');
  const audit = JSON.parse(fs.readFileSync(path.join(profile, 'pilot-audit.json'), 'utf8'));
  assert.equal(audit.ready, true, 'PILOT_RENDERER_NOT_READY');
  assert.equal(audit.formalAccessBlocked, 0, 'PILOT_ATTEMPTED_FORMAL_ACCESS');
  assert.equal(audit.writesOutsideProfileBlocked, 0, 'PILOT_ATTEMPTED_EXTERNAL_WRITE');
  finish(null, { fields, savedFields, relations: links, ready: audit.ready, offline: true, realKeyCopied: false });
})().catch(() => finish('PRIVATE_DATA_CHECK_FAILED_DETAILS_SUPPRESSED'));
