'use strict';
// Read-only local Git preflight for personal-workbench-v2.
// Does not fetch, checkout, merge, write files, or inspect business data / API secrets.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

const root=path.resolve(__dirname,'..');
const remoteRef='refs/remotes/origin/codex/p0-stability-20261018';
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'};
function git(args,required=true){
  const result=spawnSync('git',['-c','core.optionalLocks=false',...args],{
    cwd:root,env,encoding:'utf8',timeout:15000,
    windowsHide:true,maxBuffer:5*1024*1024
  });
  if(result.error)throw new Error('Git executable unavailable: '+result.error.code);
  if(result.status!==0){
    if(!required)return null;
    throw new Error('Git read failed for '+args[0]+', exit '+result.status);
  }
  return result.stdout.trim();
}
function go(){
  if(!fs.existsSync(path.join(root,'.git'))){
    throw new Error('Not a local Git worktree (no .git found)');
  }
  const head=git(['rev-parse','HEAD']);
  const branch=git(['branch','--show-current'])||'(detached)';
  const tracked=git(['status','--porcelain=v1','-z','--untracked-files=normal']);
  const changed=tracked.split('\0').filter(Boolean).map(entry=>{
    const code=entry.slice(0,2);
    // Git's NUL status may contain two paths for rename; report only status count,
    // no contents or names that might reveal personal business information.
    return code;
  });
  const candidate=git(['rev-parse','--verify',remoteRef+'^{commit}'],false);
  let ancestor=null,delta=null;
  if(candidate){
    ancestor=git(['merge-base',head,candidate],false);
    delta=git(['rev-list','--left-right','--count',head+'...'+candidate],false);
  }
  const result={
    projectPath:root,head,branch,
    dirty:changed.length!==0,changedPaths:changed.length,
    statusKinds:changed.reduce((acc,code)=>{acc[code]=(acc[code]||0)+1;return acc;},{}),
    candidateRemoteRef:remoteRef,
    candidateAvailableLocally:!!candidate,
    candidateHead:candidate||null,
    sharedBase:ancestor||null,
    leftRightCommits:delta||null,
    safeToApply:false,
    reason:changed.length?'Local changes require independent reconciliation':
      !candidate?'Candidate remote ref not available locally; no network fetch attempted':
      'Git comparison recorded; business data and Windows application still need separate acceptance'
  };
  console.log(JSON.stringify(result,null,2));
}
try{go();}catch(error){
  console.error(JSON.stringify({LOCAL_PREFLIGHT:'BLOCKED',reason:error.message,mutationPerformed:false}));
  process.exitCode=1;
}
