#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
NAME=qc-webpanel
VER=1.0
BUILD="$DIR/build"
PKG="$BUILD/pkgroot"
OUT="$DIR/${NAME}_${VER}_all.deb"

command -v dpkg-deb >/dev/null || {
    echo "error: dpkg-deb not found (Arch: pacman -S dpkg)" >&2
    exit 1
}

rm -rf "$BUILD" "$OUT"
install -d "$PKG/DEBIAN" \
    "$PKG/usr/bin" \
    "$PKG/usr/share/qc-web" \
    "$PKG/lib/systemd/system" \
    "$PKG/usr/share/doc/$NAME"

install -m 755 "$ROOT/server.py" "$PKG/usr/bin/qc-web"
install -m 644 "$ROOT/static/index.html" "$ROOT/static/style.css" \
    "$ROOT/static/app.js" "$PKG/usr/share/qc-web/"
install -m 644 "$ROOT/qc-web.service" \
    "$PKG/lib/systemd/system/qc-web.service"
install -m 644 "$ROOT/README.md" "$PKG/usr/share/doc/$NAME/README.md"
install -m 644 "$ROOT/../LICENSE" "$PKG/usr/share/doc/$NAME/copyright"

install -m 644 "$DIR/control" "$PKG/DEBIAN/control"
install -m 755 "$DIR/postinst" "$PKG/DEBIAN/postinst"
install -m 755 "$DIR/prerm" "$PKG/DEBIAN/prerm"
install -m 755 "$DIR/postrm" "$PKG/DEBIAN/postrm"

dpkg-deb --build --root-owner-group "$PKG" "$OUT"
dpkg-deb -I "$OUT"

install -d "$DIR/../dist"
cp "$OUT" "$DIR/../dist/"
