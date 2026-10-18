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
let data, enabled = restored.enabled, selected = restored.selected;

function preferenceNote(canSave) {
  $('preference-note').textContent = canSave
    ? 'Remembered on this browser. Mac sound-alert settings are separate.'
    : 'Browser storage is unavailable; choices apply to this visit only. Mac sound-alert settings are separate.';
}

function savePreferences() {
  preferenceNote(CurrencyPreferences.save(preferenceStorage, enabled, selected));
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
  for (const selector of ['.workspace', '.history', '.rate-note']) document.querySelector(selector).hidden = !enabled.length;
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

function chart() {
  if (!data || !selected) return;
  const r = data.rates[selected], points = r.history;
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
  const values = points.map(p => p.rate).concat(r.average30);
  const low = Math.min(...values), high = Math.max(...values);
  const span = Math.max(high - low, high * .004);
  const min = low - span * .18, max = high + span * .18;
  const start = Date.parse(points[0].date), end = Date.parse(points.at(-1).date);
  const x = p => left + (Date.parse(p.date) - start) / Math.max(1, end - start) * (width - left - right);
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  add('title', {}, `${selected} per CAD over the last 90 calendar days`);
  for (let i = 0; i < 4; i++) {
    const value = min + (max - min) * i / 3, yy = y(value);
    add('line', { x1: left, x2: width - right, y1: yy, y2: yy, stroke: '#e1e7dc', 'stroke-width': 1 });
    add('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end', fill: '#687b6e', 'font-size': 10 }, value.toFixed(3));
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p.rate).toFixed(2)}`).join(' ');
  add('path', { d: path + ` L${x(points.at(-1))},${bottom} L${left},${bottom} Z`, fill: '#e7efdd', opacity: .7 });
  add('line', { x1: left, x2: width - right, y1: y(r.average30), y2: y(r.average30), stroke: '#8c9a88', 'stroke-width': 1.4, 'stroke-dasharray': '5 5' });
  add('path', { d: path, fill: 'none', stroke: '#297658', 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  add('circle', { cx: x(points.at(-1)), cy: y(r.rate), r: 4.5, fill: '#163e35', stroke: '#fff', 'stroke-width': 2 });
  const shortDate = value => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
  add('text', { x: left, y: 240, fill: '#687b6e', 'font-size': 10 }, shortDate(points[0].date));
  add('text', { x: width - right, y: 240, 'text-anchor': 'end', fill: '#687b6e', 'font-size': 10 }, shortDate(points.at(-1).date));
  const distance = (1 - r.rate / r.high90) * 100;
  $('chart-summary').textContent = distance < .005 ? `${selected} is at its best observed rate in this period.` : `${selected} is ${distance.toFixed(2)}% below its 90-day best.`;
  $('chart-high').textContent = money(selected, r.high90, 4);
  $('chart-average').textContent = money(selected, r.average30, 4);
  $('chart-comparison').textContent = `${r.above_average_percent >= 0 ? '+' : ''}${r.above_average_percent.toFixed(2)}%`;
  for (const button of document.querySelectorAll('[data-currency]')) button.setAttribute('aria-pressed', String(button.dataset.currency === selected));
}

function render() {
  const dates = [...new Set(Object.values(data.rates).map(r => r.date))];
  $('rate-date').textContent = 'Rate date · ' + dates.map(dayLabel).join(' / ');
  const stale = enabled.some(c => !isFresh(data.rates[c]));
  $('notice').hidden = !stale;
  $('notice').textContent = 'These rates are more than four days old. Check the official source before converting; favourable-rate signals are paused.';
  for (const c of currencies) {
    const r = data.rates[c], fresh = isFresh(r);
    $('rate-' + c).textContent = symbols[c] + r.rate.toFixed(4);
    $('example-' + c).textContent = money(c, 1000 * r.rate);
    $('change-' + c).textContent = `${r.daily_change_percent >= 0 ? '↑ +' : '↓ '}${r.daily_change_percent.toFixed(2)}% from previous rate day`;
    $('status-' + c).textContent = !fresh ? 'Data stale' : r.good ? 'Favourable' : 'Watching';
    $('status-' + c).className = 'badge' + (fresh && r.good ? ' good' : '');
  }
  const recent = Object.fromEntries(enabled.map(c => [c, Object.fromEntries(data.rates[c].recent)]));
  const days = [...new Set(enabled.flatMap(c => data.rates[c].recent.map(p => p[0])))].sort().reverse().slice(0, 10);
  const head = $('history-head'), heading = document.createElement('tr'); head.replaceChildren();
  for (const title of ['Rate date', ...enabled.map(c => currencyNames[c])]) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; heading.appendChild(cell);
  }
  head.appendChild(heading);
  const body = $('history-body'); body.replaceChildren();
  for (const day of days) {
    const row = document.createElement('tr');
    for (const text of [dayLabel(day), ...enabled.map(c => recent[c][day] === undefined ? '—' : money(c, recent[c][day], 4))]) {
      const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
    }
    body.appendChild(row);
  }
  $('built-at').textContent = 'Last published · ' + new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' }).format(new Date(data.updated_at)) + ' Vancouver time';
  convert(); chart();
}

async function load() {
  try {
    const response = await fetch('./data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Rates unavailable');
    const next = await response.json();
    if (next.schema_version !== 1 || currencies.some(c => !next.rates?.[c]?.history?.length)) throw new Error('Invalid data');
    data = next; render();
  } catch (error) {
    $('notice').hidden = false;
    $('notice').textContent = data ? 'Could not refresh the page. The last loaded rates remain visible; check their date before converting.' : 'Rates could not be loaded. Please refresh the page or use the official rate source below.';
    if (!data) {
      $('rate-date').textContent = 'Rate data currently unavailable';
      for (const c of currencies) $('status-' + c).textContent = 'Unavailable';
      $('chart-summary').textContent = 'Rate history is unavailable.';
      $('history-body').firstElementChild.firstElementChild.textContent = 'Rate history is unavailable.';
    }
  }
}
$('amount').addEventListener('input', convert);
for (const button of document.querySelectorAll('[data-currency]')) button.addEventListener('click', () => {
  selected = button.dataset.currency; savePreferences(); chart();
});
for (const toggle of document.querySelectorAll('[data-toggle]')) toggle.addEventListener('change', () => {
  enabled = currencies.filter(c => document.querySelector(`[data-toggle="${c}"]`).checked);
  applyPreferences(); savePreferences(); if (data) render();
});
preferenceNote(restored.canSave);
applyPreferences();
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(load, 15 * 60 * 1000);
load();
