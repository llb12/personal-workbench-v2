'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizer, compareFields, relations } = require('../scripts/data-compatibility.cjs');
const normalize = normalizer(path.resolve(__dirname, '..'));
const seed = normalize.prepare({ schemaVersion: 3, todos: [{ id: 'task-fixture', text: 'Synthetic task', pid: 'project-fixture', due: '2026-10-26', status: 'waiting', waitingFor: 'Synthetic team', followUpAt: '2026-10-26' }], projects: [{ id: 'project-fixture', name: 'Synthetic project' }], inbox: [{ id: 'inbox-fixture', rawText: 'Synthetic source', candidates: [{ id: 'candidate-fixture', title: 'Synthetic candidate' }] }], events: { '2026-10-26': [{ text: 'Synthetic event' }] }, workLog: [{ id: 'record-fixture', type: 'complete', taskId: 'task-fixture', at: '2026-10-19T12:00:00+08:00', snapshot: { id: 'task-fixture', title: 'Synthetic snapshot' } }] });
seed.futureRoot = { kept: ['all', { value: 7 }] };
seed.kanban = { todo: ['task-fixture'], custom: ['task-fixture'] };
seed.todos[0].futureTask = { version: 2 };
seed.todos[0].aiMeta.futureAI = 'preserved';
seed.todos[0].tags = Array.from({ length: 25 }, (_, i) => 'tag-' + i);
seed.todos[0].notificationKeys = Array.from({ length: 35 }, (_, i) => 'key-' + i);
seed.projects[0].futureProject = { step: 9 };
seed.inbox[0].futureInbox = true;
seed.inbox[0].candidates[0].futureCandidate = { evidence: ['fixture'] };
seed.inbox[0].candidates[0].tags = Array.from({ length: 15 }, (_, i) => 'candidate-tag-' + i);
seed.workLog[0].futureRecord = 1;
seed.workLog[0].snapshot.futureSnapshot = true;
seed.events['2026-10-26'][0].futureEvent = 'retained';
seed.profile.futureProfile = 'retained';
for (const item of [seed, seed.todos[0], seed.projects[0], seed.events['2026-10-26'][0]]) {
  Object.defineProperty(item, '__proto__', { value: { syntheticExtension: true }, enumerable: true });
}
const saved = normalize.prepare(seed);
const comparison = compareFields(seed, saved);
if (comparison.changedFields) {
  const changed = [];
  function locate(a, b, key) {
    if (a && typeof a === 'object') Object.keys(a).forEach(k => locate(a[k], b && b[k], key + '.' + k));
    else if (!Object.is(a, b)) changed.push(key);
  }
  locate(seed, saved, 'synthetic');
  console.error('SYNTHETIC_CHANGED_FIELD_PATHS:' + changed.join(','));
}
assert.deepEqual({ ...comparison, comparedScalars: 0 }, { lostFields: 0, changedFields: 0, lostEntities: 0, comparedScalars: 0 });
assert.equal(saved.todos[0].followUpAt, '2026-10-26');
assert.equal(saved.todos[0].tags.length, 25);
assert.equal(saved.todos[0].notificationKeys.length, 35);
assert.equal({}.syntheticExtension, undefined);
assert.equal(normalize.prepare({ todos: [{ id: 'restored-fixture', text: 'Synthetic restored task', status: 'todo', waitingFor: 'Historical waiting party' }] }).todos[0].status, 'todo', 'An explicit restored status must override historical waiting metadata');
const twice = normalize.prepare(saved);
assert.deepEqual(twice, saved);
const links = relations(saved);
assert.equal(links.duplicateTaskIds + links.missingTaskProjects + links.brokenCandidateTaskLinks, 0);
console.log('DATA_COMPATIBILITY_PASS: extensions, original fields, IDs, references and date-only values survive read/save/read');
