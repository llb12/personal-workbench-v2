'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createSmokeProfile, assertSmokeProfile } = require('../scripts/smoke-profile.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-smoke-guard-test-'));
const previous = Object.fromEntries(['WORKBENCH_SMOKE_LOCAL', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA'].map(key => [key, process.env[key]]));
try {
  delete process.env.WORKBENCH_SMOKE_LOCAL;
  assert.throws(createSmokeProfile, /LOCAL_SMOKE_OPT_IN_REQUIRED/);
  process.env.WORKBENCH_SMOKE_LOCAL = '1';
  process.env.APPDATA = path.join(root, 'synthetic-appdata');
  const formal = path.join(process.env.APPDATA, 'personal-workbench-optimized');
  fs.mkdirSync(formal, { recursive: true }); process.env.TEMP = formal; process.env.TMP = formal; process.env.TMPDIR = formal;
  assert.throws(createSmokeProfile, /LOCAL_SMOKE_PROFILE_FORBIDDEN/);
  assert.deepEqual(fs.readdirSync(formal), [], 'Forbidden temp must be rejected before creating anything');
  process.env.TEMP = root; process.env.TMP = root; process.env.TMPDIR = root;
  const profile = createSmokeProfile(); assert.equal(assertSmokeProfile(profile), fs.realpathSync(profile));
  const link = path.join(root, 'wb-local-smoke-linked'); fs.symlinkSync(profile, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertSmokeProfile(link), /LOCAL_SMOKE_PROFILE_FORBIDDEN/);
} finally {
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
console.log('SMOKE_PROFILE_PASS: explicit opt-in, physical disposable profile and pre-write rejection of formal-directory aliases');
