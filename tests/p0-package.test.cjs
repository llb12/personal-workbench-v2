'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const asar=require('@electron/asar');
const packed=path.join(__dirname,'..','release','win-unpacked','resources','app.asar');
assert.ok(fs.existsSync(packed),'Windows app.asar not found: run electron-builder --win --dir');
const list=asar.listPackage(packed).map(v=>v.replace(/\\/g,'/').replace(/^\/+/,''));
for(const expected of [
  'main.js','preload.js','index.html','desktop-lifecycle.js','ai-adapter.js'
]){
  assert.ok(list.includes(expected),'Missing packaged resource: '+expected);
}
const physicalIcon=path.join(__dirname,'..','release','win-unpacked','resources','tray','icon.ico');
assert.ok(fs.existsSync(physicalIcon),'OS-visible tray icon must be outside app.asar');
assert.ok(fs.statSync(physicalIcon).size>2048,'Tray icon appears empty');
const bundled=asar.extractFile(packed,'main.js').toString('utf8');
assert.ok(bundled.includes('createDesktopLifecycle'),'Windows main entry did not include lifecycle integration');
assert.ok(bundled.includes('backgroundThrottling: false'));
assert.ok(bundled.includes("path.join(process.resourcesPath, 'tray', 'icon.ico')"),'Packaged tray resource path missing');
const pkg=JSON.parse(asar.extractFile(packed,'package.json').toString('utf8'));
assert.equal(pkg.main,'main.js');
console.log('P0_PACKAGE_PASS: Windows app contains physical tray icon plus asar lifecycle, preload, renderer and AI bridge');
