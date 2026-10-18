'use strict';
// P0 safety checks: Node built-ins only; no Electron, real user data, or external services.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

// Validate both inline scripts without executing the application's startup logic.
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length>=1,'inline script not found');
scripts.forEach((match,i)=>new vm.Script(match[1],{filename:'index.html inline '+i}));
assert.equal((html.match(/\b(?:window\.)?prompt\s*\(/g)||[]).length,0,'native prompt still present');
assert.equal((html.match(/\b(?:window\.)?confirm\s*\(/g)||[]).length,0,'native confirm still present');
assert.equal((html.match(/\b(?:window\.)?alert\s*\(/g)||[]).length,0,'native alert still present');
assert.equal((html.match(/id="wbDecisionMask"/g)||[]).length,1,'three-way decision dialog missing');
assert.ok(html.includes('function wbErrorModal('),'persistent in-app error dialog missing');
const importFlow=html.slice(html.indexOf("$('btnImport').addEventListener("),html.indexOf("$('fileInput').addEventListener("));
assert.ok(importFlow.indexOf('save(true).then')>=0&&importFlow.indexOf('window.api.importData()')>importFlow.indexOf('save(true).then'),'latest data must flush before main-process pre-import backup');
assert.equal((html.match(/id="promptModalMask"/g)||[]).length,1);
assert.equal((html.match(/id="wbConfirmMask"/g)||[]).length,1);
assert.ok(!html.includes("if(e.key==='Escape'){if(document.activeElement)document.activeElement.blur();return;}"),'legacy Escape focus loss present');

// Exercise the actual overlay registry and Escape dispatcher using an isolated simulated document.
const begin=html.indexOf('var wbOverlayStack=[];');
const end=html.indexOf('/* P0-2A: one outstanding confirm',begin);
assert.ok(begin>0&&end>begin,'overlay implementation markers not found');
const handlers={};
const document={addEventListener(type,fn,capture){if(type==='keydown'&&capture)handlers.keydown=fn;}};
const ctx={document};
vm.createContext(ctx);
vm.runInContext(html.slice(begin,end),ctx);
assert.equal(typeof handlers.keydown,'function','global Escape dispatcher not registered');
const closed=[],close=(id)=>()=>{closed.push(id);ctx.wbOverlayDrop(id);};
ctx.wbOverlayPush('under',close('under'),()=>true);
ctx.wbOverlayPush('top',close('top'),()=>true);
function escEvent(overrides={}){
  return Object.assign({key:'Escape',isComposing:false,keyCode:27,which:27,
    prevented:false,stopped:false,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}
  },overrides);
}
let e=escEvent();
handlers.keydown(e);
assert.deepEqual(closed,['top'],'Escape must close only the last opened overlay');
assert.ok(e.prevented&&e.stopped);
e=escEvent();handlers.keydown(e);assert.deepEqual(closed,['top','under']);
e=escEvent();handlers.keydown(e);assert.equal(e.prevented,false,'no overlays: do not blur/prevent default');
ctx.wbOverlayPush('ime',close('ime'),()=>true);
e=escEvent({isComposing:true});handlers.keydown(e);assert.equal(e.prevented,false,'IME Escape must be ignored');
ctx.wbOverlayDrop('ime');

// Exercise the actual scoped task-delete/undo implementation on disposable mock data.
const delBegin=html.indexOf('  function v2RefreshAfterDelete(){');
const delEnd=html.indexOf('  function v2TaskBoardAction(',delBegin);
assert.ok(delBegin>0&&delEnd>delBegin,'task delete implementation not found');
const original={todos:[{id:'one',text:'A'},{id:'two',text:'B'}],workLog:[],focusId:'one'};
let undo=null;
let renders=0;
const reminders=[{id:'one',kind:'due'},{id:'two',kind:'due'}];
const sandbox={
  data:original,v2ReminderQueue:reminders,v2EditingTaskId:null,
  v2HomeAI:{task:null},v2Now:()=> '2026-10-18T00:00:00.000Z',
  appendWorkLog(type,t){const log={id:'delete-log-1',type,taskId:t.id};this.data.workLog.push(log);return log;},
  renderBadges(){renders++;},renderTodos(){},renderKanban(){},renderAlert(){},renderReview(){},save(){},v2Render(){},
  toast(msg,opts){if(opts&&opts.undo)undo=opts.undo;},
};
vm.createContext(sandbox);
// Function call is unbound; use sandbox.data explicitly from within the test stub.
sandbox.appendWorkLog=function(type,t){const log={id:'delete-log-1',type,taskId:t.id};sandbox.data.workLog.push(log);return log;};
vm.runInContext(html.slice(delBegin,delEnd),sandbox);
assert.equal(sandbox.v2DeleteTaskWithLog(original.todos[0],'one'),true);
assert.deepEqual(original.todos.map(t=>t.id),['two']);
assert.equal(original.workLog.length,1);
assert.deepEqual(sandbox.v2ReminderQueue.map(t=>t.id),['two']);
assert.equal(original.focusId,null);
assert.equal(typeof undo,'function');
original.todos.push({id:'three',text:'C'}); // unrelated action after delete
undo();
assert.deepEqual(original.todos.map(t=>t.id),['one','two','three'],'undo must preserve later unrelated work');
assert.equal(original.workLog.length,0,'undo should remove only the matching delete log');
assert.deepEqual(sandbox.v2ReminderQueue.map(t=>t.id).sort(),['one','two']);
assert.equal(original.focusId,'one');
assert.ok(renders>=2);

// Project deletion undo restores only tasks still ungrouped; unrelated edits survive.
const project={id:'p1',name:'Project'};
const assigned={id:'a',pid:'p1',projectId:'p1'};
const untouched={id:'b',pid:'p2',projectId:'p2'};
const projectData={projects:[project],todos:[assigned,untouched]};
const expanded={p1:true};
let undoProject=null;
const projectCtx={
  data:projectData,projExpanded:expanded,
  projectsById(){return Object.fromEntries(projectData.projects.map(p=>[p.id,p]));},
  todoById(id){return projectData.todos.find(t=>t.id===id)||null;},
  renderTodos(){},renderOverview(){},renderAlert(){},renderDoneList(){},renderCal(){},save(){},
  window:{v2Render(){}},toast(msg,opts){if(opts&&opts.undo)undoProject=opts.undo;}
};
const projBegin=html.indexOf('function deleteProject(id){');
const projEnd=html.indexOf('function completeProject(id,done)',projBegin);
assert.ok(projBegin>0&&projEnd>projBegin);
vm.createContext(projectCtx);
vm.runInContext(html.slice(projBegin,projEnd),projectCtx);
projectCtx.deleteProject('p1');
assert.equal(projectData.projects.length,0);
assert.equal(assigned.pid,null);
assert.equal(untouched.pid,'p2');
assert.equal(typeof undoProject,'function');
projectData.todos.push({id:'new',pid:'p2',projectId:'p2'});
undoProject();
assert.equal(projectData.projects.length,1);
assert.equal(assigned.pid,'p1');
assert.equal(projectData.todos.length,3);
assert.equal(untouched.pid,'p2');

console.log('P0_STATIC_PASS: syntax, no native dialogs, overlay Esc, IME, task and project scoped undo, import backup preflight');
