# Yougori technical reference

Yougori is a Windows desktop platform for OCI containers, direct-kernel microVMs, and full desktop VMs. The standard engine carries its own minimized QEMU and Linux/containerd appliance. The optional NVIDIA CUDA container engine additionally requires WSL 2 and a compatible Windows NVIDIA driver; neither engine requires Docker Desktop or VirtualBox.

The desktop executable is `yougori.exe`; the CLI is `yougori-cli`. See
[storage and runtime compatibility](../docs/yougori-rename.md) before changing
identifiers used by existing installations.

macOS Intel and Apple Silicon preview build support is prepared in source.
It still needs a native Mac build and real-machine validation. See the
[Mac setup, installer build and testing checklist](../docs/macos.md). Apple Silicon
currently emulates the x86-64 guest runtime; native ARM guests and Mac GPU/CUDA
are not implemented.

## NVIDIA CUDA containers

Open **New environment → GPU → NVIDIA CUDA**. Review the computer checks, use **Set up CUDA** if needed, then create a GPU environment with a compatible Linux image (Ubuntu 24.04 is the default). GPU access is included; Internet and My PC remain disconnected. Start it and use **Test CUDA** in its node settings. This verifies an actual GPU calculation, not just a GPU name. Frameworks/toolkits must still be installed in the container or supplied by its image.

To copy an existing container across, stop it, save a local backup, then use **Load local backup → NVIDIA CUDA**. The restored node is a separate copy; the original and backup remain intact. Use **Enable GPU access** in the stopped restored node's settings, and reconnect Internet/shared folders separately. Existing CUDA nodes automatically display in the GPU category without a disk migration.

CUDA storage is separate from the standard container pool. CUDA is NVIDIA-only; stock Alpine images are not CUDA-ready. The GPU category is still container isolation with a shared WSL kernel, not a dedicated VM. All WSL-exposed NVIDIA devices are available; per-device selection and reserved GPU memory are not implemented. **Native CUDA in QEMU VMs and MicroVMs is not implemented.**

GPU setup checks Windows x64 (build 19044+), WSL readiness and a Pascal-or-newer NVIDIA GPU in WDDM mode with an R495+ driver. Intel and AMD CPUs, and laptops with an additional Intel/AMD GPU, are supported prerequisites. Actual application support depends on its CUDA/framework version. The app checks real hardware; the only physical GPU tested here is the RTX 5090 Laptop. Native Linux/macOS/ARM GPU backends and AMD/Intel GPU computing are not implemented. See [NVIDIA's WSL requirements](https://docs.nvidia.com/cuda/wsl-user-guide/index.html).

See [setup, verification and limitations](../runtime/cuda/README.md) and the [implementation status](../runtime/GPU-IMPLEMENTATION.md).

## Implemented runtime

- OCI images are pulled and executed by the bundled containerd, nerdctl, runc, and CNI runtime inside an isolated Alpine appliance.
- MicroVMs use QEMU's minimal `microvm` machine, direct kernel boot, virtio-mmio devices, a headless serial console, WHPX acceleration, and a TCG fallback. They omit UEFI, ACPI, PCIe, USB, and display hardware.
- Full VMs retain q35, UEFI, accelerated graphics, and an authenticated loopback-only noVNC display.
- CPU and memory policies are scheduled against measured host pressure. Container limits are applied through cgroups. Full-VM CPU and memory limits use process affinity and ballooning; microVM memory is fixed at its preferred value for each boot to avoid WHPX balloon overhead, while CPU changes remain live.
- Visual connections create real isolated network namespaces, firewall rules, and shared/secret mounts between OCI environments. One-way mounts expose the destination read-only; bidirectional mounts are writable at both ends.
- Internet access and My PC are attached from the centered fixed dock below the canvas. Drag between endpoints or click them; Escape cancels. Shared GPU is no longer a connector: create a GPU environment for CUDA. Resource allocation is automatic. Existing legacy graphics settings are preserved, not silently reset.
- Internet access can be plugged/unplugged while an OCI container or full VM is running or paused. Detach its Internet label to unplug; reconnect the dock to plug it back in. No process, terminal, or VM desktop restart is required. The choice is saved for subsequent starts. Containers use a managed CNI uplink whose appliance-side cable is lowered when disconnected; explicit container-to-container connections are separate. VMs use QMP `set_link` and apply the saved cable state before guest execution. MicroVMs are not included yet because their internet interface also carries guest-agent/terminal control. Restart Yougori once after upgrading to load the updated guest agent.
- Container snapshots and backups stream a compressed filesystem directly into one checksum-verified OCI archive on the computer. They do not commit/unpack a duplicate container layer or stage an archive inside the shared container disk. The current image configuration (startup arguments, working directory, user and environment) is preserved. Running containers pause during the export and resume afterward, including after an interrupted transfer; already-paused and stopped containers keep their state. Pauses are not reported as exits. Only complete, validated streams become snapshots; failed temporary host files are removed. Host free space is checked during writing with a 2 GB reserve. Restoring imports the archive into the runtime and still needs enough container storage for the restored files. VM snapshots use QCOW2 internal snapshots. Restores also restore saved policies and connection definitions.
- Cloud backups use content-addressed chunks, zstd compression, deduplication, local age/X25519 encryption, verified manifests, and an optional whole-upload bandwidth cap. AWS S3, Azure Blob, Google Cloud Storage, and path-style S3-compatible endpoints are supported.
- Container and built-in microVM windows have independent interactive PTY terminals. Shell state, running commands, and terminal output persist when switching tabs. Custom microVMs without the agent retain a bounded, read-only serial console. noVNC is loaded only for a full VM display.
- Opening an environment always creates another native window, leaving the dashboard available. Each window has environment switching, independent terminal/desktop tabs, a New window action, and an Other windows picker. Full-VM viewers share the same desktop; resizing one viewer does not resize the guest for the others.
- Capability labels inside each node occupy one compact row. My PC is fixed on the left, Local network and Public access / Cloudflare Tunnel sit together above the canvas (local on the left), and Internet/GPU/Dynamic remain below. All retain visible connection points and wires.

The native runtime performs a complete SHA-256 verification after install or whenever payload metadata changes. Later launches validate a manifest-bound file identity cache, avoiding a repeated scan of hundreds of megabytes. Dashboard telemetry includes CPU, memory, storage, and a GPU history chart backed directly by Windows GPU Engine performance counters; no monitoring subprocess is launched.

The OCI appliance starts lazily at up to 2 vCPUs and 1 GB RAM, sharing one containerd instance across containers. Starting a container calculates a larger VM budget from the configured container ceilings, bounded by the computer's resources. Workload admission and scheduling reserve 0.375 GB for Alpine/containerd and at least 1 GB (or 10% of RAM) for the host, also accounting for other running/paused VMs. A ceiling equal to installed RAM does not guarantee that all of that RAM can be allocated; a start can be refused when the host lacks free memory.

An idle appliance resizes through a clean shutdown and boots the same existing data disk. If any container is running or paused, expansion returns **Stop all containers, then retry** without restarting those workloads. The first retry reserves room for the other configured containers as well. Starts and policy updates are serialized for admission; runtime operations and snapshot transfers hold leases against resizing. CPU quota and period are updated explicitly so limits persist across container restarts. Dynamic allocation works within the booted envelope; increasing that envelope may require the same idle resize. No container disk is recreated or deleted by resizing.

Independent container, image, network, and snapshot operations use resource-scoped locks. Batched telemetry needs at most one runtime process-list and one stats request per refresh, regardless of container count. The zstd-compressed base contains only the required CNI plugins and runtime files.

Local snapshot count is bounded by the configured retention value, backup history is bounded, incompatible appliance recovery overlays are capped at one, and runtime logs/tails have explicit size limits. Persistent state uses atomic generations with a durable previous-generation backup and corruption recovery. A process-wide Windows mutex prevents two Yougori instances from mutating the same disks or state at once.

The bundled runtime occupies approximately 363 MB (346 MiB), including the appliance, minimized standard QEMU, TPM/Secure Boot runtime, and CUDA guest tools. Runtime updates do not replace existing environment disks. Terminal history, concurrent sessions, connections, and shared-folder requests are bounded; idle/background polling backs off. The optional Cloudflare helper downloads only when requested and is not included in this size.

Computer Branch remains visible as a future environment type, but creation and launch are intentionally disabled in this release.

## Supported host

Private graph connections now support containers, MicroVMs and VMs. Each window
has **Skills → Copy skills** for AI-agent access instructions. Files/Data sharing
works across every pairing: managed containers and built-in MicroVMs mount the
connection folder; full VMs use the private file browser at `http://10.192.0.1:7444`
inside the guest. Only designated connection folders are shared, not entire guest
disks. Cross-VM shared folders are separate from VM snapshots/backups. See
[private networking and Skills](../runtime/PRIVATE-NETWORK.md) for setup and limits.

The legacy QEMU graphics implementation is retained for existing environments;
its old Shared GPU picker and connector have been removed from the UI.
See [the graphics bridge notes](../runtime/gpu/README.md) for historical implementation
details; graphics is not NVIDIA CUDA or GPU passthrough.

Yougori 1.0 targets 64-bit Windows 11. Hardware virtualization is used when Windows Hypervisor Platform is available; software emulation remains available when it is not.

The shipped container and VM paths run as the current user and do not force a UAC elevation prompt. The separate administrator development command remains available only for experiments that explicitly need elevated Windows APIs.

Pulling a new OCI image, using cloud backups, and Cloudflare publishing require network access. Local environments and local folder/service sharing otherwise run on the machine.

## Run from source

Install Node.js 24.19.0 (npm 11.17.0, matching CI), the stable Rust MSVC toolchain,
Microsoft C++ Build Tools, and WebView2. This repository includes the verified
runtime payloads and EFI boot helpers needed by a fresh checkout. See
[source checkout setup](../docs/source-checkout.md) for platform prerequisites and
maintainer rebuild instructions. Personal documents and development-agent
configuration are not included.

Open PowerShell in this directory, then run:

```powershell
npm ci
npm run desktop:dev
```

If an earlier development session was interrupted, the command stops only an orphaned Vite server from this Yougori workspace before binding port 1420. If a live Tauri development process owns it, the command asks you to close that desktop normally; it never force-kills that process tree or its guest workloads. It will not terminate an unrelated process using that port.

The functional application is the Tauri desktop process. A plain Vite browser session is intentionally rejected outside automated tests because native isolation and storage operations cannot run safely in a browser.

After this workspace update, close Yougori and restart `npm run desktop:dev` so the native commands are refreshed. Existing container/VM disks are preserved. Development builds use the locally prepared runtime directly instead of overwriting copies that a running QEMU process may have locked. Release builds still bundle the runtime normally. Already-running guests need a normal stop/start to load an updated guest boot image.

## CLI and AI agents

Open **Terminal** in the dashboard, then **Set up AI agent access**. No command to
copy: this installs Yougori's Codex skill for the current user. Start a new Codex
session afterward. Existing personal skill edits are preserved; unmodified
Yougori-managed skills can be updated through the same button. **Copy agent
guide** provides instructions for other agents. Agent applications and their
logins are separate; setup does not install or authenticate them.

The compact bottom terminal is resizable (drag its top edge, or focus the resize
handle and use Up/Down), supports four tabs, a project-folder picker, maximize,
and Ctrl+C/Ctrl+V. Use **Ctrl+`** to toggle it. Detected Codex/Claude/Gemini commands
can be launched into fresh tabs. The bundled CLI is available inside the terminal
without changing the system PATH. The panel is lazy-loaded and shell output is
bounded; hidden tabs poll less often. Hiding keeps commands running. Ending a
tab asks for confirmation and stops its shell and attached Windows job processes.
Yougori shutdown ends its host terminals too. Programs launched independently
through the OS may outlive the shell.

**Host terminal means your computer, not a container.** It cannot be opened from
a guest window and refuses to start while Yougori is elevated. It starts without
PowerShell profiles, never requests elevation, and does not save terminal
transcripts. Programs run inside it can still write their own files/history.
New shells and agent tabs start in `%USERPROFILE%\Yougori\Workspace` on Windows
(`$HOME/Yougori/Workspace` on Unix), created on first use, unless a project is
explicitly selected with the folder picker. Existing running tabs are not moved
or restarted. This is a starting folder only: it does not restrict access to
other files on the host or create a security sandbox.
For a fresh development checkout, build the small bundled CLI with
`npm run cli:bundle` before opening Terminal. Packaged releases include it.

Terminal checks: `npm run test:terminal` tests UI interactions and DOM layout
without screenshots; `npm run test:terminal:native` runs disposable real Windows
PowerShell sessions, CLI discovery, Unicode input, Ctrl+C, resize, and owned-job
cleanup without touching user environments or installing a personal skill.

The native CLI controls the same backend as the desktop: standard/GPU containers,
microVMs, VMs, resource policies, private connections, My PC folders, TCP ports,
local-network/Cloudflare publishing, snapshots, backups, terminal sessions, CUDA
setup/checks, and guest windows. It is not a second runtime or a Docker wrapper.

```powershell
npm run cli -- help
npm run cli -- app status
npm run cli -- env list
npm run cli -- env create --name web --kind container --image docker.io/library/node:24 --cpu 2 --memory 2
npm run cli -- schema
npm run cli -- skills install
```

`skills install` installs the bundled Yougori skill into the current user's Codex
skills directory without replacing any existing skill. Start a new agent session
to discover it. Other agents can read `skills print` or the source
[SKILL.md](../skills/yougori/SKILL.md). No host permissions are granted by installing
a skill. [The guide](../skills/yougori/references/cli.md) covers workflows and limits.

`npm run cli:build` builds a small standalone Rust executable at
`cli/target/release/yougori-cli.exe` on Windows (no Node.js/Rust required to run
the built executable). Desktop release builds bundle it under `cli/` beside the
application resources; add that directory to PATH if desired. In development,
keep the desktop engine running, or use `app start --app ABSOLUTE_PATH_TO_OPENDOCK`
to launch a built engine with no dashboard. `app show` opens its dashboard and
`app quit --yes` gracefully shuts down its workloads. The development Vite server
is still needed when opening dev-build windows.

All backend actions are discoverable through `schema METHOD` and available via
`call METHOD --file request.json` (`--file -` reads stdin). Consequential actions
require `--yes`, enforced by the server even for raw calls. Supply secrets on
stdin or in a private JSON file, not shell command arguments. The control API is
a same-user Windows named pipe (remote clients rejected) or private Unix socket,
not an HTTP port; guests and Cloudflare do not receive it. The explicit Windows
ACL follows [Microsoft's named-pipe security guidance](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights).

Long actions run as bounded, tracked jobs. Calls wait by default; `--no-wait`
returns a job ID, and `jobs get`/`jobs wait` inspect completion. A CLI timeout or
disconnect does not cancel accepted work. Check the job and persisted state
before retrying. Completed job history expires after 30 minutes or engine exit.
`--dry-run` checks request syntax, not runtime readiness. Existing provider/GPU
limitations, guest OS setup, application credentials, and firewalls still apply.

CLI regression tests: `npm run cli:test`. For the real disposable-container,
microVM and VM lifecycle/connection/backup test, run `npm run cli:test:runtime`.
That integration test uses a separate temporary runtime and never opens a public
tunnel or changes saved user environments; it requires the bundled runtime and
Internet access to pull its small test image. It does not install a guest OS.

This version also fixes backups of freshly restored/stopped containers. The
boot-time guest agent is updated without rebasing the container disk. Existing
CUDA installations will ask for a one-time runtime update: use New environment
→ GPU → Update, or `npm run cli -- gpu setup --yes` while CUDA workloads are
stopped. Existing container disks are retained.

## Coding tools in container terminals

**Codex**, **Claude Code**, **Gemini**, **Ollama**, **OpenCode**, **Kilo Code**, and **OpenClaw** are in the **Install tools** dropdown immediately left of **New window** in container workspaces. Choosing a tool opens a dedicated install terminal, stages the complete script through the guest agent, and runs a short launcher automatically. Existing terminal input and processes are untouched. Yougori does not enable networking or copy host credentials. The controls are disabled until the terminal is connected; VM desktops do not show them.

The script detects the guest package manager (apk, apt-get, dnf, microdnf, yum, zypper, pacman, or swupd) rather than guessing from the image name, and installs prerequisites using root, sudo, or doas inside that guest. It uses the official [Codex standalone installer](https://learn.chatgpt.com/docs/codex/cli), [Claude Code installer](https://code.claude.com/docs/en/setup), [Gemini CLI npm package](https://geminicli.com/docs/get-started/installation/), [OpenCode installer](https://opencode.ai/docs/), or [Kilo Code CLI npm package](https://kilo.ai/docs/code-with-ai/platforms/cli). Gemini and Kilo reuse a suitable Node.js 20+ or install a checksum-verified private Node 22 without replacing the application's system Node; Alpine uses its native Node package. OpenCode's installer selects its native CPU/libc variant. Alpine needs its matching community repository for some packages. Internet access, sufficient guest memory/storage, and provider setup are still required. Older/minimal images may not support these tools; failures remain visible in the install tab and can be retried.

[Ollama](https://docs.ollama.com/linux) uses Alpine's signed CPU-only package on Alpine, or the official x64/ARM64 Linux bundle in the container user's private directory on other supported images. No host drivers, services, or models are installed automatically. After installation, run `ollama serve` in a new terminal, then `ollama run MODEL_NAME` in another terminal with your chosen model name. Models require additional memory and storage; installing Ollama does not enable GPU/CUDA access by itself. OpenCode and Kilo can be started with `opencode` and `kilo`, then configured with `/connect`.

[OpenClaw](https://docs.openclaw.ai/install/installer) uses its official local-prefix installer inside x64/ARM64 Linux containers, under the container user's `~/.local/share/opendock/openclaw`. Upstream manages its own supported Node runtime and verifies downloads; it is not forced onto the older Gemini/Kilo runtime. Alpine uses native packages and must pass upstream's Node/SQLite safety checks; if rejected, use Ubuntu/Debian or a current official `node:26-alpine` image. Installation does not run onboarding or publish ports. Afterwards, open a new terminal and run `openclaw onboard` to configure provider access and permissions. In a container without systemd, use `openclaw gateway run` in a terminal rather than installing a background service. Connected accounts and writable shared folders remain sensitive permissions.

## QEMU virtual machines

For installer ISOs, Yougori tries the installed VM disk first, then starts the installer automatically. Standard Windows x64 media uses its own no-prompt EFI loader, so users do not need to catch a timed keypress or type UEFI shell commands. The tiny read-only [boot helper](../src-tauri/boot-helper/README.md) leaves the ISO and existing VM disk untouched; Windows setup choices and licensing remain manual. Existing ISO-based VMs get this behavior on their next stop/start after updating Yougori.

On Windows hosts, full VMs let WHPX select its interrupt controller and hide unsupported nested VMX/SVM features. This avoids the early multiprocessor Windows boot hang and firmware protection fault caused by the old launch profile, while keeping hardware acceleration. Apply it to existing VMs with a cold stop/start (not a saved-memory resume). The opt-in `scripts/test-windows-setup.ps1 -Iso <English-x64-Windows-ISO> -Cpus 12 -MemoryGb 14.25` test verifies an actual visible Windows Setup window and process from inside a disposable guest, without screenshots, installing Windows, or touching existing environment disks. Building its tiny test-only observer requires Visual Studio C++ tools and `mtools` in the `Ubuntu-22.04` WSL distro; these are not end-user dependencies.

Windows installation is manual, and Windows/app licensing remains the user's responsibility. Recognized Windows 10/11 x64 installer media automatically use a private virtual TPM 2.0 and enforced Secure Boot. See [secure VM runtime and backup notes](../runtime/security/README.md). Apps installed inside a VM stay on its disk.

## Local backups

Stop the environment, open its node settings, and select **Back up to this PC**. Choose a destination folder. Yougori creates a unique `Yougori-backup-…` folder containing `backup.yougori` and `disk.data`; keep both files together. The disk copy is streamed with bounded memory and verified with SHA-256 before the backup is marked complete.

Use **Load local backup** beside **Create environment** (or in node settings), choose `backup.yougori` (or an older `backup.opendock`), and select **Restore as new environment**. Restoration creates a new stopped node with independent IDs, without replacing your original environment. Containers are retagged during import so the same backup can be restored more than once.

Supported: managed containers, full VM disks, and built-in Alpine microVMs. Native branches and custom microVMs are not supported yet. These are disk/settings backups, not live-memory saves: shared PC folders, connection permissions, tunnels, host credentials, terminal sessions, VM firmware settings and snapshot history are excluded. Guest files can contain secrets; backups are **not encrypted**. Keep them private, load only trusted backups, and reconnect shared folders/services after restoring. Portable VM disks with external backing files are rejected.

## Recover a stuck container

Blank guest windows on Windows are avoided by creating WebView2 windows through an asynchronous native command. The OCI appliance exposes the accelerator's modern CPU feature set (including AVX when supported), uses the WHPX interrupt-controller compatibility setting, and passes software-emulation options separately from machine options.

Service images such as MongoDB, Redis and Nginx now use their own startup command by default. Linux/language workspaces retain their terminal keep-alive command. An explicitly empty **Startup command** means the image's original ENTRYPOINT/CMD, not `sleep`. MongoDB's preset uses 0.5 GB and can be increased within the host-sized range. Images such as PostgreSQL/MySQL may require additional initialization or credentials; catalog availability is not a guarantee that every image runs without configuration. Exited containers show their exit code, out-of-memory indication when available, and a bounded tail of recent output in node settings.

If a container shows **Needs attention**, open its settings to see the actual error and a **Delete environment** action. Failed deletion keeps the confirmation open with a retry button. For abandoned Windows container runtimes, **Recover runtime and delete** verifies the bundled executable, exact managed disk, and missing owner before stopping that orphan and retrying normal deletion. This can interrupt other containers inside that abandoned runtime, but does not delete their saved data. A runtime with a live owner is never stopped by recovery. Startup leaves a locked disk alone and keeps the UI available for recovery.

## Share files and publish services

1. Start an environment. Connect **My PC** to its bottom connector, choose specific folders, then select **Connect selected folders**. Access defaults to read-only; allowing edits is an explicit choice. Containers and built-in microVMs mount each folder under `/opendock/shared/my-pc/`. The dialog shows the exact path. These Windows-backed mounts support ordinary file operations, not every POSIX filesystem feature such as symlinks or Unix permission changes.
2. Run your app in a terminal tab. Listening TCP ports appear on the node automatically for managed containers and built-in microVMs, including localhost-only servers. Click a port to manage it, or connect its dot to **Public access / Cloudflare Tunnel** or **Local network**. Public access uses Cloudflare Tunnel; direct public IP is no longer offered. A single port can use Cloudflare and local networking together; the graph shows one wire per destination. Existing direct public connections remain visible so they can be disconnected.
3. **Local network** opens a host TCP listener restricted to private/loopback source addresses. The dialog shows URLs for this PC, the LAN, and managed guests (`10.0.2.2:<host-port>`). Internet-enabled OCI containers receive an exception for only these published ports; unrelated private host access remains blocked. Host firewall rules may still need to permit the selected port.
4. **Cloudflare Tunnel** creates a separate public HTTPS preview link after confirmation. Anyone with the link can access the service. Yougori downloads the pinned Windows `cloudflared` 2026.8.3 binary and verifies its SHA-256 before use. `OPENDOCK_CLOUDFLARED_PATH` can point to an existing trusted executable. This uses [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), intended for development/testing, not production hosting; Quick Tunnels have a 200-request concurrency limit and do not support SSE.

Full desktop VMs do not contain the Yougori guest agent. Use the node's **Add service port** button and bind the app to `0.0.0.0` inside the VM; QEMU forwards the specified port. My PC provides a private, token-scoped read-only download/WebDAV URL in these VMs instead of pretending to mount a folder. Automatic port discovery and automatic writable mounts require the managed container/microVM guest agent.

### Optional Cloudflare account authentication

Under a service port's **Public access / Cloudflare Tunnel**, **Quick link — no account** remains the default. Nothing needs to be configured for the existing temporary link. Select **Use my Cloudflare account (optional)** to connect a dashboard-managed tunnel and use your own hostname. [Cloudflare Tunnel is available on all plans](https://developers.cloudflare.com/tunnel/), not only premium plans.

1. Use **Cloudflare login / dashboard** to sign in in your browser. Create a dedicated **cloudflared** tunnel for this service under Networking → Tunnels.
2. Enter your public hostname and an unused **Local tunnel port** in Yougori. Add a published application route in Cloudflare for that hostname with the exact HTTP Service URL shown by Yougori, for example `http://127.0.0.1:45000`. This is the host bridge port, not the container/VM port. Yougori does not create DNS records or change your dashboard configuration.
3. Copy **only** the `eyJ…` tunnel token from the connector installation command into the masked token field. Do not run the installation command or install a background service; Yougori runs its own connector. The token is a tunnel credential, not your Cloudflare password or an account API token. See [Cloudflare's token instructions](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/).
4. Review the tunnel's routes, then select **Publish service**. Use a dedicated tunnel with only this service's route: dashboard configuration controls all origins this connector can reach, and additional routes could expose other host services. Do not run other replicas pointing to different services. Yougori rejects reuse of the same tunnel for another active publication in this app.

**Remember in this PC's credential vault** is opt-in and stores the token plus hostname/bridge-port settings in the OS vault, scoped to this environment and service port. Tokens are never returned to the frontend, written into platform JSON/backups, put on command lines, or included in Yougori's displayed helper logs. Without Remember, a newly entered token is session-only. **Forget saved token** removes the local saved credential, without disconnecting an active connector or revoking the token in Cloudflare. Forget credentials before deleting an environment if you no longer want them retained in the OS vault.

Cloudflare account authentication is not visitor authentication. Configure **Cloudflare Access** separately in your dashboard if visitors should log in. A successful connector registration does not prove that DNS, routing, visitor Access policies, or the app itself are configured correctly; Yougori labels these as unverified. A failed account connection never falls back to an anonymous public link. Stopping the environment, disconnecting, or closing Yougori stops this connector; other replicas or DNS records in your Cloudflare account are not removed.

Use the disconnect action to revoke a folder or stop a publication. Folder shares and publications are session-only: stopping/pausing the environment or closing Yougori removes them; restarting does not silently re-expose files or services. Closing a terminal tab/window closes its shell but does not stop the environment. Never share folder URLs publicly—they grant access while connected.

## Graphical apps in a MicroVM

The built-in Alpine MicroVM can run compatible Linux graphical apps without a full desktop OS or an emulated GPU:

1. Create a MicroVM with source `builtin:alpine`. Set Preferred memory to **2 GB** for browser workloads (0.5 GB is the minimum for basic graphical support). If already running, stop/start it after changing memory.
2. Open **Apps** from the node's settings or its environment window.
3. Choose **Install app support**, or **Install Firefox + app support**. This downloads Alpine packages into that MicroVM only; setup progress and failures stay in the panel.
4. Launch Firefox, a graphical terminal, or a custom installed Linux command. A separate Yougori app window opens, with the environment switcher and additional terminal tabs still available.

Custom app commands run as the non-root `opendock-apps` user, with persistent files in `/home/opendock-apps`. Install their dependencies from the MicroVM terminal first. Windows `.exe` files, macOS apps, and Linux binaries built for incompatible system libraries are not supported by this Alpine launcher. Opening ChatGPT in Firefox is its **web interface**, not an installation of the native desktop app.

Each app has an independent software-rendered display. No graphical process starts at MicroVM boot; Xvnc and the window manager run only for launched apps. RFB uses a private Unix socket; the existing loopback-only guest control connection carries a WebSocket stream protected by a separate random display key. There are no automatic public/network publications. Closing a viewer leaves its app running; reopen it from **Apps → App sessions**. **Stop app** ends the process and its display. Stopping the MicroVM ends all app sessions, but installed packages and files remain on its disk. Audio and GPU acceleration are not included in this first graphical-app implementation.

After updating Yougori, restart existing MicroVMs to load the new bundled agent and host-seeded clock. TLS certificate verification is never disabled. Test without screenshots with `cargo test --manifest-path src-tauri/Cargo.toml --lib micro_vm_graphical_apps_end_to_end -- --ignored --nocapture` (downloads packages into an isolated temporary MicroVM).

## MicroVM sources

The create dialog defaults to `builtin:alpine`, which reuses the bundled verified kernel, initramfs, and disk through a copy-on-write overlay. A custom microVM can be described by a JSON file; relative paths resolve beside that file:

```json
{
  "kernel": "vmlinuz",
  "initrd": "initramfs",
  "disk": "root.qcow2",
  "cmdline": "root=/dev/vda rw console=ttyS0"
}
```

Kernel, initramfs, boot-media, and disk imports are content-addressed and reused. Source fingerprints avoid hashing unchanged multi-gigabyte media again. Deleting the final referencing environment reclaims unreferenced managed bases. Cloud backup currently supports the built-in microVM profile; custom profiles retain local snapshots because their externally supplied boot artifacts are not silently omitted from a cloud restore.

## Build the Windows release

```powershell
npm ci
npm run verify
npm run release:check
npm run desktop:build
```

The final command creates the native executable and Windows installers under `src-tauri\target\release\bundle`. QEMU, UEFI firmware, the Linux appliance, containerd, runc, CNI plugins, and the control agent are included in those packages.

Packaging verifies runtime checksums and refuses unsupported architectures or
test-adapter builds. The supported bundled desktop target is Windows x64, not
every operating system/computer. Before uploading a public release, complete
the [release checklist](../docs/release-readiness.md), including clean-machine
installation/upgrade/uninstall tests, hardware checks, signing and source/license
distribution. A green unit-test suite does not certify all these scenarios.
The [validation report](../docs/production-readiness.md) records the fixes, actual
test results and limitations from the September 2026 production-readiness review.

## Runtime integration tests

The normal verification suite is fast and does not boot guests. These opt-in tests boot the shipped runtime and exercise real control paths:

```powershell
npm run test:runtime
npm run test:workspace
npm run test:graph
```

The appliance test pulls a small OCI image, so it needs network access. It exercises real container lifecycle, batched telemetry, cgroups, GPU/network policies, connections, and snapshot export/re-import/release. The VM tests cover the q35/QMP/VNC path, transactional disk-restore rollback/finalize, and a real direct-kernel microVM boot with authenticated command execution and clean shutdown. None needs an external runtime. 

The workspace tests use temporary runtime data to verify independent PTYs, localhost service discovery/forwarding, narrow local-network allowances, read-only/writable selected-folder mounts, revocation, and full-VM QMP forwarding/display connections. They do not create public Cloudflare tunnels. The graph suite covers pointer/touch/keyboard connections, fixed docks, compact rows, file-sharing dialogs, multiple publication targets, and independent terminal tabs, with screenshots/video/traces disabled.

## Performance benchmark

Build the frontend, then capture runtime size, warm metadata validation, full checksum cost, QEMU process startup, and local runtime-data size:

```powershell
npm run build
npm run benchmark
```

Set `OPENDOCK_PERF_TRACE=1` when running the native integration tests to print runtime verification, overlay preparation, VM provisioning, and guest boot timings.

## Regenerate bundled runtime files

Rebuild only when changing the embedded runtime; a fresh checkout already
includes verified payloads. Rebuilding requires 7-Zip and an Ubuntu 22.04 WSL distribution; the script
downloads upstream archives over HTTPS, checks their published or pinned hashes,
rebuilds the appliance, applies explicit QEMU DLL/firmware allowlists,
smoke-tests the remaining launch devices, and writes runtime SHA-256 manifests.
The secure runtime, CUDA payload, and boot helper have additional build steps
listed in [source checkout setup](../docs/source-checkout.md).

```powershell
npm run runtime:build
```

For an agent-only update that preserves the existing immutable base disk, run the following from WSL with Go 1.25 or newer on `PATH` (the Ubuntu 22.04 `golang-go` package is too old):

```sh
bash scripts/update-workspace-agent.sh "$PWD"
```

This rebuilds the static agent into the verified initramfs. At the next managed guest boot, the updater replaces only the guest agent executable in the writable overlay before OpenRC starts it.

## Architecture

```text
React UI
  -> typed Tauri commands
     -> Rust lifecycle and scheduler
        -> bundled QEMU microvm -> direct-kernel workloads
        -> bundled QEMU q35 -> full desktop VMs
        -> bundled Linux appliance -> containerd/runc/CNI
        -> QCOW2/OCI snapshot storage
        -> encrypted object-storage backup
```

Persistent application state and runtime data live in the operating-system application-data directory. Cloud credentials and the device encryption identity are stored in Windows Credential Manager rather than platform state. Reset removes local environments, snapshots, rules, history, and credentials; it deliberately does not delete already-uploaded encrypted objects from the user's storage account.

## License

Yougori's original code is licensed by Yougori LLC under the
[Yougori Internal-Use License](../LICENSE). Personal use, internal business use,
and running or selling your own applications are permitted. Redistributing
or reselling Yougori itself, including modified copies, or providing its
management controls as a service requires separate written permission.
Private modifications are permitted when source is supplied. This is not an
open-source license.

Separately licensed components retain their own permissions and obligations;
the Yougori restrictions do not override those licenses. Third-party runtime
attribution is included in [THIRD_PARTY_NOTICES.md](../src-tauri/resources/THIRD_PARTY_NOTICES.md).
See [licensing and source distribution](../docs/licensing.md) for release details.
# Linux desktop preview

Linux x86-64 packaging and setup instructions are in [docs/linux.md](../docs/linux.md).
The first package targets Ubuntu 22.04+ and Debian 12+ with QEMU/KVM. GPU/CUDA
and Windows secure-VM support are not included in the Linux preview.
