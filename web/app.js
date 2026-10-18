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
let historyPage = 1;
const rangeTitles = {'1W':'The past week','1M':'The past month','3M':'The past 3 months','6M':'The past 6 months',YTD:'Year to date','1Y':'The past year',ALL:'All available history'};

function preferenceNote(canSave) {
  $('preference-note').textContent = canSave
    ? 'Remembered on this browser. Mac sound-alert settings are separate.'
    : 'Browser storage is unavailable; choices apply to this visit only. Mac sound-alert settings are separate.';
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
  document.querySelector('.rate-grid').dataset.count = String(enabled.length);
  $('empty-currencies').hidden = enabled.length > 0;
  for (const selector of ['.workspace', '.rate-note']) document.querySelector(selector).hidden = !enabled.length;
  document.querySelector('.history').hidden = !enabled.length || !settings.showHistory;
}


function isFresh(rate) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return (Date.parse(today + 'T12:00:00Z') - Date.parse(rate.date + 'T12:00:00Z')) / 86400000 <= 4;
}

function convert() {
  if (!data) return;
  const input = $('amount');
  const amount = input.valueAsNumber;
  const valid = input.value.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 1e9;
  $('amount-error').hidden = valid;
  input.setAttribute('aria-invalid', String(!valid));
  for (const c of currencies) $('convert-' + c).textContent = valid ? money(c, amount * data.rates[c].rate) : '—';
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
  const dates = [...new Set(Object.values(data.rates).map(r => r.date))];
  $('rate-date').textContent = 'Rate date · ' + dates.map(dayLabel).join(' / ');
  const stale = enabled.some(c => !isFresh(data.rates[c]));
  $('notice').hidden = !stale;
  $('notice').textContent = 'These rates are more than four days old. Check the official source before converting; favourable-rate signals are paused.';
  for (const c of currencies) {
    const r = data.rates[c], fresh = isFresh(r), good = RateAlerts.favourable(r, settings);
    $('rate-' + c).textContent = symbols[c] + r.rate.toFixed(settings.precision);
    $('example-' + c).textContent = money(c, settings.amount * r.rate);
    document.querySelector('#card-' + c + ' .card-foot span').textContent = 'CAD ' + money('CAD', settings.amount, Number.isInteger(settings.amount) ? 0 : 2) + ' buys';
    $('change-' + c).textContent = `${r.daily_change_percent >= 0 ? '↑ +' : '↓ '}${r.daily_change_percent.toFixed(2)}% from previous rate day`;
    $('status-' + c).textContent = !fresh ? 'Data stale' : good ? 'Favourable' : 'Watching';
    $('status-' + c).className = 'badge' + (fresh && good ? ' good' : '');
  }
  renderHistory();
  $('built-at').textContent = 'Last published · ' + new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' }).format(new Date(data.updated_at)) + ' Vancouver time';
  convert(); chart();
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch('./data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Rates unavailable');
    const next = await response.json();
    if (next.schema_version !== 1 || currencies.some(c => !next.rates?.[c]?.history?.length)) throw new Error('Invalid data');
    data = next; render(); await checkAlerts();
  } catch (error) {
    $('notice').hidden = false;
    $('notice').textContent = data ? 'Could not refresh the page. The last loaded rates remain visible; check their date before converting.' : 'Rates could not be loaded. Please refresh the page or use the official rate source below.';
    if (!data) {
      $('rate-date').textContent = 'Rate data currently unavailable';
      for (const c of currencies) $('status-' + c).textContent = 'Unavailable';
      $('chart-summary').textContent = 'Rate history is unavailable.';
      $('history-body').replaceChildren();
    }
  } finally { loading = false; }
}

function applyTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = settings.theme === 'system' ? (dark ? 'dark' : 'forest') : settings.theme;
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  if (settings.refreshMinutes) refreshTimer = setInterval(load, settings.refreshMinutes * 60 * 1000);
}

function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function alertStatus() {
  const parts = [];
  if (!settings.notifyCurrencies.length) parts.push('No currencies selected for alerts.');
  if (settings.notifications) parts.push(notificationPermission() === 'granted' ? 'Desktop notifications enabled.' : 'Desktop notification permission is missing or blocked.');
  if (settings.sound) parts.push(audioContext?.state === 'running' ? 'Sound is enabled for this visit.' : 'Enable sound for this visit to hear saved sound alerts.');
  if (!settings.notifications && !settings.sound) parts.push('Browser alerts are off. Choose a delivery option above.');
  $('alert-status').textContent = parts.join(' ');
}

async function armSound() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio unavailable');
    audioContext ||= new Audio();
    await audioContext.resume();
    settings.sound = true;
    $('setting-sound').checked = true;
    savePreferences(); alertStatus();
    return audioContext.state === 'running';
  } catch {
    $('alert-status').textContent = 'This browser could not enable sound. Check its audio permissions and your output device.';
    return false;
  }
}

function playSound() {
  if (audioContext?.state !== 'running') return false;
  for (let i = 0; i < 2; i++) {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const start = audioContext.currentTime + i * .35;
    oscillator.frequency.value = i ? 880 : 660;
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(.18 * settings.volume, start + .02);
    gain.gain.exponentialRampToValueAtTime(.001, start + .22);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start + .24);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  return true;
}

function readAlertHistory() {
  try {
    const raw = JSON.parse(preferenceStorage.getItem('cad-rate-monitor.alerts.v1'));
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
  sessionAlertHistory = history;
  try { preferenceStorage.setItem('cad-rate-monitor.alerts.v1', JSON.stringify(history)); }
  catch { preferenceNote(false); }
}

async function deliverAlert(body, tag) {
  return RateAlerts.deliver(settings, notificationPermission(), () => {
    const notification = new Notification('CAD rate monitor', { body, tag, icon: './icon.svg' });
    notification.onclick = () => { window.focus(); notification.close(); };
    notification.onerror = () => { $('alert-status').textContent = 'The browser could not display the desktop notification. Sound may still work.'; };
    return true;
  }, playSound);
}

async function checkAlerts() {
  if (!data || checkingAlerts || (!settings.notifications && !settings.sound)) return;
  checkingAlerts = true;
  const check = async () => {
    const history = { ...sessionAlertHistory, ...readAlertHistory() };
    const now = Date.now();
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    for (const c of currencies) {
      const r = data.rates[c];
      if (!RateAlerts.eligible(c, r, history[c], settings, today, now)) continue;
      const body = `${c} is favourable: CAD ${money('CAD', settings.amount)} buys about ${money(c, settings.amount * r.rate)}, before fees.`;
      if (await deliverAlert(body, 'cad-rate-monitor-' + c)) {
        history[c] = { date: r.date, rate: r.rate, time: now };
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
  for (const [id, value] of Object.entries({theme:settings.theme,amount:settings.amount,precision:settings.precision,refresh:settings.refreshMinutes,volume:settings.volume * 100,'near-high':settings.nearHigh,'above-average':settings.aboveAverage,reminder:settings.reminderDays})) $('setting-' + id).value = value;
  for (const [id, value] of Object.entries({history:settings.showHistory,notifications:settings.notifications,sound:settings.sound,'mac-speech':settings.macSpeech})) $('setting-' + id).checked = value;
  for (const c of currencies) document.querySelector(`[data-notify="${c}"]`).checked = settings.notifyCurrencies.includes(c);
  $('amount').value = settings.amount;
  $('history-range').value = settings.historyRange;
  $('history-page-size').value = settings.pageSize;
  $('rule-near-high').textContent = settings.nearHigh;
  $('rule-above-average').textContent = settings.aboveAverage;
  applyTheme(); applyPreferences(); scheduleRefresh(); alertStatus();
}

function changedSettings() {
  savePreferences(); initializeSettings(); if (data) { render(); checkAlerts(); }
}

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
for (const [id, key] of Object.entries({history:'showHistory','mac-speech':'macSpeech'})) $('setting-' + id).addEventListener('change', event => { settings[key] = event.target.checked; changedSettings(); });
$('setting-volume').addEventListener('input', event => { settings.volume = Number(event.target.value) / 100; savePreferences(); });
$('setting-sound').addEventListener('change', async event => {
  settings.sound = event.target.checked;
  if (settings.sound) await armSound();
  changedSettings();
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
$('enable-audio').addEventListener('click', async () => { if (await armSound()) checkAlerts(); });
$('test-alert').addEventListener('click', async () => {
  if (settings.sound) await armSound();
  const delivered = await deliverAlert('This is a test of your CAD rate alert.', 'cad-rate-monitor-test');
  $('alert-status').textContent = delivered ? 'Test alert requested. Check your sound output and notification centre.' : 'Turn on desktop notifications or enable sound for this visit, then test again.';
});
$('refresh-now').addEventListener('click', load);
$('download-mac-settings').addEventListener('click', () => {
  const file = new Blob([JSON.stringify(RateAlerts.macSettings(settings), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = 'cad-rate-monitor-settings.json'; ($('settings-dialog').open ? $('settings-dialog') : document.body).appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('reset-settings').addEventListener('click', () => {
  enabled = [...currencies]; selected = currencies[0]; settings = CurrencyPreferences.defaultSettings(currencies); historyPage = 1;
  $('alert-banner').hidden = true; changedSettings();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });
preferenceNote(restored.canSave);
initializeSettings();
document.addEventListener('visibilitychange', () => { if (!document.hidden && settings.refreshMinutes) load(); });
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
