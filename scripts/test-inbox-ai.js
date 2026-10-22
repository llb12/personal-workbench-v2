'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { runAIAction, buildActionSystemPrompt, testAIConnection } = require('../ai-adapter');

const item = { title: '提交报告', type: 'todo', priority: 'mid', dueMode: 'fixed', dueAt: '2026-09-20', sourceQuote: '明天提交报告' };
let responses, requests;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requests.push(JSON.parse(body));
    const next = responses.shift();
      if (next && typeof next === 'object' && Number.isInteger(next.httpStatus)) {
        res.writeHead(next.httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next.body));
        return;
      }
    res.writeHead(next === 503 ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }] }));
  });
});

server.listen(0, '127.0.0.1', async () => {
  const config = { baseUrl: 'http://127.0.0.1:' + server.address().port, model: 'mock', timeoutMs: 3000 };
  const run = (reply, action = 'analyzeInbox') => {
    responses = reply; requests = [];
    return runAIAction({ action, config, apiKey: 'mock', payload: { rawText: '明天提交报告；确认截止时间', currentDate: '2026-09-19', timeZone: 'Asia/Shanghai', referenceInstant: '2026-09-18T16:00:00.000Z' } });
  };
  try {
    for (const action of ['analyzeInbox', 'parseQuickCapture']) {
      const prompt = buildActionSystemPrompt(action, '2026-09-19');
      for (const rule of ['priority', 'YYYY-MM-DD', 'existingTasks', 'projects']) assert.ok(prompt.includes(rule));
      const result = await run(['```json\n' + JSON.stringify({ items: [{ ...item, priority: 'medium', dueAt: '2026-09-20T23:59:59' }] }) + '\n```'], action);
      assert.equal(result.items[0].priority, 'mid');
      assert.equal(result.items[0].dueAt, '2026-09-20');
      assert.equal(requests.length, 1);
    }
    let result = await run(['invalid', { items: [item] }]);
    assert.equal(result.items.length, 1);
    assert.equal(requests.length, 2);
    assert.ok(requests[1].messages.at(-1).content.includes('校验'));
    const mixed = { items: [item, { ...item, title: '确认截止时间', dueAt: '2026-02-30', sourceQuote: '确认截止时间' }, null] };
    result = await run([mixed, mixed]);
    assert.equal(requests.length, 2);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].dueAt, '2026-09-20');
    assert.equal(result.items[1].type, 'confirm');
    assert.equal(result.items[1].dueAt, null);
    assert.ok(result.warnings.length);
    result = await run([mixed, 503]);
    assert.equal(result.items.length, 2);
    await assert.rejects(run(['invalid', 'invalid']), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(requests.length, 2);
    await assert.rejects(run([503]), { code: 'AI_HTTP_ERROR' });
    assert.equal(requests.length, 1);
    await assert.rejects(run([{ httpStatus: 400, body: { error: { code: 'invalid_api_key', message: 'mock secret detail must stay private' } } }]), error => {
      assert.equal(error.code, 'AI_AUTH_ERROR');
      assert(!error.message.includes('mock secret detail'));
      return true;
    });
    responses = ['Connected with compatible model text']; requests = [];
    assert.deepEqual(await testAIConnection({ config, apiKey: 'mock' }), { ok: true });
    assert.equal(requests.length, 1);
    const followUpPrompt = buildActionSystemPrompt('suggestFollowUp', '2026-09-19');
    assert(followUpPrompt.includes('有效日期 YYYY-MM-DD'));
    assert(followUpPrompt.includes('不补时刻'));
    result = await run([{ followUpAt: '2026-10-20', reason: '按已记录日期提醒' }], 'suggestFollowUp');
    assert.equal(result.followUpAt, '2026-10-20', '纯日期保持日期精度');
    result = await run([{ followUpAt: '2026-10-20T14:30:00+08:00', reason: '明确时刻' }], 'suggestFollowUp');
    assert.equal(result.followUpAt, '2026-10-20T06:30:00.000Z', '显式带时区时间沿用现有UTC标准化');
    await assert.rejects(run([{ followUpAt: '2026-02-30' }], 'suggestFollowUp'), { code: 'AI_INVALID_RESPONSE' });
    result = await run([{ items: [] }]);
    assert.deepEqual(result.items, []);
    assert.equal(requests.length, 1);
    await assert.rejects(run(['invalid'], 'planToday'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(requests.length, 1);
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
    console.log('PASS: shared schema, format compatibility, date-precision follow-up, single retry, partial recovery, service errors, empty results, other actions, renderer syntax');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
