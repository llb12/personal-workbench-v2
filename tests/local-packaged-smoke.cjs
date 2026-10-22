'use strict';
// Explicit local smoke: a newly-created physical temporary profile is mandatory.
// No developer userData, no install, no app publishing, no production process changes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function retry(fn,timeout,description){
  const start=Date.now();let last=null;
  while(Date.now()-start<timeout){
    try{const result=await fn();if(result)return result;}catch(e){last=String(e.message||e);}
    await pause(250);
  }
  throw new Error(description+' timeout'+(last?' ('+last.slice(0,300)+')':''));
}
async function openSession(url){
  const ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('WebSocket timeout')),8000);
    ws.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('WebSocket error'));},{once:true});
  });
  let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{
    let obj;try{obj=JSON.parse(String(event.data));}catch(_){return;}
    const p=pending.get(obj.id);if(!p)return;
    pending.delete(obj.id);clearTimeout(p.timer);
    if(obj.error)p.reject(new Error(JSON.stringify(obj.error)));
    else p.resolve(obj.result);
  });
  function call(method,params){
    return new Promise((resolve,reject)=>{
      const req=++id,timer=setTimeout(()=>{pending.delete(req);reject(new Error('CDP command timeout'));},15000);
      pending.set(req,{resolve,reject,timer});ws.send(JSON.stringify({id:req,method,params}));
    });
  }
  async function evaluate(expression){
    const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error('Renderer exception: '+JSON.stringify(response.exceptionDetails).slice(0,900));
    return response.result&&response.result.value;
  }
  return {ws,evaluate};
}
const {createSmokeProfile,assertSmokeProfile}=require('../scripts/smoke-profile.cjs');
async function main(){
  assert.equal(process.platform,'win32','Windows only');
  const profile=createSmokeProfile();
  const exe=path.resolve(process.argv[2]||'__missing_binary__');
  assert.ok(fs.existsSync(exe),'Pass the exact built EXE path');
  assertSmokeProfile(profile);
  const port=await freePort(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port,'--disable-gpu'],{cwd:profile,windowsHide:true,env,stdio:['ignore','pipe','pipe']});
  let exit=null,logs='';child.on('error',e=>{logs+=e.message;});child.on('exit',(code,signal)=>{exit={code,signal};});
  child.stdout.on('data',b=>{logs=(logs+b.toString()).slice(-5000);});child.stderr.on('data',b=>{logs=(logs+b.toString()).slice(-5000);});
  let session;
  try{
    const target=await retry(async()=>{if(exit)throw Error('Early exit '+JSON.stringify(exit));const r=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)});return (await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);},65000,'local packaged startup');
    session=await openSession(target.webSocketDebuggerUrl);
    await retry(()=>session.evaluate('typeof loaded!=="undefined"&&loaded&&dataReady()&&typeof window.v2OpenNewTask==="function"'),15000,'renderer readiness');
    const result=await session.evaluate(`(async()=>{v2Navigate('tasks');v2OpenNewTask();document.getElementById('taskEditTitle').value='ISOLATED LOCAL SMOKE';document.getElementById('taskEditSave').click();const saved=window.api.flush(JSON.parse(JSON.stringify(data)));if(!saved.ok)throw Error(JSON.stringify(saved));return {desktop:await window.workbench.desktop.getSettings(),dataPath:await window.api.getDataPath(),weather:await window.workbench.weather.get({city:'北京',force:true})};})()`);
    assert.equal(path.resolve(result.dataPath),path.join(profile,'data.json'));
    assert.ok(JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8')).todos.some(t=>t.text==='ISOLATED LOCAL SMOKE'));
    assert.equal(typeof result.desktop.trayAvailable,'boolean');
    assert.ok(result.weather&&typeof result.weather.ok==='boolean','Weather IPC failed');
    const report={passed:true,exe,profile,version:result.desktop.appVersion,weather:result.weather.ok?'live':result.weather.error,weatherIpc:true};
    fs.writeFileSync(path.join(profile,'smoke-result.json'),JSON.stringify(report,null,2));
    console.log('LOCAL_PACKAGED_PASS: '+JSON.stringify(report));
    await session.evaluate('window.close();');
    await retry(()=>exit,12000,'test process exit');
    assert.equal(exit.code,0);
  }catch(e){console.error('LOCAL_SMOKE_DIAGNOSTICS: '+JSON.stringify({exit,logs}));throw e;}
  finally{if(session)session.ws.close();if(!exit&&child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:15000});}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
