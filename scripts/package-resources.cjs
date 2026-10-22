'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function inspectPackage(packed, profile = 'release') {
  const asar = require('@electron/asar');
  const files = new Set(asar.listPackage(packed).map(v => v.replace(/\\/g, '/').replace(/^\/+/, '')));
  const required = new Set(['package.json', 'main.js', 'preload.js', 'index.html', 'pilot-runtime.js']);
  if (profile === 'pilot') required.add('pilot-mode.json');
  else assert.ok(!files.has('pilot-mode.json'), 'Release must not activate isolated pilot mode');
  const queue = [...required];
  function add(from, relative) {
    const name = path.posix.normalize(path.posix.join(path.posix.dirname(from), relative));
    assert.ok(!name.startsWith('../'), 'Resource escapes package: ' + name);
    const resolved = [name, name + '.js', name + '.json', name + '.cjs'].find(v => files.has(v));
    assert.ok(resolved, 'Missing packaged resource: ' + name + ' (from ' + from + ')');
    if (!required.has(resolved)) { required.add(resolved); queue.push(resolved); }
  }
  while (queue.length) {
    const name = queue.shift();
    assert.ok(files.has(name), 'Missing packaged resource: ' + name);
    if (!/\.(?:js|cjs|html)$/.test(name)) continue;
    const source = asar.extractFile(packed, name).toString('utf8');
    for (const hit of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) add(name, hit[1]);
    if (name.endsWith('.html')) {
      for (const hit of source.matchAll(/<script\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) {
        assert.ok(!/^(?:https?:|\/\/)/i.test(hit[1]), 'Renderer script must be local');
        add(name, hit[1]);
      }
    }
    for (const hit of source.matchAll(/path\.join\(__dirname,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
      const parts = [...hit[1].matchAll(/['"]([^'"]+)['"]/g)].map(v => v[1]);
      const relative = parts.join('/');
      // The native icon is deliberately OS-visible outside asar. The pilot marker is profile-specific.
      if (relative === 'build/icon.ico' || (relative === 'pilot-mode.json' && profile !== 'pilot')) continue;
      add(name, relative);
    }
  }
  const icon = path.join(path.dirname(packed), 'tray', 'icon.ico');
  assert.ok(fs.existsSync(icon) && fs.statSync(icon).size > 2048, 'Missing physical tray/icon.ico');
  const pkg = JSON.parse(asar.extractFile(packed, 'package.json').toString('utf8'));
  assert.equal(pkg.main, 'main.js');
  return { profile, version: pkg.version, required: [...required].sort(), physicalIcon: true };
}
module.exports = { inspectPackage };
