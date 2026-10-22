'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('node:fs').mkdirSync(path.join(root, '.integration-evidence'), { recursive: true });
const cases = ['scripts/test-inbox-ai.js', 'scripts/test-inbox-semantics.js', 'scripts/test-calendar-reminders.js', 'scripts/test-work-assistant.js', 'tests/data-compatibility.test.cjs', 'tests/desktop-lifecycle.test.cjs', 'tests/p0-safety.test.cjs', 'tests/pilot-runtime.test.cjs', 'tests/interaction-regressions.test.cjs', 'tests/weather-client.test.cjs'];
const results = cases.map(file => {
  const result = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true });
  return { file, passed: result.status === 0 && !result.error, output: (result.stdout + result.stderr).trim(), error: result.error && result.error.message };
});
console.log(JSON.stringify({ passed: results.every(item => item.passed), results }, null, 2));
process.exitCode = results.every(item => item.passed) ? 0 : 1;
