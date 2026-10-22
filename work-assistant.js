(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchAssistant = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit || 500); }
  function unique(list, key) { var seen = new Set(); return list.filter(function (x) { var k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); }
  function date(value) {
    var raw = text(value, 50);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    var d = new Date(raw + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : '';
  }
  function addDays(day, count) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
  function inZone(value, zone, withTime) {
    try {
      var d = new Date(value); if (!Number.isFinite(d.getTime())) return '';
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      function part(type) { return parts.find(function (p) { return p.type === type; }).value; }
      return [part('year'), part('month'), part('day')].join('-') + (withTime ? 'T' + [part('hour'), part('minute'), part('second')].join(':') : '');
    } catch (_) { return ''; }
  }
  function clock(context) {
    var zone = text(context.timeZone, 100), instant = text(context.referenceInstant, 80), day = date(context.currentDate);
    var local = inZone(instant, zone, true);
    return { day: day, zone: zone, local: local, valid: !!day && !!zone && !!local && local.slice(0, 10) === day };
  }
  function calendar(value, context) {
    if (date(value)) return value;
    var raw = text(value, 80);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) && date(raw.slice(0, 10))) return raw.slice(0, 10);
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? inZone(raw, context.timeZone, false) : '';
  }
  function scheduled(value, context) {
    var c = clock(context), raw = text(value, 80);
    if (!c.valid) return false;
    if (date(raw)) return raw <= c.day;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) {
      var h = Number(raw.slice(11, 13)), m = Number(raw.slice(14, 16));
      return !!date(raw.slice(0, 10)) && h <= 23 && m <= 59 && raw <= c.local;
    }
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw)) && Date.parse(raw) <= Date.parse(context.referenceInstant);
  }
  function open(task) { return !!task && !task.archived && !task.archivedAt && !task.done && task.status !== 'done' && task.status !== 'archived'; }
  function waiting(task) { return open(task) && task.status === 'waiting'; }
  function due(task) { return task.dueMode === 'none' || task.dueMode === 'tbd' ? '' : date(task.due || task.dueAt); }
  function projectId(item) { return text(item.projectId || item.pid, 100); }
  function sourceKey(item) { return item.type + ':' + item.id; }
  function sources(context) {
    var result = [];
    function append(list, type) { (Array.isArray(list) ? list : []).forEach(function (item) { if (item && text(item.id, 100)) result.push(Object.assign({}, item, { id: text(item.id, 100), type: type || item.type })); }); }
    append(context.tasks, 'task'); append(context.waiting, 'task'); append(context.records, 'record'); append(context.projects, 'project');
    append(context.sources);
    return unique(result.filter(function (s) { return ['task', 'project', 'record', 'inbox', 'event'].indexOf(s.type) >= 0; }), sourceKey);
  }
  function link(source) { return { id: source.id, type: source.type, title: text(source.type === 'project' ? source.name || source.title : source.title || source.text, 180), taskId: source.taskId || null }; }
  function taskFacts(task, context) {
    var facts = [waiting(task) ? '等待他人反馈' : task.done || task.status === 'done' ? '已标记完成' : task.status === 'doing' ? '状态：进行中' : task.status === 'followup' ? '主动跟进' : '未完成待办（未记录开展情况）'];
    if (task.project || task.projectName) facts.push('项目：' + text(task.project || task.projectName, 100));
    if (due(task)) facts.push('截止 ' + due(task));
    if (waiting(task) && task.waitingFor) facts.push('等待对象：' + text(task.waitingFor, 80));
    if (calendar(task.followUpAt, context)) facts.push('计划跟进 ' + calendar(task.followUpAt, context) + (date(task.followUpAt) ? '（未指定时刻）' : ' · ' + text(task.followUpAt, 80)));
    if (task.nextAction) facts.push('下一步：' + text(task.nextAction, 240));
    return facts.join('；');
  }
  function riskOptions(context) {
    var value = context.riskOptions || {};
    return { waitingDays: Math.max(1, Math.min(90, Number(value.waitingDays) || 7)), projectDays: Math.max(3, Math.min(365, Number(value.projectDays) || 14)), imminentDays: 3 };
  }
  function risks(context) {
    var c = clock(context); if (!c.valid) return [];
    var all = sources(context), tasks = all.filter(function (s) { return s.type === 'task' && open(s); });
    var records = all.filter(function (s) { return s.type === 'record'; }), options = riskOptions(context), result = [];
    tasks.forEach(function (t) {
      var reasons = [], deadline = due(t), elapsed = calendar(t.waitingSince, context);
      if (deadline && deadline < c.day) reasons.push('截止 ' + deadline + '，已逾期 ' + dayDiff(c.day, deadline) + ' 天');
      if (waiting(t) && elapsed && dayDiff(c.day, elapsed) >= options.waitingDays) reasons.push('从 ' + elapsed + ' 开始等待，已达 ' + options.waitingDays + ' 天提示阈值');
      if (t.followUpAt && scheduled(t.followUpAt, context)) reasons.push((waiting(t) ? '等待事项的计划跟进' : '主动跟进') + '日期/时刻已到：' + text(t.followUpAt, 80) + (date(t.followUpAt) ? '（未指定时刻）' : ''));
      if (deadline && deadline >= c.day && dayDiff(deadline, c.day) <= options.imminentDays && !text(t.nextAction)) reasons.push('截止临近（' + deadline + '），尚未记录下一步');
      if (reasons.length) result.push({ key: 'task:' + t.id, source: link(t), reasons: reasons, tone: deadline && deadline < c.day ? 'danger' : 'warn' });
    });
    all.filter(function (s) { return s.type === 'project' && !s.done; }).forEach(function (p) {
      var times = [p.updatedAt, p.createdAt];
      records.filter(function (r) { return projectId(r) === p.id && ['delete', 'archive', 'restore', 'unarchive'].indexOf(r.eventType) < 0; }).forEach(function (r) { times.push(r.eventAt); });
      tasks.filter(function (t) { return projectId(t) === p.id; }).forEach(function (t) { times.push(t.updatedAt, t.createdAt); });
      var latest = times.map(function (v) { return calendar(v, context); }).filter(function (v) { return v && v <= c.day; }).sort().pop();
      if (latest && dayDiff(c.day, latest) >= options.projectDays) result.push({ key: 'project:' + p.id, source: link(p), reasons: ['最近已保存进展/变更记录为 ' + latest + '，已达 ' + options.projectDays + ' 天提示阈值；没有新记录不等于未开展工作'], tone: 'warn' });
    });
    return unique(result, function (r) { return r.key; });
  }
  function normalizePlan(parsed, context) {
    var c = clock(context), all = sources(context), available = all.filter(function (s) { return s.type === 'task' && open(s); });
    var byId = new Map(available.map(function (t) { return [t.id, t]; }));
    var requested = Array.isArray(parsed.items) ? parsed.items : [];
    var ranked = unique(requested.filter(function (x) { return x && byId.has(x.taskId || x.id); }).map(function (x, index) { return { taskId: x.taskId || x.id, rank: Number.isFinite(Number(x.rank)) ? Number(x.rank) : index + 1 }; }), function (x) { return x.taskId; });
    ranked.sort(function (a, b) { return a.rank - b.rank; });
    available.filter(function (t) { return waiting(t) || c.valid && (due(t) && due(t) <= c.day || scheduled(t.followUpAt, context)); }).forEach(function (t) { if (!ranked.some(function (x) { return x.taskId === t.id; })) ranked.push({ taskId: t.id }); });
    var items = ranked.map(function (x, index) {
      var t = byId.get(x.taskId), category = waiting(t) ? 'waiting' : c.valid && (due(t) && due(t) <= c.day || scheduled(t.followUpAt, context)) ? 'must' : 'progress';
      return { taskId: t.id, rank: index + 1, category: category, reason: taskFacts(t, context) + '；优先级：' + ({ high: '高', mid: '中', low: '低' }[t.priority] || '中'), source: link(t) };
    });
    var warnings = c.valid ? [] : ['参考日期与时区不一致，未据此判断必须处理。'];
    if (items.length > 24) warnings.push('今日计划为保持侧栏清晰最多展示 24 项；其他任务仍保留在任务列表。');
    return { engine: 'ai', items: items.slice(0, 24), summary: '仅调整今日标记与执行顺序；等待事项单列，截止日期不变。', warnings: warnings };
  }
  function bounds(context, action) {
    var c = clock(context); if (!c.valid) return null;
    if (action === 'summarizeDay') { var d = date(context.date) || c.day; return { start: d, end: d }; }
    if (action === 'summarizeMonth') return { start: date(context.monthStart) || c.day.slice(0, 7) + '-01', end: c.day };
    var weekday = new Date(c.day + 'T00:00:00Z').getUTCDay() || 7;
    return { start: addDays(c.day, 1 - weekday), end: c.day };
  }
  function within(value, range, context) { var d = calendar(value, context); return !!range && !!d && d >= range.start && d <= range.end; }
  function completion(record) { return record.type === 'record' && record.eventType === 'complete' && (record.done === true || record.status === 'done'); }
  function recordFacts(record, context) {
    var status = { doing: '进行中', waiting: '等待反馈', followup: '主动跟进', todo: '待办' }[record.status] || '';
    var event = record.eventType === 'complete' && !completion(record) ? '记录状态不完整（完成情况待确认）' : { complete: '记录完成', restore: '记录恢复任务', archive: '记录归档', unarchive: '记录取消归档', delete: '记录删除', 'status-change': '记录状态变更' }[record.eventType] || '记录变更';
    if (record.eventType === 'status-change' && status) event += '为' + status;
    return (calendar(record.eventAt, context) || '日期未明') + ' · ' + event + '：' + text(record.title, 180) + (record.project ? ' · 项目：' + text(record.project, 100) : '');
  }
  function normalizeSummary(parsed, context, action) {
    var all = sources(context), range = bounds(context, action), tasks = all.filter(function (s) { return s.type === 'task' && open(s); });
    var records = all.filter(function (s) { return s.type === 'record' && within(s.eventAt, range, context); });
    var ranking = [];
    (Array.isArray(parsed.sections) ? parsed.sections : []).forEach(function (s) { if (!s || typeof s !== 'object') return; (Array.isArray(s.sourceIds) ? s.sourceIds : []).forEach(function (id) { if (ranking.indexOf(id) < 0) ranking.push(id); }); });
    function order(a, b) { var x = ranking.indexOf(a.source.id), y = ranking.indexOf(b.source.id); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y); }
    function item(s, body) { return { source: link(s), text: body }; }
    var progressRecords = records.filter(function (r) { return r.eventType === 'status-change' && r.status === 'doing'; });
    var progressTaskIds = new Set(progressRecords.map(function (r) { return r.taskId; }).filter(Boolean));
    var issueItems = risks(context).map(function (r) { return { source: r.source, text: r.source.title + '：' + r.reasons.join('；') }; });
    all.filter(function (s) { return s.type === 'project' && !s.done && text(s.blocker); }).forEach(function (project) {
      var existing = issueItems.find(function (entry) { return entry.source.type === 'project' && entry.source.id === project.id; });
      var blocker = '已记录卡点“' + text(project.blocker, 240) + '”';
      if (existing) existing.text += '；' + blocker;
      else issueItems.push(item(project, text(project.name || project.title, 100) + '：' + blocker));
    });
    var sections = [
      { kind: 'completed', title: '已完成工作', items: records.filter(completion).map(function (r) { var current = all.find(function (s) { return s.type === 'task' && s.id === r.taskId; }); return item(r, recordFacts(r, context) + (current && open(current) ? '；当前已恢复为未完成，保留当时记录' : '')); }) },
      { kind: 'progress', title: '正在推进事项', items: tasks.filter(function (t) { return !waiting(t) && t.status === 'doing'; }).map(function (t) { return item(t, text(t.title, 180) + '：' + taskFacts(t, context) + (progressTaskIds.has(t.id) ? '；本期有状态变更记录' : '；仅能确认当前状态，本期未提供新的进度记录')); }) },
      { kind: 'waiting', title: '等待协调事项', items: tasks.filter(waiting).map(function (t) { return item(t, text(t.title, 180) + '：' + taskFacts(t, context)); }) },
      { kind: 'issues', title: '存在的问题', items: issueItems },
      { kind: 'next', title: '下一步安排', items: tasks.filter(function (t) { return !!text(t.nextAction); }).map(function (t) { return item(t, text(t.title, 180) + '：已记录下一步“' + text(t.nextAction, 240) + '”'); }).concat(all.filter(function (s) { return s.type === 'project' && !s.done && text(s.next); }).map(function (p) { return item(p, text(p.name, 100) + '：已记录下一步“' + text(p.next, 240) + '”'); })) },
      { kind: 'unstarted', title: '未完成但未记录开展情况', items: tasks.filter(function (t) { return !waiting(t) && t.status !== 'doing' && !text(t.nextAction); }).map(function (t) { return item(t, text(t.title, 180) + '：' + taskFacts(t, context)); }) }
    ];
    var truncated = false;
    sections.forEach(function (s) { s.items = unique(s.items, function (x) { return sourceKey(x.source); }).sort(order); if (s.items.length > 12) truncated = true; s.items = s.items.slice(0, 12); });
    var title = action === 'summarizeDay' ? '工作日报' : action === 'summarizeMonth' ? '工作月报' : '工作周报';
    var summary = title + ' · ' + (range ? (action === 'summarizeWeek' ? '本周截至 ' + range.end + '（自 ' + range.start + '）' : action === 'summarizeMonth' ? '本月截至 ' + range.end + '（自 ' + range.start + '）' : range.start) : '参考日期待确认');
    var draft = [summary, '依据当前提供的已保存记录；未更新状态不等于未开展工作。'];
    sections.forEach(function (s) { draft.push('', s.title); if (s.items.length) s.items.forEach(function (x) { draft.push('- ' + x.text); }); else draft.push('- 当前没有足够记录。'); });
    var warnings = ['仅列有完成事件依据的已完成工作；未更新状态不等于未开展。', context.truncated ? '上下文受隐私数量/历史范围限制，内容可能不完整。' : '草稿可编辑、复制，不会修改或发送任务。'];
    if (truncated) warnings.push('为保持侧栏清晰，每类最多展示 12 条；可打开依据查看原始记录。');
    return { engine: 'ai', summary: summary, draft: draft.join('\n'), sections: sections, sources: unique(sections.flatMap(function (s) { return s.items.map(function (x) { return x.source; }); }), sourceKey), warnings: warnings };
  }
  function normalizeProjectSummary(parsed, context) {
    var project = context.project && typeof context.project === 'object' ? context.project : null;
    if (!project || !text(project.id, 100)) return { engine: 'ai', summary: '项目已不存在', draft: '项目已不存在或当前没有足够记录，未生成推断。', sections: [], sources: [], warnings: ['项目上下文不可用；未依据无关数据生成内容。'] };
    var all = sources({ project: project, projects: [project], tasks: context.tasks, records: context.records });
    all = all.filter(function (s) {
      if (s.type === 'project') return s.id === project.id;
      if (s.type !== 'task' && s.type !== 'record') return false;
      return projectId(s) === project.id;
    });
    var tasks = all.filter(function (s) { return s.type === 'task' && open(s); });
    var records = all.filter(function (s) { return s.type === 'record'; });
    var risksForProject = risks({
      currentDate: context.currentDate, timeZone: context.timeZone, referenceInstant: context.referenceInstant,
      projects: [project], tasks: tasks, records: records, riskOptions: context.riskOptions
    });
    var ranking = [];
    (Array.isArray(parsed.sections) ? parsed.sections : []).forEach(function (section) {
      (section && Array.isArray(section.sourceIds) ? section.sourceIds : []).forEach(function (id) { if (ranking.indexOf(id) < 0) ranking.push(id); });
    });
    function item(source, body) { return { source: link(source), text: body }; }
    function order(a, b) { var x = ranking.indexOf(a.source.id), y = ranking.indexOf(b.source.id); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y); }
    var sections = [
      { kind: 'completed', title: '已完成工作', items: records.filter(completion).map(function (record) { return item(record, recordFacts(record, context)); }) },
      { kind: 'progress', title: '正在推进事项', items: tasks.filter(function (task) { return task.status === 'doing'; }).map(function (task) { return item(task, text(task.title, 180) + '：' + taskFacts(task, context) + '；仅能确认当前状态'); }) },
      { kind: 'waiting', title: '等待协调事项', items: tasks.filter(waiting).map(function (task) { return item(task, text(task.title, 180) + '：' + taskFacts(task, context)); }) },
      { kind: 'issues', title: '存在的问题', items: risksForProject.map(function (risk) { return { source: risk.source, text: risk.source.title + '：' + risk.reasons.join('；') }; }).concat(project.blocker ? [item(project, text(project.name, 100) + '：已记录卡点“' + text(project.blocker, 240) + '”')] : []) },
      { kind: 'next', title: '下一步安排', items: tasks.filter(function (task) { return !!text(task.nextAction); }).map(function (task) { return item(task, text(task.title, 180) + '：已记录下一步“' + text(task.nextAction, 240) + '”'); }).concat(text(project.step) || text(project.next) ? [item(project, text(project.name, 100) + '：当前步骤“' + text(project.step || '未记录', 240) + '”；下一步“' + text(project.next || '未记录', 240) + '”')] : []) },
      { kind: 'unstarted', title: '未完成但未记录开展情况', items: tasks.filter(function (task) { return task.status !== 'doing' && !waiting(task) && !text(task.nextAction); }).map(function (task) { return item(task, text(task.title, 180) + '：' + taskFacts(task, context)); }) }
    ];
    var truncated = false;
    sections.forEach(function (section) { section.items = unique(section.items, function (entry) { return sourceKey(entry.source); }).sort(order); if (section.items.length > 12) truncated = true; section.items = section.items.slice(0, 12); });
    var summary = '项目总结：' + text(project.name || project.title, 100) + ' · 依据已保存项目字段、任务与工作记录';
    var draft = [summary, '仅记录有数据依据的完成情况、当前任务状态、等待事项、卡点和下一步；负责人未记录时不作推断。'];
    sections.forEach(function (section) { draft.push('', section.title); if (section.items.length) section.items.forEach(function (entry) { draft.push('- ' + entry.text); }); else draft.push('- 当前没有足够记录。'); });
    var warnings = ['已完成内容只引用完成事件；未记录负责人和进展不作推断。', context.truncated ? '项目上下文受隐私数量/历史范围限制，内容可能不完整。' : '草稿可编辑、复制，逐项依据可打开。'];
    if (truncated) warnings.push('为保持侧栏清晰，每类最多展示 12 条；其余数据仍保留在项目任务与记录页。');
    return { engine: 'ai', summary: summary, draft: draft.join('\n'), sections: sections, sources: unique(sections.flatMap(function (section) { return section.items.map(function (entry) { return entry.source; }); }), sourceKey), warnings: warnings };
  }
  function normalizeName(value) { return text(value).replace(/[\s，,。？！?！：:]/g, '').replace(/项目/g, ''); }
  function normalizeAnswer(parsed, context) {
    var all = sources(context), q = text(context.query, 4000), c = clock(context), range = bounds(context, 'summarizeWeek'), selected = [], note = '';
    var tasks = all.filter(function (s) { return s.type === 'task'; }), projects = all.filter(function (s) { return s.type === 'project'; });
    var matchedProjects = projects.filter(function (p) { var name = normalizeName(p.name || p.title); return name.length >= 2 && normalizeName(q).includes(name); });
    var intent = /(?:本周|本星期|这周).*完成/.test(q) ? 'weekCompleted' : /(?:项目.*逾期|哪个项目.*逾期)/.test(q) ? 'overdueProjects' : /明天|明日/.test(q) ? 'tomorrow' : /等(?:待)?.*反馈|等待|还在等/.test(q) ? 'waiting' : /进展|进度|推进情况/.test(q) && matchedProjects.length ? 'projectProgress' : 'unknown';
    if (intent === 'weekCompleted') {
      selected = all.filter(function (s) { return completion(s) && within(s.eventAt, range, context); });
      note = '按本周完成事件查询；未登记的工作无法据此判断。';
    } else if (intent === 'waiting') {
      selected = tasks.filter(waiting);
      var actor = /等(?:待)?\s*([^，,。？！?！]{1,16}?)\s*(?:的)?反馈/.exec(q);
      if (actor && !/哪些|什么|谁|他人/.test(actor[1])) { var wanted = normalizeName(actor[1]).replace(/部门?|处|室/g, ''); selected = selected.filter(function (s) { var name = normalizeName(s.waitingFor).replace(/部门?|处|室/g, ''); return !!name && (name.includes(wanted) || wanted.includes(name)); }); }
      if (matchedProjects.length) selected = selected.filter(function (s) { return matchedProjects.some(function (p) { return projectId(s) === p.id; }); });
      note = '以下是已保存的等待状态，不代表对方已经承诺完成时间。';
    } else if (intent === 'tomorrow' && c.valid) {
      var tomorrow = addDays(c.day, 1);
      selected = tasks.filter(function (s) { return open(s) && (due(s) === tomorrow || calendar(s.followUpAt, context) === tomorrow); });
      note = '按 ' + tomorrow + ' 的截止日期或计划跟进日期筛选；没有补充具体时刻。';
    } else if (intent === 'overdueProjects' && c.valid) {
      selected = tasks.filter(function (s) { return open(s) && projectId(s) && due(s) && due(s) < c.day; });
      note = '仅将有明确截止日期且早于 ' + c.day + ' 的未完成任务判为逾期。';
    } else if (intent === 'projectProgress') {
      selected = matchedProjects.concat(all.filter(function (s) { return s.type === 'record' && matchedProjects.some(function (p) { return projectId(s) === p.id; }); }).sort(function (a, b) { return String(b.eventAt).localeCompare(String(a.eventAt)); }).slice(0, 8));
      note = selected.some(function (s) { return s.type === 'record'; }) ? '项目近况依据保存的工作事件与项目字段；未记录的开展情况无法确定。' : '项目字段可供核对；当前没有足够记录确定最近新增进展。';
    } else {
      var requested = (Array.isArray(parsed.sources) ? parsed.sources : []).map(function (s) { return s && s.id; });
      selected = all.filter(function (s) { var title = normalizeName(s.title || s.name); return requested.indexOf(s.id) >= 0 && title.length >= 2 && normalizeName(q).includes(title); });
      note = '仅返回能直接定位的已保存事项；当前没有足够记录确定其他结论。';
    }
    selected = unique(selected, sourceKey).slice(0, 20);
    var lines = selected.map(function (s) {
      if (s.type === 'record') return recordFacts(s, context);
      if (s.type === 'project') return text(s.name || s.title, 100) + '：当前步骤“' + text(s.step || '未记录') + '”；下一步“' + text(s.next || '未记录') + '”；卡点“' + text(s.blocker || '未记录') + '”';
      if (s.type === 'inbox') return text(s.title, 180) + '：收件箱原始记录，未据此推断任务完成情况';
      if (s.type === 'event') return (date(s.date) || '日期待确认') + ' · 日程记录：' + text(s.title, 180);
      return text(s.title, 180) + '：' + taskFacts(s, context);
    });
    return { engine: 'ai', answer: (lines.length ? note + '\n\n' + lines.map(function (l) { return '• ' + l; }).join('\n') : '当前没有足够记录。' + (note ? '\n' + note : '')), sources: selected.map(link), warnings: context.truncated ? ['上下文受隐私数量/历史范围限制，结果可能不完整。'] : [], intent: intent };
  }
  return { normalizePlan: normalizePlan, normalizeSummary: normalizeSummary, normalizeProjectSummary: normalizeProjectSummary, normalizeAnswer: normalizeAnswer, risks: risks, calendar: calendar, scheduled: scheduled, clock: clock };
});
