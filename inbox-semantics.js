'use strict';

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch (_) { return false; }
}

function dateInZone(value, zone) {
  if (!validTimeZone(zone)) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const result = {};
  parts.forEach(part => { if (part.type !== 'literal') result[part.type] = part.value; });
  return result.year + '-' + result.month + '-' + result.day;
}

function localDateTimeParts(value, zone) {
  if (!validTimeZone(zone)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const result = {};
  parts.forEach(part => { if (part.type !== 'literal') result[part.type] = part.value; });
  return result;
}

function explicitClock(text) {
  const source = String(text || '');
  let match = /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(source);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return { valid: false, raw: match[0] };
    hour = hour % 12 + (/pm/i.test(match[3]) ? 12 : 0);
    return { hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0'), valid: true };
  }
  match = /(上午|下午|早上|晚上|凌晨)?\s*(\d{1,2})[:：](\d{2})/.exec(source);
  if (match) {
    let hour = Number(match[2]);
    if (match[1] && (hour < 1 || hour > 12)) return { valid: false, raw: match[0] };
    if (/下午|晚上/.test(match[1] || '') && hour < 12) hour += 12;
    if (/上午|凌晨/.test(match[1] || '') && hour === 12) hour = 0;
    const minute = Number(match[3]);
    return hour <= 23 && minute <= 59
      ? { hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0'), valid: true }
      : { valid: false, raw: match[0] };
  }
  match = /(上午|下午|早上|晚上|凌晨)\s*(\d{1,2})(?:点|时)(半|(\d{1,2})分?)?/.exec(source);
  if (match) {
    let hour = Number(match[2]);
    if (hour < 1 || hour > 12) return { valid: false, raw: match[0] };
    if (/下午|晚上/.test(match[1]) && hour < 12) hour += 12;
    if (/上午|凌晨/.test(match[1]) && hour === 12) hour = 0;
    const minute = match[3] === '半' ? 30 : Number(match[4] || 0);
    return hour <= 23 && minute <= 59
      ? { hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0'), valid: true }
      : { valid: false, raw: match[0] };
  }
  match = /\b(\d{1,2}):(\d{2})\b/.exec(source);
  if (match) {
    const hour = Number(match[1]), minute = Number(match[2]);
    return hour <= 23 && minute <= 59
      ? { hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0'), valid: true }
      : { valid: false, raw: match[0] };
  }
  match = /\b(\d{1,2})\s*(am|pm)\b/i.exec(source);
  if (match) {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) return { valid: false, raw: match[0] };
    hour = hour % 12 + (/pm/i.test(match[2]) ? 12 : 0);
    return { hour: String(hour).padStart(2, '0'), minute: '00', valid: true };
  }
  return null;
}

function clockContext(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const timeZone = typeof source.timeZone === 'string' && source.timeZone.trim()
    ? source.timeZone.trim() : (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const zoneValid = validTimeZone(timeZone);
  const hasInstant = typeof source.referenceInstant === 'string' && !!source.referenceInstant.trim();
  const instant = hasInstant ? new Date(source.referenceInstant) : new Date();
  const instantFormatValid = !hasInstant || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(source.referenceInstant);
  const instantValid = !Number.isNaN(instant.getTime()) && instantFormatValid;
  const instantDate = zoneValid && instantValid ? dateInZone(instant, timeZone) : '';
  const suppliedDate = validDate(source.currentDate) ? source.currentDate : '';
  const hasCurrentDate = typeof source.currentDate === 'string' && !!source.currentDate.trim();
  const mismatch = !!(hasInstant && hasCurrentDate && (!suppliedDate || !instantDate || suppliedDate !== instantDate));
  return {
    currentDate: suppliedDate || instantDate,
    timeZone,
    referenceInstant: instantValid ? instant.toISOString() : '',
    relativeValid: zoneValid && instantValid && !!(suppliedDate || instantDate) && !mismatch,
    mismatch
  };
}

function addDays(value, amount) {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekday(value) {
  const day = new Date(value + 'T00:00:00.000Z').getUTCDay();
  return day || 7;
}

function endOfMonth(value, offset) {
  const d = new Date(value + 'T00:00:00.000Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + offset, 0)).toISOString().slice(0, 10);
}

function resolveDate(phrase, clock) {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(phrase);
  if (match) {
    const date = match[1] + '-' + match[2] + '-' + match[3];
    return { date: validDate(date) ? date : '', absolute: true };
  }
  match = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/.exec(phrase);
  if (match) {
    let year = match[1] ? Number(match[1]) : Number((clock.currentDate || '').slice(0, 4));
    let date = year ? String(year).padStart(4, '0') + '-' + String(Number(match[2])).padStart(2, '0') + '-' + String(Number(match[3])).padStart(2, '0') : '';
    if (!validDate(date)) return { date: '', absolute: !!match[1], relative: !match[1], needsYearConfirm: !match[1] };
    if (!match[1] && clock.currentDate && date < clock.currentDate) return { date: '', absolute: false, relative: true, needsYearConfirm: true };
    return { date, absolute: !!match[1], relative: !match[1] };
  }
  if (/大后天/.test(phrase)) return { date: clock.relativeValid ? addDays(clock.currentDate, 3) : '', relative: true };
  if (/后天/.test(phrase)) return { date: clock.relativeValid ? addDays(clock.currentDate, 2) : '', relative: true };
  if (/明天|明日/.test(phrase)) return { date: clock.relativeValid ? addDays(clock.currentDate, 1) : '', relative: true };
  if (/今天|今日/.test(phrase)) return { date: clock.relativeValid ? clock.currentDate : '', relative: true };
  if (/月底|月末/.test(phrase)) {
    if (!clock.relativeValid) return { date: '', relative: true };
    return { date: endOfMonth(clock.currentDate, /下个月底|下个月末|下月底|下月末/.test(phrase) ? 1 : 0), relative: true };
  }
  if (/周末/.test(phrase)) {
    if (!clock.relativeValid) return { date: '', relative: true };
    const monday = addDays(clock.currentDate, 1 - weekday(clock.currentDate));
    const start = /下周末|下星期末|下个星期末/.test(phrase) ? addDays(monday, 12)
      : /本周末|这周末|这个周末/.test(phrase) ? addDays(monday, 5)
      : addDays(clock.currentDate, weekday(clock.currentDate) <= 5 ? 6 - weekday(clock.currentDate) : 6 - weekday(clock.currentDate));
    return { date: '', relative: true, range: { start, end: addDays(start, 1) } };
  }
  match = /^(下下周|下下星期|下周|下星期|下个星期|本周|本星期|这周|这星期)?(?:周|星期)?([一二三四五六日天])(?:(之前|以前|前))?$/.exec(phrase);
  if (match) {
    if (!clock.relativeValid) return { date: '', relative: true, boundary: !!match[3] };
    const day = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 }[match[2]];
    const prefix = /^(下下周|下下星期)$/.test(match[1] || '') ? 'nextnext'
      : /^(下周|下星期|下个星期)$/.test(match[1] || '') ? 'next'
      : /^(本周|本星期|这周|这星期)$/.test(match[1] || '') ? 'this' : 'bare';
    const monday = addDays(clock.currentDate, 1 - weekday(clock.currentDate));
    const offset = prefix === 'nextnext' ? 14 + day - 1
      : prefix === 'next' ? 7 + day - 1
      : prefix === 'this' ? day - 1 : (day - weekday(clock.currentDate) + 7) % 7;
    return { date: addDays(prefix === 'bare' ? clock.currentDate : monday, offset), relative: true, boundary: !!match[3] };
  }
  return null;
}

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}|(?:\d{4}年)?\d{1,2}月\d{1,2}日|下个星期末|下星期末|下周末|本周末|这周末|这个周末|周末|下个月底|下个月末|下月底|下月末|本月底|这个月底|月底|月末|大后天|后天|明天|明日|今天|今日|下下星期[一二三四五六日天](?:之前|以前|前)?|下下周[一二三四五六日天](?:之前|以前|前)?|下个星期[一二三四五六日天](?:之前|以前|前)?|下星期[一二三四五六日天](?:之前|以前|前)?|下周[一二三四五六日天](?:之前|以前|前)?|本星期[一二三四五六日天](?:之前|以前|前)?|这星期[一二三四五六日天](?:之前|以前|前)?|本周[一二三四五六日天](?:之前|以前|前)?|这周[一二三四五六日天](?:之前|以前|前)?|(?:星期|周)[一二三四五六日天](?:之前|以前|前)?/g;

function findDates(text, clock) {
  const found = [];
  DATE_PATTERN.lastIndex = 0;
  let match;
  const source = String(text || '');
  while ((match = DATE_PATTERN.exec(source))) {
    const parsed = resolveDate(match[0], clock);
    const suffix = /^(之前|以前|前)/.exec(source.slice(DATE_PATTERN.lastIndex));
    if (suffix) DATE_PATTERN.lastIndex += suffix[0].length;
    if (parsed) found.push({
      phrase: match[0] + (suffix ? suffix[0] : ''), date: parsed.date, relative: !!parsed.relative,
      absolute: !!parsed.absolute, boundary: !!parsed.boundary || !!suffix,
      range: parsed.range || null, needsYearConfirm: !!parsed.needsYearConfirm
    });
  }
  return found;
}

function segments(rawText) {
  return String(rawText || '').split(/(?<=[。！？!?；;\r\n])/).map(part => part.trim()).filter(Boolean);
}

function countOccurrences(text, part) {
  return part ? String(text).split(part).length - 1 : 0;
}

function locateQuote(item, rawText, parts, itemCount) {
  if (item.sourceQuote) return countOccurrences(rawText, item.sourceQuote) === 1 ? item.sourceQuote : '';
  const title = String(item.title || '').trim();
  const matches = parts.filter(part => title.length >= 2 && part.includes(title));
  if (matches.length === 1) return matches[0];
  return itemCount === 1 && parts.length === 1 ? parts[0] : '';
}

function sentenceKey(rawText, quote) {
  const index = rawText.indexOf(quote);
  if (index < 0 || countOccurrences(rawText, quote) !== 1) return '';
  let start = index;
  let end = index + quote.length;
  while (start > 0 && !/[。！？!?；;\r\n]/.test(rawText[start - 1])) start--;
  while (end < rawText.length && !/[。！？!?；;\r\n]/.test(rawText[end])) end++;
  return rawText.slice(start, end).trim();
}

function dateContext(rawText, quote) {
  const index = rawText.indexOf(quote);
  if (index < 0 || countOccurrences(rawText, quote) !== 1) return quote;
  let start = index;
  let end = index + quote.length;
  while (start > 0 && !/[，,。！？!?；;\r\n]/.test(rawText[start - 1])) start--;
  while (end < rawText.length && !/[，,。！？!?；;\r\n]/.test(rawText[end])) end++;
  return rawText.slice(start, end).trim();
}

function followActor(text) {
  const match = /(?:催|联系|提醒|跟进|追一下|推动)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?=发|提交|回复|反馈|答复|报价|处理|核对|确认|检查|沟通|获取|提供|开具|完成|$)/.exec(String(text || ''));
  if (!match || /^(一下|一次|尽快|对方|相关部门)$/.test(match[1])) return '';
  return match[1];
}

function waitingActor(text) {
  const match = /(?:等待|等)(?:向|来自)?\s*([^，,。；;\r\n]{1,20}?)\s*(?:反馈|回复|答复|回传)/.exec(String(text || ''));
  return match ? match[1].trim() : '';
}

function genericFollowup(text) {
  DATE_PATTERN.lastIndex = 0;
  const action = String(text || '')
    .replace(new RegExp(DATE_PATTERN.source, 'g'), '')
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, '')
    .replace(/[，,。！？!?；;\s]/g, '')
    .replace(/^(?:我|再|届时|请|到时)+/, '');
  return /^(?:催(?:一下|对方|一次)?|跟进(?:一下|对方|一次)?|提醒(?:一下|对方|相关方|相关部门)?|联系(?:一下|对方)?|追一下|推动一下)$/.test(action);
}

function waitingActionTail(text) {
  const match = /(?:等待|等)(?:向|来自)?\s*[^，,。；;\r\n]{1,20}?\s*(反馈|回复|答复|回传)\s*([^，,。；;\r\n]{1,24})/.exec(String(text || ''));
  if (!match) return '';
  return (match[1] + match[2]).replace(/[\s。！？!?；;]+$/g, '').trim();
}

function matchesWaitingAction(wait, follow) {
  const tail = waitingActionTail(wait.sourceQuote);
  if (!tail) return false;
  const actor = followActor(follow.sourceQuote);
  const normalize = value => String(value || '').replace(/[\s，,。！？!?；;部门科室组]/g, '');
  if (actor && normalize(actor) !== normalize(wait.waitingFor)) return false;
  return normalize(follow.sourceQuote).includes(normalize(tail));
}

function hasDistinctFollowAction(text) {
  const source = String(text || '')
    .replace(new RegExp(DATE_PATTERN.source, 'g'), '')
    .replace(/[，,。！？!?；;\s]/g, '');
  return /(?:催|联系|提醒|跟进|追一下|推动)\s*(?:[\u4e00-\u9fa5A-Za-z0-9]{2,12})?\s*(?:发|提交|回复|反馈|答复|报价|处理|核对|确认|检查|沟通|获取|提供|开具|完成)\s*[^，,。；;\r\n]{1,20}/.test(source) ||
    /(?:核对|确认|检查|沟通|获取|提供|开具|提交|处理|报价|发出|发送)\s*[^，,。；;\r\n]{1,20}/.test(source);
}

function evidence(status, values) {
  return Object.assign({ status }, values || {});
}

function confirm(item, message, dateEvidence) {
  item.type = 'confirm';
  if (item.dueMode === 'fixed' || item.dueAt) item.dueMode = 'tbd';
  item.dueAt = null;
  item.followUpAt = null;
  item.reminderAt = null;
  item.dateEvidence = dateEvidence || {};
  item.fieldEvidence = message;
}

function appendEvidence(item, text) {
  const previous = String(item.fieldEvidence || '').trim();
  item.fieldEvidence = previous ? previous + ' ' + text : text;
}

function applyDate(item, mention, quote, context, clock, warnings) {
  const statedClock = explicitClock(context);
  const explicitTime = !!(statedClock && statedClock.valid);
  if (statedClock && !statedClock.valid) {
    confirm(item, '原文时刻超出有效范围，日期和时刻均待确认。', {
      date: evidence('confirm', { phrase: mention.phrase, statedTime: statedClock.raw, sourceQuote: quote, sourceContext: context })
    });
    warnings.push('原文时刻无效，已标为待确认。');
    return;
  }
  if (mention.relative && !clock.relativeValid) {
    confirm(item, clock.mismatch ? 'currentDate 与 referenceInstant 在 IANA 时区下不一致，日期待确认。' : '时区或参考时刻无效，相对日期待确认。', {
      date: evidence('confirm', { phrase: mention.phrase, referenceDate: clock.currentDate, timeZone: clock.timeZone, sourceQuote: quote })
    });
    warnings.push('相对日期未通过时区/参考时刻一致性校验，已待确认。');
    return;
  }
  if (mention.needsYearConfirm) {
    const field = /催|跟进|提醒|联系|追一下|推动/.test(context) || item.type === 'followup' ? 'followUpAt' : 'dueAt';
    confirm(item, '原文未写年份，且该月日已过或本年无此日期，年份待确认；不会自动顺延到下一年。', {
      [field]: evidence('confirm', { phrase: mention.phrase, referenceDate: clock.currentDate, sourceQuote: quote, sourceContext: context })
    });
    item.fieldEvidence = '原文“' + mention.phrase + '”未写年份，且按参考日 ' + clock.currentDate + ' 已过或无效；请确认年份。';
    warnings.push('未写年份的日期不能据此滚到下一年，已待确认。');
    return;
  }
  if (mention.range) {
    const followup = /催|跟进|提醒|联系|追一下|推动/.test(context) || item.type === 'followup';
    const field = followup ? 'followUpAt' : 'dueAt';
    confirm(item, '“' + mention.phrase + '”表示日期范围 ' + mention.range.start + ' 至 ' + mention.range.end + '，需选择具体日期。', {
      [field]: evidence('confirm', {
        phrase: mention.phrase, rangeStart: mention.range.start, rangeEnd: mention.range.end,
        referenceDate: clock.currentDate, timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
        explanation: '周末包含周六和周日，未擅自选定其中一天。'
      })
    });
    item.fieldEvidence = '“' + mention.phrase + '”对应 ' + mention.range.start + '（周六）至 ' + mention.range.end + '（周日），需确认具体日期；未写入截止日或跟进日期。';
    warnings.push('周末范围包含两天，已待确认具体日期。');
    return;
  }
  if (!mention.date) {
    confirm(item, '原文日期表达无法确定到有效日历日。', { date: evidence('confirm', { phrase: mention.phrase, sourceQuote: quote }) });
    warnings.push('日期表达无法解析，已待确认。');
    return;
  }
  if (mention.boundary) {
    const followup = /催|跟进|提醒|联系|追一下|推动/.test(context) || item.type === 'followup';
    const field = followup ? 'followUpAt' : 'dueAt';
    item.type = 'confirm';
    item.dueMode = 'tbd'; item.dueAt = null; item.followUpAt = null; item.reminderAt = null;
    item.dateEvidence = { [field]: evidence('confirm', {
      phrase: mention.phrase, boundaryDate: mention.date, referenceDate: clock.currentDate,
      timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
      explanation: '“前”是边界表达，需确认是否包含边界日；确认前不写入日期。'
    }) };
    item.fieldEvidence = '边界日为 ' + mention.date + '；“前”是否包含当天需确认，未写入' + (followup ? '跟进日期。' : '截止日。');
    return;
  }
  const followup = /催|跟进|提醒|联系|追一下|推动/.test(context) || item.type === 'followup';
  if (followup) {
    const supplied = item.followUpAt;
    const suppliedDate = supplied && validDate(supplied) ? supplied : supplied ? dateInZone(supplied, clock.timeZone) : '';
    const suppliedParts = explicitTime && supplied ? localDateTimeParts(supplied, clock.timeZone) : null;
    const wrongTime = explicitTime && supplied && (!suppliedParts || suppliedParts.hour !== statedClock.hour || suppliedParts.minute !== statedClock.minute);
    if (explicitTime && (!supplied || suppliedDate !== mention.date || wrongTime)) {
      confirm(item, '模型跟进时刻与原文日期不一致，需人工确认。', {
        followUpAt: evidence('confirm', { phrase: mention.phrase, date: mention.date, sourceQuote: quote, statedTime: statedClock })
      });
      warnings.push('模型跟进时刻与原文日期或时刻冲突，已待确认。');
      return;
    }
    if (supplied && suppliedDate !== mention.date) warnings.push('模型跟进日期已按原文确定日期修正。');
    if (supplied && !explicitTime && !validDate(supplied)) warnings.push('原文未写时刻，已清除模型补造的跟进时刻。');
    item.followUpAt = explicitTime && supplied ? supplied : mention.date;
    item.dueAt = null; item.dueMode = 'none';
    item.dateEvidence = { followUpAt: evidence('verified', {
      phrase: mention.phrase, date: mention.date, referenceDate: clock.currentDate,
      timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
      explanation: explicitTime ? '原文包含明确时刻。' : '程序按原文和参考日计算；保留日期精度。'
    }) };
    appendEvidence(item, '跟进日期由程序按原文“' + mention.phrase + '”和参考日 ' + clock.currentDate + '（' + clock.timeZone + '）校验为 ' + mention.date + (explicitTime ? '。' : '，未补造时刻。'));
  } else {
    if (item.dueAt && item.dueAt !== mention.date) warnings.push('模型截止日期已按原文确定日期修正。');
    item.dueMode = 'fixed'; item.dueAt = mention.date; item.followUpAt = null;
    item.dateEvidence = { dueAt: evidence('verified', {
      phrase: mention.phrase, date: mention.date, referenceDate: clock.currentDate,
      timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
      explanation: mention.absolute ? '原文明确写出日期。' : '程序按原文和参考日计算；不推断时刻。'
    }) };
    appendEvidence(item, (mention.absolute ? '截止日期在原文明确写为 ' : '截止日期由程序按原文“' + mention.phrase + '”和参考日 ' + clock.currentDate + '（' + clock.timeZone + '）计算为 ') + mention.date + '。');
  }
}

function validateInboxResult(result, payload) {
  if (!result || !Array.isArray(result.items)) return result;
  const source = payload && (payload.rawText || payload.text) || '';
  const clock = clockContext(payload || {});
  const rawText = String(source).slice(0, 20000);
  const parts = segments(rawText);
  const warnings = Array.isArray(result.warnings) ? result.warnings.slice() : [];
  const items = result.items.map(item => Object.assign({}, item, {
    dateEvidence: {}, fieldEvidence: String(item.fieldEvidence || '')
  }));
  const quotes = items.map(item => locateQuote(item, rawText, parts, items.length));
  const counts = new Map();
  quotes.forEach((quote, index) => {
    if (!quote) return;
    const sentence = sentenceKey(rawText, quote);
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  });
  items.forEach((item, index) => {
    const quote = quotes[index];
    if (item.type === 'ignore') {
      item.dueAt = null; item.followUpAt = null; item.reminderAt = null;
      if (quote) item.sourceQuote = quote;
      item.dateEvidence = { date: evidence('ignored', { explanation: '忽略项不进入任务日期校验或写入流程。' }) };
      return;
    }
    if (item.type === 'confirm') {
      item.dueAt = null; item.followUpAt = null; item.reminderAt = null;
      if (item.dueMode === 'fixed' || item.dueMode === 'none') item.dueMode = 'tbd';
      item.dateEvidence = { date: evidence('confirm', { explanation: '候选已标为待确认；日期不会在此阶段自动写入。' }) };
      if (quote && countOccurrences(rawText, quote) === 1) {
        item.sourceQuote = quote;
        const context = dateContext(rawText, quote);
        const dates = findDates(context, clock);
        if (dates.length === 1 && !(dates[0].relative && !clock.relativeValid)) {
          const mention = dates[0];
          const followup = /催|跟进|提醒|联系|追一下|推动/.test(context);
          const field = followup ? 'followUpAt' : 'dueAt';
          if (mention.range) {
            item.dateEvidence = { [field]: evidence('confirm', {
              phrase: mention.phrase, rangeStart: mention.range.start, rangeEnd: mention.range.end,
              referenceDate: clock.currentDate, timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
              explanation: '周末包含周六和周日，需确认具体日期。'
            }) };
            appendEvidence(item, '“' + mention.phrase + '”对应 ' + mention.range.start + '（周六）至 ' + mention.range.end + '（周日），需确认具体日期；未写入日期。');
          } else if (mention.boundary && mention.date) {
            item.dateEvidence = { [field]: evidence('confirm', {
              phrase: mention.phrase, boundaryDate: mention.date, referenceDate: clock.currentDate,
              timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
              explanation: '“前”是否包含边界当天待确认。'
            }) };
            appendEvidence(item, '边界日为 ' + mention.date + '；“前”是否包含当天需确认，未写入' + (followup ? '跟进日期。' : '截止日。'));
          } else if (mention.needsYearConfirm) {
            item.dateEvidence = { [field]: evidence('confirm', {
              phrase: mention.phrase, referenceDate: clock.currentDate,
              sourceQuote: quote, sourceContext: context, explanation: '原文未写年份且该月日已过或本年无此日期。'
            }) };
            appendEvidence(item, '原文“' + mention.phrase + '”未写年份，需确认年份；未写入日期。');
          } else if (mention.date) {
            item.dateEvidence = { [field]: evidence('suggested', {
              phrase: mention.phrase, date: mention.date, referenceDate: clock.currentDate,
              timeZone: clock.timeZone, sourceQuote: quote, sourceContext: context,
              explanation: '仅作待确认建议，不写入任务日期。'
            }) };
            appendEvidence(item, '程序解析的日期建议为 ' + mention.date + '；候选仍待确认，未写入日期。');
          }
        }
      }
      appendEvidence(item, '候选已标为待确认，日期字段保持空白。');
      return;
    }
    if (!quote || (!item.sourceQuote && counts.get(sentenceKey(rawText, quote)) > 1)) {
      if (item.type !== 'ignore') {
        confirm(item, '候选无法唯一关联到原文片段，请补充原文依据。', {
          sourceQuote: evidence('confirm', { explanation: 'sourceQuote 缺失、重复或无法唯一定位。' })
        });
        warnings.push('候选无法唯一关联到原文，已标为待确认。');
      }
      return;
    }
    item.sourceQuote = quote;
    const context = dateContext(rawText, quote);
    const dates = findDates(context, clock);
    if (dates.length > 1) {
      confirm(item, '同一原文片段包含多个日期，无法确定各日期对应事项。', {
        date: evidence('confirm', { phrases: dates.map(value => value.phrase), sourceQuote: quote, sourceContext: context })
      });
      warnings.push('候选片段包含多个日期，已标为待确认。');
    } else if (dates.length === 1) {
      applyDate(item, dates[0], quote, context, clock, warnings);
    } else if (item.dueAt || item.followUpAt) {
      confirm(item, '模型日期没有可验证的原文依据，已清除并待确认。', {
        date: evidence('confirm', { sourceQuote: quote, explanation: '模型日期未在对应原文片段中出现。' })
      });
      warnings.push('原文不支持模型日期，已清除并待确认。');
    } else if (/(?:今天|明天|后天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|月末|\d{1,2}月\d{1,2}日)/.test(quote)) {
      confirm(item, '原文含日期表达但无法确定对应日期。', {
        date: evidence('confirm', { sourceQuote: quote, explanation: '日期表达未被程序唯一解析。' })
      });
      warnings.push('日期表达无法唯一解析，已待确认。');
    }
    if (item.type === 'confirm') return;
    if (item.reminderAt) {
      const statedClock = explicitClock(context);
      const reminderParts = statedClock ? localDateTimeParts(item.reminderAt, clock.timeZone) : null;
      const reminderDate = dates.length === 1 ? dates[0].date : '';
      const reminderValid = !!(reminderDate && statedClock && reminderParts &&
        reminderParts.year + '-' + reminderParts.month + '-' + reminderParts.day === reminderDate &&
        reminderParts.hour === statedClock.hour && reminderParts.minute === statedClock.minute);
      if (!reminderValid) {
        item.reminderAt = null;
        appendEvidence(item, '模型提醒时刻未能与原文明确日期和时刻对应，已清除。');
        warnings.push('模型提醒时刻缺少精确原文依据，已清除。');
      }
    }
    const waitActorInQuote = waitingActor(quote);
    const hasWaitPhrase = /(?:等待|等)(?:向|来自)?[^，,。；;\r\n]{0,20}(?:反馈|回复|答复|回传)/.test(quote);
    if (item.type !== 'waiting' && hasWaitPhrase) {
      const firstClause = quote.split(/[，,。！？!?；;\r\n]/)[0];
      const firstClauseWithoutClock = firstClause
        .replace(new RegExp(DATE_PATTERN.source, 'g'), '')
        .replace(/(?:上午|下午|早上|晚上|凌晨)?\s*\d{1,2}[:：]\d{2}|(?:上午|下午|早上|晚上|凌晨)\s*\d{1,2}(?:点|时)(?:半|\d{1,2}分?)?/g, '')
        .replace(/^\s*(?:请|我|再|届时|到时)+/, '')
        .trim();
      if (waitActorInQuote && /^(?:等待|等)/.test(firstClauseWithoutClock)) {
        item.type = 'waiting';
        item.waitingFor = waitActorInQuote;
        appendEvidence(item, '候选类型按原文明确等待语义校正为等待，等待对象为“' + waitActorInQuote + '”。');
      } else {
        confirm(item, waitActorInQuote ? '原文同时包含独立动作与等待语义，关系需人工确认。' : '原文有等待语义但等待对象不明确，需人工确认。', Object.assign({}, item.dateEvidence));
        warnings.push('等待语义与候选类型/对象不明确，已待确认。');
        return;
      }
    }
    if (item.type === 'todo' && item.followUpAt) {
      item.type = 'followup';
      appendEvidence(item, '候选类型按原文明确跟进行动校正为跟进。');
    }
    if (item.type === 'waiting') {
      const actor = waitingActor(quote);
      if (actor) {
        item.waitingFor = actor;
        appendEvidence(item, '等待对象“' + actor + '”由程序从原文提取。');
      } else if (!item.waitingFor || !quote.includes(item.waitingFor)) {
        confirm(item, '等待对象无法从原文唯一确认。', Object.assign({}, item.dateEvidence));
        warnings.push('等待对象不明确，已待确认。');
      }
      if (item.owner && item.owner === item.waitingFor) item.owner = '';
    }
    if (item.owner && !quote.includes(item.owner)) {
      item.owner = '';
      appendEvidence(item, '未在原文找到模型负责人，已清除。');
      warnings.push('模型负责人缺少原文支持，已清除。');
    }
    if (item.projectSuggestion) {
      const projects = Array.isArray(payload && payload.projects) ? payload.projects : [];
      const project = projects.find(value => value && value.name === item.projectSuggestion);
      if (!project || !quote.includes(project.name)) {
        item.projectSuggestion = '';
        appendEvidence(item, '项目关联未在原文中明确定位，已清除。');
        warnings.push('项目关联缺少明确原文依据，已清除。');
      }
    }
    if (item.type === 'followup' && !/(?:催|跟进|提醒|联系|追一下|推动)/.test(quote)) {
      confirm(item, '主动跟进行动无法从原文确认。', Object.assign({}, item.dateEvidence));
      warnings.push('主动跟进行动缺少原文依据，已待确认。');
    }
  });
  const waits = items.filter(item => item.type === 'waiting' && item.waitingFor);
  const follows = items.filter(item => item.type === 'followup' && item.followUpAt);
  const normalizeActor = value => String(value || '').replace(/[部门科室组\s]/g, '');
  const links = new Map();
  follows.forEach(follow => {
    const followSentence = sentenceKey(rawText, follow.sourceQuote);
    const sameSentence = waits.filter(wait => followSentence && sentenceKey(rawText, wait.sourceQuote) === followSentence);
    const eligible = sameSentence.filter(wait => genericFollowup(follow.sourceQuote) || matchesWaitingAction(wait, follow));
    links.set(follow, { sameSentence, eligible });
  });
  const usesByWait = new Map();
  links.forEach(link => link.eligible.forEach(wait => usesByWait.set(wait, (usesByWait.get(wait) || 0) + 1)));
  const remove = new Set();
  links.forEach((link, follow) => {
    if (link.eligible.length === 1 && usesByWait.get(link.eligible[0]) === 1) {
      const wait = link.eligible[0];
      wait.followUpAt = follow.followUpAt;
      wait.dateEvidence = Object.assign({}, wait.dateEvidence, { followUpAt: follow.dateEvidence.followUpAt });
      appendEvidence(wait, follow.fieldEvidence);
      wait.sourceQuote = sentenceKey(rawText, wait.sourceQuote);
      remove.add(follow);
      warnings.push('同一等待事项的泛指或明确同对象跟进已并入等待候选。');
      return;
    }
    if (link.eligible.length > 0) {
      confirm(follow, '同一原文片段存在多个可能的等待关联，需人工确认跟进对象。', Object.assign({}, follow.dateEvidence));
      warnings.push('跟进与多个等待事项可能相关，已待确认。');
      return;
    }
    if (link.sameSentence.length) {
      const actor = followActor(follow.sourceQuote);
      const sameActor = actor && link.sameSentence.some(wait => normalizeActor(actor) === normalizeActor(wait.waitingFor));
      if (!hasDistinctFollowAction(follow.sourceQuote) && (!actor || sameActor)) {
        confirm(follow, '跟进与同句等待事项的关系不明确，需人工确认。', Object.assign({}, follow.dateEvidence));
        warnings.push('跟进与等待事项的关联不明确，已待确认。');
      }
    }
  });
  if (remove.size) {
    for (let i = items.length - 1; i >= 0; i--) if (remove.has(items[i])) items.splice(i, 1);
  }
  return Object.assign({}, result, {
    items,
    warnings: Array.from(new Set(warnings.filter(Boolean))).slice(0, 12)
  });
}

module.exports = { validateInboxResult };
