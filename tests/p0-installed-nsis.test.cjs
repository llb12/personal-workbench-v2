'use strict';
// CI-only silent NSIS install smoke; never runs on a user's Windows machine.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
assert.equal(process.platform,'win32','Windows CI required');
assert.equal(process.env.CI,'true','Installation test must run in GitHub CI');
const temp=process.env.RUNNER_TEMP;
assert.ok(temp&&fs.existsSync(temp),'Disposable Windows runner required');
const pkg=require('../package.json');
const installer=path.join(__dirname,'..','release','Personal_Workbench_Setup_'+pkg.version+'.exe');
assert.ok(fs.existsSync(installer),'ASCII NSIS installer missing');
async function waitForRemoval(installDir){
  const deadline=Date.now()+20000;
  while(fs.existsSync(installDir)&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(!fs.existsSync(installDir),'Uninstaller left the temporary installation directory behind');
}
async function main(){
  const installDir=fs.mkdtempSync(path.join(temp,'wb-nsis-install-'));
  assert.equal(path.dirname(path.resolve(installDir)),path.resolve(temp),'Installation must stay in RUNNER_TEMP');
  const errors=[];
  try{
    // NSIS switches are scoped to this unique disposable CI path.
    const installed=spawnSync(installer,['/S','/D='+installDir],{
      cwd:temp,timeout:90000,encoding:'utf8',windowsHide:true
    });
    if(installed.error)throw installed.error;
    assert.equal(installed.status,0,'Silent installer did not exit successfully');
    const executable=path.join(installDir,pkg.productName+'.exe');
    assert.ok(fs.existsSync(executable),'Installed application executable missing');
    assert.ok(fs.existsSync(path.join(installDir,'resources','tray','icon.ico')),'Installed tray icon missing');
    assert.ok(fs.existsSync(path.join(installDir,'resources','app.asar')),'Installed app.asar missing');
    const smoke=spawnSync(process.execPath,[
      path.join(__dirname,'p0-packaged-portable.test.cjs'),'installed'
    ],{
      cwd:temp,timeout:110000,encoding:'utf8',windowsHide:true,
      env:{...process.env,WB_CI_INSTALLED_EXE:executable}
    });
    process.stdout.write(smoke.stdout||'');
    process.stderr.write(smoke.stderr||'');
    if(smoke.error)throw smoke.error;
    assert.equal(smoke.status,0,'Installed program GUI smoke failed');
    assert.ok((smoke.stdout||'').includes('P0_PACKAGED_INSTALLED_PASS'),'Installed program pass marker missing');
  }catch(error){errors.push(error);}
  try{
    if(fs.existsSync(installDir)){
      const uninstaller=fs.readdirSync(installDir).find(name=>/^uninstall.*\.exe$/i.test(name));
      assert.ok(uninstaller,'Installed uninstaller missing');
      // Uninstall only the copy installed in this temporary CI directory.
      const removed=spawnSync(path.join(installDir,uninstaller),['/S'],{
        cwd:temp,timeout:60000,windowsHide:true,encoding:'utf8'
      });
      if(removed.error)throw removed.error;
      assert.equal(removed.status,0,'Silent uninstaller did not exit successfully');
      await waitForRemoval(installDir);
    }
  }catch(error){errors.push(error);}
  finally{
    try{fs.rmSync(installDir,{recursive:true,force:true,maxRetries:5,retryDelay:350});}
    catch(e){console.warn('CI temporary install cleanup incomplete: '+(e.code||'unknown'));}
  }
  if(errors.length)throw new AggregateError(errors,errors.map(error=>error.message).join('; '));
  console.log('P0_NSYS_INSTALLED_PASS: isolated silent installation, resources, app startup and save');
  console.log('P0_NSIS_UNINSTALLED_PASS: zero uninstall exit and temporary installation directory removed before cleanup');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
