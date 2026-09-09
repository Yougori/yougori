# Yougori on Linux (x86-64 preview)

The Linux package targets Ubuntu 22.04+ and Debian 12+ desktops. Linux Mint
releases based on those Ubuntu versions are candidates for testing. It is not
an ARM build, a headless server package, or a certification for every distro.

## Install

Download the `.deb` from the Linux build's artifacts, then open a terminal in
the download folder:

```sh
sudo apt install ./Yougori_1.0.0_amd64.deb
```

Use the actual downloaded filename if it differs. The package manager installs
QEMU, OVMF firmware and the desktop libraries as dependencies. Launch **Yougori**
from your applications menu, as your normal user (not with sudo). No Docker
Desktop is needed. The bundled appliance runs containers under QEMU/KVM.

For hardware acceleration, enable virtualization in your computer's firmware
and check that your normal user can read and write `/dev/kvm`. On Ubuntu/Debian:

```sh
sudo usermod -aG kvm "$(id -un)"
```

Log out and log in afterwards. Without KVM access, QEMU uses much slower
software emulation. Do not solve KVM permissions by running the app as root.

The **CLI** button opens your Linux shell. `yougori-cli` is also installed in
`/usr/bin`. It controls the app through a same-user Unix socket; it is not a
public network API. Host shell commands are not isolated.

## Available and unavailable features

- Ordinary x86-64 OCI containers and Linux full VMs/microVMs use Linux QEMU.
- Existing resource, terminal, graph connection, shared-folder, service-port,
  local publishing and backup code is shared with Windows. Linux validation
  results are recorded below; not every guest image has been certified.
- Public access downloads a version-pinned, SHA-256-checked Linux Cloudflare
  Tunnel executable on demand. A network connection is required the first time.
  Saved account tokens need an unlocked desktop Secret Service keyring.
- **GPU/CUDA containers are unavailable in this Linux preview.** The current
  CUDA provider uses Windows/WSL. There is no silent CPU substitute.
- **Windows 10/11 secure VMs are unavailable in this preview.** Their custom
  TPM/Secure Boot backend has not been ported. Existing secure VM identities
  are preserved, never downgraded or reset for compatibility.
- Windows computer branches and Windows-only keyboard interception are not
  available. VM key capture remains subject to the Linux desktop/window manager.
- Full VM memory changes require guest balloon drivers. Linux VM CPU allocation
  uses whole-CPU affinity within the user's allowed cpuset, not fractional quotas.

## Build from source

Install [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/),
Rust stable, and Node.js 24 LTS. Ubuntu/Debian build dependencies:

```sh
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev libxdo-dev \
  qemu-system-x86 qemu-utils ovmf openssh-client ca-certificates
npm ci
npm run cli:bundle
npm run desktop:dev
```

To create the `.deb`, run `npm run desktop:build`. Find the installer under
`src-tauri/target/release/bundle/deb/`. Build on the oldest supported distribution
so that glibc requirements do not exclude older machines. See
[Tauri's Debian guidance](https://v2.tauri.app/distribute/debian/).

The automatic Linux config bundles only the guest appliance and Linux CLI,
not Windows EXEs/DLLs. QEMU and firmware come from distribution packages so
normal system updates can patch them. Appliance checksums remain verified.

## Validation / release gate

The Linux CI job compiles the desktop and CLI, runs native tests and produces a
`.deb` artifact without publishing it. Before advertising stable Linux support,
test installation, upgrades, removal (preserving user data), the GUI on X11 and
Wayland, KVM permissions, container/VM lifecycle, networking and backups on clean
Ubuntu and Debian computers. WSL testing does not replace those checks.

Local verification on 2026-09-09 (Ubuntu 22.04 in WSL 2, QEMU 6.2):

- Native Linux compilation; 136 ordinary native tests and 20 CLI tests passed.
- Real OCI and microVM tests passed: independent PTYs, localhost service
  discovery/forwarding, read-only/read-write selected folders, revocation and stop.
- QEMU VM console WebSocket, disk backup/restore and source-cache checks passed.
- Debian package built; dependency and contents inspected; installed with apt;
  same-user CLI startup/state/dashboard-open/shutdown passed as a non-root user
  under Xvfb, using isolated XDG data/config/cache folders. No screenshots taken.
- 293 frontend tests and frontend build/lint passed.
- Windows regression checks: 144 ordinary native tests and 21 CLI tests passed.

Local installer: `artifacts/linux/Yougori_1.0.0_amd64.deb` (135,292,898 bytes).
SHA-256: `b737f84d0a531e0856b664020cae699c028b43e30d20d7a6a6a0071a8774b924`.
The local package used the freshly built frontend and Linux CLI with a prebuilt
frontend hook; CI runs the full native-Linux npm build from a clean checkout.

This is a preview. Interactive desktop QA, clean Debian hardware, Wayland,
Secure Boot guests, Linux GPU support and authenticated external cloud providers
are not certified by these checks.
