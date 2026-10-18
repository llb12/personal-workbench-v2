'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const asar=require('@electron/asar');
const packed=path.join(__dirname,'..','release','win-unpacked','resources','app.asar');
assert.ok(fs.existsSync(packed),'Windows app.asar not found: run electron-builder --win --dir');
const list=asar.listPackage(packed).map(v=>v.replace(/\\/g,'/').replace(/^\/+/,''));
for(const expected of [
  'main.js','preload.js','index.html','desktop-lifecycle.js','ai-adapter.js','build/icon.ico'
]){
  assert.ok(list.includes(expected),'Missing packaged resource: '+expected);
}
const bundled=asar.extractFile(packed,'main.js').toString('utf8');
assert.ok(bundled.includes('createDesktopLifecycle'),'Windows main entry did not include lifecycle integration');
assert.ok(bundled.includes('backgroundThrottling: false'));
const pkg=JSON.parse(asar.extractFile(packed,'package.json').toString('utf8'));
assert.equal(pkg.main,'main.js');
console.log('P0_PACKAGE_PASS: Windows asar includes tray icon, lifecycle, preload, renderer and AI bridge');
