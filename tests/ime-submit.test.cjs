'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
for (const token of ["$('evText').addEventListener('keydown'", "$('todoList').addEventListener('keydown'", "kb.addEventListener('keydown'"]) {
  const begin = html.indexOf(token), end = html.indexOf('\n});', begin);
  assert.ok(begin > 0 && end > begin);
  let handler, additions = 0;
  const input = { value: '中文候选', getAttribute: () => 'active', parentNode: { querySelector: () => null } };
  const context = { wbIsComposingKey: e => e.isComposing || e.keyCode === 229 || e.which === 229,
    $: id => id === 'evRepeat' ? { value: 'none' } : { addEventListener: (name, fn) => { handler = fn; } },
    kb: { addEventListener: (name, fn) => { handler = fn; } }, data: { events: {} }, selDate: '2026-10-22',
    addProjectItem() { additions++; }, addTodo() { additions++; return true; }, renderKanban() {}, renderCal() {}, renderOverview() {}, save() {} };
  vm.createContext(context); vm.runInContext(html.slice(begin, end + 4), context);
  const event = extra => ({ key: 'Enter', target: { closest: () => input }, preventDefault() {}, ...extra });
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) handler.call(input, event(extra));
  assert.equal(additions, 0); assert.equal(Object.keys(context.data.events).length, 0); assert.equal(input.value, '中文候选');
  handler.call(input, event({}));
  assert.equal(additions + Object.values(context.data.events).flat().length, 1); assert.equal(input.value, '');
}
console.log('IME_SUBMIT_PASS: calendar, project entry and board ignore composing Enter; one confirmed Enter creates one item');
