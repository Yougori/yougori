#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Run this build on macOS. Windows cannot build/sign the macOS installer."
  exit 1
fi
if [[ "$(id -u)" == 0 ]]; then echo "Build as your normal user, not sudo."; exit 1; fi
xcode-select -p >/dev/null
command -v node >/dev/null
command -v cargo >/dev/null
export TMPDIR="$(mktemp -d /private/tmp/yougori-build-tests.XXXXXX)"
echo "Disposable test root: $TMPDIR"
node scripts/macos-setup.mjs
# Fresh native packages: never copy Windows node_modules, target or CLI binaries.
npm ci
npm run lint
npm test
cargo test --locked --manifest-path cli/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build
node scripts/verify-macos-bundle.mjs src-tauri/target/release/bundle/macos/Yougori.app
echo "Build finished. Installer: src-tauri/target/release/bundle/dmg/"
echo "Still required: npm run macos:test:runtime and the real-Mac checklist in docs/macos.md."
