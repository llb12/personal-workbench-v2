'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
function functionSource(html, name) {
  const begin = html.indexOf('function ' + name + '(');
  if (begin < 0) throw new Error('COMPAT_FUNCTION_MISSING');
  const next = html.indexOf('\nfunction ', begin + 10);
  if (next < 0) throw new Error('COMPAT_FUNCTION_BOUNDARY');
  return html.slice(begin, next);
}
function normalizer(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = html.indexOf('var EMPTY='), alternate = html.indexOf('var EMPTY =');
  const begin = start < 0 ? alternate : start;
  const end = html.indexOf('\nvar ', begin + 10);
  if (begin < 0 || end < 0) throw new Error('COMPAT_DEFAULTS_MISSING');
  const context = { WorkbenchTaskState: require('../task-state'), isArchivedTask: t => !!t && (t.archived === true || t.status === 'archived' || !!t.archivedAt), uid: 1, Date, Math, Number, String, Object, Array, JSON, isFinite, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(context);
  vm.runInContext(html.slice(begin, end), context);
  for (const name of ['genId', 'preserveDataFields', 'normalizeAIMeta', 'workLogTaskSnapshot', 'normalizeWorkLogEntry', 'normalize']) {
    if (html.includes('function ' + name + '(')) vm.runInContext(functionSource(html, name), context);
  }
  const normalize = input => JSON.parse(JSON.stringify(context.normalize(JSON.parse(JSON.stringify(input)))));
  vm.runInContext(functionSource(html, 'prepareDataForSave'), context);
  normalize.prepare = input => { context.data = normalize(input); context.prepareDataForSave(); return JSON.parse(JSON.stringify(context.data)); };
  return normalize;
}
function compareFields(before, after) {
  const result = { lostFields: 0, changedFields: 0, lostEntities: 0, comparedScalars: 0 };
  function visit(a, b, exists) {
    if (!exists) { result.lostFields++; return; }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) { result.changedFields++; return; }
      const byId = a.length && a.every(x => x && typeof x === 'object' && typeof x.id === 'string') ? new Map(b.filter(x => x && typeof x.id === 'string').map(x => [x.id, x])) : null;
      a.forEach((x, i) => { const next = byId ? byId.get(x.id) : b[i]; if (byId && !next) result.lostEntities++; else visit(x, next, byId ? !!next : i < b.length); });
      return;
    }
    if (a && typeof a === 'object') {
      if (!b || typeof b !== 'object' || Array.isArray(b)) { result.changedFields++; return; }
      Object.keys(a).forEach(key => visit(a[key], b[key], Object.hasOwn(b, key)));
      return;
    }
    result.comparedScalars++; if (!Object.is(a, b)) result.changedFields++;
  }
  visit(before, after, true); return result;
}
function relations(data) {
  const tasks = Array.isArray(data.todos) ? data.todos : [], projects = Array.isArray(data.projects) ? data.projects : [], records = Array.isArray(data.workLog) ? data.workLog : [], inbox = Array.isArray(data.inbox) ? data.inbox : [];
  const ids = list => new Set(list.map(x => x && x.id));
  const taskIds = ids(tasks), projectIds = ids(projects), inboxIds = ids(inbox);
  const project = x => x.projectId || x.pid;
  return {
    tasks: tasks.length, projects: projects.length, records: records.length, inbox: inbox.length,
    duplicateTaskIds: tasks.length - taskIds.size, duplicateProjectIds: projects.length - projectIds.size,
    duplicateRecordIds: records.length - ids(records).size, duplicateInboxIds: inbox.length - inboxIds.size,
    conflictingTaskProjectAliases: tasks.filter(t => t.pid && t.projectId && t.pid !== t.projectId).length,
    missingTaskProjects: tasks.filter(t => project(t) && !projectIds.has(project(t))).length,
    missingTaskInboxSources: tasks.filter(t => t.sourceId && !inboxIds.has(t.sourceId)).length,
    brokenCandidateTaskLinks: inbox.flatMap(x => x.candidates || []).filter(c => c.createdTaskId && !taskIds.has(c.createdTaskId)).length,
    brokenCandidateProjectLinks: inbox.flatMap(x => x.candidates || []).filter(c => project(c) && !projectIds.has(project(c))).length,
    missingRecordProjects: records.filter(r => r.projectId && !projectIds.has(r.projectId)).length,
    historicRecordsWithTaskSnapshot: records.filter(r => r.taskId && !taskIds.has(r.taskId) && r.snapshot && r.snapshot.id === r.taskId).length,
    recordTimestampFailures: records.filter(r => !Number.isFinite(Date.parse(r.at))).length
  };
}
module.exports = { normalizer, compareFields, relations, functionSource };
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.integration-evidence/final-pilot-20261020/private-manifest.json'), 'utf8'));
    const source = path.join(manifest.compatibilityProfile, 'data.json');
    if (path.resolve(source) === path.resolve(manifest.originalPath)) throw new Error('FORMAL_PROFILE_FORBIDDEN');
    const bytes = fs.readFileSync(source), before = JSON.parse(bytes.toString('utf8'));
    const normalize = normalizer(root), after = normalize.prepare(before), twice = normalize.prepare(after);
    const result = { inputSha256: crypto.createHash('sha256').update(bytes).digest('hex'), fields: compareFields(before, after), secondRead: compareFields(after, twice), beforeRelations: relations(before), afterRelations: relations(after), rawDataPrinted: false, networkUsed: false };
    console.log(JSON.stringify(result, null, 2));
  } catch (_) { console.error('COMPAT_AUDIT_BLOCKED: details suppressed to protect private data'); process.exitCode = 1; }
}
