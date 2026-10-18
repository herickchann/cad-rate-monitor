"""Read the same public travel-cash feed used by VBCE's website.

The website publishes its feed URL in its public page bundle. Discover it rather
than copying a vendor key into CADar. Fetch only at publication, never per visitor.
"""
import datetime as dt
import json
import math
import re
import subprocess

SOURCE = 'https://www.vbce.ca/travel-rates'
CURRENCIES = ('GBP', 'EUR', 'USD', 'JPY')


def get(url):
    # curl also works with the provider's public endpoint on our build runners.
    return subprocess.run(['curl', '--fail', '--silent', '--show-error',
                           '--location', '--max-time', '30', '--retry', '2', url],
                          check=True, capture_output=True, text=True).stdout


def fetch_cash_rates(now):
    result = {'source': SOURCE, 'fetched_at': now.isoformat(),
              'status': 'unavailable', 'rates': {}}
    try:
        page = get(SOURCE)
        bundle = re.search(r'src="([^" ]*/pages/travel-rates-[^" ]+\.js)"', page)
        if not bundle:
            raise ValueError('Public rate bundle not found')
        script = get('https://www.vbce.ca' + bundle[1])
        feed = re.search(r'https://rs1\.smallfactory\.dev/api/v1/rates\?apikey=[a-zA-Z0-9]+', script)
        if not feed:
            raise ValueError('Public cash feed not found')
        rows = json.loads(get(feed[0]))
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('Unexpected cash feed')
        for currency in CURRENCIES:
            matches = [row for row in rows if row.get('iso') == currency]
            if len(matches) != 1:
                raise ValueError('Missing or ambiguous currency')
            row = matches[0]
            buy, sell = float(row['buy_price']), float(row['sell_price'])
            updated = dt.datetime.fromisoformat(row['updated_at'])
            if not (math.isfinite(buy) and math.isfinite(sell) and 0 < buy <= sell):
                raise ValueError('Invalid cash price')
            if updated.tzinfo is None or updated > now + dt.timedelta(minutes=5):
                raise ValueError('Invalid cash quote timestamp')
            result['rates'][currency] = {
                'rate': 1 / sell, 'buy_cad': buy, 'sell_cad': sell,
                'updated_at': updated.isoformat(),
                'date': updated.astimezone(now.tzinfo).date().isoformat(),
            }
        result['status'] = 'available'
    except (ValueError, KeyError, TypeError, OverflowError, subprocess.SubprocessError):
        # Publish BoC normally if VBCE is down; never substitute a reference quote.
        result['rates'] = {}
        print('VBCE cash quotes unavailable; publishing Bank of Canada data only.')
    return result
