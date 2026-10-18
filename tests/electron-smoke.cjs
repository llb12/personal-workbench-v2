'use strict';
// Electron main-process GUI smoke. Guard must run before loading the app.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app, BrowserWindow}=require('electron');
const profile=process.env.WB_ELECTRON_SMOKE_PROFILE;
const scenario=process.env.WB_ELECTRON_SMOKE_CASE||'normal';
assert.ok(['normal','legacy','corrupt','import'].includes(scenario));
assert.equal(process.platform,'win32');
assert.equal(process.env.CI,'true');
assert.ok(profile&&process.env.RUNNER_TEMP,'CI-only profile missing');
const relative=path.relative(process.env.RUNNER_TEMP,profile);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Profile outside runner temp');
assert.equal(path.resolve(app.commandLine.getSwitchValue('user-data-dir')),path.resolve(profile),'Explicit user-data-dir mismatch');
app.commandLine.appendSwitch('disable-background-networking');
let finished=false;
const failTimer=setTimeout(()=>finish(new Error('Electron GUI smoke timed out')),55000);
function finish(error){
  if(finished)return;
  finished=true;
  clearTimeout(failTimer);
  if(error)console.error('P0_ELECTRON_GUI_FAIL:',error.stack||String(error));
  else console.log('P0_ELECTRON_GUI_PASS');
  process.exitCode=error?1:0;
  try{app.quit();}catch(_){process.exit(error?1:0);}
  setTimeout(()=>process.exit(error?1:0),3000).unref();
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('render-process-gone',(_ev,details)=>finish(new Error('Renderer crashed: '+JSON.stringify(details))));
});
if(scenario==='import'){
  const {dialog}=require('electron');
  const source=path.join(profile,'import-source.json');
  assert.ok(fs.existsSync(source),'Import source missing');
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});
}
require('../main.js');
async function pollUntil(fn,label,timeout=13000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{const value=await fn();if(value)return value;}catch(error){if(Date.now()-start>timeout-500)throw error;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Wait timed out: '+label);
}
async function smokeRenderer(){
  const check=(condition,label)=>{if(!condition)throw new Error(label);};
  const promptPromise=window.v2PromptModal({title:'CI Prompt',defaultValue:'input'});
  check(document.getElementById('promptModalMask').classList.contains('show'),'prompt did not open');
  document.getElementById('promptModalCancel').click();
  check((await promptPromise)===null,'prompt cancellation was not respected');

  const decisionPromise=wbDecisionModal({title:'CI Decision',message:'duplicate'});
  document.getElementById('wbDecisionSkip').click();
  check((await decisionPromise)==='skip','duplicate decision failed');

  window.v2OpenQuickRecord();
  check(document.getElementById('quickRecordMask').classList.contains('show'),'quick record did not open');
  const inner=window.v2PromptModal({title:'Nested Esc'});
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,keyCode:27,which:27}));
  check((await inner)===null,'Escape did not cancel top prompt');
  check(document.getElementById('quickRecordMask').classList.contains('show'),'Escape closed underlying modal');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,keyCode:27,which:27}));
  check(!document.getElementById('quickRecordMask').classList.contains('show'),'Second Escape did not close quick record');

  const undone=[];
  toast('CI First Undo',{undo:function(){undone.push('first');}});
  toast('CI Routine Notice');
  check(document.getElementById('toast').textContent.includes('CI First Undo'),'routine toast overwrote Undo');
  toast('CI Second Undo',{undo:function(){undone.push('second');}});
  document.querySelector('#toast .toast-undo').click();
  check(undone.length===1&&undone[0]==='first','first Undo did not execute');
  check(document.getElementById('toast').textContent.includes('CI Second Undo'),'second Undo did not remain queued');
  document.querySelector('#toast .toast-undo').click();
  check(undone.length===2&&undone[1]==='second','second Undo did not execute');

  window.v2Navigate('tasks');
  check(document.getElementById('v2TaskSearch')!==null,'task page did not render');
  window.v2OpenNewTask();
  check(document.getElementById('taskModalMask').classList.contains('show'),'new task modal not shown');
  document.getElementById('taskEditTitle').value='CI Desktop Task';
  document.getElementById('taskEditSave').click();
  check(data.todos.some(t=>t.text==='CI Desktop Task'||t.title==='CI Desktop Task'),'new task missing');
  check(!document.getElementById('taskModalMask').classList.contains('show'),'task modal not closed');

  const desktop=window.workbench.desktop;
  const cfg=await desktop.getSettings();
  check(typeof cfg.trayAvailable==='boolean','desktop preload IPC missing');
  if(cfg.trayAvailable) {
    const changed=await desktop.setSettings({closeToTray:true});
    check(changed.ok===true&&changed.closeToTray===true,'tray opt-in was not persisted');
  } else {
    const changed=await desktop.setSettings({closeToTray:true});
    check(changed.ok===false,'cannot enable unavailable tray');
  }
  const flushed=window.api.flush(JSON.parse(JSON.stringify(data)));
  check(flushed&&flushed.ok,'isolated task save failed');
  return {trayAvailable:cfg.trayAvailable,tasks:data.todos.length};
}
async function run(){
  await app.whenReady();
  assert.equal(path.resolve(app.getPath('userData')),path.resolve(profile),'Application profile isolation failed');
  const win=await pollUntil(()=>BrowserWindow.getAllWindows()[0],'BrowserWindow');
  if(scenario==='corrupt'){
    await pollUntil(async()=>{
      if(win.webContents.isLoading())return false;
      return win.webContents.executeJavaScript("typeof loadState !== 'undefined' && loadState==='failed' && !!document.getElementById('retryDataLoad')",true);
    },'corrupted data failure mode');
    const state=await win.webContents.executeJavaScript("(function(){return {loaded:loaded,loadState:loadState,saveEnabled:dataReady(),hasProtectedUI:!!document.querySelector('.v2-load-failure')}})()",true);
    assert.equal(state.loadState,'failed');
    assert.equal(state.saveEnabled,false);
    assert.equal(state.hasProtectedUI,true);
    const result=await win.webContents.executeJavaScript("window.api.flush({todos:[{text:'DANGER'}]})",true);
    assert.equal(result.ok,false,'flush must be forbidden after corrupt data');
    assert.equal(result.code,'DATA_WRITE_BLOCKED');
    console.log('P0_ELECTRON_CORRUPT_UI_PASS: protected failure mode, write blocked');
    finish(null);return;
  }
  await pollUntil(async()=>{
    if(win.webContents.isLoading())return false;
    return win.webContents.executeJavaScript('typeof loaded !== "undefined" && loaded && dataReady() && typeof window.v2OpenNewTask==="function"',true);
  },'renderer ready');
  if(scenario==='legacy'){
    const migration=await win.webContents.executeJavaScript("(function(){return {version:data.schemaVersion,tasks:data.todos,projects:data.projects,events:data.events,note:data.note,inbox:data.inbox,workLog:data.workLog}})()",true);
    assert.equal(migration.version,3);
    assert.equal(migration.tasks.find(t=>t.id==='legacy-task').waitingFor,'部门反馈');
    assert.equal(migration.tasks.find(t=>t.id==='legacy-task').due,'2027-02-03');
    assert.equal(migration.tasks.find(t=>t.id==='legacy-task').note,'保留此备注');
    assert.equal(migration.projects.find(p=>p.id==='legacy-project').name,'历史项目');
    assert.equal(migration.events['2026-10-18'][0].text,'历史日程');
    assert.equal(migration.note,'历史便签内容必须保留');
    assert.equal(migration.inbox[0].rawText,'历史收件箱记录');
    assert.ok(migration.workLog.some(x=>x.taskId==='legacy-done'&&x.type==='complete'));
    console.log('P0_ELECTRON_LEGACY_UI_PASS: legacy v2 schema preserved in rendered data');
  }
  const result=await win.webContents.executeJavaScript('('+smokeRenderer.toString()+')()',true);
  console.log('P0_ELECTRON_GUI_CHECKS: '+JSON.stringify(result));
  if(scenario==='import'){
    await win.webContents.executeJavaScript("document.getElementById('btnImport').click();true",true);
    await pollUntil(()=>win.webContents.executeJavaScript("document.getElementById('wbConfirmMask').classList.contains('show')",true),'import confirm');
    const confirmed=await win.webContents.executeJavaScript("(function(){return document.getElementById('wbConfirmMessage').textContent.includes('覆盖当前全部数据')})()",true);
    assert.equal(confirmed,true,'Import confirmation text missing');
    await win.webContents.executeJavaScript("document.getElementById('wbConfirmAccept').click();true",true);
    await pollUntil(async()=>{
      const disk=path.join(profile,'data.json');
      try{
        const persisted=JSON.parse(fs.readFileSync(disk,'utf8'));
        return persisted.todos.some(t=>t.id==='imported-task');
      }catch(_){return false;}
    },'import persistence');
    const current=await win.webContents.executeJavaScript("(function(){return {taskIds:data.todos.map(x=>x.id),note:data.note}})()",true);
    assert.ok(current.taskIds.includes('imported-task'),'Imported task not displayed');
    assert.equal(current.note,'导入便签');
    console.log('P0_ELECTRON_IMPORT_UI_PASS: confirmation, IPC import and saved replacement');
    win.webContents.reload();
    await pollUntil(async()=>{
      if(win.webContents.isLoading())return false;
      return win.webContents.executeJavaScript("typeof data!=='undefined' && loaded && data.todos.some(t=>t.id==='imported-task')",true);
    },'post-import renderer reload');
    console.log('P0_ELECTRON_IMPORT_RELOAD_PASS: imported data survives renderer reload');
  }
  if(result.trayAvailable){
    win.close();
    assert.equal(win.isDestroyed(),false,'Opted-in close should hide instead of exit');
    assert.equal(win.isVisible(),false,'Opted-in close did not hide window');
    win.show();
    win.webContents.send('desktop-quick-capture');
    await pollUntil(()=>win.webContents.executeJavaScript("document.getElementById('quickRecordMask').classList.contains('show')",true),'tray quick capture');
    await win.webContents.executeJavaScript("document.getElementById('quickRecordCancel').click()");
  }
  const stored=JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8'));
  assert.ok(stored.todos.some(t=>scenario==='import'?t.id==='imported-task':(t.text==='CI Desktop Task'||t.title==='CI Desktop Task')));
  finish(null);
}
run().catch(finish);
