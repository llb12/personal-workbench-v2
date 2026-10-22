'use strict';
process.env.TZ = 'Asia/Shanghai';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const assistant = require('../work-assistant');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name, indent = '  ') {
  const start = source.indexOf(indent + 'function ' + name + '(');
  assert(start >= 0, name + ' exists');
  const tail = source.slice(start);
  const boundary = new RegExp('^' + indent + '(?:function |window\\.)', 'mg');
  boundary.lastIndex = indent.length + 9;
  const next = boundary.exec(tail);
  assert(next, name + ' boundary');
  return tail.slice(0, next.index);
}
let now = Date.parse('2026-10-20T12:00:00+08:00');
const RealDate = Date;
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
let notifications = 0;
const context = {
  Date: TestDate, Intl, Set, Map, console, pad: value => String(value).padStart(2, '0'),
  data: { todos: [], projects: [], events: {}, workLog: [] },
  loaded: true, HAS_API: true, v2Mode: 'calendar', v2ReminderQueue: [],
  window: { WorkbenchAssistant: assistant, api: { notify() { notifications++; } } },
  fmt(d) { return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); },
  parseD(s) { const [y, m, d] = s.split('-').map(Number); return new TestDate(y, m - 1, d); },
  addDays(d, days) { const next = new TestDate(d); next.setDate(next.getDate() + days); return next; },
  today0() { const d = new TestDate(); d.setHours(0, 0, 0, 0); return d; },
  isArchivedTask(t) { return t.status === 'archived'; },
  v2Now() { return new TestDate().toISOString(); },
  v2DateText(s) { return s; },
  v2DateTimeText(s) { return s; },
  save() {}, renderV2ReminderTray() {}, v2RenderStatus() {}, v2Render() {}, toast() {},
  appendWorkLog(type, t, at) { context.data.workLog.push({ type, taskId: t.id, at }); }
};
context.todoById = id => context.data.todos.find(t => t.id === id);
context.v2AssistantRisks = () => assistant.risks({ currentDate: context.fmt(new TestDate()), timeZone: 'Asia/Shanghai', referenceInstant: new TestDate().toISOString(), tasks: context.data.todos, projects: [], records: [] });
vm.createContext(context);
vm.runInContext(extract('wbCalendarNodes', ''), context);
vm.runInContext(extract('wbDateOnly', ''), context);
for (const name of ['v2DateOnly', 'v2IsDateOnly', 'v2InputDateTime', 'v2ScheduleDate', 'v2ScheduleTime', 'v2EditedSchedule', 'v2ParseDate', 'v2Tomorrow', 'v2TaskTitle', 'v2IsWaiting', 'v2IsFollowUp', 'v2IsOpen', 'v2Due', 'v2DueMode', 'v2ReminderTargets', 'v2MarkReminder', 'v2ReminderBody', 'v2CenterReminderKey', 'v2ReminderClosed', 'v2SnoozeActive', 'v2CenterSignals', 'v2DismissReminder', 'v2ResetScheduleReminder', 'v2PruneReminderQueue', 'v2CheckReminders', 'v2ReminderCenterItems', 'v2RemoveReminder', 'v2Snooze', 'v2CompleteTask']) vm.runInContext(extract(name), context);
function task(id, extra = {}) { return { id, title: '演示：' + id, text: '演示：' + id, done: false, status: 'todo', dueMode: 'none', due: null, notificationKeys: [], projectId: 'p', ...extra }; }
const dated = task('date-only', { status: 'waiting', waitingFor: '演示协调方', followUpAt: '2026-10-20', dueMode: 'fixed', due: '2026-10-20' });
context.data.todos = [dated];
context.data.projects = [{ id: 'p', name: '演示项目', due: '2026-10-20', done: false }];
assert.equal(context.v2ReminderTargets(dated).length, 0, 'date-only fields create no timed notification');
context.v2CheckReminders();
assert.equal(notifications, 0);
assert.equal(context.v2ReminderCenterItems().signals.length, 1, 'same task merges deadline and follow-up risks');
assert.equal(context.wbCalendarNodes('2026-10-20').length, 3, 'deadline, follow-up and project share original objects');
assert.equal(context.wbCalendarNodes('2026-10-20')[0].task, dated);
const count = context.data.todos.length;
dated.due = '2026-10-21';
assert.equal(context.wbCalendarNodes('2026-10-20').filter(x => x.kind === 'deadline').length, 0);
assert.equal(context.wbCalendarNodes('2026-10-21')[0].id, dated.id);
assert.equal(context.data.todos.length, count);
assert.equal(context.v2EditedSchedule(null, '2026-10-26', ''), '2026-10-26');
assert.equal(context.v2EditedSchedule('2026-10-26', '2026-10-26', ''), '2026-10-26');
context.v2DismissReminder(dated);
assert.equal(dated.done, false);
assert.equal(dated.due, '2026-10-21');
assert.equal(context.v2ReminderCenterItems().signals.length, 0);
context.v2CheckReminders();
assert.equal(notifications, 0);
context.v2Snooze(dated.id, '2026-10-21');
assert.equal(context.v2ReminderTargets(dated).length, 0);
assert.equal(context.v2ReminderCenterItems().snoozed.length, 1);
assert.equal(dated.followUpAt, '2026-10-20');
now = Date.parse('2026-10-21T08:00:00+08:00');
context.v2CheckReminders();
assert.equal(notifications, 0, 'tomorrow date does not fabricate 09:00');
assert.equal(context.v2ReminderCenterItems().signals.length, 1);
assert.equal(dated.snoozedUntil, '2026-10-21');
const timed = task('timed', { reminderAt: '2026-10-21T07:55', followUpAt: '2026-10-21T07:55' });
context.data.todos = [timed];
context.v2ReminderQueue = [];
context.v2CheckReminders(); context.v2CheckReminders();
assert.equal(notifications, 1, 'simultaneous targets produce one notification');
assert.equal(context.v2ReminderCenterItems().due.length, 1);
timed.title = '演示：已编辑标题';
assert(context.v2ReminderCenterItems().due[0].body.includes(timed.title));
timed.dueMode = 'fixed'; timed.due = '2026-10-23';
context.v2ResetScheduleReminder(timed);
context.v2CheckReminders();
assert.equal(notifications, 1, 'changing a deadline must not replay the unchanged past explicit reminder');
timed.reminderAt = '2026-10-22T08:00'; timed.followUpAt = '2026-10-22';
assert.equal(context.v2ReminderCenterItems().due.length, 0, 'old queue is removed after schedule edit');
context.v2CompleteTask(timed, true); context.v2CompleteTask(timed, true);
assert.equal(context.data.workLog.filter(x => x.type === 'complete').length, 1);
context.v2CheckReminders();
assert.equal(context.v2ReminderCenterItems().due.length + context.v2ReminderCenterItems().signals.length, 0);
assert.equal(notifications, 1);
context.v2CompleteTask(timed, false);
assert.equal(timed.projectId, 'p');
assert.equal(timed.followUpAt, '2026-10-22');
const restored = task('restore-cycle', { dueMode: 'fixed', due: '2026-10-20', reminderAt: '2026-10-20T09:00' });
context.data.todos = [restored];
context.v2DismissReminder(restored);
context.v2CompleteTask(restored, true); context.v2CompleteTask(restored, false);
context.v2CheckReminders();
assert.equal(notifications, 1, 'restoring a task must not replay a handled past timed notification');
assert.equal(context.v2ReminderCenterItems().signals.length, 1, 'restored open task has its current date risk again');
context.data.todos = [];
context.v2PruneReminderQueue();
assert.equal(context.v2ReminderQueue.length, 0, 'deleted task has no queued reminder');
const explicit = task('chosen-nine', { dueMode: 'fixed', due: '2026-10-22', dueReminder: 'same-day' });
assert.equal(context.v2ReminderTargets(explicit)[0].at.getHours(), 9, 'explicit 09:00 menu choice remains compatible');
const boundary = task('new-year', { dueMode: 'fixed', due: '2027-01-01', followUpAt: '2026-12-31T16:30:00Z' });
context.data.todos = [boundary]; context.data.projects = [];
assert.equal(context.wbCalendarNodes('2027-01-01').length, 2, 'Shanghai date crosses UTC year boundary');
assert.equal(context.wbCalendarNodes('2026-12-31').length, 0);
const clock = { currentDate: '2026-10-20', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-20T04:00:00Z', records: [], tasks: [], projects: [] };
assert(assistant.normalizeSummary({}, clock, 'summarizeWeek').summary.includes('本周截至 2026-10-20（自 2026-10-19）'));
for (const [day, previous, following] of [['2026-11-01', '2026-10-31', '2026-11-01'], ['2027-01-01', '2026-12-31', '2027-01-01']]) {
  boundary.due = day; boundary.followUpAt = day;
  assert.equal(context.wbCalendarNodes(previous).length, 0);
  assert.equal(context.wbCalendarNodes(following).length, 2);
}
console.log('PASS: source calendar nodes; date-only precision; Shanghai month/year transitions; single-task reminder grouping, explicit notification times, dismiss/snooze, edit/complete/restore/delete; week-to-date label');
