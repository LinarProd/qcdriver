#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
NAME=qc-quadcapture
VER=1.0
TARBALL="$NAME-$VER.tar.gz"

rm -rf "$DIR/src" "$DIR/pkg" "$DIR/$TARBALL"
rm -f "$DIR"/*.pkg.tar.*

tar -C "$ROOT" -czf "$DIR/$TARBALL" \
    --exclude='./packaging' --exclude='./webgui' --exclude='./.git' \
    --transform "s,^\.,$NAME-$VER," .

cd "$DIR"
makepkg -f --noconfirm

ls -l "$DIR"/*.pkg.tar.*
