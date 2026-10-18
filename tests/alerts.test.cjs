const test = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../web/alerts.js');
const prefs = require('../web/preferences.js');
const settings = prefs.defaultSettings(['GBP','EUR','USD','JPY']);
const rate = {rate:.8,high90:.8,average30:.79,date:'2026-10-16'};
const now = Date.parse('2026-10-16T21:00:00Z');

test('currency-specific off switch suppresses a good opportunity', () => {
  assert.equal(alerts.eligible('USD',rate,null,{...settings,notifyCurrencies:['JPY']},'2026-10-16',now),false);
  assert.equal(alerts.eligible('USD',rate,null,settings,'2026-10-16',now),true);
});
test('stale and future rates cannot trigger notifications', () => {
  assert.equal(alerts.eligible('USD',rate,null,settings,'2026-10-21',now),false);
  assert.equal(alerts.eligible('USD',rate,null,settings,'2026-10-15',now),false);
});
test('same fixing is suppressed across reopening even after cooldown', () => {
  assert.equal(alerts.eligible('USD',rate,{date:rate.date,rate:.8,time:now-30*86400000},settings,'2026-10-16',now),false);
});
test('new fixings require cooldown or another one percent improvement', () => {
  const previous={date:'2026-10-15',rate:.8,time:now-86400000};
  assert.equal(alerts.eligible('USD',rate,previous,settings,'2026-10-16',now),false);
  assert.equal(alerts.eligible('USD',{...rate,rate:.809},previous,settings,'2026-10-16',now),true);
  assert.equal(alerts.eligible('USD',rate,{...previous,time:now-7*86400000},settings,'2026-10-16',now),true);
});
test('custom thresholds change both qualification and notifications', () => {
  const weaker={...rate,rate:.795,average30:.8};
  assert.equal(alerts.favourable(weaker,settings),false);
  assert.equal(alerts.favourable(weaker,{...settings,nearHigh:1}),true);
});
test('denied permission never calls desktop transport', async () => {
  let calls=0;
  assert.equal(await alerts.deliver({...settings,notifications:true},'denied',()=>{calls++;return true;},()=>true),false);
  assert.equal(calls,0);
});
test('failed delivery does not qualify as a sent alert; sound can still succeed', async () => {
  assert.equal(await alerts.deliver({...settings,notifications:true,sound:true},'granted',()=>{throw new Error('Unsupported');},()=>false),false);
  assert.equal(await alerts.deliver({...settings,notifications:true,sound:true},'granted',()=>{throw new Error('Unsupported');},()=>true),true);
});
test('desktop-only alerts work with sound disabled', async () => {
  let sounds=0;
  assert.equal(await alerts.deliver({...settings,notifications:true},'granted',()=>true,()=>{sounds++;return true;}),true);
  assert.equal(sounds,0);
});
test('Mac export contains only importable settings and separate currency selection', () => {
  const exported=alerts.macSettings({...settings,notifyCurrencies:['JPY'],sound:false,notifications:true});
  assert.deepEqual(exported.notification_currencies,['JPY']);
  assert.equal(exported.desktop_notifications,true);
  assert.equal(exported.sound_enabled,false);
  assert.equal(exported.example_cad_amount,1000);
  assert.equal('theme' in exported,false);
});
