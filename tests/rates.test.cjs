const test = require('node:test');
const assert = require('node:assert/strict');
const rates = require('../web/rates.js');

test('weekdays wait when the BoC fixing is still yesterday', () => {
  assert.equal(rates.waitingForTodaysBocFixing('2026-10-16', '2026-10-19', 1), true);
  assert.equal(rates.waitingForTodaysBocFixing('2026-10-19', '2026-10-19', 1), false);
});

test('weekends do not show waiting for today’s fixing', () => {
  assert.equal(rates.waitingForTodaysBocFixing('2026-10-16', '2026-10-18', 6), false);
  assert.equal(rates.waitingForTodaysBocFixing('2026-10-16', '2026-10-19', 0), false);
});

test('invalid dates never claim waiting', () => {
  assert.equal(rates.waitingForTodaysBocFixing(null, '2026-10-19', 1), false);
  assert.equal(rates.waitingForTodaysBocFixing('tomorrow', '2026-10-19', 1), false);
  assert.equal(rates.waitingForTodaysBocFixing('2026-10-16', 'not-a-day', 1), false);
});
