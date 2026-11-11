#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
NAME=qc-webpanel
VER=1.0
TARBALL="$NAME-$VER.tar.gz"
STAGE="$DIR/stage/$NAME-$VER"

rm -rf "$DIR/stage" "$DIR/pkg" "$DIR/$TARBALL"
rm -f "$DIR"/*.pkg.tar.*

install -d "$STAGE/static"
install -m755 "$ROOT/server.py" "$STAGE/server.py"
install -m644 "$ROOT/static/"* "$STAGE/static/"
install -m644 "$ROOT/qc-web.service" "$STAGE/qc-web.service"
install -m644 "$ROOT/README.md" "$STAGE/README.md"
install -m644 "$ROOT/../LICENSE" "$STAGE/LICENSE"

tar -C "$DIR/stage" -czf "$DIR/$TARBALL" "$NAME-$VER"

cd "$DIR"
makepkg -f --noconfirm

install -d "$DIR/../dist"
cp "$DIR"/*.pkg.tar.* "$DIR/../dist/"
ls -l "$DIR"/*.pkg.tar.*
