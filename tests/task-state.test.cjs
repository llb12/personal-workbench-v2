'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const state = require('../task-state');
const { normalizer } = require('../scripts/data-compatibility.cjs');
const normalize = normalizer(path.resolve(__dirname, '..'));
const fs = require('node:fs'), vm = require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'), main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const context={WorkbenchTaskState:state,isArchivedTask:t=>!!t&&(t.archived||t.status==='archived'),data:{projects:[{id:'p',name:'Original project'}],workLog:[]},genId:()=>String(Math.random()),Date};vm.createContext(context);
for(const name of ['workLogTaskSnapshot','appendWorkLog']){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+10);vm.runInContext(html.slice(a,b),context);}
const historyTask={id:'task-history',text:'Task',pid:'p',done:true,status:'done',doneAt:'2026-10-22T10:00:00Z'};
context.appendWorkLog('complete',historyTask);context.data.projects[0].name='Renamed project';context.appendWorkLog('archive',historyTask);
assert.equal(context.data.workLog[0].projectNameAtEvent,'Original project');assert.equal(context.data.workLog[0].snapshot.projectNameAtEvent,'Original project');assert.equal(context.data.workLog[1].projectNameAtEvent,'Renamed project');
const importStart=main.indexOf('function isPlainObject('),importEnd=main.indexOf("\nownIPC.handle('import-data'",importStart);vm.runInContext(main.slice(importStart,importEnd),context);
assert.equal(context.validateImportData({schemaVersion:4,todos:[],projects:[],events:{},inbox:[],workLog:[]}),null);
assert.ok(context.validateImportData({schemaVersion:5,todos:[]}));
const stamp = '2026-10-21T16:30:00.000Z';
for (const schemaVersion of [2, 3]) {
  const seed = { schemaVersion, todos: [{ id: 'done', text: 'Completed fixture', done: true, status: 'archived', doneAt: stamp, completedAt: stamp, future: 'kept' }, { id: 'unknown-time', text: 'Legacy archive', status: 'archived' }], projects: [], inbox: [], events: {}, workLog: [] };
  const migrated = normalize.prepare(seed), task = migrated.todos[0];
  assert.equal(task.archived, true); assert.equal(task.done, true); assert.equal(task.status, 'done'); assert.equal(task.completedAt, stamp); assert.equal(task.future, 'kept');
  assert.equal(task.archivedAt, null, 'Do not invent legacy archive time');
  state.setArchived(task, false, '2026-10-22T10:00:00Z'); assert.equal(task.done, true); assert.equal(task.completedAt, stamp);
  state.setArchived(task, true, '2026-10-22T10:00:00Z'); assert.equal(task.doneAt, stamp); assert.equal(task.status, 'done');
  assert.equal(migrated.todos[1].doneAt, null); assert.equal(migrated.todos[1].completedAt, null);
  assert.deepEqual(normalize.prepare(migrated), migrated);
}
const doneWithoutTime = normalize.prepare({ todos: [{ id: 'no-time', done: true, text: 'No timestamp' }] }).todos[0];
assert.equal(doneWithoutTime.completedAt, null, 'Do not invent completion times');
assert.equal(state.label({status:'todo'}),'待办');
assert.equal(state.label({status:'doing'}),'进行中');
assert.equal(state.normalize({done:false,status:'done'}).done,false,'Explicit restored boolean must override stale legacy status');
console.log('TASK_STATE_PASS: legacy migration, orthogonal archive, completion timestamps and unknown fields survive repeat saves');

Object.assign(context,{esc:x=>String(x),PRI_CLS:{mid:'pri-m'},PRI_TXT:{mid:'中'}});
const boardStart=html.indexOf('function kbCardHTML('),boardEnd=html.indexOf('\nvar kb=',boardStart);vm.runInContext(html.slice(boardStart,boardEnd),context);
for(const [status,label]of [['todo','待办'],['doing','进行中']]){const markup=context.kbCardHTML({id:status,text:status,pri:'mid',status},'active','2026-10-22');assert.ok(markup.includes('task-status\">'+label+'</span>'),'Board must show '+label);}
