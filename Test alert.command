#!/bin/zsh
cd -- "${0:A:h}"
/usr/bin/env python3 monitor.py --test-alert
