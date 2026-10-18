import datetime as dt
import json
from pathlib import Path
import unittest
from monitor import analyse, eligible, LOCAL

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config.example.json').read_text())


class RateTests(unittest.TestCase):
    def setUp(self):
        self.today = dt.date(2026, 10, 16)
        self.now = dt.datetime(2026, 10, 16, 14, tzinfo=LOCAL)
        self.rows = [
            {'d': (self.today - dt.timedelta(days=i)).isoformat(), 'FXGBPCAD': {'v': '2'}, 'FXEURCAD': {'v': '1.6'}}
            for i in range(100, -1, -1)
        ]

    def test_inverts_source_direction_before_statistics(self):
        result = analyse(self.rows, self.today, CONFIG)
        self.assertEqual(result['GBP']['rate'], .5)
        self.assertEqual(result['EUR']['rate'], .625)
        self.assertEqual(result['GBP']['high90'], .5)

    def test_weaker_cad_does_not_qualify(self):
        self.rows[-1]['FXGBPCAD']['v'] = '2.1'
        self.assertFalse(analyse(self.rows, self.today, CONFIG)['GBP']['good'])

    def test_average_threshold_can_qualify_below_90_day_high(self):
        self.rows[15]['FXGBPCAD']['v'] = '1.8'
        self.rows[-1]['FXGBPCAD']['v'] = '1.95'
        result = analyse(self.rows, self.today, CONFIG)['GBP']
        self.assertTrue(result['good'])
        self.assertEqual(len(result['reasons']), 1)
        self.assertIn('above its 30-day average', result['reasons'][0])

    def test_same_fixing_never_alerts_twice(self):
        result = analyse(self.rows, self.today, CONFIG)['GBP']
        previous = {'last_alert_at': self.now.isoformat(), 'last_alert_rate': .5, 'last_alert_data_date': result['date']}
        self.assertFalse(eligible(result, previous, self.now + dt.timedelta(days=9), CONFIG))

    def test_repeat_requires_week_or_material_improvement(self):
        result = analyse(self.rows, self.today, CONFIG)['GBP']
        previous = {'last_alert_at': (self.now - dt.timedelta(days=1)).isoformat(), 'last_alert_rate': .5, 'last_alert_data_date': '2026-10-15'}
        self.assertFalse(eligible(result, previous, self.now, CONFIG))
        result['rate'] = .506
        self.assertTrue(eligible(result, previous, self.now, CONFIG))
        result['rate'] = .5
        self.assertTrue(eligible(result, previous, self.now + dt.timedelta(days=6), CONFIG))

    def test_stale_observations_never_qualify(self):
        self.assertFalse(analyse(self.rows, self.today + dt.timedelta(days=5), CONFIG)['GBP']['good'])

    def test_insufficient_history_fails(self):
        with self.assertRaises(ValueError):
            analyse(self.rows[-5:], self.today, CONFIG)

    def test_future_observations_are_excluded(self):
        self.rows.append({'d': '2026-10-17', 'FXGBPCAD': {'v': '1'}, 'FXEURCAD': {'v': '1'}})
        self.assertEqual(analyse(self.rows, self.today, CONFIG)['GBP']['rate'], .5)


if __name__ == '__main__':
    unittest.main()
