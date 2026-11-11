#!/usr/bin/env bash
set -euo pipefail

# Audio servers and the control daemon hold the card, so stop them first.
systemctl --user stop pipewire.socket pipewire-pulse.socket \
    wireplumber.service pipewire.service pipewire-pulse.service 2>/dev/null || true
sudo systemctl stop qc-daemon 2>/dev/null || true
sleep 2

sudo modprobe -r snd_usb_audio
sudo modprobe snd_usb_audio
sleep 2

sudo systemctl start qc-daemon 2>/dev/null || true
systemctl --user start pipewire.socket pipewire.service \
    pipewire-pulse.socket pipewire-pulse.service wireplumber.service 2>/dev/null || true

cat /proc/asound/cards
