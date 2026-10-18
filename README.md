# CAD Rate Monitor

[Open the live tracker](https://herickchann.github.io/cad-rate-monitor/)

Track how many British pounds, euros, US dollars, and Japanese yen you can buy with Canadian dollars, using the Bank of Canada's daily average exchange rates. Includes a public dashboard, 90-day charts, an amount converter, and optional audible alerts on macOS.

Higher foreign currency received per CAD is better. Published rates are indicative and exclude your provider's fees and spread.

## Website updates

GitHub Actions builds and publishes the site on pushes to `main`, on manual runs, and weekdays around **2:15 PM America/Vancouver**. Scheduled runs can be delayed. Holidays retain the last available fixing. The webpage polls its published data every 15 minutes while open and refreshes when you return to the tab.

The public site uses `config.example.json`. Local changes to `config.json` affect only your Mac alerts. Site generation reads official market data and publishes only dashboard assets and rate data; local alert history, logs, generated reports, and machine-specific configuration are ignored by Git.

## Currency switches

Use **Your currencies** on the webpage to turn GBP, EUR, USD, and JPY on or off. This filters rate cards, chart tabs, converter results, and history columns. Choices and the selected chart currency are saved in local browser storage and restored after refresh or reopening. You can switch all currencies off. Preferences belong to this browser and are not synced to other devices or the Mac alert script. If storage is unavailable, switches work for the current visit and the page explains that choices cannot be saved.

## Favourable rate rules

A currency qualifies when its amount received per CAD is either:

- Within **0.5% of its best rate over the past 90 calendar days**, or
- At least **2% above its preceding 30-calendar-day average**.

These are comparisons with recent history, not a forecast. Rates over four calendar days old cannot trigger alerts. The script requires enough historical observations to assess either currency.

## Mac sound alerts

Requires macOS and Python 3.9 or newer. No third-party Python packages are needed.

```sh
git clone https://github.com/herickchann/cad-rate-monitor.git
cd cad-rate-monitor
python3 install_macos.py
python3 monitor.py --test-alert
```

The installer copies default settings to `config.json` when missing and creates a per-user login agent. It checks once per hour whether the weekday update is due, then fetches once after **2 PM Vancouver time**, independent of the Mac's current time zone. Failed checks retry on the next hourly run. The Mac must be on and signed in, with this folder's drive mounted and internet access available.

When a rate qualifies, the script requests a desktop notification, plays **five pings**, and speaks the conversion. Your current volume/output device and macOS notification settings apply. Opening the website does not enable background audio alerts.

Repeat alerts are suppressed for seven days per currency unless it improves another 1% since the last alert. The same published fixing never triggers a second alert. Customize the thresholds, sound, repeat interval, speech, and example amount in `config.json`.

```sh
python3 monitor.py              # Check now; sound if eligible
python3 monitor.py --no-alert   # Refresh local report quietly
python3 monitor.py --open       # Check and open report.html
python3 monitor.py --test-alert # Test sound and speech
```

Scheduler logs are in `~/Library/Logs/cad-rate-monitor/`. Local state and `report.html` stay beside the script. Keep the folder in place, or rerun the installer after moving it.

To stop automatic checks:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ca.herick.cad-rate-monitor.plist
rm ~/Library/LaunchAgents/ca.herick.cad-rate-monitor.plist
```

## Build and test

Python 3.9+ on macOS or Linux:

```sh
python3 -m unittest discover -s tests -v
node --test tests/preferences.test.cjs  # Browser preference tests; requires Node.js
python3 build_site.py
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000/`. The static output in `dist/` is the only content uploaded to GitHub Pages. On a fork, enable Pages with **GitHub Actions** as the publishing source and update repository links in `web/index.html` and this README.

## Data source

[Bank of Canada daily rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) via the [Valet API](https://www.bankofcanada.ca/valet/docs/). The source quotes CAD per foreign unit; the monitor inverts each daily observation to calculate foreign currency per CAD before computing averages and highs.
