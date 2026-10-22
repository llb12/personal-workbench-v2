'use strict';
const fsDefault = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const collections = ['todos', 'projects', 'inbox', 'workLog'];
function validateData(value, legacy = false) {
  if (!plain(value)) return '数据根结构必须是对象';
  if (legacy && ![...collections, 'events', 'note', 'kanban'].some(key => Object.hasOwn(value, key))) return '缺少工作台数据字段';
  for (const key of collections) {
    if (legacy && value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].some(item => !plain(item))) return key + ' 必须是对象数组';
    if (!legacy && value[key].some(item => typeof item.id !== 'string' || !item.id)) return key + ' 中的记录缺少有效 id';
    if (!legacy && key === 'todos' && value[key].some(item => typeof (item.text === undefined ? item.title : item.text) !== 'string')) return '任务名称必须是文本';
    if (!legacy && key === 'projects' && value[key].some(item => typeof item.name !== 'string')) return '项目名称必须是文本';
  }
  if (value.events !== undefined && (!plain(value.events) || Object.values(value.events).some(items => !Array.isArray(items)))) return 'events 必须是日程数组映射';
  if (value.note !== undefined && typeof value.note !== 'string') return 'note 必须是文本';
  return null;
}
function hasContent(value) {
  return collections.some(key => Array.isArray(value[key]) && value[key].length) ||
    (plain(value.events) && Object.values(value.events).some(items => items.length)) ||
    (typeof value.note === 'string' && value.note.trim().length > 0) ||
    (plain(value.kanban) && Object.values(value.kanban).some(items => Array.isArray(items) && items.length));
}
const hash = bytes => bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex');
function createDataWriter({ file, fs = fsDefault, now = () => new Date(), maxBackups = 14, maxBackupBytes = 128 * 1024 * 1024 }) {
  let loaded = false, expected = null, pending = null;
  function prime(bytes) { loaded = true; expected = hash(bytes); pending = null; }
  function backup(current, reason, stamp) {
    const directory = path.join(path.dirname(file()), 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const relative = path.relative(fs.realpathSync(path.dirname(file())), fs.realpathSync(directory));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('备份目录必须位于工作台数据目录内');
    const day = stamp.getFullYear() + '-' + String(stamp.getMonth() + 1).padStart(2, '0') + '-' + String(stamp.getDate()).padStart(2, '0');
    const dailyPrefix = 'data-daily-' + day + '-';
    if (reason === 'daily' && fs.readdirSync(directory).some(name => name.startsWith(dailyPrefix) && name.endsWith('.json'))) return;
    const name = reason === 'daily' ? dailyPrefix + hash(current).slice(0, 12) + '.json' : 'data-' + reason + '-' + stamp.toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID() + '.json';
    const destination = path.join(directory, name);
    fs.writeFileSync(destination, current, { flag: 'wx' });
    if (hash(fs.readFileSync(destination)) !== hash(current)) throw new Error('备份校验失败');
  }
  function prune() {
    const directory = path.join(path.dirname(file()), 'backups');
    if (!fs.existsSync(directory)) return;
    const entries = fs.readdirSync(directory).filter(name => /^data-(daily|migration|clearing)-[A-Za-z0-9.-]+\.json$/.test(name))
      .map(name => ({ name, ...fs.statSync(path.join(directory, name)) })).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
    let bytes = 0;
    entries.forEach((item, i) => {
      if (i > 0 && (i >= maxBackups || bytes + item.size > maxBackupBytes)) fs.unlinkSync(path.join(directory, item.name));
      else bytes += item.size;
    });
  }
  function write(value, options = {}) {
    if (!loaded) return { ok: false, code: 'DATA_WRITE_BLOCKED', error: '数据尚未成功加载' };
    const invalid = validateData(value);
    if (invalid) return { ok: false, code: 'DATA_SHAPE_INVALID', error: '保存失败：' + invalid };
    let tmp, fd;
    try {
      const text = JSON.stringify(value, null, 2), bytes = Buffer.from(text, 'utf8');
      if (bytes.length > 20 * 1024 * 1024) return { ok: false, code: 'DATA_TOO_LARGE', error: '保存失败：数据超过 20 MB，请先导出检查' };
      const target = file();
      let current = null;
      try { current = fs.readFileSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const previousHash = hash(current), nextHash = hash(bytes);
      if (previousHash !== expected) return { ok: false, code: 'DATA_EXTERNAL_CHANGE', error: '数据文件在加载后发生外部变化，已停止覆盖；请导出当前修改后重新加载' };
      if (previousHash === nextHash) return { ok: true, unchanged: true };
      const old = current === null ? null : JSON.parse(current.toString('utf8'));
      const stamp = now(), clearing = old && hasContent(old) && !hasContent(value);
      if (clearing) {
        const accepted = pending && pending.nextHash === nextHash && pending.previousHash === previousHash && pending.expires > stamp.getTime() && options.emptyToken === pending.token;
        if (!accepted) {
          if (!pending || pending.nextHash !== nextHash || pending.previousHash !== previousHash || pending.expires <= stamp.getTime()) pending = { token: crypto.randomUUID(), nextHash, previousHash, expires: stamp.getTime() + 300000 };
          return { ok: false, code: 'DATA_EMPTY_CONFIRM_REQUIRED', emptyToken: pending.token, error: '本次保存将清空全部工作内容，需要明确确认' };
        }
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (current !== null) backup(current, clearing ? 'clearing' : old.schemaVersion !== value.schemaVersion ? 'migration' : 'daily', stamp);
      tmp = target + '.tmp-' + process.pid + '-' + crypto.randomUUID();
      fd = fs.openSync(tmp, 'wx'); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, target); tmp = undefined;
      expected = nextHash; pending = null;
      let backupCleanupWarning = false;
      try { prune(); } catch (_) { backupCleanupWarning = true; }
      return { ok: true, backupCleanupWarning };
    } catch (error) {
      return { ok: false, code: 'DATA_SAVE_FAILED', error: '保存失败，原文件已保留：' + (error.message || '未知错误') };
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
      if (tmp) try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }
  return { prime, write };
}
module.exports = { validateData, hasContent, createDataWriter };
