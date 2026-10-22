'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceFile = process.argv[2] || path.join(__dirname, 'p0-installed-nsis.test.cjs');
const source = fs.readFileSync(sourceFile, 'utf8');
const pkg = require('../package.json');

async function fixture(options = {}) {
  const temp = path.resolve(__dirname, '..', '.virtual-runner-temp');
  const installDir = path.join(temp, 'wb-nsis-install-fixture');
  const installer = path.resolve(__dirname, '..', 'release', 'Personal_Workbench_Setup_' + pkg.version + '.exe');
  const files = new Set([temp, installer]);
  const messages = [], calls = [], cleanups = [];
  const fakeProcess = { platform: options.platform || 'win32', env: { CI: options.ci === undefined ? 'true' : options.ci, RUNNER_TEMP: temp }, execPath: 'fixture-node.exe', exitCode: 0, stdout: { write: value => messages.push(value) }, stderr: { write: value => messages.push(value) } };
  let clock = 0, delayedRemoval = false;
  const removeInstall = () => {
    for (const file of files) if (file === installDir || file.startsWith(installDir + path.sep)) files.delete(file);
  };
  const fakeFS = {
    existsSync: file => files.has(file),
    mkdtempSync: prefix => {
      assert.equal(prefix, path.join(temp, 'wb-nsis-install-'));
      files.add(installDir);
      return installDir;
    },
    readdirSync: directory => {
      assert.equal(directory, installDir);
      return options.missingUninstaller ? [pkg.productName + '.exe', 'resources'] : [pkg.productName + '.exe', 'resources', 'Uninstall.exe'];
    },
    rmSync: directory => {
      assert.equal(directory, installDir, 'Cleanup escaped the minted fixture installation');
      cleanups.push({ existed: files.has(directory), clock });
      removeInstall();
    }
  };
  const spawnSync = (command, args, input) => {
    calls.push({ command, args });
    assert.equal(input.cwd, temp);
    if (command === installer) {
      assert.deepEqual(Array.from(args), ['/S', '/D=' + installDir]);
      if (options.installError) return { status: 2 };
      for (const file of [pkg.productName + '.exe', path.join('resources', 'app.asar'), path.join('resources', 'tray', 'icon.ico')]) files.add(path.join(installDir, file));
      return { status: 0 };
    }
    if (command === fakeProcess.execPath) {
      assert.equal(input.env.WB_CI_INSTALLED_EXE, path.join(installDir, pkg.productName + '.exe'));
      return { status: options.smokeError ? 1 : 0, stdout: options.smokeError ? '' : 'P0_PACKAGED_INSTALLED_PASS', stderr: '' };
    }
    assert.equal(command, path.join(installDir, 'Uninstall.exe'));
    assert.deepEqual(Array.from(args), ['/S']);
    if (options.uninstallSpawnError) return { status: null, error: new Error('synthetic uninstall spawn failure') };
    if (options.uninstallExit) return { status: options.uninstallExit };
    if (options.delayedRemoval) delayedRemoval = true;
    else if (!options.uninstallLeavesFiles) removeInstall();
    return { status: 0 };
  };
  const context = {
    __dirname, process: fakeProcess, AggregateError,
    Date: { now: () => clock },
    setTimeout: (callback, delay) => {
      clock += delay;
      if (delayedRemoval && clock >= 300) removeInstall();
      queueMicrotask(callback);
    },
    console: { log: value => messages.push(String(value)), error: value => messages.push(String(value)), warn: value => messages.push(String(value)) },
    require: name => {
      if (name === 'node:assert/strict') return assert;
      if (name === 'node:path') return path;
      if (name === 'node:fs') return fakeFS;
      if (name === 'node:child_process') return { spawnSync };
      if (name === '../package.json') return pkg;
      throw new Error('Unmocked fixture import: ' + name);
    }
  };
  let thrown;
  try { await vm.runInNewContext(source, context, { filename: sourceFile }); }
  catch (error) { thrown = error; }
  return { passed: !thrown && fakeProcess.exitCode === 0, messages: messages.join('\n'), calls, cleanups, clock, thrown };
}

(async () => {
  const cases = [
    ['uninstall nonzero exit', { uninstallExit: 5 }, /Silent uninstaller did not exit successfully/],
    ['uninstall spawn failure', { uninstallSpawnError: true }, /synthetic uninstall spawn failure/],
    ['missing uninstaller', { missingUninstaller: true }, /Installed uninstaller missing/],
    ['uninstall leaves files', { uninstallLeavesFiles: true }, /installation directory behind/],
    ['installer failure preserved', { installError: true }, /Silent installer did not exit successfully/],
    ['GUI smoke failure preserved', { smokeError: true }, /Installed program GUI smoke failed/]
  ];
  for (const [label, options, message] of cases) {
    const result = await fixture(options);
    assert.equal(result.passed, false, label + ' must fail before cleanup can hide it');
    assert.match(result.messages, message, label);
    assert.doesNotMatch(result.messages, /P0_NSYS_INSTALLED_PASS|P0_NSIS_UNINSTALLED_PASS/, label + ' must not emit a pass marker');
    assert.equal(result.cleanups.length, 1, label + ' must retain scoped best-effort cleanup');
  }
  for (const options of [{}, { delayedRemoval: true }]) {
    const result = await fixture(options);
    assert.equal(result.passed, true, result.messages);
    assert.match(result.messages, /P0_NSYS_INSTALLED_PASS/);
    assert.match(result.messages, /P0_NSIS_UNINSTALLED_PASS/);
    assert.equal(result.cleanups[0].existed, false, 'Uninstall must remove files before fallback cleanup');
    if (options.delayedRemoval) assert.ok(result.clock >= 300, 'Wait for asynchronous uninstaller removal');
  }
  for (const options of [{ ci: 'false' }, { platform: 'linux' }]) {
    const result = await fixture(options);
    assert.equal(result.passed, false);
    assert.ok(result.thrown, 'Host/CI guard must reject before any subprocess');
    assert.equal(result.calls.length, 0);
    assert.equal(result.cleanups.length, 0);
  }
  console.log('NSIS_INSTALL_CONTRACT_PASS: 10 fully mocked cases; uninstall failure or residue cannot be hidden by cleanup; Windows CI guards retained; no installer executed');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
