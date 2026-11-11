#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
PREFIX=${PREFIX:-/usr}
DESTDIR=${DESTDIR:-}

install -Dm755 "$DIR/server.py" "$DESTDIR$PREFIX/bin/qc-web"
install -d "$DESTDIR$PREFIX/share/qc-web"
install -m644 "$DIR/static/"* "$DESTDIR$PREFIX/share/qc-web/"
install -Dm644 "$DIR/qc-web.service" \
    "$DESTDIR$PREFIX/lib/systemd/system/qc-web.service"
install -Dm644 "$DIR/README.md" \
    "$DESTDIR$PREFIX/share/doc/qc-webpanel/README.md"

if [ -z "$DESTDIR" ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
    systemctl enable --now qc-web.service 2>/dev/null || true
fi

echo "qc-web installed: http://127.0.0.1:8765/"
