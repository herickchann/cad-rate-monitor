'use strict';
// Keep the same key across deployments so browser choices survive site updates.
const CurrencyPreferences = (() => {
  const key = 'cad-rate-monitor.preferences.v1';
  function defaults(currencies) {
    return { enabled: [...currencies], selected: currencies[0] || null };
  }
  function normalize(value, currencies) {
    if (value?.version !== 1 || !Array.isArray(value.enabled) || value.enabled.some(c => typeof c !== 'string')) return defaults(currencies);
    const enabled = currencies.filter(c => value.enabled.includes(c));
    // Explicitly switching every currency off is a valid saved choice.
    if (value.enabled.length && !enabled.length) return defaults(currencies);
    return { enabled, selected: enabled.includes(value.selected) ? value.selected : enabled[0] || null };
  }
  function read(storage, currencies) {
    try {
      const raw = storage.getItem(key);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      return { ...normalize(parsed, currencies), canSave: true };
    } catch {
      return { ...defaults(currencies), canSave: false };
    }
  }
  function save(storage, enabled, selected) {
    try {
      storage.setItem(key, JSON.stringify({ version: 1, enabled, selected }));
      return true;
    } catch { return false; }
  }
  return { read, save, normalize };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CurrencyPreferences;
