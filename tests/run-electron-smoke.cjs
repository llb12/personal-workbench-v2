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
const scenario=process.env.WB_ELECTRON_SMOKE_CASE||'normal';
assert.ok(['normal','legacy','corrupt'].includes(scenario),'Invalid smoke scenario');
const profile=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'personal-workbench-gui-'));
const legacy={
  schemaVersion:2,
  todos:[
    {id:'legacy-task',text:'历史待办',pid:'legacy-project',status:'waiting',waitingFor:'部门反馈',
      sourceType:'manual',due:'2027-02-03',dueMode:'fixed',reminderAt:'2027-02-02T09:30:00',
      tags:['历史','重要'],note:'保留此备注'},
    {id:'legacy-done',text:'历史已办',pid:'legacy-project',done:true,doneAt:'2026-09-01T10:00:00.000Z'}
  ],
  projects:[{id:'legacy-project',name:'历史项目',color:'#4f7cff',next:'复核旧数据'}],
  events:{'2026-10-18':[{text:'历史日程',repeat:'monthly'}]},
  note:'历史便签内容必须保留',
  inbox:[{id:'legacy-inbox',status:'new',rawText:'历史收件箱记录',sourceType:'paste'}],
  theme:'light'
};
const corrupted='{"todos":[{"id":"broken"';
if(scenario==='legacy')fs.writeFileSync(path.join(profile,'data.json'),JSON.stringify(legacy),'utf8');
if(scenario==='corrupt')fs.writeFileSync(path.join(profile,'data.json'),corrupted,'utf8');
const electron=require('electron');
const args=[path.join(__dirname,'electron-smoke.cjs'),'--user-data-dir='+profile,'--no-sandbox','--disable-gpu'];
const res=spawnSync(electron,args,{
  cwd:path.join(__dirname,'..'),
  timeout:120000,encoding:'utf8',maxBuffer:8*1024*1024,
  env:{...process.env,WB_ELECTRON_SMOKE_PROFILE:profile,WB_ELECTRON_SMOKE_CASE:scenario}
});
process.stdout.write(res.stdout||'');
process.stderr.write(res.stderr||'');
if(res.error)throw res.error;
assert.equal(res.status,0,'Electron GUI smoke process returned nonzero status');
assert.ok((res.stdout||'').includes('P0_ELECTRON_GUI_PASS'),'GUI smoke completion marker missing');
const dataFile=path.join(profile,'data.json');
assert.ok(fs.existsSync(dataFile),'Disposable profile unexpectedly missing');
const current=fs.readFileSync(dataFile,'utf8');
if(scenario==='corrupt'){
  assert.equal(current,corrupted,'Corrupt existing data was modified');
  assert.ok(!fs.existsSync(path.join(profile,'data.json.tmp')),'Unexpected data write');
  console.log('P0_ELECTRON_CORRUPT_PASS: invalid data preserved byte-for-byte, no write');
} else {
  const obj=JSON.parse(current);
  assert.ok(Array.isArray(obj.todos)&&obj.todos.some(x=>x.text==='CI Desktop Task'),'Task not written to disposable profile');
  if(scenario==='legacy'){
    assert.ok(obj.todos.some(x=>x.id==='legacy-task'),'Legacy task lost');
    assert.ok(obj.projects.some(x=>x.id==='legacy-project'),'Legacy project lost');
    assert.equal(obj.note,'历史便签内容必须保留');
    assert.ok(Array.isArray(obj.workLog)&&obj.workLog.some(x=>x.taskId==='legacy-done'&&x.type==='complete'));
    console.log('P0_ELECTRON_LEGACY_PASS: tasks, projects, note and completion records migrated');
  }
  assert.ok(fs.existsSync(path.join(profile,'desktop-ui.json')),'Desktop UI settings not written to disposable profile');
  console.log('P0_ELECTRON_PROFILE_PASS: disposable profile, task persistence and UI settings confirmed');
}
// Cleanup only the uniquely-created ephemeral CI directory, never developer data.
fs.rmSync(profile,{recursive:true,force:true});
