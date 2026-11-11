#!/usr/bin/env bash
set -euo pipefail

NAME=qc-quadcapture
VER=1.0

sudo systemctl disable --now qc-daemon 2>/dev/null || true
sudo dkms remove -m "$NAME" -v "$VER" --all 2>/dev/null || true
sudo rm -rf "/usr/src/$NAME-$VER"
sudo find /lib/modules -path '*/updates/snd-usb-audio.ko' -delete 2>/dev/null || true
sudo depmod -a

echo "removed the module (DKMS/manual) and the qc-daemon service"
echo "packaged binaries in /usr/bin are not touched; remove the package to do that"
