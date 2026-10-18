'use strict';
// Real packaged portable Windows UI test, with unique CI-only profile and CDP.
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
async function main(){
  assert.equal(process.platform,'win32','Windows only');
  assert.equal(process.env.CI,'true','CI only');
  const runner=process.env.RUNNER_TEMP;
  assert.ok(runner&&fs.existsSync(runner),'Disposable runner required');
  const pkg=require('../package.json');
  const exe=path.join(__dirname,'..','release','Personal_Workbench_Portable_'+pkg.version+'.exe');
  assert.ok(fs.existsSync(exe),'Built portable binary missing');
  const profile=fs.mkdtempSync(path.join(runner,'wb-packaged-'));
  const port=await freePort();
  const launchEnv={...process.env};
  delete launchEnv.ELECTRON_RUN_AS_NODE; // Must launch the real graphical Electron app.
  const child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port,'--disable-gpu'],{
    cwd:runner,windowsHide:true,stdio:'ignore',env:launchEnv
  });
  let session=null;
  try{
    const target=await retry(async()=>{
      const res=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)});
      if(!res.ok)return null;
      return (await res.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
    },65000,'portable debug target');
    session=await openSession(target.webSocketDebuggerUrl);
    assert.equal(await retry(()=>session.evaluate('typeof loaded!=="undefined" && loaded && dataReady()'),15000,'portable application load'),true);
    const expression="(async function(){"+
      "window.v2Navigate('tasks');window.v2OpenNewTask();"+
      "document.getElementById('taskEditTitle').value='PACKAGED CI Task';"+
      "document.getElementById('taskEditSave').click();"+
      "if(!data.todos.some(x=>x.text==='PACKAGED CI Task'))throw Error('task not created');"+
      "const cfg=await window.workbench.desktop.getSettings();"+
      "if(typeof cfg.trayAvailable!=='boolean')throw Error('desktop IPC missing');"+
      "const flushed=window.api.flush(JSON.parse(JSON.stringify(data)));"+
      "if(!flushed||!flushed.ok)throw Error('save failed');"+
      "return {trayAvailable:cfg.trayAvailable,taskCount:data.todos.length};"+
    "})()";
    const record=await session.evaluate(expression);
    assert.ok(record.taskCount>=1);
    const saved=JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8'));
    assert.ok(saved.todos.some(x=>x.text==='PACKAGED CI Task'));
    console.log('P0_PACKAGED_PORTABLE_PASS: '+JSON.stringify(record));
  }finally{
    if(session)try{session.ws.close();}catch(_){}
    if(child.pid){
      // Terminate only the exact test process tree on a disposable Windows runner.
      spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{
        cwd:runner,windowsHide:true,timeout:15000,encoding:'utf8'
      });
    }
    await pause(800);
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});}
    catch(e){console.warn('CI temporary profile cleanup incomplete: '+(e.code||'unknown'));}
  }
}
main().catch(e=>{console.error('P0_PACKAGED_PORTABLE_FAIL: '+(e&&e.stack||String(e)));process.exitCode=1;});
