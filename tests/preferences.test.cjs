const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../web/preferences.js');
const currencies = ['GBP', 'EUR', 'USD', 'JPY'];

function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}

test('first visit enables every available currency', () => {
  assert.deepEqual(preferences.read(storage(), currencies), { enabled: currencies, selected: 'GBP', settings: preferences.defaultSettings(currencies), canSave: true });
});
test('selected currencies and chart survive a new read', () => {
  const cache = storage();
  assert.equal(preferences.save(cache, ['USD', 'JPY'], 'JPY'), true);
  assert.deepEqual(preferences.read(cache, currencies), { enabled: ['USD', 'JPY'], selected: 'JPY', settings: preferences.defaultSettings(currencies), canSave: true });
});
test('all currencies switched off remains off after reopening', () => {
  const cache = storage();
  preferences.save(cache, [], null);
  assert.deepEqual(preferences.read(cache, currencies).enabled, []);
  assert.equal(preferences.read(cache, currencies).selected, null);
});
test('disabled chart currency falls back to an enabled one', () => {
  assert.deepEqual(preferences.normalize({ version: 1, enabled: ['JPY'], selected: 'GBP' }, currencies), { enabled: ['JPY'], selected: 'JPY', settings: preferences.defaultSettings(currencies) });
});
test('corrupt and unsupported cached data recover safely', () => {
  for (const cached of ['broken json', '{}', '{"version":9,"enabled":[]}', '{"version":1,"enabled":[123]}']) {
    assert.deepEqual(preferences.read(storage(cached), currencies).enabled, currencies);
  }
});
test('removed currencies are ignored and duplicates are removed', () => {
  assert.deepEqual(preferences.normalize({ version: 1, enabled: ['JPY', 'XYZ', 'JPY'], selected: 'XYZ' }, currencies), { enabled: ['JPY'], selected: 'JPY', settings: preferences.defaultSettings(currencies) });
});
test('storage errors never prevent toggles from working', () => {
  const blocked = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(preferences.read(blocked, currencies).canSave, false);
  assert.equal(preferences.save(blocked, ['JPY'], 'JPY'), false);
});

test('old currency preferences gain safe settings without losing visibility choices', () => {
  const old = storage(JSON.stringify({ version: 1, enabled: ['JPY'], selected: 'JPY' }));
  const restored = preferences.read(old, currencies);
  assert.deepEqual(restored.enabled, ['JPY']);
  assert.equal(restored.settings.notifications, false);
  assert.equal(restored.settings.theme, 'forest');
});
test('theme, delivery switches, amount, and independent notification choices persist', () => {
  const cache = storage();
  const settings = {...preferences.defaultSettings(currencies),theme:'dark',amount:2500,notifyCurrencies:['USD'],notifications:true,showHistory:false};
  preferences.save(cache, ['JPY'], 'JPY', settings);
  const restored = preferences.read(cache, currencies);
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.enabled, ['JPY']);
});
test('out-of-range cached settings safely use defaults', () => {
  const normalized = preferences.settings({theme:'bad',amount:-1,refreshMinutes:1,nearHigh:99,precision:8,volume:0}, currencies);
  assert.equal(normalized.theme, 'forest');
  assert.equal(normalized.amount, 1000);
  assert.equal(normalized.refreshMinutes, 15);
  assert.equal(normalized.nearHigh, .5);
  assert.equal(normalized.precision, 4);
  assert.equal(normalized.volume, .5);
});
