'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pkg=require('../package.json');
const directory=path.join(__dirname,'..','release');
const exes=fs.readdirSync(directory).filter(name=>name.endsWith('.exe')).sort();
const setup=exes.find(name=>name.includes('Setup')&&name.includes(pkg.version));
const portable=exes.find(name=>!name.includes('Setup')&&name.includes(pkg.version));
assert.ok(setup,'NSIS installer missing: '+exes.join(', '));
assert.ok(portable,'Portable executable missing: '+exes.join(', '));
for(const name of [setup,portable]){
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
console.log('P0_INSTALLERS_PASS: NSIS and portable binaries exist with valid PE signatures');
