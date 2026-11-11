#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=qc-quadcapture
VER=1.0
SRC="/usr/src/$NAME-$VER"

command -v dkms >/dev/null || {
    echo "error: dkms is not installed" >&2
    exit 1
}

sudo rm -rf "$SRC"
sudo install -d "$SRC"
sudo cp -a "$ROOT/module/." "$SRC/"

sudo dkms add -m "$NAME" -v "$VER" 2>/dev/null || true
sudo dkms build -m "$NAME" -v "$VER"
sudo dkms install -m "$NAME" -v "$VER" --force
sudo depmod -a

echo "installed via DKMS:"
dkms status -m "$NAME" -v "$VER"
