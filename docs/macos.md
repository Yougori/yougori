# Yougori on macOS — development preview

The macOS port is prepared in source, not yet built or tested on a Mac. Windows
and Linux tests cannot validate AppKit/WebKit, Apple hypervisor behavior, Mac
file permissions or Gatekeeper. Do not advertise this as stable macOS support.

## Which Mac to borrow

Use macOS 14 or newer, preferably with at least 16 GB RAM and 30 GB free disk
space for development dependencies, Rust builds and disposable test guests.

| Mac | App executable | Guest runtime in this preview |
| --- | --- | --- |
| Apple Silicon (M-series) | Native ARM64 | x86-64 software emulation; slower, no HVF for these guests |
| Intel | Native x86-64 | HVF for containers/full VMs, with software fallback; microVMs use TCG |

Use **amd64/x86-64** OCI images and Linux ISO/disk images on both hosts. Native
ARM64 guests are not implemented. A native ARM64 app does not make the bundled
x86 guest kernel/container runtime ARM-native. Fast Apple Silicon guests need
a separate ARM kernel, initramfs, appliance, machine/device and image-validation
port. Rosetta is not a replacement for that work.

## First build on the borrowed Mac

Use a separate macOS user account for testing. Install Xcode Command Line Tools
(`xcode-select --install`), native [Homebrew](https://brew.sh), Node.js 24 LTS and
[Rust stable](https://rustup.rs). Do not use a Rosetta terminal on Apple Silicon.

Copy/clone the project, including `src-tauri/resources/runtime/appliance` and
its checksum manifest. Do **not** copy `node_modules`, `target`, `dist`, existing
`resources/cli` binaries, build caches, or your personal Yougori app-data folder.
Runtime payloads must contain the actual binaries, not Git LFS pointer files.

In Terminal, open the copied project folder and run:

```sh
npm run macos:setup
npm run macos:build
npm run macos:test:runtime
```

- `macos:setup` installs QEMU and Cloudflare Tunnel through native Homebrew.
  It does not install Homebrew itself, use sudo, change OS security settings,
  or access existing environments. Homebrew dependencies remain installed.
- `macos:build` checks dependencies, installs fresh native npm packages, runs
  frontend/native tests, builds the app and CLI, and packages an `.app` and `.dmg`.
- `macos:test:runtime` boots disposable container, microVM and blank-disk VM
  fixtures. It tests PTYs, selected test-folder permissions, localhost service
  forwarding, QMP/VNC and disk backup/restore. It does not publish a public URL,
  use your app-data folder, take screenshots or install a complete guest OS.

Find the installer in `src-tauri/target/release/bundle/dmg/`. Open the DMG and
drag **Yougori** into Applications. The runtime dependencies must also be
installed on each destination Mac:

```sh
brew install qemu cloudflared
```

This preview DMG is **not yet an all-in-one end-user installer**: QEMU and
Cloudflare are external Homebrew-managed dependencies, not bundled binaries.
Homebrew owns their downloads, signatures and security updates. Yougori still
verifies the bundled guest appliance's SHA-256 manifest. Use `brew upgrade qemu
cloudflared` for dependency updates after shutting down guests normally.

For development after setup:

```sh
npm ci
npm run cli:bundle
npm run desktop:dev
```

`npm run macos:doctor` checks dependencies without installing anything. A
manual GitHub Actions workflow builds/tests Intel and Apple Silicon separately;
it has not been run as part of this Windows-only coding session.

## CLI, files and networking

The **CLI** panel uses the Mac shell (zsh by default), starts in the dedicated
Yougori workspace, and includes the bundled CLI and Homebrew in PATH. It does
not source user shell startup files. The host shell is **not sandboxed**.
CLI control remains same-user local IPC, not a public network API.

From an external terminal, without editing shell profiles:

```sh
"/Applications/Yougori.app/Contents/Resources/cli/yougori-cli" app status
```

App data remains under `~/Library/Application Support/com.opendock.desktop`.
Uninstalling the `.app` does not delete environments/backups. Use Yougori's
delete/reclaim actions when you want to remove managed data.

My PC grants only the selected folders. macOS may ask permission to access
protected folders. Grant only what you intended; do not solve failures by
running as root, disabling SIP/Gatekeeper, or granting blanket Full Disk Access.
Local publishing may need macOS firewall/local-network approval. Private node
connections and Cloudflare publishing use the existing shared networking code;
they still require real-Mac validation, including disconnect/revocation tests.

## Explicit limitations

- No GPU/CUDA/Metal guest acceleration. CUDA needs a supported NVIDIA backend;
  Apple's integrated GPU cannot run NVIDIA CUDA. No silent CPU substitute.
- No Windows 10/11 secure VM runtime: the custom TPM/Secure Boot provider is
  Windows-only. Restored security identity is never downgraded or reset.
- VM/microVM CPU and RAM use their preferred values at startup. Saved changes
  require shutdown/restart. Container resource allocation remains dynamic.
- No Windows computer branches. No guarantee that macOS-reserved keyboard
  shortcuts are captured by the VM. Display/clipboard need interactive testing.
- If the app crashes, an orphaned QEMU may remain. Disk deletion/replacement
  checks ownership and refuses a busy disk. This preview does not automatically
  terminate an unverified process; normal app shutdown remains the safe path.
- Build separate native Intel and ARM64 packages. Universal and cross-compiled
  packages are deliberately rejected so an incorrect embedded CLI cannot ship.
- Public distribution requires Apple Developer ID signing and notarization.
  Local/CI builds without signing credentials are development artifacts, not
  trusted consumer downloads. Follow [Tauri's signing guide](https://v2.tauri.app/distribute/sign/macos/).
  Do not disable Gatekeeper or remove quarantine as an installer strategy.

## Required real-Mac checks before release

Verification completed here on 2026-09-09 (Windows host plus Ubuntu 22.04 WSL):

- Frontend lint/build and 295 tests passed; nine packaging/preflight tests passed.
- Windows all-target compilation, 148 ordinary native tests and 22 CLI tests passed.
- Linux all-target compilation and 140 ordinary native tests passed. Existing
  unused Windows-only code warnings remain on Linux.
- Disposable Linux OCI and microVM tests passed (PTYs, local HTTP forwarding,
  selected-folder reads/writes and revocation). The real QEMU VM QMP/VNC and
  backup/restore test passed. These verify shared-code regressions, **not macOS**.
- Mac script syntax, target selection, bundle configuration, CLI relocation,
  conservative disk-ownership result handling and fixed VM budget logic were
  checked here. No macOS binary/DMG was produced; no real-Mac test is marked passed.

1. Build and run all commands above on both Intel and Apple Silicon; record OS,
   QEMU version, logs and results. CI software-emulation tests do not prove HVF.
2. Open the installed app from Finder in the separate test account. Test startup
   with missing dependencies, CLI panel, multiple windows, copy/paste and sizing.
3. Create/start/stop/restart/rename/delete containers and microVMs. Verify files
   persist across normal restart and only disappear after confirmed reset/delete.
4. Install an x86-64 Linux VM, verify guest restarts and disk persistence, then
   test resource-policy changes applying on the next shutdown/start.
5. Connect two nodes, test allowed/denied files and ports, stop a peer, disconnect
   and verify revocation. Use only disposable folders and data.
6. Test selected-folder privacy prompts, manual ports, local network access,
   Quick Tunnel and optional account authentication. Explicitly authorize public
   exposure only for a disposable Hello World service, then stop publishing.
7. Save/load a local backup; delete only the test environments and check actual
   disk usage, including shared-image caching and busy-disk refusal.
8. Test sleep/wake, app crash recovery, dependency upgrades, app upgrade/removal
   preserving data, and a moved app bundle. Never force-close a real guest
   during an OS install to test recovery.
9. Sign/notarize and test the downloaded DMG on a clean Mac with Gatekeeper on.

Reference: [Tauri macOS bundle structure](https://v2.tauri.app/distribute/macos-application-bundle/),
[QEMU hosts](https://www.qemu.org/download/#macos),
[Homebrew QEMU](https://formulae.brew.sh/formula/qemu).
