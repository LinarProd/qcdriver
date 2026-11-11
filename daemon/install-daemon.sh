#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)

sudo install -m 755 "$DIR/qcctl.py" /usr/bin/qcctl
sudo install -m 644 "$DIR/qc-daemon.service" /etc/systemd/system/qc-daemon.service
sudo systemctl daemon-reload
sudo systemctl enable --now qc-daemon.service

systemctl status qc-daemon.service --no-pager --lines=5
