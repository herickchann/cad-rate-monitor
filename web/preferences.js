'use strict';
const CurrencyPreferences = (() => {
  const key = 'cad-rate-monitor.preferences.v1';
  const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  function defaultSettings(currencies) {
    return { source: 'boc', vbceTargets: Object.fromEntries(currencies.map(c => [c, 0])), theme: 'forest', amount: 1000, refreshMinutes: 15, showHistory: true, precision: 4,
      notifications: false, sound: false, volume: .5, notifyCurrencies: [...currencies],
      nearHigh: .5, aboveAverage: 2, reminderDays: 7, macSpeech: true,
      cardOrder: [...currencies], chartRange: '3M', historyRange: '3M', pageSize: 10 };
  }
  function settings(value, currencies) {
    const base = defaultSettings(currencies), v = value && typeof value === 'object' ? value : {};
    return {
      source: ['boc', 'vbce'].includes(v.source) ? v.source : base.source,
      vbceTargets: Object.fromEntries(currencies.map(c => [c, number(v.vbceTargets?.[c], 0, 0, 1e6)])),
      cardOrder: [...new Set([...(Array.isArray(v.cardOrder) ? v.cardOrder.filter(c => currencies.includes(c)) : []), ...currencies])],
      theme: ['forest', 'dark', 'ocean', 'system'].includes(v.theme) ? v.theme : base.theme,
      amount: number(v.amount, base.amount, 0, 1e9),
      refreshMinutes: [0, 5, 15, 30, 60].includes(v.refreshMinutes) ? v.refreshMinutes : base.refreshMinutes,
      showHistory: typeof v.showHistory === 'boolean' ? v.showHistory : base.showHistory,
      precision: [2, 4, 6].includes(v.precision) ? v.precision : base.precision,
      notifications: v.notifications === true, sound: v.sound === true,
      volume: number(v.volume, base.volume, .05, 1),
      notifyCurrencies: Array.isArray(v.notifyCurrencies) ? currencies.filter(c => v.notifyCurrencies.includes(c)) : base.notifyCurrencies,
      nearHigh: number(v.nearHigh, base.nearHigh, 0, 10),
      aboveAverage: number(v.aboveAverage, base.aboveAverage, 0, 25),
      reminderDays: [1, 3, 7, 14, 30].includes(v.reminderDays) ? v.reminderDays : base.reminderDays,
      macSpeech: typeof v.macSpeech === 'boolean' ? v.macSpeech : base.macSpeech,
      chartRange: ['1W','1M','3M','6M','YTD','1Y','ALL'].includes(v.chartRange) ? v.chartRange : base.chartRange,
      historyRange: ['1W','1M','3M','6M','YTD','1Y','ALL'].includes(v.historyRange) ? v.historyRange : base.historyRange,
      pageSize: [10,25,50,100].includes(v.pageSize) ? v.pageSize : base.pageSize
    };
  }
  function defaults(currencies) {
    return { enabled: [...currencies], selected: currencies[0] || null, settings: defaultSettings(currencies) };
  }
  function normalize(value, currencies) {
    if (value?.version !== 1 || !Array.isArray(value.enabled) || value.enabled.some(c => typeof c !== 'string')) return defaults(currencies);
    const enabled = currencies.filter(c => value.enabled.includes(c));
    if (value.enabled.length && !enabled.length) return defaults(currencies);
    return { enabled, selected: enabled.includes(value.selected) ? value.selected : enabled[0] || null, settings: settings(value.settings, currencies) };
  }
  function read(storage, currencies) {
    try {
      const raw = storage.getItem(key);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      return { ...normalize(parsed, currencies), canSave: true };
    } catch { return { ...defaults(currencies), canSave: false }; }
  }
  function save(storage, enabled, selected, settings) {
    try { storage.setItem(key, JSON.stringify({ version: 1, enabled, selected, settings })); return true; }
    catch { return false; }
  }
  return { read, save, normalize, settings, defaultSettings };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CurrencyPreferences;
