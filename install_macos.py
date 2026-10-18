#!/usr/bin/env python3
"""Install the weekday audible monitor for the current Mac user."""
import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

LABEL = 'ca.herick.cad-rate-monitor'
ROOT = Path(__file__).resolve().parent


def install():
    if sys.platform != 'darwin':
        raise SystemExit('The sound-alert installer requires macOS.')
    if not (ROOT / 'config.json').exists():
        shutil.copy2(ROOT / 'config.example.json', ROOT / 'config.json')
    config = json.loads((ROOT / 'config.json').read_text())
    if not Path(config['sound']).exists():
        raise SystemExit('The configured alert sound does not exist.')
    agents = Path.home() / 'Library' / 'LaunchAgents'
    logs = Path.home() / 'Library' / 'Logs' / 'cad-rate-monitor'
    agents.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    plist = agents / (LABEL + '.plist')
    esc = lambda value: html.escape(str(value), quote=False)
    python = shutil.which('python3') or sys.executable
    content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{LABEL}</string>
<key>ProgramArguments</key><array><string>{esc(python)}</string><string>{esc(ROOT / 'monitor.py')}</string><string>--scheduled</string></array>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><dict><key>Minute</key><integer>0</integer></dict>
<key>StandardOutPath</key><string>{esc(logs / 'scheduler.log')}</string>
<key>StandardErrorPath</key><string>{esc(logs / 'scheduler-error.log')}</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>
'''
    subprocess.run(['/usr/bin/plutil', '-lint', '-'], input=content, text=True, check=True, capture_output=True)
    domain = f'gui/{os.getuid()}'
    if plist.exists():
        subprocess.run(['/bin/launchctl', 'bootout', domain, str(plist)], capture_output=True)
    plist.write_text(content)
    subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(plist)], check=True)
    print('Installed. Rate checks run on weekdays after 2 PM Vancouver time, with catch-up after sleep or sign-in.')
    print('Test audio with: python3 monitor.py --test-alert')
    print('Keep this folder in place and its drive mounted. Logs: ' + str(logs))


if __name__ == '__main__':
    install()
