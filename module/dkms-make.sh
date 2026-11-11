#!/bin/sh
# Build helper for DKMS: use the same toolchain the kernel was built with.
set -e

kdir="$1"
mdir="$2"
llvm=""

if grep -q '^CONFIG_CC_IS_CLANG=y' "$kdir/.config" 2>/dev/null; then
    llvm="1"
fi

exec make -C "$kdir" M="$mdir" LLVM="$llvm" modules
