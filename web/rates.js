'use strict';
/** Pure helpers for rate-date / publish labeling (testable without the DOM). */
const RateDates = (() => {
  /**
   * True on Vancouver weekdays when the latest BoC observation is still before today.
   * Weekends keep the prior fixing without a “waiting” message. Holidays may briefly
   * show waiting until the next business-day publish.
   * @param {string|null|undefined} latestRateDate ISO date of the newest BoC fixing
   * @param {string} todayIso Vancouver calendar day as YYYY-MM-DD
   * @param {number} weekday 0=Sunday … 6=Saturday in America/Vancouver
   */
  function waitingForTodaysBocFixing(latestRateDate, todayIso, weekday) {
    if (!Number.isInteger(weekday) || weekday === 0 || weekday === 6) return false;
    if (typeof latestRateDate !== 'string' || typeof todayIso !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestRateDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return false;
    return latestRateDate < todayIso;
  }

  return { waitingForTodaysBocFixing };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RateDates;
