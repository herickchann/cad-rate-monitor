const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../web/preferences.js');
const currencies = ['GBP', 'EUR', 'USD', 'JPY'];

function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}

test('first visit enables every available currency', () => {
  assert.deepEqual(preferences.read(storage(), currencies), { enabled: currencies, selected: 'GBP', canSave: true });
});
test('selected currencies and chart survive a new read', () => {
  const cache = storage();
  assert.equal(preferences.save(cache, ['USD', 'JPY'], 'JPY'), true);
  assert.deepEqual(preferences.read(cache, currencies), { enabled: ['USD', 'JPY'], selected: 'JPY', canSave: true });
});
test('all currencies switched off remains off after reopening', () => {
  const cache = storage();
  preferences.save(cache, [], null);
  assert.deepEqual(preferences.read(cache, currencies).enabled, []);
  assert.equal(preferences.read(cache, currencies).selected, null);
});
test('disabled chart currency falls back to an enabled one', () => {
  assert.deepEqual(preferences.normalize({ version: 1, enabled: ['JPY'], selected: 'GBP' }, currencies), { enabled: ['JPY'], selected: 'JPY' });
});
test('corrupt and unsupported cached data recover safely', () => {
  for (const cached of ['broken json', '{}', '{"version":9,"enabled":[]}', '{"version":1,"enabled":[123]}']) {
    assert.deepEqual(preferences.read(storage(cached), currencies).enabled, currencies);
  }
});
test('removed currencies are ignored and duplicates are removed', () => {
  assert.deepEqual(preferences.normalize({ version: 1, enabled: ['JPY', 'XYZ', 'JPY'], selected: 'XYZ' }, currencies), { enabled: ['JPY'], selected: 'JPY' });
});
test('storage errors never prevent toggles from working', () => {
  const blocked = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(preferences.read(blocked, currencies).canSave, false);
  assert.equal(preferences.save(blocked, ['JPY'], 'JPY'), false);
});
