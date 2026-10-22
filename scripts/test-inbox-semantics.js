'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { runAIAction } = require('../ai-adapter');

let nextReply;
let requestCount = 0;
let expectedTimeZone = 'Asia/Shanghai';
let expectedCurrentDate = '2026-10-19';
let expectedReferenceInstant = '2026-10-18T16:00:00.000Z';
const server = http.createServer((req, res) => {
  assert.equal(req.socket.remoteAddress, '127.0.0.1');
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requestCount++;
    const request = JSON.parse(body);
    const promptText = request.messages.map(message => message.content).join('\n');
    assert.ok(promptText.includes(expectedTimeZone));
    assert.ok(promptText.includes(expectedCurrentDate));
    assert.ok(promptText.includes(expectedReferenceInstant));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(nextReply) } }] }));
  });
});

function item(title, type, quote, extra) {
  return Object.assign({
    title, type, priority: 'mid', dueMode: 'none', dueAt: null,
    reminderAt: null, waitingFor: '', followUpAt: null,
    projectSuggestion: '', owner: '', reason: '模型理由仅供展示', confidence: null,
    sourceQuote: quote
  }, extra || {});
}

function inboxPayload(rawText, clock) {
  return Object.assign({
    rawText,
    currentDate: '2026-10-19',
    timeZone: 'Asia/Shanghai',
    referenceInstant: '2026-10-18T16:00:00.000Z'
  }, clock || {});
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = {
    baseUrl: 'http://127.0.0.1:' + server.address().port,
    model: 'loopback-semantics-fixture', timeoutMs: 3000
  };
  async function run(rawText, items, clock, action) {
    nextReply = { items, warnings: [] };
    expectedTimeZone = clock && clock.timeZone || 'Asia/Shanghai';
    expectedCurrentDate = clock && clock.currentDate || '2026-10-19';
    expectedReferenceInstant = clock && clock.referenceInstant || '2026-10-18T16:00:00.000Z';
    return runAIAction({
      action: action || 'analyzeInbox', config, apiKey: 'mock-only',
      payload: inboxPayload(rawText, clock)
    });
  }
  try {
    for (const action of ['analyzeInbox', 'parseQuickCapture']) {
      let result = await run(
        '等待财务部反馈薪酬测算数据，下周一催一下',
        [
          item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
          item('下周一催一下', 'followup', '下周一催一下', { followUpAt: '2026-10-26' })
        ], null, action
      );
      assert.equal(result.items.length, 1, action + ' merges one waiting and its generic follow-up');
      assert.equal(result.items[0].type, 'waiting');
      assert.equal(result.items[0].waitingFor, '财务部');
      assert.equal(result.items[0].followUpAt, '2026-10-26');
      assert.equal(result.items[0].dueAt, null);
      assert.equal(result.items[0].dateEvidence.followUpAt.date, '2026-10-26');
      assert.match(result.items[0].fieldEvidence, /未补造时刻|日期精度保留/);
    }

    let result = await run(
      '等待财务部反馈薪酬测算数据，下周一催一下。明天提交报告',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一催一下', 'followup', '下周一催一下', { followUpAt: '2026-10-26' }),
        item('明天提交报告', 'todo', '明天提交报告', { dueMode: 'fixed', dueAt: '2026-10-20' })
      ]
    );
    assert.equal(result.items.length, 2, 'a separate action does not prevent a same-sentence merge');
    assert.equal(result.items.find(candidate => candidate.type === 'waiting').followUpAt, '2026-10-26');

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一催采购部发报价',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一催采购部发报价', 'followup', '下周一催采购部发报价', { followUpAt: '2026-10-26' })
      ]
    );
    assert.equal(result.items.length, 2, 'different explicit actor remains separate');

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一联系财务部核对发票',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一联系财务部核对发票', 'followup', '下周一联系财务部核对发票', { followUpAt: '2026-10-26' })
      ]
    );
    assert.equal(result.items.length, 2, 'same actor but different work remains two candidates');
    assert.equal(result.items.find(candidate => candidate.title.includes('核对发票')).type, 'followup');

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一联系财务部',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一联系财务部', 'followup', '下周一联系财务部', { followUpAt: '2026-10-26' })
      ]
    );
    assert.equal(result.items.length, 2, 'same actor without a specific follow-up target is not merged');
    assert.equal(result.items.find(candidate => candidate.title.includes('联系财务部')).type, 'confirm');

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一催财务部反馈薪酬测算数据',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一催财务部反馈薪酬测算数据', 'followup', '下周一催财务部反馈薪酬测算数据', { followUpAt: '2026-10-26' })
      ]
    );
    assert.equal(result.items.length, 1, 'explicit same actor and same waiting action can merge');
    assert.equal(result.items[0].followUpAt, '2026-10-26');

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一催一下，等待采购部反馈报价，下周二提醒一下',
      [
        item('等待财务部反馈薪酬测算数据', 'waiting', '等待财务部反馈薪酬测算数据', { waitingFor: '财务部' }),
        item('下周一催一下', 'followup', '下周一催一下', { followUpAt: '2026-10-26' }),
        item('等待采购部反馈报价', 'waiting', '等待采购部反馈报价', { waitingFor: '采购部' }),
        item('下周二提醒一下', 'followup', '下周二提醒一下', { followUpAt: '2026-10-27' })
      ]
    );
    assert.equal(result.items.length, 4, 'multiple possible waiting links are not guessed or merged');
    assert.ok(result.items.filter(candidate => candidate.title.includes('一下')).every(candidate => candidate.type === 'confirm'));

    result = await run(
      '等待财务部反馈薪酬测算数据，下周一催一下',
      [item('等待财务部反馈薪酬测算数据，下周一催一下', 'todo', '等待财务部反馈薪酬测算数据，下周一催一下', {
        dueMode: 'fixed', dueAt: '2026-10-26'
      })]
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, 'waiting', 'clear waiting semantics override a mislabeled todo');
    assert.equal(result.items[0].waitingFor, '财务部');
    assert.equal(result.items[0].followUpAt, '2026-10-26');
    assert.equal(result.items[0].dueAt, null);

    result = await run(
      '明天联系财务部，等待反馈',
      [item('明天联系财务部，等待反馈', 'todo', '明天联系财务部，等待反馈', { dueMode: 'fixed', dueAt: '2026-10-20' })]
    );
    assert.equal(result.items[0].type, 'confirm', 'mixed action with missing waiting actor remains ambiguous');
    assert.equal(result.items[0].dueAt, null);

    result = await run('明天提交报告', [item('明天提交报告', 'confirm', '明天提交报告', { dueMode: 'fixed', dueAt: '2026-10-20' })]);
    assert.equal(result.items[0].type, 'confirm', 'existing confirm fallback cannot be upgraded by date validation');
    assert.equal(result.items[0].dueAt, null);

    result = await run('等待财务部反馈数据，明天联系财务部', [item('等待财务部反馈数据', 'ignore', '等待财务部反馈数据', {
      dueMode: 'fixed', dueAt: '2026-10-20', followUpAt: '2026-10-20'
    })]);
    assert.equal(result.items[0].type, 'ignore', 'ignore candidate is never upgraded by waiting semantics');
    assert.equal(result.items[0].dueAt, null);
    assert.equal(result.items[0].followUpAt, null);

    result = await run(
      '等待财务部反馈数据，下周一催一下；等待财务部反馈数据，下周一催一下',
      [
        item('等待财务部反馈数据', 'waiting', '等待财务部反馈数据', { waitingFor: '财务部' }),
        item('下周一催一下', 'followup', '下周一催一下', { followUpAt: '2026-10-26' })
      ]
    );
    assert.equal(result.items.length, 2, 'repeated source quotes do not silently merge');
    assert.ok(result.items.every(candidate => candidate.type === 'confirm'));

    result = await run(
      '明天提交报告；下周一催财务部反馈',
      [
        item('明天提交报告', 'todo', '明天提交报告', { dueMode: 'fixed', dueAt: '2026-10-23' }),
        item('下周一催财务部反馈', 'followup', '下周一催财务部反馈', { followUpAt: '2026-10-26T09:00:00+08:00' })
      ]
    );
    assert.equal(result.items[0].dueAt, '2026-10-20', 'valid but wrong model date is corrected');
    assert.equal(result.items[1].followUpAt, '2026-10-26', 'invented 09:00 is removed');

    result = await run('明天提交报告', [item('明天提交报告', 'todo', '明天提交报告', {
      dueMode: 'fixed', dueAt: '2026-10-20', reminderAt: '2026-10-20T01:00:00.000Z'
    })]);
    assert.equal(result.items[0].reminderAt, null, 'time-only model reminder is removed when source has no time');

    result = await run('明天上午9点提交报告', [item('明天上午9点提交报告', 'todo', '明天上午9点提交报告', {
      dueMode: 'fixed', dueAt: '2026-10-20', reminderAt: '2026-10-20T01:00:00.000Z'
    })]);
    assert.equal(result.items[0].reminderAt, '2026-10-20T01:00:00.000Z', 'explicit reminder time is retained only when it matches the source in zone');

    result = await run('下周一上午9点催财务部反馈', [item('下周一上午9点催财务部反馈', 'followup', '下周一上午9点催财务部反馈', {
      followUpAt: '2026-10-26T07:00:00.000Z'
    })]);
    assert.equal(result.items[0].type, 'confirm', 'model follow-up hour must match explicit source time');

    result = await run('周五前交付报告', [item('周五前交付报告', 'todo', '周五前交付报告', { dueMode: 'fixed', dueAt: '2026-10-23' })]);
    assert.equal(result.items[0].type, 'confirm');
    assert.equal(result.items[0].dueMode, 'tbd');
    assert.equal(result.items[0].dueAt, null);
    assert.equal(result.items[0].dateEvidence.dueAt.boundaryDate, '2026-10-23');
    assert.match(result.items[0].fieldEvidence, /边界日为 2026-10-23.*是否包含当天需确认.*未写入截止日/);

    result = await run('周五前交付报告', [item('周五前交付报告', 'confirm', '周五前交付报告', { dueMode: 'tbd', dueAt: '2026-10-23' })]);
    assert.equal(result.items[0].type, 'confirm', 'prompt-returned confirm remains confirm');
    assert.equal(result.items[0].dueAt, null);
    assert.equal(result.items[0].dateEvidence.dueAt.boundaryDate, '2026-10-23', 'confirm path retains computed boundary evidence');
    assert.match(result.items[0].fieldEvidence, /边界日为 2026-10-23.*是否包含当天需确认.*未写入截止日/);

    for (const [raw, quote, boundaryDate] of [
      ['月底前完成汇总', '月底前', '2026-10-31'],
      ['2026年10月23日前提交报告', '2026年10月23日前', '2026-10-23']
    ]) {
      result = await run(raw, [item(raw, 'todo', quote, { dueMode: 'fixed', dueAt: boundaryDate })]);
      assert.equal(result.items[0].type, 'confirm', raw + ' is an unresolved boundary');
      assert.equal(result.items[0].dueAt, null);
      assert.equal(result.items[0].dateEvidence.dueAt.boundaryDate, boundaryDate);
      assert.match(result.items[0].fieldEvidence, /是否包含当天需确认/);
    }

    result = await run('明天提交报告，下周一开会', [
      item('提交报告', 'todo', '', { dueMode: 'fixed', dueAt: '2026-10-20' }),
      item('开会', 'todo', '', { dueMode: 'fixed', dueAt: '2026-10-26' })
    ]);
    assert.ok(result.items.every(candidate => candidate.type === 'confirm'), 'missing quote cannot guess date attribution');

    result = await run('明天提交报告；明天提交报告', [
      item('提交报告', 'todo', '明天提交报告', { dueMode: 'fixed', dueAt: '2026-10-20' })
    ]);
    assert.equal(result.items[0].type, 'confirm', 'non-unique quote is not accepted');

    const dateCases = [
      ['今天提交', '今天', '2026-10-19'],
      ['明天提交', '明天', '2026-10-20'],
      ['后天提交', '后天', '2026-10-21'],
      ['本周五提交', '本周五', '2026-10-23'],
      ['周五提交', '周五', '2026-10-23'],
      ['下周一提交', '下周一', '2026-10-26'],
      ['周六整理', '周六', '2026-10-24'],
      ['周日整理', '周日', '2026-10-25'],
      ['月底汇总', '月底', '2026-10-31']
    ];
    for (const [raw, quote, date] of dateCases) {
      result = await run(raw, [item(raw, 'todo', quote, { dueMode: 'fixed', dueAt: '2026-10-30' })]);
      assert.equal(result.items[0].dueAt, date, raw);
    }

    for (const [phrase, start, end] of [
      ['周末', '2026-10-24', '2026-10-25'],
      ['本周末', '2026-10-24', '2026-10-25'],
      ['下周末', '2026-10-31', '2026-11-01']
    ]) {
      result = await run(phrase + '整理', [item(phrase + '整理', 'todo', phrase, { dueMode: 'fixed', dueAt: '2026-10-25' })]);
      assert.equal(result.items[0].type, 'confirm', phrase + ' is a two-day date range');
      assert.equal(result.items[0].dueAt, null);
      assert.equal(result.items[0].dateEvidence.dueAt.rangeStart, start);
      assert.equal(result.items[0].dateEvidence.dueAt.rangeEnd, end);
      assert.match(result.items[0].fieldEvidence, new RegExp(start + '.*' + end));
    }

    result = await run('周末整理', [item('周末整理', 'todo', '周末', { dueMode: 'fixed', dueAt: '2026-10-25' })], {
      currentDate: '2026-10-24', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-23T16:00:00.000Z'
    });
    assert.equal(result.items[0].dateEvidence.dueAt.rangeStart, '2026-10-24', 'Saturday is included in weekend range');
    assert.equal(result.items[0].dateEvidence.dueAt.rangeEnd, '2026-10-25');

    result = await run('周末整理', [item('周末整理', 'todo', '周末', { dueMode: 'fixed', dueAt: '2026-10-25' })], {
      currentDate: '2026-10-25', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-24T16:00:00.000Z'
    });
    assert.equal(result.items[0].dateEvidence.dueAt.rangeStart, '2026-10-24', 'Sunday still refers to the full current weekend');
    assert.equal(result.items[0].dateEvidence.dueAt.rangeEnd, '2026-10-25');

    result = await run('10月18日提交报告', [item('10月18日提交报告', 'todo', '10月18日', { dueMode: 'fixed', dueAt: '2027-10-18' })]);
    assert.equal(result.items[0].type, 'confirm', 'past month-day without year does not roll into next year');
    assert.equal(result.items[0].dueAt, null);
    assert.match(result.items[0].fieldEvidence, /未写年份/);

    result = await run('10月31日提交报告', [item('10月31日提交报告', 'todo', '10月31日', { dueMode: 'fixed', dueAt: '2027-10-31' })]);
    assert.equal(result.items[0].dueAt, '2026-10-31', 'future month-day without year can use current year');

    result = await run('2025年10月18日提交报告', [item('2025年10月18日提交报告', 'todo', '2025年10月18日', { dueMode: 'fixed', dueAt: '2026-10-18' })]);
    assert.equal(result.items[0].dueAt, '2025-10-18', 'explicit year is accepted without rolling');

    result = await run('明天或后天提交报告', [item('明天或后天提交报告', 'todo', '明天', { dueMode: 'fixed', dueAt: '2026-10-20' })]);
    assert.equal(result.items[0].type, 'confirm', 'truncated quote cannot hide a second date in its source clause');
    assert.equal(result.items[0].dateEvidence.date.phrases.length, 2);

    result = await run('本周五还是下周一交付', [item('本周五还是下周一交付', 'todo', '本周五', { dueMode: 'fixed', dueAt: '2026-10-23' })]);
    assert.equal(result.items[0].type, 'confirm', 'truncated quote cannot hide conflicting weekday alternatives');

    result = await run('明天提交报告，后天整理数据', [
      item('明天提交报告', 'todo', '明天', { dueMode: 'fixed', dueAt: '2026-10-20' }),
      item('后天整理数据', 'todo', '后天', { dueMode: 'fixed', dueAt: '2026-10-21' })
    ]);
    assert.deepEqual(result.items.map(candidate => candidate.dueAt), ['2026-10-20', '2026-10-21'], 'distinct comma clauses retain separate date attribution');

    for (const [raw, quote] of [
      ['明天25:99提交报告', '明天25:99'],
      ['明天 at 25:99 submit report', '明天 at 25:99'],
      ['明天下午25点提交报告', '明天下午25点'],
      ['明天下午13:00提交报告', '明天下午13:00']
    ]) {
      result = await run(raw, [item(raw, 'todo', quote, { dueMode: 'fixed', dueAt: '2026-10-20' })]);
      assert.equal(result.items[0].type, 'confirm', raw + ' must not be date-verified');
      assert.equal(result.items[0].dueAt, null);
      assert.match(result.items[0].fieldEvidence, /时刻/);
    }

    result = await run('明天 at 9:30 pm 联系财务部', [item('明天 at 9:30 pm 联系财务部', 'followup', '明天 at 9:30 pm 联系财务部', {
      followUpAt: '2026-10-20T13:30:00.000Z'
    })]);
    assert.equal(result.items[0].type, 'followup');
    assert.equal(result.items[0].followUpAt, '2026-10-20T13:30:00.000Z', 'valid English clock is checked in the requested IANA zone');

    result = await run('下周一提交', [item('下周一提交', 'todo', '下周一提交', { dueMode: 'fixed', dueAt: '2027-01-01' })], {
      currentDate: '2026-12-30', timeZone: 'Asia/Shanghai', referenceInstant: '2026-12-29T16:00:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2027-01-04', 'cross-year next Monday');

    result = await run('月底汇总', [item('月底汇总', 'todo', '月底', { dueMode: 'fixed', dueAt: '2027-01-01' })], {
      currentDate: '2026-12-30', timeZone: 'Asia/Shanghai', referenceInstant: '2026-12-29T16:00:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2026-12-31', 'cross-year month end');

    result = await run('周一提交', [item('周一提交', 'todo', '周一提交', { dueMode: 'fixed', dueAt: '2026-11-01' })], {
      currentDate: '2026-10-30', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-29T16:00:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2026-11-02', 'bare weekday crosses month boundary');

    result = await run('周末整理', [item('周末整理', 'todo', '周末', { dueMode: 'fixed', dueAt: '2026-10-26' })], {
      currentDate: '2026-10-25', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-24T16:00:00.000Z'
    });
    assert.equal(result.items[0].type, 'confirm', 'bare weekend on Sunday remains a two-day range');
    assert.equal(result.items[0].dateEvidence.dueAt.rangeStart, '2026-10-24');
    assert.equal(result.items[0].dateEvidence.dueAt.rangeEnd, '2026-10-25');

    result = await run('下个月底汇总', [item('下个月底汇总', 'todo', '下个月底', { dueMode: 'fixed', dueAt: '2026-11-30' })]);
    assert.equal(result.items[0].dueAt, '2026-11-30', 'next calendar month end is not truncated to this month');

    result = await run('下下周一提交报告', [item('下下周一提交报告', 'todo', '下下周一', { dueMode: 'fixed', dueAt: '2026-11-02' })]);
    assert.equal(result.items[0].dueAt, '2026-11-02', 'second-next week is parsed as a whole phrase');

    result = await run('月底汇总', [item('月底汇总', 'todo', '月底', { dueMode: 'fixed', dueAt: '2028-02-01' })], {
      currentDate: '2028-02-01', timeZone: 'Asia/Shanghai', referenceInstant: '2028-01-31T16:00:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2028-02-29', 'leap-year month end');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-20' })], {
      currentDate: '2026-10-19', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-18T16:30:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2026-10-20', 'reference instant crosses midnight in Shanghai');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-19' })], {
      currentDate: '2026-10-18', timeZone: 'America/Los_Angeles', referenceInstant: '2026-10-19T00:30:00.000Z'
    });
    assert.equal(result.items[0].dueAt, '2026-10-19', 'reference instant uses Los Angeles date');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-20' })], {
      currentDate: '2026-10-19', timeZone: 'Not/A_Time_Zone', referenceInstant: '2026-10-18T16:00:00.000Z'
    });
    assert.equal(result.items[0].type, 'confirm', 'invalid IANA zone fails closed');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-20' })], {
      currentDate: '2026-10-20', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-18T16:00:00.000Z'
    });
    assert.equal(result.items[0].type, 'confirm', 'reference date mismatch fails closed');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-20' })], {
      currentDate: 'invalid-date', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-18T16:00:00.000Z'
    });
    assert.equal(result.items[0].type, 'confirm', 'invalid currentDate fails closed');

    result = await run('明天提交', [item('明天提交', 'todo', '明天提交', { dueMode: 'fixed', dueAt: '2026-10-20' })], {
      currentDate: '2026-10-19', timeZone: 'Asia/Shanghai', referenceInstant: '2026-10-19'
    });
    assert.equal(result.items[0].type, 'confirm', 'date-only referenceInstant is not accepted as an instant');

    assert.ok(requestCount >= 16, 'all cases used the loopback HTTP endpoint');
    console.log('PASS: inbox deterministic date attribution, timezone validation, date precision, waiting/follow-up merge, and loopback HTTP actions');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
