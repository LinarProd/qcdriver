#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KDIR="/lib/modules/$(uname -r)/build"

if [ ! -d "$KDIR" ]; then
    echo "error: kernel build directory $KDIR not found" >&2
    echo "install the headers package for $(uname -r) first" >&2
    exit 1
fi

if grep -q '^CONFIG_CC_IS_CLANG=y' "$KDIR/.config" 2>/dev/null; then
    TOOLCHAIN=(LLVM=1)
else
    TOOLCHAIN=(CC=gcc)
fi

make -C "$KDIR" M="$ROOT/module" "${TOOLCHAIN[@]}" modules
echo "built: $ROOT/module/snd-usb-audio.ko"
