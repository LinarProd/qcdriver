#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KREL=$(uname -r)
KO="$ROOT/module/snd-usb-audio.ko"

if [ ! -f "$KO" ]; then
    echo "error: $KO not found, run scripts/build.sh first" >&2
    exit 1
fi

sudo install -Dm 644 "$KO" "/lib/modules/$KREL/updates/snd-usb-audio.ko"
sudo depmod -a

echo "installed /lib/modules/$KREL/updates/snd-usb-audio.ko"
echo "now run: scripts/reload.sh"
