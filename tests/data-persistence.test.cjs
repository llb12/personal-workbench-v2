'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDataWriter, validateData } = require('../data-persistence');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-persistence-test-'));
const full = () => ({ schemaVersion: 3, todos: [{ id: 'task', text: 'Fixture' }], projects: [], inbox: [], workLog: [], events: {}, note: '' });
const empty = () => ({ ...full(), todos: [] });
function setup(options = {}) {
  const directory = fs.mkdtempSync(path.join(root, 'case-')), file = path.join(directory, 'data.json');
  const before = Buffer.from(JSON.stringify(full())); fs.writeFileSync(file, before);
  const writer = createDataWriter({ file: () => file, ...options }); writer.prime(before);
  return { directory, file, before, writer };
}
assert.ok(validateData({})); assert.ok(validateData({ ...full(), todos: [{}] })); assert.ok(validateData({ ...full(), todos: [{id:'bad',text:4}] })); assert.ok(validateData({ ...full(), todos: [null] })); assert.ok(validateData({ ...full(), events: [] }));
assert.equal(validateData({ todos: [], note: 'legacy' }, true), null);
{
  const { file, before, writer } = setup();
  assert.equal(writer.write({}).code, 'DATA_SHAPE_INVALID'); assert.deepEqual(fs.readFileSync(file), before);
  const ask = writer.write(empty()); assert.equal(ask.code, 'DATA_EMPTY_CONFIRM_REQUIRED'); assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(writer.write({ ...empty(), theme: 'dark' }, { emptyToken: ask.emptyToken }).code, 'DATA_EMPTY_CONFIRM_REQUIRED');
  const exact = writer.write(empty()); assert.equal(writer.write(empty(), { emptyToken: exact.emptyToken }).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file)).todos.length, 0);
  const backups = fs.readdirSync(path.join(path.dirname(file), 'backups')); assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), 'backups', backups[0])), before);
}
for (const failure of ['rename', 'backup']) {
  const fake = { ...fs };
  if (failure === 'rename') fake.renameSync = () => { throw new Error('Injected rename failure'); };
  else fake.writeFileSync = (file, ...args) => { if (String(file).includes('backups')) throw new Error('Injected backup failure'); return fs.writeFileSync(file, ...args); };
  const { file, directory, before, writer } = setup({ fs: fake });
  assert.equal(writer.write({ ...full(), note: 'changed' }).ok, false); assert.deepEqual(fs.readFileSync(file), before);
  assert.ok(!fs.readdirSync(directory).some(name => name.includes('.tmp-')));
}
{
  let day = 1;
  const { directory, writer } = setup({ now: () => new Date(2026, 9, day, 12), maxBackups: 3 });
  for (day = 1; day <= 6; day++) assert.ok(writer.write({ ...full(), note: String(day) }).ok);
  assert.equal(fs.readdirSync(path.join(directory, 'backups')).length, 3);
}
{
  const { file, writer } = setup(); fs.writeFileSync(file, JSON.stringify({ ...full(), note: 'external' }));
  assert.equal(writer.write(full()).code, 'DATA_EXTERNAL_CHANGE'); assert.equal(JSON.parse(fs.readFileSync(file)).note, 'external');
}
console.log('PERSISTENCE_PASS: shape validation, exact empty confirmation, pre-write backup, retention, external edits and atomic failure cleanup');
