# Yougori

<p>
  <a href="https://yougori.com/"><img src="logo.svg" width="122" height="122" align="absmiddle" alt="Yougori website"></a>
  &nbsp;&nbsp;
  <a href="https://discord.gg/Eqhf4Hq3AG"><img src="discord.webp" width="122" height="122" align="absmiddle" alt="Discord"></a>
  &nbsp;&nbsp;
  <a href="https://x.com/withYougori"><img src="https://raw.githubusercontent.com/Yougori/yougori/677bc5244d2f998e57bc3810b52a314135b88b59/xcom.webp" width="112" height="112" align="absmiddle" alt="X"></a>
</p>

Create and manage containers, microVMs and virtual machines from one desktop workspace.

Yougori's original code is **open source under [AGPL-3.0-only](LICENSE)**,
with a **[separate paid commercial licensing option](COMMERCIAL_LICENSE.md)**
from Yougori LLC. Commercial use is allowed under AGPL when its conditions are
met; payment is not required just because a use is commercial. Third-party
components retain their own licenses, and earlier Apache grants remain valid.
See the [licensing guide](docs/licensing.md), [attribution notices](NOTICE)
and [source-distribution status](docs/compliance-status.md).

Download Yougori from **[yougori.com](https://yougori.com/)**, use a direct download below, or [clone this GitHub repository](https://github.com/Yougori/yougori) and run it from source.

| Windows x64 | Ubuntu 22.04+ x64 |
| --- | --- |
| [Download EXE](https://yougori.com/downloads/Yougori_1.0.0_x64-setup-20260910.exe) · [Download MSI](https://yougori.com/downloads/Yougori_1.0.0_x64_en-US-20260910.msi) | [Download DEB](https://yougori.com/downloads/Yougori_1.0.0_amd64-20260910.deb) |

![Yougori app showing containers, a GPU environment, a virtual machine and their connections](yougori1.png)

## Run from source

Start with Git, Node.js 24 LTS, Rust stable and the platform prerequisites: [Windows](docs/source-checkout.md#windows-desktop-prerequisites), [Ubuntu](docs/linux.md#build-from-source), or [macOS](docs/macos.md#first-build-on-the-borrowed-mac).

### Windows x64 — PowerShell

```powershell
git clone https://github.com/Yougori/yougori.git
Set-Location yougori
rustup default stable-x86_64-pc-windows-msvc
npm ci
npm run cli:bundle
npm run desktop:dev
```

### Ubuntu 22.04+ x64 — Terminal

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
  libssl-dev libxdo-dev qemu-system-x86 qemu-utils ovmf \
  openssh-client ca-certificates

git clone https://github.com/Yougori/yougori.git
cd yougori
npm ci
npm run cli:bundle
npm run desktop:dev
```

### macOS 14+ — Terminal · development preview

```bash
git clone https://github.com/Yougori/yougori.git
cd yougori
npm ci
npm run macos:setup
npm run cli:bundle
npm run desktop:dev
```

## Documentation

[Technical reference and troubleshooting](docs/technical-reference.md) · [CLI and AI agents](skills/yougori/references/cli.md) · [CUDA setup](runtime/cuda/README.md)

[Development, testing and releases](CONTRIBUTING.md)

[License](LICENSE) · [Third-party notices](src-tauri/resources/THIRD_PARTY_NOTICES.md)
