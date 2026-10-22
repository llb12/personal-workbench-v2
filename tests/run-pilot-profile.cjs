'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
assert.equal(root, 'C:\\Users\\19101\\Documents\\Codex\\personal-workbench-p0-integration-20261019');
assert.notEqual(process.env.CI, 'true');
const evidence = path.join(root, '.integration-evidence/final-pilot-20261020');
const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'private-manifest.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const backup = path.join(manifest.backupDirectory, 'data.json');
assert.equal(hash(backup), manifest.originalSha256);
assert.equal(hash(manifest.originalPath), manifest.originalSha256);
function mark(profile) {
  assert.equal(fs.realpathSync(profile), profile);
  const file = path.join(profile, 'profile-marker.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ kind: 'personal-workbench-isolated-pilot-v1', expectedUserData: profile }), { flag: 'wx' });
}
const restored = fs.mkdtempSync(path.join(manifest.privateRoot, 'profiles', 'restore-drill-'));
fs.copyFileSync(backup, path.join(restored, 'data.json'), fs.constants.COPYFILE_EXCL);
assert.equal(hash(path.join(restored, 'data.json')), manifest.originalSha256, 'RESTORED_BYTES_MUST_MATCH_BACKUP');
mark(manifest.compatibilityProfile); mark(restored);
async function run(profile, crash) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const args = [path.join(__dirname, 'pilot-profile.cjs'), '--workbench-pilot', '--user-data-dir=' + profile, '--disable-gpu'];
  if (crash) args.push('--pilot-crash-check');
  const child = spawn(require('electron'), args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', () => {});
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(status, crash ? 23 : 0, 'PRIVATE_PROFILE_PROCESS_FAILED');
  const line = output.split(/\r?\n/).find(x => x.startsWith('PILOT_PROFILE_PASS:'));
  assert.ok(line, 'PRIVATE_PROFILE_ACCEPTANCE_MISSING');
  return { mode: crash ? 'abrupt-exit-after-flush' : 'normal-close', result: JSON.parse(line.slice('PILOT_PROFILE_PASS:'.length)) };
}
(async () => {
  const results = [];
  results.push(await run(manifest.compatibilityProfile, false));
  results.push(await run(manifest.compatibilityProfile, true));
  results.push(await run(manifest.compatibilityProfile, false));
  results.push(await run(restored, false));
  assert.equal(hash(backup), manifest.originalSha256);
  assert.equal(hash(manifest.originalPath), manifest.originalSha256);
  const result = { outcome: 'PASS', scenarios: results, backupHashVerified: true, restoreBytesVerified: true, originalUnchanged: true, rawContentsLogged: false };
  fs.writeFileSync(path.join(evidence, 'private-profile-checks.json'), JSON.stringify(result, null, 2));
  console.log('PRIVATE_PROFILE_PASS: renderer read/save/restart, controlled abrupt exit after flush, backup restore; original fields and references preserved');
})().catch(() => { console.error('PRIVATE_PROFILE_BLOCKED: see safe acceptance markers; private details suppressed'); process.exitCode = 1; });
