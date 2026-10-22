'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function config(name) {
  const value = name === 'package.json' ? require('../package.json').build : JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const base = value.extends ? config(value.extends.replace(/^\.\//, '')) : { files: [] };
  return { ...base, ...value, files: [...base.files, ...(value.files || [])] };
}
const common = require('../electron-builder.common.json');
for (const name of ['package.json', 'electron-builder.release.json', 'electron-builder.pilot.json']) {
  const result = config(name);
  for (const file of common.files) assert.ok(result.files.includes(file), name + ': ' + file);
  assert.ok(result.files.includes('weather-client.js') && result.files.includes('weather-cities.json'));
  assert.equal(result.files.includes('pilot-mode.json'), name.includes('pilot'));
}
console.log('BUILD_MANIFEST_PASS: shared runtime resources; pilot marker required only for pilot');
