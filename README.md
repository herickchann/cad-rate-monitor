# CADar

[Open the live tracker](https://herickchann.github.io/cad-rate-monitor/)

**Your Canadian-dollar radar.** CADar uses the original bird mascot chosen for the app.

Track how many British pounds, euros, US dollars, and Japanese yen you can buy with Canadian dollars, using the Bank of Canada's daily average exchange rates. Includes a public dashboard, historical charts with selectable time ranges, an amount converter, and built-in browser sound alerts.

Higher foreign currency received per CAD is better. Published rates are indicative and exclude your provider's fees and spread.

## Website updates

GitHub Actions builds and publishes the site on pushes to `main`, on manual runs, and weekdays around **2:15 PM America/Vancouver**. Scheduled runs can be delayed. Holidays retain the last available fixing. The webpage polls its published data every 15 minutes by default while open; users can change the interval or choose manual refresh.

The public site uses `config.example.json`. Local changes to `config.json` affect only your Mac alerts. Site generation reads official market data and publishes only dashboard assets and rate data; local alert history, logs, generated reports, and machine-specific configuration are ignored by Git.

## Currency switches

Open **Settings** in the top-right corner and use **Your currencies** to turn GBP, EUR, USD, and JPY on or off. This filters rate cards, chart tabs, converter results, and history columns. Choices and the selected chart currency are saved in local browser storage and restored after refresh or reopening. You can switch all currencies off. Preferences belong to this browser and are not synced to other devices or the Mac alert script. If storage is unavailable, switches work for the current visit and the page explains that choices cannot be saved.

## Rearrange currency cards

Drag a card by its floating grip handle to put it in a different position. On touchscreens, drag the same handle; the rest of the page scrolls normally. With a handle focused, arrow keys move the card earlier or later, and Home/End move it first or last. Escape cancels an active drag. Card order is saved with browser preferences and survives refreshes, hiding currencies, and reopening. Card colours stay with their currencies. Reset browser settings restores the default order.

## Chart ranges and table pagination

The chart has **1W, 1M, 3M, 6M, YTD, 1Y, and All** controls. Its high, average, and percentage change summarize the selected period. The daily-history table has its own range selector and shows newest fixings first, with 10, 25, 50, or 100 rows per page and numbered Previous/Next navigation. Range and page-size choices are saved with browser preferences. Changing the table range or visible currencies returns the table to page one.

Ranges end on the latest published rate date, so weekends and holidays do not create empty leading periods. Months and years use calendar boundaries. **All** covers available Bank of Canada daily observations from 2017 onward. Only published rate days appear; missing currency observations show a dash. Alert qualification continues to use its configured 90-day-high and preceding-30-day-average rules, independently of the chart view.

## Settings and themes

Open the **Settings** panel from the top-right corner for Forest light, Midnight dark, Ocean blue, or Match device themes; a saved default CAD amount; rate precision; refresh frequency; history visibility; and custom favourable-rate thresholds. Existing saved currency selections survive this update. Reset browser settings restores defaults without clearing alert history.

## Sound alerts — no installation

1. Open **Alerts** in the top-right corner of the website.
2. Choose the currencies you want to watch and press **Turn on sound alerts**. Five sample chimes confirm audio has started; adjust **Alert volume** or use **Play sample** as needed.
3. Keep the page open and your device awake. When a rate qualifies, the page plays five chimes and displays the conversion. Optional desktop notifications ask for browser permission only when switched on.

Use **Pause all alerts** to stop both sound and desktop notifications. The header shows whether alerts are on, off, waiting for sound to resume, offline, or waiting for fresh data. Each currency has an independent alert switch; hiding a currency in Settings does not mute its alerts.

Preferences are saved in this browser. After reopening, click anywhere on the page to resume previously enabled audio, or use **Turn on sound alerts**. Browsers require user interaction to start audio. Closing the page stops alerts; sleeping devices, background throttling, muted tabs, and system audio settings can prevent delivery. This static site does not provide background push notifications. No Python installation is needed to use website alerts.

With manual refresh selected, enabled alerts still check published rates every 15 minutes. Other refresh intervals apply as selected. Alert history is kept per browser to suppress duplicate alerts for the same fixing. If storage is blocked, preferences and suppression last for the current visit only. Different devices have independent settings and alert history.

## Favourable rate rules

With the default thresholds, a currency qualifies when its amount received per CAD is either:

- Within **0.5% of its best rate over the past 90 calendar days**, or
- At least **2% above its preceding 30-calendar-day average**.

These are comparisons with recent history, not a forecast. Rates over four calendar days old cannot trigger alerts. The script requires enough historical observations to assess each currency. Browser threshold changes update the website’s badges and alerts. The legacy Mac script has its own local configuration.

## Optional legacy Mac script (advanced)

Requires macOS and Python 3.9 or newer. No third-party Python packages are needed.

```sh
git clone https://github.com/herickchann/cad-rate-monitor.git
cd cad-rate-monitor
python3 install_macos.py
python3 monitor.py --test-alert
```

The installer copies default settings to `config.json` when missing and creates a per-user login agent. It checks once per hour whether the weekday update is due, then fetches once after **2 PM Vancouver time**, independent of the Mac's current time zone. Failed checks retry on the next hourly run. The Mac must be on and signed in, with this folder's drive mounted and internet access available.

When a rate qualifies, the script requests a desktop notification, plays **five pings**, and speaks the conversion. Your current volume/output device and macOS notification settings apply. This legacy script is independent of the website’s built-in sound alerts.

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
node --test tests/*.test.cjs  # Browser preference tests; requires Node.js
python3 build_site.py
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000/`. The static output in `dist/` is the only content uploaded to GitHub Pages. On a fork, enable Pages with **GitHub Actions** as the publishing source and update repository links in `web/index.html` and this README.

## Data source

[Bank of Canada daily rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) via the [Valet API](https://www.bankofcanada.ca/valet/docs/). The source quotes CAD per foreign unit; the monitor inverts each daily observation to calculate foreign currency per CAD before computing averages and highs.
