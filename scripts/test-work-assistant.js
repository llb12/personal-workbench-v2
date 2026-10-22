'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const assistant = require('../work-assistant');
const { runAIAction } = require('../ai-adapter');
const clock = { currentDate: '2026-10-20', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-20T04:00:00.000Z' };
const base = { type: 'task', status: 'todo', done: false, priority: 'mid', dueMode: 'none', due: null, projectId: 'salary', project: '薪酬测算', createdAt: '2026-10-01', updatedAt: '2026-10-01' };
const tasks = [
  { ...base, id: 'urgent', title: '核对三季度考核结果', priority: 'high', dueMode: 'fixed', due: '2026-10-20', nextAction: '核对汇总表' },
  { ...base, id: 'overdue', title: '复核待审核材料', dueMode: 'fixed', due: '2026-10-18' },
  { ...base, id: 'no-date', title: '梳理项目安排', dueMode: 'none', due: '2026-10-01' },
  { ...base, id: 'waiting', title: '等待财务反馈测算数据', status: 'waiting', waitingFor: '财务部', waitingSince: '2026-10-01', followUpAt: '2026-10-20' },
  { ...base, id: 'tomorrow', title: '准备责任书草稿', dueMode: 'fixed', due: '2026-10-21' },
  { ...base, id: 'follow', title: '主动联系财务核对口径', status: 'followup', followUpAt: '2026-10-20' },
  { ...base, id: 'done', title: '核对已归档摘要', done: true, status: 'done' }
];
const projects = [{ type: 'project', id: 'salary', name: '薪酬测算', title: '薪酬测算', step: '核对口径', next: '汇总核对结果', blocker: '等待财务数据' }, { type: 'project', id: 'old', name: '历史演示项目', title: '历史演示项目', updatedAt: '2026-10-01' }];
const records = [
  { type: 'record', id: 'complete-today', taskId: 'done', projectId: 'salary', project: '薪酬测算', title: '核对已归档摘要', eventType: 'complete', eventAt: '2026-10-20T00:00:00+08:00', done: true, status: 'done' },
  { type: 'record', id: 'restore', taskId: 'no-date', projectId: 'salary', title: '梳理项目安排', eventType: 'restore', eventAt: '2026-10-20T09:00:00+08:00', done: false, status: 'todo' },
  { type: 'record', id: 'last-week', taskId: 'gone', projectId: 'salary', title: '上周已完成演示', eventType: 'complete', eventAt: '2026-10-18T20:00:00+08:00', done: true, status: 'done' },
  { type: 'record', id: 'fake-complete', taskId: 'no-date', title: '快照状态不支持完成', eventType: 'complete', eventAt: '2026-10-20T09:00:00+08:00', done: false, status: 'todo' }
];
const payload = { ...clock, tasks, projects, records, date: clock.currentDate };
const before = JSON.stringify(payload);
let response;
let requests = 0;
const server = http.createServer((req, res) => {
  let body = '';
  assert.equal(req.socket.remoteAddress, '127.0.0.1');
  req.on('data', part => { body += part; });
  req.on('end', () => {
    const sent = JSON.parse(body);
    assert(sent.messages[0].content.includes('Asia/Shanghai'));
    assert(sent.messages[0].content.includes('2026-10-20'));
    requests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }));
  });
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { baseUrl: 'http://127.0.0.1:' + server.address().port, model: 'assistant-local-only', timeoutMs: 3000 };
  async function run(action, reply, context = payload) { response = reply; return runAIAction({ action, payload: context, config, apiKey: 'synthetic-test-only' }); }
  try {
    const plan = await run('planToday', { items: [{ taskId: 'waiting', rank: 1 }, { taskId: 'salary', rank: 1 }, { taskId: 'unknown', rank: 1 }, { taskId: 'urgent', rank: 2 }, { taskId: 'urgent', rank: 3 }, { taskId: 'done', rank: 4 }, { taskId: 'no-date', rank: 5 }], summary: '全部必须本人立即完成' });
    assert.equal(plan.items.find(x => x.taskId === 'waiting').category, 'waiting');
    assert.equal(plan.items.find(x => x.taskId === 'urgent').category, 'must');
    assert.equal(plan.items.find(x => x.taskId === 'no-date').category, 'progress');
    assert.equal(plan.items.filter(x => x.taskId === 'urgent').length, 1);
    assert(plan.items.some(x => x.taskId === 'overdue' && x.category === 'must'));
    assert(!plan.items.some(x => ['salary', 'done', 'unknown'].includes(x.taskId)));
    assert(!JSON.stringify(plan).includes('全部必须本人立即完成'));
    const longTasks = Array.from({ length: 30 }, (_, index) => ({ ...base, id: 'long-' + index, title: '演示任务 ' + index }));
    const compactPlan = assistant.normalizePlan({ items: longTasks.map(task => ({ taskId: task.id })) }, { ...clock, tasks: longTasks });
    assert.equal(compactPlan.items.length, 24, '今日计划保持侧栏长度可控');
    assert(compactPlan.warnings.some(message => message.includes('其他任务仍保留')));
    const risk = assistant.risks(payload);
    assert.equal(new Set(risk.map(x => x.key)).size, risk.length);
    assert(!risk.some(x => x.key === 'task:no-date'));
    assert(risk.some(x => x.key === 'task:overdue' && x.reasons.join().includes('逾期')));
    assert.equal(risk.filter(x => x.key === 'task:waiting').length, 1);
    assert(risk.find(x => x.key === 'task:waiting').reasons.length >= 2);
    assert(risk.find(x => x.key === 'task:waiting').reasons.join().includes('未指定时刻'));
    assert(risk.some(x => x.key === 'task:tomorrow' && x.reasons.join().includes('尚未记录下一步')));
    assert(risk.some(x => x.key === 'project:old' && x.reasons.join().includes('不等于未开展')));
    assert.deepEqual(assistant.risks(payload), risk, 'rechecking does not accumulate risks');
    assert(assistant.scheduled('2026-10-20', payload));
    assert(!assistant.scheduled('2026-10-20T13:00', payload));
    assert.equal(assistant.risks({ ...payload, timeZone: 'Not/AZone' }).length, 0);
    const fabricated = { summary: '已完成全部任务，财务已经反馈', sections: [{ kind: 'completed', sourceIds: ['urgent', 'restore', 'fake-complete', 'invented'] }] };
    for (const action of ['summarizeDay', 'summarizeWeek']) {
      const report = await run(action, fabricated);
      const done = report.sections.find(x => x.kind === 'completed').items;
      assert.deepEqual(done.map(x => x.source.id), ['complete-today']);
      assert(!report.draft.includes('已完成全部任务'));
      assert(!report.draft.includes('财务已经反馈'));
      assert(!report.sections.find(x => x.kind === 'progress').items.some(x => x.source.id === 'urgent'));
      assert(report.sections.find(x => x.kind === 'next').items.some(x => x.source.id === 'urgent'));
      assert(report.sections.find(x => x.kind === 'waiting').items.some(x => x.source.id === 'waiting'));
      assert(report.sections.find(x => x.kind === 'issues').items.some(x => x.source.type === 'project' && x.source.id === 'salary' && x.text.includes('等待财务数据')));
      assert(report.draft.includes('未更新状态不等于未开展'));
      assert(report.sources.some(x => x.type === 'record' && x.id === 'complete-today'));
    }
    assert.doesNotThrow(() => assistant.normalizeSummary({ sections: [null, 'invalid', { sourceIds: ['complete-today'] }] }, payload, 'summarizeDay'), 'malformed section entries are ignored');
    const foreignTask = { ...base, id: 'other-project-task', projectId: 'other', title: '其他项目负责人已完成' };
    const foreignRecord = { type: 'record', id: 'other-project-record', projectId: 'other', title: '其他项目已完成', eventType: 'complete', eventAt: '2026-10-20T09:00:00+08:00', done: true, status: 'done' };
    const projectSummary = assistant.normalizeProjectSummary({ summary: '该项目负责人已完成全部工作', sections: [{ sourceIds: ['other-project-task', 'other-project-record', 'complete-today', 'urgent'] }] }, {
      ...clock, project: projects[0], tasks: [...tasks, foreignTask], records: [...records, foreignRecord], truncated: false
    });
    assert(projectSummary.sources.some(x => x.id === 'complete-today'));
    assert(!projectSummary.sources.some(x => x.id === 'other-project-task' || x.id === 'other-project-record'));
    assert(!projectSummary.draft.includes('负责人已完成全部工作'));
    assert(!projectSummary.draft.includes('其他项目'));
    const noRecords = await run('summarizeDay', fabricated, { ...payload, records: [] });
    assert.equal(noRecords.sections.find(x => x.kind === 'completed').items.length, 0, 'a saved task alone cannot invent a completion event');
    const contexts = { ...clock, sources: [...tasks, ...projects, ...records] };
    const lie = { answer: '全部任务已经完成，财务数据已收到。', sources: [{ id: 'invented', type: 'record', title: '伪造来源' }] };
    let answer = await run('askWorkspace', lie, { ...contexts, query: '本周完成了哪些工作？' });
    assert.deepEqual(answer.sources.map(x => x.id), ['complete-today']);
    assert(!answer.answer.includes('全部任务已经完成'));
    answer = await run('askWorkspace', lie, { ...contexts, query: '哪些事项还在等财务部反馈？' });
    assert.deepEqual(answer.sources.map(x => x.id), ['waiting']);
    assert(answer.answer.includes('财务部'));
    answer = await run('askWorkspace', lie, { ...contexts, query: '哪些事项还在等采购部反馈？' });
    assert.equal(answer.sources.length, 0);
    assert(answer.answer.includes('当前没有足够记录'));
    answer = await run('askWorkspace', lie, { ...contexts, query: '薪酬测算项目最近有什么进展？' });
    assert(answer.sources.some(x => x.id === 'salary' && x.type === 'project'));
    assert(answer.sources.some(x => x.id === 'complete-today' && x.type === 'record'));
    answer = await run('askWorkspace', lie, { ...contexts, query: '明天有哪些任务要处理？' });
    assert.deepEqual(answer.sources.map(x => x.id), ['tomorrow']);
    answer = await run('askWorkspace', lie, { ...contexts, query: '哪个项目有逾期任务？' });
    assert.deepEqual(answer.sources.map(x => x.id), ['overdue']);
    answer = await run('askWorkspace', lie, { ...contexts, query: '预测下一季度奖金金额' });
    assert.equal(answer.sources.length, 0);
    assert(answer.answer.includes('当前没有足够记录'));
    const existingSources = [
      { id: 'inbox-existing', type: 'inbox', title: '演示：整理收集说明', status: 'pending' },
      { id: 'event:2026-10-21:0', type: 'event', title: '演示：复核日程安排', date: '2026-10-21' }
    ];
    for (const source of existingSources) {
      answer = await run('askWorkspace', { answer: '这项工作已经完成', sources: [{ ...source, title: '模型伪造标题' }] }, { ...clock, sources: existingSources, query: '查看' + source.title });
      assert.deepEqual(answer.sources.map(x => [x.id, x.type, x.title]), [[source.id, source.type, source.title]]);
      assert(!answer.answer.includes('这项工作已经完成'));
      assert(!answer.answer.includes('未完成待办'));
    }
    assert.equal(JSON.stringify(payload), before, 'AI operations never mutate saved context');
    assert.equal(requests, 13);
    console.log('PASS: real loopback AI actions; grounded plan groups and compact output, merged risks, record-only completion, editable report data, five workspace questions, unknown evidence, and no context writes');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
