'use strict';
// Compose an inspectable candidate handoff. CI-only, never publishes a release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
assert.equal(process.env.CI, 'true', 'Candidate bundle must be created only in CI');
assert.equal(process.platform,'win32','Windows build required');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const dir=path.join(root,'release');
const names=[
  'Personal_Workbench_Setup_'+pkg.version+'.exe',
  'Personal_Workbench_Portable_'+pkg.version+'.exe'
];
for(const name of names){
  assert.match(name,/^[A-Za-z0-9_.-]+$/,'ASCII filename required');
  assert.ok(fs.existsSync(path.join(dir,name)),'Missing tested executable '+name);
}
const hashes=names.map(name=>{
  const bytes=fs.readFileSync(path.join(dir,name));
  assert.ok(bytes.length>5*1024*1024,'Unexpected binary size');
  assert.equal(bytes.subarray(0,2).toString('ascii'),'MZ','Invalid Windows PE binary');
  return {name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
});
const manifest={
  candidate:true,
  releaseApproved:false,
  gitCommit:process.env.GITHUB_SHA||'unknown',
  buildVersion:pkg.version,
  profile:'GitHub Actions disposable Windows runner',
  targets:hashes
};
const instructions=[
  'Personal Workbench — TEST-ONLY Windows Candidate',
  'Git commit: '+manifest.gitCommit,
  'Version: '+pkg.version,
  '',
  'These are UNSIGNED test candidates, not an approved production release.',
  'DO NOT install over the current Personal Workbench or replace any existing data.json.',
  'DO NOT copy personal credentials, work logs or business data into an unverified test profile.',
  'Run only after independent source review and on a disposable Windows profile or test machine.',
  'Check SHA256SUMS.txt and candidate_manifest.json against the downloaded executables.',
  'Local Git divergence review, userData backup verification, sleep/wake reminders and real-PC',
  'regression remain BLOCKED or NOT_EXECUTED; GitHub CI does not cover those steps.',
  '',
  'Files:',
  ...hashes.map(h=>' - '+h.name+' ['+h.bytes+' bytes]'),
  ''
].join('\r\n');
fs.writeFileSync(path.join(dir,'CANDIDATE_README.txt'),instructions,'utf8');
fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),
  hashes.map(h=>h.sha256+'  '+h.name).join('\r\n')+'\r\n','ascii');
fs.writeFileSync(path.join(dir,'candidate_manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log('P0_CANDIDATE_BUNDLE_PASS '+JSON.stringify({commit:manifest.gitCommit,targets:hashes}));
