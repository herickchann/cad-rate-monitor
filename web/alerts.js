'use strict';
const RateAlerts = (() => {
  function favourable(rate, settings) {
    return rate.rate >= rate.high90 * (1 - settings.nearHigh / 100) || rate.rate >= rate.average30 * (1 + settings.aboveAverage / 100);
  }
  function eligible(currency, rate, previous, settings, today, now) {
    if (!settings.notifyCurrencies.includes(currency) || !favourable(rate, settings)) return false;
    const age = (Date.parse(today + 'T12:00:00Z') - Date.parse(rate.date + 'T12:00:00Z')) / 86400000;
    if (!Number.isFinite(age) || age < 0 || age > 4) return false;
    if (!previous || !Number.isFinite(previous.rate) || !Number.isFinite(previous.time)) return true;
    if (previous.date >= rate.date) return false;
    return now - previous.time >= settings.reminderDays * 86400000 || rate.rate >= previous.rate * 1.01;
  }
  // Inject the two delivery methods so permission failures and partial delivery can be tested.
  async function deliver(settings, permission, desktop, sound) {
    let delivered = false;
    if (settings.notifications && permission === 'granted') {
      try { delivered = await desktop() === true || delivered; } catch {}
    }
    if (settings.sound) {
      try { delivered = await sound() === true || delivered; } catch {}
    }
    return delivered;
  }
  function macSettings(settings) {
    return { notification_currencies: [...settings.notifyCurrencies],
      near_90_day_high_percent: settings.nearHigh, above_30_day_average_percent: settings.aboveAverage,
      repeat_after_days: settings.reminderDays, improvement_since_alert_percent: 1,
      example_cad_amount: settings.amount, desktop_notifications: settings.notifications,
      sound_enabled: settings.sound, speak_alert: settings.macSpeech };
  }
  return { favourable, eligible, deliver, macSettings };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RateAlerts;
