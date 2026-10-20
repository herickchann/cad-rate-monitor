'use strict';
const $ = id => document.getElementById(id);
const currencies = ['GBP', 'EUR', 'USD', 'JPY'];
const currencyNames = { GBP: 'British pound', EUR: 'Euro', USD: 'US dollar', JPY: 'Japanese yen' };
const symbols = { GBP: '£', EUR: '€', USD: 'US$', JPY: '¥' };
const money = (currency, amount, digits = currency === 'JPY' ? 0 : 2) => new Intl.NumberFormat('en-CA', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
const dayLabel = date => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const preferenceStorage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value)
};
const restored = CurrencyPreferences.read(preferenceStorage, currencies);
let data, enabled = restored.enabled, selected = restored.selected, settings = restored.settings;
let refreshTimer, audioContext, checkingAlerts = false, loading = false;
let lastCheckedAt = null;
let historyPage = 1;
let soundQueueUntil = 0, resumingSound = false;
const soundNodes = new Set();
const rangeTitles = {'1W':'The past week','1M':'The past month','3M':'The past 3 months','6M':'The past 6 months',YTD:'Year to date','1Y':'The past year',ALL:'All available history'};

function preferenceNote(canSave) {
  $('preference-note').textContent = canSave
    ? 'Remembered on this browser.'
    : 'Browser storage is unavailable; choices apply to this visit only.';
}

function savePreferences() {
  preferenceNote(CurrencyPreferences.save(preferenceStorage, enabled, selected, settings));
}

function applyPreferences() {
  if (!enabled.includes(selected)) selected = enabled[0] || null;
  for (const c of currencies) {
    const visible = enabled.includes(c);
    $('card-' + c).hidden = !visible;
    document.querySelector(`[data-toggle="${c}"]`).checked = visible;
    document.querySelector(`[data-currency="${c}"]`).hidden = !visible;
    document.querySelector(`[data-result-currency="${c}"]`).hidden = !visible;
  }
  applyCardOrder();
  document.querySelector('.rate-grid').dataset.count = String(enabled.length);
  $('empty-currencies').hidden = enabled.length > 0;
  for (const selector of ['.workspace', '.rate-note']) document.querySelector(selector).hidden = !enabled.length;
  document.querySelector('.history').hidden = !enabled.length || !settings.showHistory;
}


function isFresh(rate) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return (Date.parse(today + 'T12:00:00Z') - Date.parse(rate.date + 'T12:00:00Z')) / 86400000 <= 4;
}

function cashRate(currency) {
  const r = data?.vbce?.status === 'available' ? data.vbce.rates?.[currency] : null;
  return r && Number.isFinite(r.rate) && r.rate > 0 && Number.isFinite(Date.parse(r.updated_at)) ? r : null;
}
function currentRate(currency) {
  return settings.source === 'vbce' ? cashRate(currency) : data?.rates[currency];
}
function cashFresh(rate) {
  const age = rate ? Date.now() - Date.parse(rate.updated_at) : Infinity;
  return age >= -300000 && age <= 4 * 86400000;
}
function cashGood(currency, rate) {
  const target = settings.vbceTargets[currency];
  return cashFresh(rate) && target > 0 && rate.rate >= target;
}
const quoteTime = value => new Intl.DateTimeFormat('en-CA', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Vancouver'}).format(new Date(value));

function vancouverCalendar() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver', weekday: 'short'
  }).format(new Date());
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayName];
  // Unknown weekday → treat as Sunday so we never false-alarm “waiting”.
  return { today, weekday: Number.isInteger(weekday) ? weekday : 0 };
}

function convert() {
  if (!data) return;
  const input = $('amount');
  const amount = input.valueAsNumber;
  const valid = input.value.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1e9;
  $('amount-error').hidden = valid;
  input.setAttribute('aria-invalid', String(!valid));
  for (const c of currencies) {
    const rate = currentRate(c);
    $('convert-' + c).textContent = valid && rate ? money(c, amount * rate.rate) : '—';
  }
}

function rangeStart(range, lastDate) {
  if (range === 'ALL') return '0000-01-01';
  const start = new Date(lastDate + 'T12:00:00Z');
  if (range === '1W') start.setUTCDate(start.getUTCDate() - 7);
  else if (range === 'YTD') start.setUTCMonth(0, 1);
  else {
    const months = {'1M':1,'3M':3,'6M':6,'1Y':12}[range] || 3;
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
  }
  return start.toISOString().slice(0, 10);
}

function inRange(points, range, lastDate = points.at(-1)?.date) {
  if (!lastDate) return [];
  const first = rangeStart(range, lastDate);
  return points.filter(point => point.date >= first && point.date <= lastDate);
}

function chart() {
  if (!data || !selected) return;
  const r = data.rates[selected], points = inRange(r.history, settings.chartRange, r.date);
  $('chart-title').textContent = rangeTitles[settings.chartRange];
  for (const button of document.querySelectorAll('[data-chart-range]')) button.setAttribute('aria-pressed', String(button.dataset.chartRange === settings.chartRange));
  if (!points.length) { $('chart').replaceChildren(); $('chart-summary').textContent = 'No published rates in this period.'; return; }
  const periodHigh = Math.max(...points.map(p => p.rate));
  const periodAverage = points.reduce((sum, p) => sum + p.rate, 0) / points.length;
  const periodChange = (points.at(-1).rate / points[0].rate - 1) * 100;
  const svg = $('chart');
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    svg.appendChild(el);
    return el;
  };
  const width = 680, left = 49, right = 12, top = 19, bottom = 218;
  const values = points.map(p => p.rate);
  const low = Math.min(...values), high = Math.max(...values);
  const span = Math.max(high - low, high * .004);
  const min = low - span * .18, max = high + span * .18;
  const start = Date.parse(points[0].date), end = Date.parse(points.at(-1).date);
  const x = p => left + (Date.parse(p.date) - start) / Math.max(1, end - start) * (width - left - right);
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  add('title', {}, `${selected} per CAD: ${dayLabel(points[0].date)} to ${dayLabel(points.at(-1).date)}`);
  for (let i = 0; i < 4; i++) {
    const value = min + (max - min) * i / 3, yy = y(value);
    add('line', { x1: left, x2: width - right, y1: yy, y2: yy, stroke: 'var(--chart-grid)', 'stroke-width': 1 });
    add('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end', fill: 'var(--chart-label)', 'font-size': 10 }, value.toFixed(3));
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p.rate).toFixed(2)}`).join(' ');
  add('path', { d: path + ` L${x(points.at(-1))},${bottom} L${left},${bottom} Z`, fill: 'var(--chart-fill)', opacity: .7 });
  add('line', { x1: left, x2: width - right, y1: y(periodAverage), y2: y(periodAverage), stroke: 'var(--chart-average)', 'stroke-width': 1.4, 'stroke-dasharray': '5 5' });
  add('path', { d: path, fill: 'none', stroke: 'var(--chart-line)', 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  add('circle', { cx: x(points.at(-1)), cy: y(points.at(-1).rate), r: 4.5, fill: 'var(--chart-line)', stroke: 'var(--field)', 'stroke-width': 2 });
  const multiYear = points[0].date.slice(0, 4) !== points.at(-1).date.slice(0, 4);
  const shortDate = value => new Intl.DateTimeFormat('en-CA', { month: 'short', ...(multiYear ? {year:'numeric'} : {day:'numeric'}), timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
  add('text', { x: left, y: 240, fill: 'var(--chart-label)', 'font-size': 10 }, shortDate(points[0].date));
  add('text', { x: width - right, y: 240, 'text-anchor': 'end', fill: 'var(--chart-label)', 'font-size': 10 }, shortDate(points.at(-1).date));
  $('chart-summary').textContent = `${selected} ${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(2)}% · ${dayLabel(points[0].date)} – ${dayLabel(points.at(-1).date)}`;
  $('chart-high').textContent = money(selected, periodHigh, settings.precision);
  $('chart-average').textContent = money(selected, periodAverage, settings.precision);
  $('chart-comparison').textContent = `${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(2)}%`;
  for (const button of document.querySelectorAll('[data-currency]')) button.setAttribute('aria-pressed', String(button.dataset.currency === selected));
}

function renderHistory() {
  if (!data) return;
  const lastDate = enabled.map(c => data.rates[c].date).sort().at(-1);
  const start = lastDate ? rangeStart(settings.historyRange, lastDate) : '0000-01-01';
  const histories = Object.fromEntries(enabled.map(c => [c, data.rates[c].history]));
  const maps = Object.fromEntries(enabled.map(c => [c, Object.fromEntries(histories[c].map(p => [p.date, p.rate]))]));
  const days = [...new Set(enabled.flatMap(c => histories[c].map(p => p.date)))].filter(day => day >= start && day <= lastDate).sort().reverse();
  const pageCount = Math.max(1, Math.ceil(days.length / settings.pageSize));
  historyPage = Math.max(1, Math.min(historyPage, pageCount));
  const offset = (historyPage - 1) * settings.pageSize;
  const visibleDays = days.slice(offset, offset + settings.pageSize);
  const head = $('history-head'), heading = document.createElement('tr'); head.replaceChildren();
  for (const title of ['Rate date', ...enabled.map(c => currencyNames[c])]) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; heading.appendChild(cell);
  }
  head.appendChild(heading);
  const body = $('history-body'); body.replaceChildren();
  for (const day of visibleDays) {
    const row = document.createElement('tr');
    for (const text of [dayLabel(day), ...enabled.map(c => maps[c][day] === undefined ? '—' : money(c, maps[c][day], settings.precision))]) {
      const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
    }
    body.appendChild(row);
  }
  if (!visibleDays.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = enabled.length + 1; cell.textContent = 'No published rates in this period.'; row.appendChild(cell); body.appendChild(row);
  }
  $('history-caption').textContent = days.length ? `${dayLabel(days.at(-1))} – ${dayLabel(days[0])} · Foreign currency per CAD · Newest first` : 'Foreign currency per CAD · Newest first';
  $('history-count').textContent = days.length ? `${offset + 1}–${offset + visibleDays.length} of ${days.length.toLocaleString('en-CA')} rate days` : 'No rates to display';
  $('history-pagination').hidden = pageCount <= 1;
  $('history-previous').disabled = historyPage <= 1;
  $('history-next').disabled = historyPage >= pageCount;
  const pages = [...new Set([1, historyPage - 1, historyPage, historyPage + 1, pageCount])].filter(page => page >= 1 && page <= pageCount).sort((a,b) => a-b);
  const buttons = $('history-pages'); buttons.replaceChildren();
  let previous = 0;
  for (const page of pages) {
    if (previous && page > previous + 1) {
      const ellipsis = document.createElement('span'); ellipsis.textContent = '…'; ellipsis.setAttribute('aria-hidden','true'); buttons.appendChild(ellipsis);
    }
    const button = document.createElement('button'); button.type = 'button'; button.dataset.page = String(page); button.textContent = page;
    button.setAttribute('aria-label', `Go to page ${page}`);
    if (page === historyPage) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      historyPage = page; renderHistory(); $('history-pages').querySelector(`[data-page="${page}"]`)?.focus();
    });
    buttons.appendChild(button); previous = page;
  }
}

function render() {
  const cash = settings.source === 'vbce';
  const dates = [...new Set(Object.values(data.rates).map(r => r.date))].sort();
  const latestRateDate = dates.at(-1);
  const quotes = enabled.map(cashRate).filter(Boolean);
  const published = 'Published · ' + quoteTime(data.updated_at) + ' Vancouver';
  const { today, weekday } = vancouverCalendar();
  const waiting = !cash && RateDates.waitingForTodaysBocFixing(latestRateDate, today, weekday);
  $('source-title').textContent = cash ? 'VBCE travel-cash estimates' : 'Bank of Canada daily rates';
  $('rate-date').textContent = cash
    ? (quotes.length ? 'Quoted · ' + [...new Set(quotes.map(r => quoteTime(r.updated_at)))].join(' / ') + ' Vancouver' : 'Cash quotes currently unavailable')
    : (waiting
      ? 'Waiting for today’s Bank of Canada fixing · last rate date ' + dates.map(dayLabel).join(' / ')
      : 'Rate date · ' + dates.map(dayLabel).join(' / '));
  const publishEl = $('publish-date');
  publishEl.hidden = false;
  publishEl.textContent = published;
  $('source-description').textContent = cash
    ? 'CAD → foreign cash · VBCE sells · Cards and converter use this source.'
    : 'Daily market reference · Cards and converter use this source.';
  $('rate-note').textContent = cash
    ? 'VBCE cash estimates for smaller transactions. Confirm the rate and currency availability with VBCE. Charts and history below use Bank of Canada daily references.'
    : 'Daily averages, before fees and provider spreads. These are reference rates, not live transaction quotes.';
  $('converter-note').textContent = cash
    ? 'Estimated at VBCE’s selling price. Confirm your quote with VBCE; larger amounts may receive different pricing.'
    : 'Your provider’s fees and exchange spread will reduce the amount received.';
  const unavailable = cash && enabled.some(c => !cashRate(c));
  const stale = enabled.some(c => cash ? !cashFresh(cashRate(c)) : !isFresh(data.rates[c]));
  $('notice').hidden = !unavailable && !stale;
  $('notice').textContent = unavailable
    ? 'VBCE quotes could not be retrieved at the last publication. Cash conversions and cash alerts are unavailable; Bank of Canada history remains available.'
    : 'These quotes are more than four days old. Check the source before exchanging; alerts for stale data are paused.';
  for (const c of currencies) {
    const r = currentRate(c), fresh = cash ? cashFresh(r) : isFresh(r);
    const good = cash ? cashGood(c, r) : RateAlerts.favourable(r, settings);
    $('rate-' + c).textContent = r ? symbols[c] + r.rate.toFixed(settings.precision) : '—';
    $('example-' + c).textContent = r ? money(c, settings.amount * r.rate) : '—';
    document.querySelector('#card-' + c + ' .card-foot span').textContent = money('CAD', settings.amount, Number.isInteger(settings.amount) ? 0 : 2) + ' buys';
    $('change-' + c).textContent = cash
      ? (r ? `VBCE sells · C$${r.sell_cad.toFixed(c === 'JPY' ? 6 : 4)} per ${c}` : 'Cash quote unavailable')
      : `${r.daily_change_percent >= 0 ? '↑ +' : '↓ '}${r.daily_change_percent.toFixed(2)}% from previous rate day`;
    $('status-' + c).textContent = !r ? 'Unavailable' : !fresh ? 'Data stale' : good ? (cash ? 'Target met' : 'Favourable') : cash && !settings.vbceTargets[c] ? 'No target' : 'Watching';
    $('status-' + c).className = 'badge' + (fresh && good ? ' good' : '');
    let comparison = $('comparison-' + c);
    if (!comparison) {
      comparison = document.createElement('p'); comparison.id = 'comparison-' + c; comparison.className = 'card-comparison';
      $('change-' + c).after(comparison);
    }
    const other = cash ? data.rates[c] : cashRate(c);
    comparison.textContent = other
      ? `${cash ? 'BoC reference' : 'VBCE cash'}: ${money(c, other.rate, settings.precision)} / CAD · ${dayLabel(other.date)}`
      : 'VBCE cash comparison unavailable';
  }
  renderHistory();
  $('built-at').textContent = 'Last published · ' + quoteTime(data.updated_at) + ' Vancouver time';
  $('checked-at').textContent = lastCheckedAt
    ? 'Last checked on this device · ' + quoteTime(lastCheckedAt) + ' Vancouver time'
    : '';
  convert(); chart();
}

async function load(options = {}) {
  if (loading) return;
  loading = true;
  const button = $('refresh-now');
  const manual = options.manual === true;
  if (manual && button) {
    button.disabled = true;
    button.textContent = 'Refreshing…';
  }
  try {
    const response = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Rates unavailable');
    const next = await response.json();
    if (next.schema_version !== 1 || currencies.some(c => !next.rates?.[c]?.history?.length)) throw new Error('Invalid data');
    data = next;
    lastCheckedAt = Date.now();
    render();
    await checkAlerts();
  } catch (error) {
    $('notice').hidden = false;
    $('notice').textContent = data ? 'Could not refresh published rates. The last loaded rates remain visible; check their date before converting.' : 'Rates could not be loaded. Please refresh the page or use the official rate source below.';
    if (!data) {
      $('rate-date').textContent = 'Rate data currently unavailable';
      $('publish-date').hidden = true;
      $('checked-at').textContent = '';
      for (const c of currencies) $('status-' + c).textContent = 'Unavailable';
      $('chart-summary').textContent = 'Rate history is unavailable.';
      $('history-body').replaceChildren();
    }
  } finally {
    loading = false;
    if (button) {
      button.disabled = false;
      button.textContent = 'Refresh now';
    }
    alertStatus();
  }
}

function applyTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = settings.theme === 'system' ? (dark ? 'dark' : 'forest') : settings.theme;
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  const minutes = settings.refreshMinutes || (settings.sound || settings.notifications ? 15 : 0);
  if (minutes) refreshTimer = setInterval(load, minutes * 60 * 1000);
}

function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function alertStatus() {
  const active = settings.sound || settings.notifications;
  const soundReady = settings.sound && audioContext?.state === 'running';
  let label = 'Off', message = 'Alerts are off. Turn on sound alerts to get started.';
  if (active && !settings.notifyCurrencies.length) {
    label = 'Choose'; message = 'Choose at least one currency below to receive alerts.';
  } else if (active) {
    if (settings.sound && !soundReady) {
      label = 'Resume'; message = 'Sound needs to be resumed. Click Turn on sound alerts below.';
    } else if (soundReady || (settings.notifications && notificationPermission() === 'granted')) {
      label = 'On'; message = `Watching ${settings.source === 'vbce' ? 'VBCE cash targets' : 'Bank of Canada'} · ${settings.notifyCurrencies.join(', ')}. ${soundReady ? 'Sound is ready.' : 'Desktop notifications are enabled.'} Keep this page open.`;
    } else {
      label = 'Blocked'; message = 'Notification permission is blocked. Turn on sound alerts or allow notifications in your browser.';
    }
    if (!navigator.onLine) { label = 'Offline'; message = 'You are offline. Alerts will resume when your connection returns; keep this page open.'; }
    else if (!data) { label = 'Waiting'; message = 'Waiting for rate data. Keep this page open; alerts start when fresh rates are available.'; }
    else if (data && settings.notifyCurrencies.every(c => settings.source === 'vbce' ? !cashFresh(cashRate(c)) : !isFresh(data.rates[c]))) { label = 'Waiting'; message = 'Waiting for fresh published rates. Old rates cannot trigger an alert.'; }
  }
  if (active && data && settings.source === 'vbce' && settings.notifyCurrencies.length && !settings.notifyCurrencies.some(c => settings.vbceTargets[c] > 0)) { label = 'Choose'; message = 'Set at least one VBCE cash target below. Alerts follow the source selected at the top of the page.'; }
  $('alerts-state').textContent = label;
  $('open-alerts').dataset.active = String(label === 'On');
  $('alert-status').textContent = message;
  $('enable-audio').textContent = soundReady ? 'Sound alerts are on' : 'Turn on sound alerts';
  $('enable-audio').disabled = soundReady;
  $('pause-alerts').disabled = !active;
  $('volume-value').textContent = Math.round(settings.volume * 100) + '%';
}

async function armSound() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio unavailable');
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new Audio();
      audioContext.addEventListener('statechange', alertStatus);
    }
    await audioContext.resume();
    return audioContext.state === 'running';
  } catch { return false; }
}

function stopSound() {
  for (const node of soundNodes) { try { node.stop(); } catch {} }
  soundNodes.clear(); soundQueueUntil = 0;
  if (audioContext) audioContext.suspend();
}

function playSound() {
  if (audioContext?.state !== 'running') return false;
  const beginning = Math.max(audioContext.currentTime, soundQueueUntil);
  for (let i = 0; i < 5; i++) {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const start = beginning + i * .6;
    oscillator.frequency.value = i % 2 ? 880 : 660;
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(.3 * settings.volume, start + .025);
    gain.gain.exponentialRampToValueAtTime(.001, start + .35);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    soundNodes.add(oscillator);
    oscillator.start(start); oscillator.stop(start + .4);
    oscillator.onended = () => { soundNodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }
  soundQueueUntil = beginning + 3;
  return true;
}

async function enableSoundAlerts() {
  const ready = await armSound();
  settings.sound = ready;
  changedSettings();
  if (ready) { playSound(); checkAlerts(); }
  else $('alert-status').textContent = 'Sound could not start. Check this site’s audio permission and your device volume, then try again.';
}

function alertHistoryKey() { return settings.source === 'vbce' ? 'cad-rate-monitor.alerts.vbce.v1' : 'cad-rate-monitor.alerts.v1'; }
function readAlertHistory() {
  try {
    const raw = JSON.parse(preferenceStorage.getItem(alertHistoryKey()));
    const result = {};
    for (const c of currencies) {
      const value = raw?.[c];
      if (Number.isFinite(value?.rate) && value.rate > 0 && Number.isFinite(value?.time) && /^\d{4}-\d{2}-\d{2}$/.test(value?.date)) result[c] = value;
    }
    return result;
  } catch { return {}; }
}
let sessionAlertHistory = {};
function persistAlertHistory(history) {
  sessionAlertHistory[settings.source] = history;
  try { preferenceStorage.setItem(alertHistoryKey(), JSON.stringify(history)); }
  catch { preferenceNote(false); }
}

async function deliverAlert(body, tag) {
  return RateAlerts.deliver(settings, notificationPermission(), () => {
    const notification = new Notification('CADar', { body, tag, icon: './cadar-icon.png' });
    notification.onclick = () => { window.focus(); notification.close(); };
    notification.onerror = () => { $('alert-status').textContent = 'The browser could not display the desktop notification. Sound may still work.'; };
    return true;
  }, playSound);
}

async function checkAlerts() {
  if (!data || checkingAlerts || (!settings.notifications && !settings.sound)) return;
  checkingAlerts = true;
  const check = async () => {
    const source = settings.source;
    const history = { ...sessionAlertHistory[source], ...readAlertHistory() };
    const now = Date.now();
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    for (const c of currencies) {
      if (source !== settings.source) break;
      const r = currentRate(c), cash = source === 'vbce', previous = history[c];
      if (cash) {
        if (!settings.notifyCurrencies.includes(c) || !cashGood(c, r)) continue;
        if (previous?.quote === r.updated_at && previous?.rate === r.rate) continue;
        if (previous?.target === settings.vbceTargets[c] && now - previous.time < settings.reminderDays * 86400000 && r.rate < previous.rate * 1.01) continue;
      } else if (!RateAlerts.eligible(c, r, previous, settings, today, now)) continue;
      const body = cash
        ? `VBCE cash target met · ${c}: C$${settings.amount.toLocaleString('en-CA')} buys about ${money(c, settings.amount * r.rate)}. Quote ${quoteTime(r.updated_at)} Vancouver; confirm with VBCE.`
        : `Bank of Canada · ${c} is favourable: ${money('CAD', settings.amount)} buys about ${money(c, settings.amount * r.rate)}, before fees.`;
      if (await deliverAlert(body, 'cadar-' + source + '-' + c)) {
        if (source !== settings.source) break;
        history[c] = { date: r.date, rate: r.rate, time: now, ...(cash ? {quote:r.updated_at, target:settings.vbceTargets[c]} : {}) };
        persistAlertHistory(history);
        $('alert-banner').hidden = false; $('alert-banner').textContent = body;
      }
    }
  };
  try {
    if (navigator.locks?.request) await navigator.locks.request('cad-rate-monitor-alerts', check);
    else await check();
  } finally { checkingAlerts = false; }
}

function initializeSettings() {
  $('rate-source').value = settings.source;
  for (const c of currencies) $('target-' + c).value = settings.vbceTargets[c] || '';
  $('alert-source-note').textContent = 'Currently watching: ' + (settings.source === 'vbce' ? 'VBCE travel cash targets.' : 'Bank of Canada history rules.') + ' Change the source at the top of the page.';
  for (const [id, value] of Object.entries({theme:settings.theme,amount:settings.amount,precision:settings.precision,refresh:settings.refreshMinutes,volume:settings.volume * 100,'near-high':settings.nearHigh,'above-average':settings.aboveAverage,reminder:settings.reminderDays})) $('setting-' + id).value = value;
  for (const [id, value] of Object.entries({history:settings.showHistory,notifications:settings.notifications,sound:settings.sound})) $('setting-' + id).checked = value;
  for (const c of currencies) document.querySelector(`[data-notify="${c}"]`).checked = settings.notifyCurrencies.includes(c);
  $('amount').value = settings.amount;
  $('history-range').value = settings.historyRange;
  $('history-page-size').value = settings.pageSize;
  window.refreshCustomDropdowns?.();
  window.refreshCustomSteppers?.();
  $('rule-near-high').textContent = settings.nearHigh;
  $('rule-above-average').textContent = settings.aboveAverage;
  applyTheme(); applyPreferences(); scheduleRefresh(); alertStatus();
}

function changedSettings() {
  savePreferences(); initializeSettings(); if (data) { render(); checkAlerts(); }
}

$('rate-source').addEventListener('change', event => {
  settings.source = event.target.value; $('alert-banner').hidden = true; changedSettings();
});
for (const input of document.querySelectorAll('[data-vbce-target]')) input.addEventListener('change', () => {
  if (!input.checkValidity()) { input.reportValidity(); return; }
  settings.vbceTargets[input.dataset.vbceTarget] = input.value.trim() ? input.valueAsNumber : 0;
  changedSettings();
});
$('amount').addEventListener('input', () => {
  convert();
  const amount = $('amount').valueAsNumber;
  if ($('amount').value.trim() && Number.isFinite(amount) && amount >= 0 && amount <= 1e9) {
    settings.amount = amount; $('setting-amount').value = amount;
    savePreferences(); if (data) render();
  }
});
for (const button of document.querySelectorAll('[data-currency]')) button.addEventListener('click', () => {
  selected = button.dataset.currency; savePreferences(); chart();
});
for (const toggle of document.querySelectorAll('[data-toggle]')) toggle.addEventListener('change', () => {
  enabled = currencies.filter(c => document.querySelector(`[data-toggle="${c}"]`).checked);
  historyPage = 1;
  applyPreferences(); savePreferences(); if (data) render();
});
for (const toggle of document.querySelectorAll('[data-notify]')) toggle.addEventListener('change', () => {
  settings.notifyCurrencies = currencies.filter(c => document.querySelector(`[data-notify="${c}"]`).checked);
  changedSettings();
});
for (const [id, key] of Object.entries({theme:'theme',amount:'amount',precision:'precision',refresh:'refreshMinutes','near-high':'nearHigh','above-average':'aboveAverage',reminder:'reminderDays'})) $('setting-' + id).addEventListener('change', event => {
  if (!event.target.checkValidity()) { event.target.reportValidity(); return; }
  const value = id === 'theme' ? event.target.value : Number(event.target.value);
  settings = CurrencyPreferences.settings({ ...settings, [key]: value }, currencies);
  changedSettings();
});
// Save valid numeric edits immediately; a user can leave a field without blurring it first.
for (const [id, key] of Object.entries({amount:'amount','near-high':'nearHigh','above-average':'aboveAverage'})) $('setting-' + id).addEventListener('input', event => {
  if (!event.target.value.trim() || !event.target.checkValidity()) return;
  settings = CurrencyPreferences.settings({ ...settings, [key]: Number(event.target.value) }, currencies);
  if (id === 'amount') $('amount').value = settings.amount;
  $('rule-near-high').textContent = settings.nearHigh;
  $('rule-above-average').textContent = settings.aboveAverage;
  savePreferences(); if (data) { render(); checkAlerts(); }
});
for (const [id, key] of Object.entries({history:'showHistory'})) $('setting-' + id).addEventListener('change', event => { settings[key] = event.target.checked; changedSettings(); });
$('setting-volume').addEventListener('input', event => { settings.volume = Number(event.target.value) / 100; savePreferences(); alertStatus(); });
$('setting-sound').addEventListener('change', async event => {
  if (event.target.checked) await enableSoundAlerts();
  else { settings.sound = false; stopSound(); changedSettings(); }
});
$('setting-notifications').addEventListener('change', async event => {
  const requested = event.target.checked;
  settings.notifications = false;
  if (requested && 'Notification' in window) {
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      settings.notifications = permission === 'granted';
    } catch {}
  }
  changedSettings();
  if (requested && !settings.notifications) $('alert-status').textContent = 'Desktop notifications are unavailable or blocked. You can enable sound instead, or change this site’s browser notification permission.';
});
$('enable-audio').addEventListener('click', enableSoundAlerts);
$('test-alert').addEventListener('click', async () => {
  if (await armSound()) {
    playSound();
    $('alert-status').textContent = 'Sample playing: five chimes. If you cannot hear them, check your device volume and whether this tab is muted.';
  } else $('alert-status').textContent = 'Sound could not start. Check your browser audio permission and device volume, then try again.';
});
$('pause-alerts').addEventListener('click', () => {
  settings.sound = false; settings.notifications = false; stopSound();
  changedSettings();
});
$('refresh-now').addEventListener('click', () => load({ manual: true }));
$('reset-settings').addEventListener('click', () => {
  enabled = [...currencies]; selected = currencies[0]; settings = CurrencyPreferences.defaultSettings(currencies); historyPage = 1;
  $('alert-banner').hidden = true; stopSound(); changedSettings();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });
preferenceNote(restored.canSave);
initializeSettings();
document.addEventListener('visibilitychange', () => { alertStatus(); if (!document.hidden && (settings.refreshMinutes || settings.sound || settings.notifications)) load(); });
window.addEventListener('online', () => { alertStatus(); load(); });
window.addEventListener('offline', alertStatus);
load();

const settingsDialog = $('settings-dialog');
function openSettings() {
  if (!settingsDialog.open) settingsDialog.showModal();
  document.body.classList.add('settings-open');
  $('open-settings').setAttribute('aria-expanded', 'true');
}
$('open-settings').addEventListener('click', openSettings);
$('empty-open-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('close', () => {
  document.body.classList.remove('settings-open');
  $('open-settings').setAttribute('aria-expanded', 'false');
  $('open-settings').focus();
});
settingsDialog.addEventListener('click', event => {
  if (event.target !== settingsDialog) return;
  const bounds = settingsDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) settingsDialog.close();
});

for (const button of document.querySelectorAll('[data-chart-range]')) button.addEventListener('click', () => {
  settings.chartRange = button.dataset.chartRange; savePreferences(); chart();
});
$('history-range').addEventListener('change', event => {
  settings.historyRange = event.target.value; historyPage = 1; savePreferences(); renderHistory();
});
$('history-page-size').addEventListener('change', event => {
  settings.pageSize = Number(event.target.value); historyPage = 1; savePreferences(); renderHistory();
});
$('history-previous').addEventListener('click', () => { historyPage--; renderHistory(); });
$('history-next').addEventListener('click', () => { historyPage++; renderHistory(); });

for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, async event => {
  if (!event.isTrusted || !settings.sound || audioContext?.state === 'running' || resumingSound) return;
  // Alert controls handle their own activation and sample, avoiding duplicate alarms.
  if (event.target.closest?.('#enable-audio, #test-alert, #pause-alerts, #setting-sound, #reset-settings')) return;
  resumingSound = true;
  try { if (await armSound()) { alertStatus(); checkAlerts(); } }
  finally { resumingSound = false; }
});
const alertsDialog = $('alerts-dialog');
function openAlerts() {
  if (!alertsDialog.open) alertsDialog.showModal();
  document.body.classList.add('settings-open');
  $('open-alerts').setAttribute('aria-expanded', 'true');
  alertStatus();
}
$('open-alerts').addEventListener('click', openAlerts);
$('converter-open-alerts').addEventListener('click', openAlerts);
$('close-alerts').addEventListener('click', () => alertsDialog.close());
alertsDialog.addEventListener('close', () => {
  document.body.classList.remove('settings-open');
  $('open-alerts').setAttribute('aria-expanded', 'false');
  $('open-alerts').focus();
});
alertsDialog.addEventListener('click', event => {
  if (event.target !== alertsDialog) return;
  const bounds = alertsDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) alertsDialog.close();
});

function applyCardOrder() {
  const grid = document.querySelector('.rate-grid');
  for (const c of settings.cardOrder) grid.appendChild($('card-' + c));
}
function announceCardOrder(currency, saved) {
  const visible = settings.cardOrder.filter(c => enabled.includes(c));
  $('card-order-status').textContent = `${currencyNames[currency]} moved to position ${visible.indexOf(currency) + 1} of ${visible.length}. ${saved ? 'Order saved.' : 'Browser storage is unavailable; order applies to this visit only.'}`;
}
function moveCard(currency, target) {
  const order = [...settings.cardOrder];
  order.splice(order.indexOf(currency), 1);
  order.splice(target, 0, currency);
  settings.cardOrder = order;
  applyCardOrder();
}
let cardDrag;
for (const handle of document.querySelectorAll('[data-move]')) {
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || cardDrag) return;
    event.preventDefault();
    const currency = handle.dataset.move;
    const visible = settings.cardOrder.filter(c => enabled.includes(c));
    const index = visible.indexOf(currency);
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1)));
    if (destination === index) return;
    moveCard(currency, settings.cardOrder.indexOf(visible[destination]));
    handle.focus({preventScroll:true});
    const saved = CurrencyPreferences.save(preferenceStorage, enabled, selected, settings);
    preferenceNote(saved); announceCardOrder(currency, saved);
  });
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || cardDrag) return;
    const card = handle.closest('.rate-card');
    cardDrag = {handle, card, currency:handle.dataset.move, pointer:event.pointerId, x:event.clientX, y:event.clientY, original:[...settings.cardOrder], started:false};
    handle.setPointerCapture(event.pointerId);
  });
}
window.addEventListener('pointermove', event => {
  const drag = cardDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  if (!drag.started) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.started = true;
    drag.card.classList.add('is-dragging'); document.body.classList.add('reordering-cards');
  }
  event.preventDefault();
  drag.clientX = event.clientX; drag.clientY = event.clientY;
  if (!drag.scrollFrame) drag.scrollFrame = requestAnimationFrame(scrollCardDrag);
  updateCardDrag(event.clientX, event.clientY);
}, {passive:false});
function updateCardDrag(x, y) {
  const drag = cardDrag;
  if (!drag?.started) return;
  const target = document.elementFromPoint(x, y)?.closest('.rate-card');
  if (!target || target === drag.card || target.hidden || !target.closest('.rate-grid')) return;
  const targetCurrency = target.id.slice(5);
  const from = settings.cardOrder.indexOf(drag.currency), to = settings.cardOrder.indexOf(targetCurrency);
  const bounds = target.getBoundingClientRect(), origin = drag.card.getBoundingClientRect();
  const sameRow = Math.abs(bounds.top - origin.top) < bounds.height / 2;
  const passedMiddle = sameRow ? x > bounds.left + bounds.width / 2 : y > bounds.top + bounds.height / 2;
  if ((to > from && !passedMiddle) || (to < from && passedMiddle)) return;
  moveCard(drag.currency, to);
  drag.handle.setPointerCapture(drag.pointer);
}
function scrollCardDrag() {
  const drag = cardDrag;
  if (!drag?.started) return;
  const edge = 65;
  const amount = drag.clientY < edge ? -12 : drag.clientY > window.innerHeight - edge ? 12 : 0;
  if (amount) { window.scrollBy(0, amount); updateCardDrag(drag.clientX, drag.clientY); }
  drag.scrollFrame = requestAnimationFrame(scrollCardDrag);
}
function finishCardDrag(cancelled = false) {
  const drag = cardDrag;
  if (!drag) return;
  cardDrag = null;
  if (drag.scrollFrame) cancelAnimationFrame(drag.scrollFrame);
  if (drag.handle.hasPointerCapture(drag.pointer)) drag.handle.releasePointerCapture(drag.pointer);
  drag.card.classList.remove('is-dragging'); document.body.classList.remove('reordering-cards');
  if (cancelled) { settings.cardOrder = drag.original; applyCardOrder(); }
  else if (drag.started) {
    const saved = CurrencyPreferences.save(preferenceStorage, enabled, selected, settings);
    preferenceNote(saved); announceCardOrder(drag.currency, saved);
  }
  drag.handle.focus({preventScroll:true});
}
window.addEventListener('pointerup', event => { if (cardDrag?.pointer === event.pointerId) finishCardDrag(); });
window.addEventListener('pointercancel', event => { if (cardDrag?.pointer === event.pointerId) finishCardDrag(true); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && cardDrag) { event.preventDefault(); finishCardDrag(true); } });
window.addEventListener('blur', () => { if (cardDrag) finishCardDrag(true); });
