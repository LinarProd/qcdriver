#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
NAME=qc-quadcapture
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
    "$PKG/usr/src/$NAME-$VER" \
    "$PKG/usr/bin" \
    "$PKG/lib/systemd/system" \
    "$PKG/usr/share/applications" \
    "$PKG/usr/share/icons/hicolor/scalable/apps" \
    "$PKG/usr/share/doc/$NAME"

cp -a "$ROOT/module/." "$PKG/usr/src/$NAME-$VER/"
install -m 755 "$ROOT/daemon/qcctl.py" "$PKG/usr/bin/qcctl"
install -m 755 "$ROOT/gui/qcpanel.py" "$PKG/usr/bin/qcpanel"
install -m 644 "$ROOT/daemon/qc-daemon.service" \
    "$PKG/lib/systemd/system/qc-daemon.service"
install -m 644 "$ROOT/gui/qcpanel.desktop" \
    "$PKG/usr/share/applications/qcpanel.desktop"
install -m 644 "$ROOT/gui/qcpanel.svg" \
    "$PKG/usr/share/icons/hicolor/scalable/apps/qcpanel.svg"
install -m 644 "$ROOT/README.md" "$PKG/usr/share/doc/$NAME/README.md"
install -m 644 "$ROOT/LICENSE" "$PKG/usr/share/doc/$NAME/copyright"

install -m 644 "$DIR/control" "$PKG/DEBIAN/control"
install -m 755 "$DIR/postinst" "$PKG/DEBIAN/postinst"
install -m 755 "$DIR/prerm" "$PKG/DEBIAN/prerm"
install -m 755 "$DIR/postrm" "$PKG/DEBIAN/postrm"

dpkg-deb --build --root-owner-group "$PKG" "$OUT"
dpkg-deb -I "$OUT"
