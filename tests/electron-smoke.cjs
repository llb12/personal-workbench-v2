'use strict';
// Electron main-process GUI smoke. Guard must run before loading the app.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app, BrowserWindow}=require('electron');
const profile=process.env.WB_ELECTRON_SMOKE_PROFILE;
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
  await pollUntil(async()=>{
    if(win.webContents.isLoading())return false;
    return win.webContents.executeJavaScript('typeof loaded !== "undefined" && loaded && dataReady() && typeof window.v2OpenNewTask==="function"',true);
  },'renderer ready');
  const result=await win.webContents.executeJavaScript('('+smokeRenderer.toString()+')()',true);
  console.log('P0_ELECTRON_GUI_CHECKS: '+JSON.stringify(result));
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
  assert.ok(stored.todos.some(t=>t.text==='CI Desktop Task'||t.title==='CI Desktop Task'));
  finish(null);
}
run().catch(finish);
