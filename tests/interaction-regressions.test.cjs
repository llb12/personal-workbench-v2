'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function extract(name, next) {
  const start = html.indexOf('function ' + name + '('), end = html.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'missing function ' + name);
  return html.slice(start, end);
}
const elements = {};
for (const id of ['taskEditTitle', 'taskEditFollowUp', 'taskEditFollowUpTime', 'taskEditDueMode', 'taskEditDue']) elements[id] = { value: '', focus() { this.focused = true; } };
elements.taskEditTitle.value = 'Synthetic task'; elements.taskEditDueMode.value = 'fixed';
let created = 0, rendered = 0;
const context = vm.createContext({ Date, Promise, Number, window: { _curDay: 'old', v2Render() { rendered++; } }, loaded: true,
  document: { activeElement: null }, fmt: () => '2026-10-22',
  $: id => elements[id], toast() {}, todoById() { created++; throw new Error('Data must not be reached for an invalid form'); },
  renderOverview() {}, renderTodos() {}, renderCal() {}, renderKanban() {}, renderCore() {} });
vm.runInContext(extract('v2SaveTaskModal', '  function v2TaskAIObject'), context);
context.v2SaveTaskModal();
assert.equal(created, 0, 'A fixed deadline without a date must not create or edit a task');
assert.equal(elements.taskEditDue.focused, true);
vm.runInContext(extract('refreshDayViews', 'setInterval(refreshDayViews'), context);
context.document.activeElement = { closest: () => true, matches: () => true };
context.refreshDayViews();
assert.equal(rendered, 0, 'Do not replace a form while its draft is being edited');
assert.equal(context.window._curDay, 'old', 'A deferred refresh must remain pending');
context.document.activeElement = null; context.refreshDayViews();
assert.equal(rendered, 1); context.refreshDayViews(); assert.equal(rendered, 1, 'Same-day focus must not repeat a full render');
vm.runInContext(extract('wbIsComposingKey', 'function pad('), context);
for (const event of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) assert.equal(context.wbIsComposingKey(event), true);
assert.equal(context.wbIsComposingKey({ key: 'Enter' }), false);
assert.equal(/id="btnLayout"/.test(html), false, 'The obsolete layout control must not be exposed');
assert.equal(html.includes('api.open-meteo.com'), false);
assert.equal(html.includes('api.bigdatacloud.net'), false);
console.log('INTERACTION_PASS: incomplete deadline, draft-safe day refresh, IME guards, obsolete layout control removed');
