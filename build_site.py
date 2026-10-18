#!/usr/bin/env python3
"""Build a static public site using official data and no personal runtime state."""
import datetime as dt
import json
from pathlib import Path
import shutil
from monitor import analyse, fetch, LOCAL, SERIES

ROOT = Path(__file__).resolve().parent


def build(output=None):
    output = Path(output) if output else ROOT / 'dist'
    output.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(LOCAL)
    config = json.loads((ROOT / 'config.example.json').read_text())
    observations = fetch(now.date())
    rates = analyse(observations, now.date(), config)
    for currency, result in rates.items():
        end = dt.date.fromisoformat(result['date'])
        start = end - dt.timedelta(days=90)
        result['history'] = [
            {'date': row['d'], 'rate': 1 / float(row[SERIES[currency]]['v'])}
            for row in observations
            if start.isoformat() <= row['d'] <= end.isoformat()
            and row.get(SERIES[currency], {}).get('v') is not None
            and float(row[SERIES[currency]]['v']) > 0
        ]
    payload = {
        'schema_version': 1,
        'updated_at': now.isoformat(),
        'source': 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/',
        'thresholds': {'near_high_percent': config['near_90_day_high_percent'],
                       'above_average_percent': config['above_30_day_average_percent']},
        'rates': rates,
    }
    for path in (ROOT / 'web').iterdir():
        if path.is_file():
            shutil.copy2(path, output / path.name)
    (output / 'data.json').write_text(json.dumps(payload, indent=2) + '\n')
    (output / '.nojekyll').touch()
    print('Built public site with rate dates: ' + ', '.join(r['date'] for r in rates.values()))
    return payload


if __name__ == '__main__':
    build()
