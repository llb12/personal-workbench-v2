'use strict';
// Electron main-process GUI smoke. Guard must run before loading the app.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const nodeHttp=require('node:http');
const nodeHttps=require('node:https');
const {EventEmitter}=require('node:events');
const {app, BrowserWindow, session}=require('electron');
const profile=process.env.WB_ELECTRON_SMOKE_PROFILE;
const scenario=process.env.WB_ELECTRON_SMOKE_CASE||'normal';
const localOptIn=process.env.WORKBENCH_SMOKE_LOCAL==='1';
const mockUrlText=process.env.WB_ELECTRON_SMOKE_MOCK_URL||'';
assert.ok(['normal','legacy','corrupt','import','ai','core'].includes(scenario));
assert.equal(process.platform,'win32');
if(localOptIn){
  assert.notEqual(process.env.CI,'true','Local smoke must not impersonate CI');
  const projectRoot=path.resolve(__dirname,'..');
  assert.equal(path.resolve(process.env.WB_ELECTRON_SMOKE_PROJECT_ROOT||''),projectRoot,'Local smoke root mismatch');
  require('../scripts/smoke-profile.cjs').assertSmokeProfile(profile);
  const marker=JSON.parse(fs.readFileSync(path.join(profile,'local-smoke-marker.json'),'utf8'));
  assert.equal(marker.kind,'workbench-local-smoke');
  assert.equal(path.resolve(marker.profile),path.resolve(profile));
}else{
  assert.equal(process.env.CI,'true');
  assert.ok(profile&&process.env.RUNNER_TEMP,'CI-only profile missing');
  const relative=path.relative(process.env.RUNNER_TEMP,profile);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Profile outside runner temp');
}
assert.equal(path.resolve(app.commandLine.getSwitchValue('user-data-dir')),path.resolve(profile),'Explicit user-data-dir mismatch');
assert.equal(path.resolve(app.getPath('userData')),path.resolve(profile),'Electron userData is not isolated before loading main');
let mockUrl=null;
if(mockUrlText){
  mockUrl=new URL(mockUrlText);
  assert.ok(['ai','core'].includes(scenario),'A loopback mock is allowed only in a synthetic AI scenario');
  assert.equal(mockUrl.protocol,'http:');
  assert.equal(mockUrl.hostname,'127.0.0.1');
  assert.ok(Number(mockUrl.port)>0);
  assert.equal(mockUrl.pathname,'/chat/completions');
  assert.equal(mockUrl.search,'');
  assert.equal(mockUrl.hash,'');
  assert.equal(mockUrl.username,'');
  assert.equal(mockUrl.password,'');
}else assert.notEqual(scenario,'ai','AI smoke requires its explicit loopback mock');
let networkGuardInstalled=false;
let blockedHttpRequests=0;
let allowedLoopbackMockRequests=0;
let blockedNodeHttpRequests=0;
let allowedNodeHttpRequests=0;
app.once('ready',()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{
    let allowed=false;
    if(mockUrl){
      try{
        const requested=new URL(details.url);
        allowed=details.method==='POST'&&requested.protocol==='http:'&&requested.hostname==='127.0.0.1'&&
          requested.port===mockUrl.port&&requested.pathname==='/chat/completions'&&requested.search===''&&requested.hash==='';
      }catch(_){}
    }
    if(allowed)allowedLoopbackMockRequests++;else blockedHttpRequests++;
    callback({cancel:!allowed});
  });
  networkGuardInstalled=true;
});
function blockedNodeRequest(){
  const request=new EventEmitter();
  request.setTimeout=()=>request;
  request.write=()=>true;
  request.destroy=()=>request;
  request.end=()=>{
    process.nextTick(()=>request.emit('error',Object.assign(new Error('HTTP(S) disabled by the local smoke guard'),{code:'ECONNREFUSED'})));
    return request;
  };
  return request;
}
function installNodeHttpGuard(transport,protocol){
  const originalRequest=transport.request;
  transport.request=function(...args){
    let allowed=false;
    if(protocol==='http:'&&mockUrl&&args[0] instanceof URL){
      try{
        const requestUrl=args[0];
        const options=args.find((arg,index)=>index>0&&arg&&typeof arg==='object'&&typeof arg!=='function'&&!(arg instanceof URL))||{};
        allowed=String(options.method||'GET').toUpperCase()==='POST'&&requestUrl.protocol==='http:'&&
          requestUrl.hostname==='127.0.0.1'&&requestUrl.port===mockUrl.port&&
          requestUrl.pathname==='/chat/completions'&&requestUrl.search===''&&requestUrl.hash===''&&
          requestUrl.username===''&&requestUrl.password==='';
      }catch(_){}
    }
    if(!allowed){blockedNodeHttpRequests++;return blockedNodeRequest();}
    allowedNodeHttpRequests++;
    return originalRequest.apply(transport,args);
  };
  transport.get=function(...args){
    const request=transport.request(...args);
    request.end();
    return request;
  };
}
installNodeHttpGuard(nodeHttp,'http:');
installNodeHttpGuard(nodeHttps,'https:');
app.commandLine.appendSwitch('disable-background-networking');
let finished=false;
const failTimer=setTimeout(()=>finish(new Error('Electron GUI smoke timed out')),55000);
function finish(error){
  if(finished)return;
  finished=true;
  clearTimeout(failTimer);
  if(error)console.error('P0_ELECTRON_GUI_FAIL:',error.stack||String(error));
  else console.log('P0_ELECTRON_GUI_PASS');
  console.log('P0_ELECTRON_NETWORK_COUNTS:'+JSON.stringify({blockedChromiumHttpRequests:blockedHttpRequests,allowedChromiumLoopbackRequests:allowedLoopbackMockRequests,blockedNodeHttpRequests,allowedNodeHttpRequests,networkGuardInstalled}));
  process.exitCode=error?1:0;
  try{app.quit();}catch(_){process.exit(error?1:0);}
  setTimeout(()=>process.exit(error?1:0),3000).unref();
}
app.on('browser-window-created',(_event,win)=>{
  if(!networkGuardInstalled)finish(new Error('HTTP(S) network guard was not installed before BrowserWindow'));
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

  // Click legacy UI buttons, not just the shared helper. They must leave one delete
  // audit entry, then Undo must restore that task and remove only this audit entry.
  for(const [hostId,attr] of [
    ['todoList','data-i'],
    ['kb','data-id'],
    ['evList','data-todoid']
  ]){
    const host=document.getElementById(hostId);
    check(!!host,'legacy delete test host missing: '+hostId);
    const id='ci-legacy-delete-'+hostId;
    const task={id:id,text:id,title:id,done:false,status:'todo',pri:'mid'};
    data.todos.push(task);
    const index=data.todos.length-1;
    const before=(data.workLog||[]).filter(x=>x.taskId===id&&x.type==='delete').length;
    const button=document.createElement('button');
    button.setAttribute('data-act','del');
    button.setAttribute(attr,attr==='data-i'?String(index):id);
    host.appendChild(button);
    button.click();
    check(!data.todos.some(x=>x.id===id),'legacy '+hostId+' did not delete');
    const after=(data.workLog||[]).filter(x=>x.taskId===id&&x.type==='delete').length;
    check(after===before+1,'legacy '+hostId+' missing delete work log');
    const undo=document.querySelector('#toast .toast-undo');
    check(!!undo,'legacy '+hostId+' missing Undo action');
    undo.click();
    check(data.todos.some(x=>x.id===id),'legacy '+hostId+' failed to restore task');
    check((data.workLog||[]).filter(x=>x.taskId===id&&x.type==='delete').length===before,
      'legacy '+hostId+' failed to remove only corresponding delete log');
    data.todos.splice(data.todos.findIndex(x=>x.id===id),1); // ephemeral CI test-fixture cleanup
  }
  console.log('P0_LEGACY_DELETE_UI_PASS: todo list, kanban and calendar use audited scoped Undo');

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
  assert.equal(networkGuardInstalled,true,'HTTP(S) network guard was not installed');
  assert.equal(path.resolve(app.getPath('userData')),path.resolve(profile),'Application profile isolation failed');
  assert.equal(app.hasSingleInstanceLock(),true,'Isolated profile did not acquire its own single-instance lock');
  assert.ok(fs.existsSync(path.join(profile,'sessionData')),'Session data escaped the isolated profile');
  assert.ok(fs.existsSync(path.join(profile,'cache')),'Cache escaped the isolated profile');
  assert.equal(path.resolve(app.getPath('sessionData')),path.resolve(profile,'sessionData'),'Session path isolation failed');
  assert.equal(path.resolve(app.commandLine.getSwitchValue('disk-cache-dir')),path.resolve(profile,'cache'),'Cache path isolation failed');
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
    assert.equal(migration.version,4);
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
  if(scenario==='ai')await smokeAI(win);
  if(scenario==='core'){
    await win.webContents.executeJavaScript('window.workbench.ai.saveConfig('+JSON.stringify({enabled:true,baseUrl:mockUrl.href,model:'synthetic-core-only',apiKey:'synthetic-only',privacyMode:'full'})+')',true);
    const core=require('./pilot-core-ui.cjs');
    const result=await win.webContents.executeJavaScript('('+core.toString()+')()',true);
    console.log('PILOT_CORE_UI_PASS:'+JSON.stringify(result));
    win.webContents.reload();
    await pollUntil(()=>win.webContents.executeJavaScript("typeof loaded!=='undefined'&&loaded&&data.projects.some(p=>p.name==='演示整合项目')&&data.todos.some(t=>t.text==='演示人工校正汇总')&&data.todos.some(t=>t.text.startsWith('演示关联任务：')&&t.status==='todo')",true),'core persisted reload');
  }
  if(scenario==='import'){
    // Confirm cancellations and simultaneous in-place edits never overwrite the live data.
    const guardChecks=await win.webContents.executeJavaScript(`(async function(){
      const untouched=JSON.stringify(data);
      const candidate={schemaVersion:3,todos:[{id:'should-never-import',text:'Blocked'}],projects:[],events:{},note:'blocked'};
      applyImported(candidate);
      document.getElementById('wbConfirmCancel').click();
      await Promise.resolve();
      if(JSON.stringify(data)!==untouched)throw new Error('Canceled import modified data');
      applyImported(candidate);
      const oldNote=data.note;
      data.note='EDIT_WHILE_CONFIRMING';
      document.getElementById('wbConfirmAccept').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(data.todos.some(x=>x.id==='should-never-import'))throw new Error('Concurrent edit allowed import overwrite');
      if(!document.getElementById('wbConfirmMask').classList.contains('show'))throw new Error('Missing concurrent edit warning');
      if(!document.getElementById('wbConfirmMessage').textContent.includes('发生变化'))throw new Error('Missing edit warning text');
      document.getElementById('wbConfirmAccept').click();
      data.note=oldNote;
      return JSON.stringify(data)===untouched;
    })()`,true);
    assert.equal(guardChecks,true,'Import confirmation concurrency guard did not preserve contents');
    console.log('P0_ELECTRON_IMPORT_GUARD_PASS: cancellation and in-place edit protection');
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
async function smokeAI(win){
  const mockUrlValue=mockUrl.href;
  const saved=await win.webContents.executeJavaScript(`window.workbench.ai.saveConfig({enabled:true,baseUrl:${JSON.stringify(mockUrlValue)},model:'local-smoke',apiKey:'local-smoke-key',timeoutMs:3000})`,true);
  assert.equal(saved.ok,true,'AI settings IPC did not accept the isolated mock configuration');
  const configured=await win.webContents.executeJavaScript('window.workbench.ai.getConfig()',true);
  assert.equal(configured.enabled,true);
  assert.equal(configured.baseUrl,mockUrlValue);
  assert.equal(Object.prototype.hasOwnProperty.call(configured,'apiKey'),false,'AI key leaked through preload IPC');
  await win.webContents.executeJavaScript("window.v2Navigate('inbox');document.getElementById('v2InboxText').value='Local P0 AI smoke item；2026年10月20日17:00前提交报告';document.getElementById('v2InboxAI').click();true",true);
  await pollUntil(async()=>win.webContents.executeJavaScript("(function(){var e=data.inbox.find(function(x){return x.rawText==='Local P0 AI smoke item；2026年10月20日17:00前提交报告'});var n=document.querySelector('.v2-ai-notice');return !!(e&&e.status==='candidate'&&e.candidates&&e.candidates.length&&n&&n.textContent.includes('AI整理完成'))})()",true),'AI IPC success and corrected preview',22000);
  const preview=await win.webContents.executeJavaScript(`(function(){var e=data.inbox.find(function(x){return x.rawText==='Local P0 AI smoke item；2026年10月20日17:00前提交报告'});var c=e&&e.candidates&&e.candidates[0];var n=document.querySelector('.v2-ai-notice');return {entryStatus:e&&e.status,candidateCount:e&&e.candidates&&e.candidates.length,title:c&&c.title,priority:c&&c.priority,dueAt:c&&c.dueAt,notice:n&&n.textContent,toast:document.getElementById('toast').textContent,taskWritten:data.todos.some(function(t){return t.text==='本地模拟提交报告'||t.title==='本地模拟提交报告'})}})()`,true);
  assert.equal(preview.entryStatus,'candidate');
  assert.ok(preview.candidateCount>=1);
  assert.equal(preview.title,'本地模拟提交报告');
  assert.equal(preview.priority,'mid');
  assert.equal(String(preview.dueAt).slice(0,10),'2026-10-20');
  assert.ok(preview.notice.includes('自动纠正一次'),'Corrected-output warning was not shown in the candidate preview');
  assert.ok(preview.toast.includes('候选预览'),'AI candidate preview confirmation flow was not shown');
  assert.equal(preview.taskWritten,false,'AI candidate bypassed preview and wrote a task');
  await win.webContents.executeJavaScript("window.runInboxAIAnalysis('Local P0 AI HTTP error smoke','paste',null,{origin:'inbox',navigateOnSuccess:false});true",true);
  await pollUntil(async()=>win.webContents.executeJavaScript("(function(){var n=document.querySelector('.v2-ai-notice strong');return !!(n&&n.textContent.includes('AI 服务返回错误'))})()",true),'AI IPC HTTP error display',15000);
  const failure=await win.webContents.executeJavaScript("(function(){var n=document.querySelector('.v2-ai-notice strong');return {notice:n&&n.textContent,toast:document.getElementById('toast').textContent}})()",true);
  const expected='AI 服务返回错误，请稍后重试或检查服务状态；原始内容已保留';
  assert.ok(failure.notice.includes(expected),'Specific HTTP error was not shown in the notice');
  assert.ok(failure.toast.includes(expected),'Specific HTTP error was not shown in the toast');
  assert.equal(allowedNodeHttpRequests,3,'Expected exactly three Node HTTP requests to the local mock');
  console.log('P0_ELECTRON_AI_IPC_PASS: isolated loopback mock, corrected candidate preview, specific error notice and toast');
}
run().catch(finish);
