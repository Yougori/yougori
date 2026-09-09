#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
source_dir="$repo/build/runtime-cache/qemu-secure-src"
output="$repo/build/secure-runtime/qemu-build"
mkdir -p "$output"
cd "$output"
export PYTHON=/ucrt64/bin/python
# Normalize both MSYS and native Windows forms before __FILE__ and debug
# strings are embedded in a distributable executable.
native_repo=$(cygpath -m "$repo")
privacy_cflags="-ffile-prefix-map='$repo'=/yougori -ffile-prefix-map='$native_repo'=/yougori"
"$source_dir/configure" --target-list=x86_64-softmmu --enable-whpx --enable-tpm \
  --extra-cflags="$privacy_cflags" \
  --enable-virglrenderer --enable-opengl --enable-gnutls --enable-slirp \
  --disable-docs --disable-gtk --disable-sdl --disable-curses --disable-tools \
  --disable-guest-agent --disable-werror --disable-debug-info --disable-strip \
  --disable-user --enable-vnc --disable-install-blobs
ninja -j 8 qemu-system-x86_64.exe
