'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {createDesktopLifecycle} = require('../desktop-lifecycle');

function harness(options={}) {
  const files = new Map();
  if (options.existing) files.set('C:/sandbox/desktop-ui.json',JSON.stringify(options.existing));
  const fs = {
    existsSync:p=>files.has(p),
    readFileSync:p=>files.get(p),
    mkdirSync(){},
    writeFileSync(p,text){files.set(p,text);},
    renameSync(a,b){if(!files.has(a))throw Error('missing tmp');files.set(b,files.get(a));files.delete(a);}
  };
  const menu={template:null};
  const events={};
  const win={
    hidden:false, focused:false, closePrevented:false, size:{x:100,y:80,width:1200,height:810},
    destroyed:false, minimized:false, maximized:false, visible:true,
    on(type,handler){events[type]=handler;},
    isDestroyed(){return this.destroyed;},isMinimized(){return this.minimized;},
    isMaximized(){return this.maximized;},isVisible(){return this.visible;},
    getNormalBounds(){return this.size;},
    hide(){this.hidden=true;this.visible=false;},
    show(){this.hidden=false;this.visible=true;},
    focus(){this.focused=true;},restore(){this.minimized=false;},
    webContents:{loading:false,sent:[],isLoading(){return this.loading;},
      send(event){this.sent.push(event);},
      once(type,handler){this.pendingLoad=handler;}
    }
  };
  const app={quitCount:0,getPath(type){assert.equal(type,'userData');return 'C:/sandbox';},quit(){this.quitCount++;}};
  const screen={getAllDisplays(){return options.displays || [{workArea:{x:0,y:0,width:1920,height:1080}}];}};
  function Tray(img) {
    assert.deepEqual(img,{valid:true});
    this.handlers={};this.destroyed=false;
    this.on=(name,cb)=>{this.handlers[name]=cb;};
    this.setToolTip=text=>assert.equal(text,'个人工作台');
    this.setContextMenu=v=>{menu.template=v;};
    this.destroy=()=>{this.destroyed=true;};
    options.trayInstance=this;
  }
  const nativeImage={createFromPath(src){assert.match(src,/icon\.ico$/);return {valid:true,isEmpty(){return !!options.badIcon;}};}};
  const lifecycle=createDesktopLifecycle({
    app, screen, Tray, Menu:{buildFromTemplate:t=>t},nativeImage,fs,path,
    iconPath:'C:/repo/build/icon.ico',getWindow:()=>win,platform:options.platform||'win32'
  });
  return {lifecycle,win,events,files,menu,app,options};
}

// Default: closing × still exits, even if a tray icon was created.
{
  const h=harness();const {lifecycle,win,events}=h;
  lifecycle.attachWindow(win);
  assert.deepEqual(lifecycle.getSettings(),{closeToTray:false,trayAvailable:false});
  assert.equal(lifecycle.ensureTray(),true);
  assert.deepEqual(lifecycle.getSettings(),{closeToTray:false,trayAvailable:true});
  let prevented=false;
  events.close({preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'default behavior must remain exit');
  assert.equal(win.hidden,false);
}

// Opt-in: X hides to tray; tray menu restores, captures, explicitly quits.
{
  const h=harness();const {lifecycle,win,events,menu,app}=h;
  lifecycle.attachWindow(win);lifecycle.ensureTray();
  const set=lifecycle.setSettings({closeToTray:true});
  assert.equal(set.ok,true);assert.equal(set.closeToTray,true);
  assert.equal(JSON.parse(h.files.get('C:/sandbox/desktop-ui.json')).closeToTray,true);
  let prevented=false;
  events.close({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(win.hidden,true);
  const open=menu.template.find(x=>x.label==='打开个人工作台');
  open.click();assert.equal(win.visible,true);assert.equal(win.focused,true);
  menu.template.find(x=>x.label==='快速记录').click();
  assert.deepEqual(win.webContents.sent,['desktop-quick-capture']);
  const quit=menu.template.find(x=>x.label==='退出个人工作台');
  quit.click();assert.equal(app.quitCount,1);
  lifecycle.beforeQuit();assert.equal(h.options.trayInstance.destroyed,true);
  prevented=false;events.close({preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'explicit quit must never hide to tray');
}

// Delayed renderer load must not lose quick capture.
{
  const h=harness();h.lifecycle.attachWindow(h.win);h.lifecycle.ensureTray();
  h.win.webContents.loading=true;
  h.lifecycle.quickCapture();
  assert.equal(h.win.webContents.sent.length,0);
  h.win.webContents.pendingLoad();
  assert.deepEqual(h.win.webContents.sent,['desktop-quick-capture']);
}

// Window bounds: persist normal geometry, restore on-screen; off-screen is discarded.
{
  const h=harness();h.lifecycle.attachWindow(h.win);
  h.events.close({preventDefault(){}});
  const saved=JSON.parse(h.files.get('C:/sandbox/desktop-ui.json'));
  assert.deepEqual(saved.bounds,{x:100,y:80,width:1200,height:810});
  const restored=harness({existing:saved});
  assert.deepEqual(restored.lifecycle.getWindowBounds(),saved.bounds);
  const changed=harness({existing:{closeToTray:true,bounds:{x:10000,y:10000,width:1000,height:600}}});
  assert.deepEqual(changed.lifecycle.getWindowBounds(),{});
  const corrupt=harness({existing:{closeToTray:"yes",bounds:{x:"0",y:0,width:100,height:500}}});
  assert.equal(corrupt.lifecycle.getSettings().closeToTray,false);
  assert.deepEqual(corrupt.lifecycle.getWindowBounds(),{});
}

// Tray creation failure never enables hide-to-tray or prevents an ordinary close.
{
  const h=harness({badIcon:true});h.lifecycle.attachWindow(h.win);
  assert.equal(h.lifecycle.ensureTray(),false);
  assert.equal(h.lifecycle.setSettings({closeToTray:true}).ok,false);
  let prevented=false;
  h.events.close({preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  assert.equal(h.win.hidden,false);
}

// Desktop settings must never share the task data file or AI secret storage.
assert.ok(!require('node:fs').readFileSync(path.join(__dirname,'../desktop-lifecycle.js'),'utf8').includes("'data.json'"));
console.log('P0_DESKTOP_PASS: default exit, opt-in tray, capture, quit, bounds, bad icon, isolation');
