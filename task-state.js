(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchTaskState = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalize(task) {
    var done = task.done === true || (task.done !== false && task.status === 'done');
    var status = done ? 'done' : ['todo', 'doing', 'waiting', 'followup', 'inbox'].indexOf(task.status) >= 0 ? task.status : task.waitingFor && task.status !== 'archived' ? 'waiting' : 'todo';
    return { done: done, status: status, archived: task.archived === true || task.status === 'archived' || !!task.archivedAt, archivedAt: task.archivedAt || null };
  }
  function setArchived(task, archived, stamp) {
    Object.assign(task, normalize(task));
    task.archived = !!archived;
    task.archivedAt = archived ? task.archivedAt || stamp : null;
    return task;
  }
  function label(task) { var state=normalize(task);return {todo:'待办',doing:'进行中',waiting:'等待 · 被动',followup:'跟进 · 主动',done:'已完成',inbox:'收件箱'}[state.status]||'待办'; }
  return { normalize: normalize, setArchived: setArchived, label: label };
}));
