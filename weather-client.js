'use strict';

const https = require('node:https');
const cityData = require('./weather-cities.json');

function cityKey(value) {
  return String(value || '').trim().replace(/臺/g, '台').replace(/區/g, '区').replace(/縣/g, '县')
    .replace(/(?:壮族|回族|维吾尔)?自治区|特别行政区|自治州|自治县|省|市|区|县|[·\s]/g, '');
}

function resolveCity(input) {
  if (typeof input !== 'string' || input.length > 100) throw new Error('请填写中国城市，例如北京市海淀区');
  const query = cityKey(input);
  if (!query) throw new Error('请先在设置中填写所在地');
  const exact = cityData.cities.filter(row => {
    const names = [...new Set(row.slice(1))];
    return [names.join(''), [...new Set(row.slice(2))].join(''), row[3]].some(name => cityKey(name) === query);
  });
  const unique = [...new Map(exact.map(row => [row[0], row])).values()];
  if (!unique.length) throw new Error('未找到所在地，请填写简体省、市、区县名称');
  if (unique.length !== 1) throw new Error('存在同名地区，请补充省市，例如北京市朝阳区');
  const row = unique[0];
  return { id: row[0], label: [...new Set(row.slice(1))].join('·') };
}

function fetchText(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['d1.weather.com.cn', 'www.weather.com.cn'].includes(parsed.hostname)) {
      reject(new Error('天气地址无效')); return;
    }
    let finished = false, timer;
    const done = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const request = https.get(parsed, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.weather.com.cn/', 'Cache-Control': 'no-cache' } }, response => {
      if (response.statusCode !== 200) {
        response.resume(); done(new Error('中国天气网暂时不可用，请稍后重试')); return;
      }
      let body = '', bytes = 0;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > 1024 * 1024) { done(new Error('天气数据格式异常')); response.destroy(); return; }
        body += chunk;
      });
      response.on('end', () => done(null, body));
      response.on('error', () => done(new Error('天气连接中断，请重试')));
      response.on('aborted', () => done(new Error('天气连接中断，请重试')));
    });
    timer = setTimeout(() => { done(new Error('天气连接超时，请重试')); request.destroy(); }, timeoutMs);
    request.on('error', () => done(new Error('无法连接中国天气网，请检查网络后重试')));
  });
}

function weatherCode(text) {
  if (/雷/.test(text)) return 95;
  if (/雪/.test(text)) return 71;
  if (/雨/.test(text)) return 61;
  if (/雾|霾/.test(text)) return 45;
  if (/阴/.test(text)) return 3;
  if (/云/.test(text)) return 2;
  return /晴/.test(text) ? 0 : 3;
}

function observationTime(value, now) {
  const date = /^(\d{1,2})月(\d{1,2})日/.exec(String(value.date));
  const time = /^(\d{2}):(\d{2})$/.exec(String(value.time));
  if (!date || !time || +date[1] < 1 || +date[1] > 12 || +date[2] < 1 || +date[2] > 31 || +time[1] > 23 || +time[2] > 59) throw new Error('天气观测时间无效');
  const year = new Date(now + 8 * 3600000).getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map(y => Date.UTC(y, +date[1] - 1, +date[2], +time[1] - 8, +time[2]));
  const timestamp = candidates.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
  const parts = new Date(timestamp + 8 * 3600000);
  if (parts.getUTCMonth() + 1 !== +date[1] || parts.getUTCDate() !== +date[2] || timestamp > now + 3600000) throw new Error('天气观测日期无效');
  return new Date(timestamp).toISOString();
}

function parseCurrent(raw, city, now) {
  const match = /^\s*var\s+dataSK\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(raw);
  if (!match) throw new Error('天气实况格式已变化，请稍后重试');
  const value = JSON.parse(match[1]);
  const number = item => typeof item === 'string' && /^-?\d+(?:\.\d+)?$/.test(item) ? Number(item) : null;
  const temp = number(value.temp);
  if (String(value.city) !== city.id || temp === null || temp < -90 || temp > 65 || typeof value.weather !== 'string' || !value.weather.trim() || value.weather.length > 40) throw new Error('天气实况数据无效');
  const observedAt = observationTime(value, now);
  const humidity = number(String(value.SD || '').replace('%', ''));
  const windMatch = /^(\d+(?:\.\d+)?)km\/?h$/.exec(String(value.wse || ''));
  return {
    temp: Math.round(temp), code: weatherCode(value.weather), text: value.weather,
    city: city.label, loc: city.label, cityId: city.id, source: '中国天气网',
    sourceUrl: 'https://www.weather.com.cn/weather/' + city.id + '.shtml',
    ts: now, observedAt, stale: now - Date.parse(observedAt) > 3 * 3600000,
    hum: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
    wind: windMatch ? Number(windMatch[1]) : null,
    windText: [value.WD, value.WS].filter(part => typeof part === 'string' && part.length <= 20).join(' ')
  };
}

function parseForecast(html) {
  const section = html.slice(html.indexOf('id="7d"'));
  const base = /id="fc_24h_internal_update_time"\s+value="(\d{4})(\d{2})(\d{2})/.exec(section);
  const list = /<ul class="t clearfix">([\s\S]*?)<\/ul>/.exec(section);
  if (!base || !list) throw new Error('预报格式暂不可用');
  const days = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].slice(0, 4);
  return days.map((day, index) => {
    const body = day[1], text = /class="wea">([^<]{1,60})<\/p>/.exec(body);
    const temperatures = /class="tem">([\s\S]*?)<\/p>/.exec(body);
    const high = temperatures && /<span>(-?\d+)(?:℃)?<\/span>/.exec(temperatures[1]);
    const low = temperatures && /<i>(-?\d+)(?:℃)?<\/i>/.exec(temperatures[1]);
    if (!text || !low) throw new Error('预报温度暂不可用');
    const date = new Date(Date.UTC(+base[1], +base[2] - 1, +base[3] + index)).toISOString().slice(0, 10);
    return { date, text: text[1], code: weatherCode(text[1]), tmax: high ? +high[1] : null, tmin: +low[1], pop: null };
  });
}

function createWeatherClient(options = {}) {
  const request = options.fetchText || fetchText, now = options.now || Date.now;
  const cache = new Map(), pending = new Map();
  async function getWeather(input) {
    const city = resolveCity(input && input.city);
    if (pending.has(city.id)) return { ...await pending.get(city.id), inputCity: input.city };
    const old = cache.get(city.id);
    if (!input.force && old && now() >= old.ts && now() - old.ts < 10 * 60000) return { ...old, inputCity: input.city };
    const promise = (async () => {
      const timestamp = now(), suffix = '?_=' + timestamp;
      const [current, forecast] = await Promise.allSettled([
        request('https://d1.weather.com.cn/sk_2d/' + city.id + '.html' + suffix),
        request('https://www.weather.com.cn/weather/' + city.id + '.shtml' + suffix)
      ]);
      if (current.status !== 'fulfilled') throw current.reason;
      const result = parseCurrent(current.value, city, now());
      result.inputCity = input.city; result.daily = null;
      try { if (forecast.status === 'fulfilled') result.daily = parseForecast(forecast.value); } catch (_) {}
      if (!result.daily || result.daily.length < 2) result.forecastNotice = '未来预报暂不可用';
      cache.set(city.id, result);
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      return result;
    })();
    pending.set(city.id, promise);
    try { return await promise; } finally { pending.delete(city.id); }
  }
  return { getWeather };
}

module.exports = { createWeatherClient, resolveCity, parseCurrent, parseForecast, observationTime };
