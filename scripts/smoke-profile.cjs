'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function inside(root, target) {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
function createSmokeProfile() {
  if (process.env.WORKBENCH_SMOKE_LOCAL !== '1') throw new Error('LOCAL_SMOKE_OPT_IN_REQUIRED');
  const temp = fs.realpathSync(os.tmpdir());
  const formal = process.env.APPDATA && path.resolve(process.env.APPDATA, 'personal-workbench-optimized');
  if (formal && inside(formal, temp)) throw new Error('LOCAL_SMOKE_PROFILE_FORBIDDEN');
  const profile = fs.mkdtempSync(path.join(temp, 'wb-local-smoke-'));
  assertSmokeProfile(profile, temp);
  fs.writeFileSync(path.join(profile, 'local-smoke-marker.json'), JSON.stringify({ kind: 'workbench-local-smoke', profile }));
  return profile;
}
function assertSmokeProfile(profile, temp = fs.realpathSync(os.tmpdir())) {
  const resolved = path.resolve(profile), physical = fs.realpathSync(resolved);
  const appData = process.env.APPDATA && path.resolve(process.env.APPDATA, 'personal-workbench-optimized');
  if (!inside(temp, resolved) || !/^wb-local-smoke-/.test(path.basename(resolved)) || physical.toLowerCase() !== resolved.toLowerCase() || (appData && inside(appData, physical))) {
    throw new Error('LOCAL_SMOKE_PROFILE_FORBIDDEN');
  }
  return physical;
}
module.exports = { createSmokeProfile, assertSmokeProfile };
