'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
if (!process.argv.includes('--case')) {
  for (const zone of ['UTC', 'Asia/Shanghai']) {
    const result = spawnSync(process.execPath, [__filename, '--case'], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  console.log('LOCAL_DATES_PASS: UTC and Shanghai midnight, 07:59, 23:59, month/year boundaries and calendar-only deadlines');
} else {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('function wbDateOnly('), end = html.indexOf('\nfunction ', start + 10);
  const context = { window: { WorkbenchAssistant: require('../work-assistant') }, Intl, String };
  vm.createContext(context); vm.runInContext(html.slice(start, end), context);
  const shanghai = process.env.TZ === 'Asia/Shanghai';
  const cases = [
    ['2026-10-21T16:30:00.000Z', '2026-10-21', '2026-10-22'],
    ['2026-10-31T23:59:00Z', '2026-10-31', '2026-11-01'],
    ['2026-10-22T15:59:00Z', '2026-10-22', '2026-10-22'],
    ['2026-12-31T16:30:00Z', '2026-12-31', '2027-01-01'],
    ['2026-11-01T00:30:00+08:00', '2026-10-31', '2026-11-01']
  ];
  for (const [value, utc, cn] of cases) assert.equal(context.wbDateOnly(value), shanghai ? cn : utc, value);
  for (const value of ['2026-10-22', '2026-10-22T00:30', '2026-10-22T23:59:59']) assert.equal(context.wbDateOnly(value), '2026-10-22');
  for (const value of ['', 'invalid', '2026-02-30']) assert.equal(context.wbDateOnly(value), '');
  assert.equal(/(?:doneAt|completedAt)\.slice\(/.test(html), false);
}
