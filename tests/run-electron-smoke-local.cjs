'use strict';
// Explicit, isolated local Electron smoke. It never sets CI=true and only creates
// disposable profiles below this integration checkout's evidence directory.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn,execFileSync}=require('node:child_process');

const marker='personal-workbench-p0-integration-20261019';
assert.equal(process.platform,'win32','Local Electron smoke must run on Windows');
assert.equal(process.env.WB_RUN_LOCAL_ELECTRON_SMOKE,marker,'Set the exact local smoke opt-in for this integration checkout');
const projectRoot=fs.realpathSync(path.resolve(__dirname,'..'));
assert.equal(projectRoot,path.resolve('C:\\Users\\19101\\Documents\\Codex\\personal-workbench-p0-integration-20261019'),'Unexpected project root');
assert.notEqual(process.env.CI,'true','Local smoke does not impersonate CI');
const evidenceRoot=path.join(projectRoot,'.integration-evidence');
const profileRoot=path.join(evidenceRoot,'local-electron-profiles');
fs.mkdirSync(profileRoot,{recursive:true});
assert.equal(fs.lstatSync(profileRoot).isSymbolicLink(),false,'Profile root must not be a link');
assert.ok(path.relative(evidenceRoot,fs.realpathSync(profileRoot))&&!path.relative(evidenceRoot,fs.realpathSync(profileRoot)).startsWith('..'),'Profile root escaped evidence directory');
const electron=require('electron');
assert.equal(typeof electron,'string','Electron executable path was not resolved');
const electronExe=path.resolve(electron);
assert.ok(path.relative(path.join(projectRoot,'node_modules'),electronExe)&&!path.relative(path.join(projectRoot,'node_modules'),electronExe).startsWith('..'),'Electron executable is outside local dependencies');
assert.ok(fs.statSync(electronExe).isFile(),'Electron executable is missing');

let mockRequests=0,coreMode=false,coreRequests=0;
const results=[];
const mockServer=http.createServer((req,res)=>{
  if(coreMode){
    let body='';req.on('data',part=>{body+=part;});req.on('end',()=>{
      coreRequests++;
      try{
        const sent=JSON.parse(body),text=sent.messages.find(x=>x.role==='user').content;
        const input=JSON.parse(text.split('BEGIN_UNTRUSTED_CONTEXT_JSON\n')[1].split('\nEND_UNTRUSTED_CONTEXT_JSON')[0]);
        const c=input.context;let reply;
        if(['parseQuickCapture','analyzeInbox'].includes(input.action)){
          const d=new Date(c.currentDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);
          reply={items:[{title:'提交演示汇总',type:'todo',priority:'high',dueMode:'fixed',dueAt:d.toISOString().slice(0,10),sourceQuote:'明天提交演示汇总'},{title:'等待演示团队反馈样例',type:'waiting',priority:'mid',dueMode:'none',dueAt:null,waitingFor:'演示团队',followUpAt:null,sourceQuote:'等待演示团队反馈样例，下周一催一下'}],warnings:[]};
        }else if(input.action==='planToday')reply={items:(c.tasks||[]).filter(t=>!t.done).map((t,i)=>({taskId:t.id,rank:i+1,reason:'Synthetic evidence'})),summary:'Synthetic plan'};
        else if(input.action==='askWorkspace')reply={answer:'Synthetic answer',sources:(c.sources||[]).map(x=>({id:x.id,type:x.type,title:x.title,reason:'Synthetic evidence'})),warnings:[]};
        else reply={summary:'Synthetic report',sections:[],warnings:[]};
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));
      }catch(_){res.writeHead(400);res.end('{}');}
    });return;
  }
  req.resume();
  mockRequests++;
  if(req.method!=='POST'||req.url!=='/chat/completions'){
    res.writeHead(404,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'unexpected local smoke route'}));
    return;
  }
  if(mockRequests===1){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'not-json'}}]}));
    return;
  }
  if(mockRequests===2){
    const content='```json\n'+JSON.stringify({
      items:[{title:'本地模拟提交报告',type:'todo',priority:'medium',dueMode:'fixed',dueAt:'2026-10-20T17:00:00',sourceQuote:'Local P0 AI smoke item；2026年10月20日17:00前提交报告',reason:'local fixture',confidence:0.9}],
      warnings:[]
    })+'\n```';
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content}}]}));
    return;
  }
  if(mockRequests===3){
    res.writeHead(503,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'local fixture failure'}));
    return;
  }
  res.writeHead(429,{'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'unexpected extra mock request'}));
});

function writeEvidence(record){
  const file=path.join(evidenceRoot,'electron-local-smoke-'+Date.now()+'.json');
  fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  return file;
}
async function runCase(scenario,mockUrl){
  const profile=fs.mkdtempSync(path.join(profileRoot,'profile-'+scenario+'-'));
  fs.writeFileSync(path.join(profile,'local-smoke.guard'),marker,{encoding:'utf8',flag:'wx'});
  const args=[path.join(__dirname,'electron-smoke.cjs'),'--user-data-dir='+profile,'--disable-gpu'];
  const env={...process.env};
  delete env.CI;
  delete env.RUNNER_TEMP;
  delete env.ELECTRON_RUN_AS_NODE;
  env.WB_ELECTRON_SMOKE_PROFILE=profile;
  env.WB_ELECTRON_SMOKE_CASE=scenario;
  env.WB_ELECTRON_SMOKE_LOCAL=marker;
  env.WB_ELECTRON_SMOKE_PROJECT_ROOT=projectRoot;
  if(mockUrl)env.WB_ELECTRON_SMOKE_MOCK_URL=mockUrl;
  else delete env.WB_ELECTRON_SMOKE_MOCK_URL;
  const child=spawn(electron,args,{cwd:projectRoot,env,stdio:['ignore','pipe','pipe']});
  let stdout='';
  let stderr='';
  let timedOut=false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const res=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{timedOut=true;child.kill();},120000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal});});
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const relativeProfile=path.relative(projectRoot,profile).split(path.sep).join('/');
  const record={scenario,exitCode:res.status,signal:res.signal,timedOut,profileRelativePath:relativeProfile,profileCleaned:false,networkCounts:null,stdout,stderr};
  results.push(record);
  assert.equal(res.status,0,'Electron local smoke process returned nonzero status: '+scenario);
  assert.ok(stdout.includes('P0_ELECTRON_GUI_PASS'),'GUI smoke completion marker missing: '+scenario);
  const networkLine=stdout.split(/\r?\n/).find(line=>line.startsWith('P0_ELECTRON_NETWORK_COUNTS:'));
  assert.ok(networkLine,'Network guard counts missing: '+scenario);
  const networkCounts=JSON.parse(networkLine.slice('P0_ELECTRON_NETWORK_COUNTS:'.length));
  record.networkCounts=networkCounts;
  assert.equal(networkCounts.networkGuardInstalled,true,'Network guard did not run: '+scenario);
  const dataFile=path.join(profile,'data.json');
  assert.ok(fs.existsSync(dataFile),'Isolated data file missing: '+scenario);
  const data=JSON.parse(fs.readFileSync(dataFile,'utf8'));
  if(scenario==='normal')assert.ok(data.todos.some(item=>item.text==='CI Desktop Task'||item.title==='CI Desktop Task'));
  if(scenario==='ai'){
    assert.equal(mockRequests,3,'Expected exactly three loopback mock requests: invalid, one correction, then HTTP error');
    assert.ok(stdout.includes('P0_ELECTRON_AI_IPC_PASS'),'AI/IPC integration marker missing');
    assert.ok(data.inbox.some(item=>item.rawText==='Local P0 AI smoke item；2026年10月20日17:00前提交报告'&&item.status==='candidate'));
    assert.ok(!data.todos.some(item=>item.text==='本地模拟提交报告'||item.title==='本地模拟提交报告'));
  }
  fs.rmSync(profile,{recursive:true,force:true});
  record.profileCleaned=true;
  record.profileWasDisposable=true;
  record.networkCounts=networkCounts;
  return record;
}

(async()=>{
  let failure=null;
  let mockAddress=null;
  try{
    mockAddress=await new Promise((resolve,reject)=>{
      mockServer.once('error',reject);
      mockServer.listen(0,'127.0.0.1',()=>resolve(mockServer.address()));
    });
    const mockUrl='http://127.0.0.1:'+mockAddress.port+'/chat/completions';
    await runCase('normal',null);
    await runCase('ai',mockUrl);
    assert.equal(mockRequests,3,'Unexpected loopback mock request count');
    coreMode=true;
    await runCase('core',mockUrl);
    assert.ok(coreRequests>=5&&coreRequests<=8,'Unexpected core mock request count');
  }catch(error){
    failure=error;
  }finally{
    if(mockServer.listening)await new Promise(resolve=>mockServer.close(()=>resolve()));
  }
  const evidence={
    outcome:failure?'FAIL':'PASS',
    optIn:marker,
    ciWasSetForChildren:false,
    electronRunAsNodeRemoved:true,
    projectHead:execFileSync('git',['rev-parse','HEAD'],{cwd:projectRoot,encoding:'utf8'}).trim(),
    scenarios:results,
    loopbackMock:{started:!!mockAddress,protocol:'http',host:'127.0.0.1',path:'/chat/completions',requests:mockRequests,coreRequests,requestBodiesRecorded:false},
    externalHttpPolicy:'Electron session blocks every HTTP(S) renderer request except the exact POST to this run loopback mock during the AI scenario; test-only Node http/https request guards block every other endpoint.',
    failure:failure?String(failure.stack||failure):null,
    generatedAt:new Date().toISOString()
  };
  let file;
  try{file=writeEvidence(evidence);console.log('P0_ELECTRON_LOCAL_SMOKE_EVIDENCE:'+path.relative(projectRoot,file).split(path.sep).join('/'));}
  catch(error){console.error('Could not persist local Electron evidence:',String(error));failure=failure||error;}
  if(failure){
    console.error('P0_ELECTRON_LOCAL_SMOKE_FAIL:',failure.stack||String(failure));
    process.exitCode=1;
  }else console.log('P0_ELECTRON_LOCAL_SMOKE_PASS: normal UI, isolated profile, AI preload/main IPC and loopback mock');
})().catch(error=>{
  console.error('P0_ELECTRON_LOCAL_SMOKE_FAIL:',error.stack||String(error));
  process.exitCode=1;
});
