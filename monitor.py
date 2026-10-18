#!/usr/bin/env python3
"""CAD buying GBP/EUR/USD/JPY: official daily data, local HTML report, audible alerts."""
import argparse
import datetime as dt
import fcntl
import html
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
SOURCE = 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/'
SERIES = {'GBP': 'FXGBPCAD', 'EUR': 'FXEURCAD', 'USD': 'FXUSDCAD', 'JPY': 'FXJPYCAD'}
NAMES = {'GBP': 'British pounds', 'EUR': 'euros', 'USD': 'US dollars', 'JPY': 'Japanese yen'}
LOCAL = ZoneInfo('America/Vancouver')


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def analyse(observations, today, config):
    results = {}
    for currency, series in SERIES.items():
        points = []
        for row in observations:
            day = dt.date.fromisoformat(row['d'])
            raw = row.get(series, {}).get('v')
            if raw is not None and float(raw) > 0 and day <= today:
                # Bank of Canada quotes CAD per foreign unit. Invert to show what CAD buys.
                points.append((day, 1 / float(raw)))
        points.sort()
        if not points:
            raise ValueError(f'No valid {currency} observations')
        latest_day, rate = points[-1]
        history90 = [p for p in points if latest_day - dt.timedelta(days=90) <= p[0] <= latest_day]
        history30 = [p for p in points if latest_day - dt.timedelta(days=30) <= p[0] < latest_day]
        if len(history90) < 45 or len(history30) < 15:
            raise ValueError(f'Insufficient history to assess {currency}')
        high = max(p[1] for p in history90)
        average = sum(p[1] for p in history30) / len(history30)
        near_high = rate >= high * (1 - config['near_90_day_high_percent'] / 100)
        above_average = rate >= average * (1 + config['above_30_day_average_percent'] / 100)
        # Never flag old data as a current opportunity.
        fresh = (today - latest_day).days <= 4
        reasons = []
        if near_high:
            reasons.append(f"within {config['near_90_day_high_percent']:g}% of its 90-day best")
        if above_average:
            reasons.append(f"at least {config['above_30_day_average_percent']:g}% above its 30-day average")
        results[currency] = {
            'currency': currency, 'date': latest_day.isoformat(), 'rate': rate,
            'daily_change_percent': (rate / points[-2][1] - 1) * 100 if len(points) > 1 else 0,
            'high90': high, 'average30': average,
            'above_average_percent': (rate / average - 1) * 100,
            'good': bool(reasons) and fresh, 'fresh': fresh, 'reasons': reasons,
            'recent': [(d.isoformat(), r) for d, r in points[-10:]],
        }
    return results


def eligible(result, previous, now, config):
    if not result['good']:
        return False
    if not previous.get('last_alert_at'):
        return True
    # Re-fetching the same daily fixing must never cause another alert.
    if previous.get('last_alert_data_date', '') >= result['date']:
        return False
    elapsed = now - dt.datetime.fromisoformat(previous['last_alert_at'])
    improved = result['rate'] >= previous['last_alert_rate'] * (1 + config['improvement_since_alert_percent'] / 100)
    return elapsed >= dt.timedelta(days=config['repeat_after_days']) or improved


def channels_enabled(config):
    return any(config.get(key, default) for key, default in [('desktop_notifications', True), ('sound_enabled', True), ('speak_alert', True)])


def import_settings(path, config):
    incoming = json.loads(Path(path).read_text())
    if not isinstance(incoming, dict):
        raise ValueError('Settings must be a JSON object.')
    ranges = {'near_90_day_high_percent': (0, 10), 'above_30_day_average_percent': (0, 25),
              'repeat_after_days': (1, 30), 'improvement_since_alert_percent': (0, 25), 'example_cad_amount': (0, 1e9)}
    booleans = {'desktop_notifications', 'sound_enabled', 'speak_alert'}
    allowed = set(ranges) | booleans | {'notification_currencies'}
    if set(incoming) - allowed:
        raise ValueError('Unsupported settings: ' + ', '.join(sorted(set(incoming) - allowed)))
    for key, value in incoming.items():
        if key in ranges:
            low, high = ranges[key]
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f'{key} must be between {low} and {high}.')
        elif key in booleans and not isinstance(value, bool):
            raise ValueError(f'{key} must be true or false.')
        elif key == 'notification_currencies':
            if not isinstance(value, list) or any(not isinstance(c, str) or c not in SERIES for c in value):
                raise ValueError('notification_currencies must contain only GBP, EUR, USD, or JPY.')
            incoming[key] = list(dict.fromkeys(value))
    return {**config, **incoming}


def alert(message, config, test=False):
    title = 'CAD rate alert test' if test else 'Favourable CAD conversion rate'
    failures = []
    delivered = False
    if config.get('desktop_notifications', True):
        script = f'display notification {json.dumps(message)} with title {json.dumps(title)}'
        notification = subprocess.run(['/usr/bin/osascript', '-e', script], capture_output=True, text=True)
        delivered = notification.returncode == 0
        if notification.returncode:
            failures.append('Desktop notification: ' + notification.stderr.strip())
    if config.get('sound_enabled', True):
        for index in range(config['sound_repeats']):
            sound = subprocess.run(['/usr/bin/afplay', config['sound']], capture_output=True, text=True)
            delivered = delivered or sound.returncode == 0
            if sound.returncode:
                failures.append('Sound: ' + sound.stderr.strip())
                break
            if index < config['sound_repeats'] - 1:
                time.sleep(1)
    if config.get('speak_alert', True):
        voice = subprocess.run(['/usr/bin/say', message], capture_output=True, text=True)
        delivered = delivered or voice.returncode == 0
        if voice.returncode:
            failures.append('Speech: ' + voice.stderr.strip())
    for failure in failures:
        print(failure, file=sys.stderr)
    if not delivered:
        raise RuntimeError('No enabled alert channel succeeded. Check your notification and audio settings.')


def report(results, now, config, error=None):
    symbol = {'GBP': '£', 'EUR': '€', 'USD': 'US$', 'JPY': '¥'}
    rows = []
    comparisons = []
    recent = []
    amount = config['example_cad_amount']
    for currency, r in results.items():
        status = 'Data stale' if not r['fresh'] else ('Favourable' if r['good'] else 'Watching')
        css = 'good' if r['good'] else ''
        rows.append(f'<tr><td><strong>{currency}</strong></td><td>{symbol[currency]}{r["rate"]:.4f}</td>'
                    f'<td>{symbol[currency]}{amount * r["rate"]:,.2f}</td>'
                    f'<td>{r["daily_change_percent"]:+.2f}%</td><td class="{css}">{status}</td></tr>')
        comparisons.append(f'<tr><td>{currency}</td><td>{symbol[currency]}{r["average30"]:.4f}</td>'
                           f'<td>{r["above_average_percent"]:+.2f}%</td><td>{symbol[currency]}{r["high90"]:.4f}</td></tr>')
    days = sorted({d for r in results.values() for d, _ in r['recent']}, reverse=True)[:10]
    maps = {c: dict(r['recent']) for c, r in results.items()}
    for day in days:
        values = ''.join(f'<td>{symbol[c]}{maps[c][day]:.4f}</td>' if day in maps.get(c, {}) else '<td>—</td>' for c in SERIES)
        recent.append(f'<tr><td>{day}</td>{values}</tr>')
    data_date = ', '.join(sorted({r['date'] for r in results.values()})) or 'Unavailable'
    banner = f'<p class="error">Latest check failed: {html.escape(error)}. Any rates below are from the last successful check.</p>' if error else ''
    text = f'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canadian dollar conversion tracker</title>
<style>
body{{font:16px -apple-system,BlinkMacSystemFont,sans-serif;color:#202b36;background:#f3f6f8;margin:0;padding:32px 20px}}
main{{max-width:950px;margin:auto;background:white;padding:32px;border-radius:18px}}h1{{margin-top:0;font-size:30px}}
h2{{font-size:20px;margin-top:32px}}p,li{{line-height:1.6}}.muted{{color:#5a6774;font-size:14px}}
.scroll{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}}
th,td{{padding:13px 12px;text-align:right;border-bottom:1px solid #e3e9ef;white-space:nowrap}}
th:first-child,td:first-child{{text-align:left}}th{{color:#546270;font-size:13px;background:#f7f9fb}}
.good{{color:#087a4b;font-weight:700}}.error{{background:#fff0e6;padding:14px;border-radius:8px}}a{{color:#125ac2}}
</style><main><h1>Canadian dollar conversion tracker</h1>
<p>Buying British pounds, euros, US dollars, and Japanese yen with Canadian dollars. <strong>A higher rate means your CAD buys more.</strong></p>
<p class="muted">Checked {now.strftime('%B %d, %Y at %I:%M %p %Z')} · Rate date {data_date}<br>
Scheduled weekdays at 2:00 PM Vancouver time, with a catch-up check after waking or signing in. Refresh this page to see saved updates.</p>
{banner}<h2>Latest rates</h2><div class="scroll"><table><thead><tr><th>Currency</th><th>1 CAD buys</th>
<th>CAD {amount:,.0f} buys</th><th>Daily change</th><th>Status</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<p class="muted">Indicative daily averages from the <a href="{SOURCE}">Bank of Canada</a>, before exchange provider fees and spreads. These are not live transaction quotes.</p>
<h2>How the rate compares</h2><div class="scroll"><table><thead><tr><th>Currency</th><th>30 day average</th><th>Versus average</th>
<th>90 day best</th></tr></thead><tbody>{''.join(comparisons)}</tbody></table></div>
<h2>When the alarm sounds</h2><p>Any tracked currency qualifies when the amount bought per CAD is within {config['near_90_day_high_percent']:g}% of its best rate over the past 90 calendar days,
or at least {config['above_30_day_average_percent']:g}% above its preceding 30 day average. These are relative opportunity thresholds, not a forecast.</p>
<p>The alert plays {config['sound_repeats']} sounds, speaks the result, and requests a Mac desktop notification. Repeat alerts for a currency are suppressed for {config['repeat_after_days']} days unless it improves another {config['improvement_since_alert_percent']:g}%. The same published rate is never alerted twice.</p>
<h2>Recent history</h2><div class="scroll"><table><thead><tr><th>Rate date</th>{''.join(f'<th>{c} per CAD</th>' for c in SERIES)}</tr></thead>
<tbody>{''.join(recent)}</tbody></table></div><p class="muted">Mac must be on and signed in. Sound uses your current volume and output device. Edit config.json to change thresholds or audio.</p></main></html>'''
    temporary = ROOT / 'report.html.tmp'
    temporary.write_text(text)
    temporary.replace(ROOT / 'report.html')


def fetch(today, start_date=None):
    start = start_date or today - dt.timedelta(days=110)
    url = (f'https://www.bankofcanada.ca/valet/observations/{",".join(SERIES.values())}/json'
           f'?start_date={start.isoformat()}&end_date={today.isoformat()}')
    request = urllib.request.Request(url, headers={'User-Agent': 'CADRateMonitor/1.0', 'Accept': 'application/json'})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.load(response)['observations']
        except (OSError, ValueError, KeyError) as exc:
            last = exc
            if attempt < 2:
                time.sleep(2)
    raise RuntimeError(f'Could not retrieve Bank of Canada data: {last}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--import-settings', metavar='FILE', help='Import settings downloaded from the website without checking rates')
    parser.add_argument('--test-alert', action='store_true', help='Play a labelled test without fetching rates')
    parser.add_argument('--scheduled', action='store_true', help='Run the weekday update when due in Vancouver time')
    parser.add_argument('--no-alert', action='store_true', help='Refresh report without sounding or consuming an alert')
    parser.add_argument('--open', action='store_true', help='Open the updated report')
    args = parser.parse_args()
    config_path = ROOT / 'config.json'
    if not config_path.exists():
        config_path = ROOT / 'config.example.json'
    config = json.loads(config_path.read_text())
    if args.import_settings:
        try:
            updated = import_settings(args.import_settings, config)
        except (OSError, ValueError) as exc:
            parser.error(str(exc))
        save_json(ROOT / 'config.json', updated)
        print('Mac alert settings imported. They apply to the next check; existing alert history is preserved.')
        return 0
    if args.test_alert:
        if not channels_enabled(config):
            print('All alert delivery channels are off. Enable notifications, sound, or speech before testing.')
            return 0
        alert('This is a test of your Canadian dollar conversion alert.', config, test=True)
        print('Audio test completed. Confirm that you heard it on your Mac.')
        return 0
    with (ROOT / '.monitor.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        now = dt.datetime.now(LOCAL)
        state_path = ROOT / 'state.json'
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if args.scheduled and (now.weekday() >= 5 or now.hour < 14 or state.get('last_scheduled_day') == now.date().isoformat()):
            return 0
        try:
            results = analyse(fetch(now.date()), now.date(), config)
            report(results, now, config)
            candidates = [r for c, r in results.items() if channels_enabled(config) and c in config.get('notification_currencies', SERIES) and eligible(r, state.get('alerts', {}).get(c, {}), now, config)]
            state.update({'last_checked': now.isoformat(), 'results': results, 'last_error': None})
            if candidates and not args.no_alert:
                amount = config['example_cad_amount']
                pieces = [f"{amount:,.0f} Canadian dollars buys {r['rate'] * amount:.0f} {NAMES[r['currency']]}, before fees" for r in candidates]
                alert('Favourable conversion rate. ' + '. '.join(pieces) + '. Open your currency report for details.', config)
                for r in candidates:
                    state.setdefault('alerts', {})[r['currency']] = {
                        'last_alert_at': now.isoformat(), 'last_alert_rate': r['rate'], 'last_alert_data_date': r['date']}
            if args.scheduled:
                state['last_scheduled_day'] = now.date().isoformat()
            save_json(state_path, state)
            print(json.dumps({'checked': now.isoformat(), 'rates': {c: {'date': r['date'], 'per_CAD': round(r['rate'], 6), 'favourable': r['good']} for c, r in results.items()}}, indent=2))
            if args.open:
                subprocess.run(['/usr/bin/open', str(ROOT / 'report.html')], check=True)
            return 0
        except Exception as exc:
            state.update({'last_error': str(exc), 'last_attempt': now.isoformat()})
            save_json(state_path, state)
            report(state.get('results', {}), now, config, error=str(exc))
            print(str(exc), file=sys.stderr)
            return 1


if __name__ == '__main__':
    sys.exit(main())
