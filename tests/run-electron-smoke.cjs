'use strict';
// Run only in a disposable CI Windows runner. Never use a developer's real app profile.
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
assert.equal(process.platform,'win32','Electron smoke test must run on Windows');
assert.equal(process.env.CI,'true','Electron smoke test requires CI');
assert.ok(process.env.RUNNER_TEMP,'Missing disposable runner temp directory');
const profile=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'personal-workbench-gui-'));
const electron=require('electron');
const args=[path.join(__dirname,'electron-smoke.cjs'),'--user-data-dir='+profile,'--no-sandbox','--disable-gpu'];
const res=spawnSync(electron,args,{
  cwd:path.join(__dirname,'..'),
  timeout:120000,encoding:'utf8',maxBuffer:8*1024*1024,
  env:{...process.env,WB_ELECTRON_SMOKE_PROFILE:profile}
});
process.stdout.write(res.stdout||'');
process.stderr.write(res.stderr||'');
if(res.error)throw res.error;
assert.equal(res.status,0,'Electron GUI smoke process returned nonzero status');
assert.ok((res.stdout||'').includes('P0_ELECTRON_GUI_PASS'),'GUI smoke completion marker missing');
const dataFile=path.join(profile,'data.json');
assert.ok(fs.existsSync(dataFile),'Disposable profile was not used or not saved');
const obj=JSON.parse(fs.readFileSync(dataFile,'utf8'));
assert.ok(Array.isArray(obj.todos)&&obj.todos.some(x=>x.text==='CI Desktop Task'),'Task not written to disposable profile');
const deskFile=path.join(profile,'desktop-ui.json');
assert.ok(fs.existsSync(deskFile),'Desktop UI settings not written to disposable profile');
console.log('P0_ELECTRON_PROFILE_PASS: temporary profile, task persistence and desktop settings confirmed');
// Cleanup only the uniquely-created ephemeral CI directory, never developer data.
fs.rmSync(profile,{recursive:true,force:true});
