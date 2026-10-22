'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pkg=require('../package.json');
const target=process.argv[2]||'all';
assert.ok(['all','nsis','portable','unpacked'].includes(target),'Unexpected artifact target');
const directory=path.resolve(process.argv[3]||path.join(__dirname,'..','release'));
if(target==='unpacked'){require('../scripts/package-resources.cjs').inspectPackage(path.join(directory,'win-unpacked','resources','app.asar'));console.log('UNPACKED_ARTIFACT_PASS');process.exit(0);}
const exes=fs.readdirSync(directory).filter(name=>name.endsWith('.exe')).sort();
const setup='Personal_Workbench_Setup_'+pkg.version+'.exe';
const portable='Personal_Workbench_Portable_'+pkg.version+'.exe';
const expected=target==='all'?[setup,portable]:[target==='nsis'?setup:portable];
for(const name of expected){
  assert.ok(exes.includes(name),'Missing '+target+' artifact: '+name);
  assert.ok(/^[A-Za-z0-9_.-]+$/.test(name),'ASCII filename required');
  const file=path.join(directory,name);
  const stat=fs.statSync(file);
  assert.ok(stat.size>5*1024*1024,'Executable unexpectedly small: '+name);
  const fd=fs.openSync(file,'r');
  const head=Buffer.alloc(2);
  fs.readSync(fd,head,0,2,0);fs.closeSync(fd);
  assert.equal(head.toString('ascii'),'MZ','Windows PE header not found: '+name);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  console.log('P0_WINDOWS_ARTIFACT: '+JSON.stringify({filename:name,bytes:stat.size,sha256:hash}));
}
console.log('P0_INSTALLERS_PASS: Requested binaries exist with valid PE headers');
