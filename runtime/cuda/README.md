# Optional WSL 2 NVIDIA CUDA container engine

This engine is integrated into Yougori's native runtime and UI. It has passed
real GPU kernel tests on an RTX 5090 Laptop GPU. It is **not** a GPU backend for
the current QEMU VMs or MicroVMs.

## Use it

1. In the desktop app, open **New environment → GPU → Set up CUDA**. Setup downloads a
   dedicated runtime. WSL 2 and a compatible Windows NVIDIA driver are required;
   missing Windows features/drivers may require an administrator and a reboot.
2. In **GPU**, use the **NVIDIA CUDA** runtime and a compatible glibc Linux image, such
   as Ubuntu 22.04+/Debian 12+ or an appropriate NVIDIA CUDA image. Stock Alpine
   does not become CUDA-compatible by selecting this engine.
3. GPU access is included automatically. Start the container. Enable Internet
   separately if the workload needs downloads; My PC folders remain private.
4. Open node settings and press **Test CUDA**. The built-in native C check runs
   as UID 65534, launches a 256-thread CUDA kernel, reads back every result, and
   verifies it. It needs neither Python nor a CUDA compiler. Your own application
   still needs its framework/toolkit and compatible NVIDIA driver version.

For an existing standard container, stop it and export a local backup. Select
**NVIDIA CUDA** when loading that backup. Import creates a new stopped copy with
GPU/network permissions disconnected; the original container and backup remain.
Use **Enable GPU access** in the stopped restored node's settings to grant it.
A VM disk cannot be converted into a container by this option.

## Isolation and persistence

- Provider identity is persisted for environments and snapshots. Connecting a
  GPU never silently migrates disks, substitutes an engine, or grants My PC.
- A dedicated `OpenDock-CUDA-<storage-hash>` WSL 2 distribution holds the engine.
  Existing Ubuntu distributions, Docker Desktop, QEMU disks, and the user's
  global `.wslconfig` are not adopted or modified. Windows drive automounts and
  executable interop are disabled inside this managed distribution.
- WSL distributions share the WSL kernel. Separate storage does not imply a
  separate hardware-isolation boundary. GPU memory is shared, not reserved.
- NVIDIA CDI devices are injected only with GPU access enabled. With it disabled,
  no device is passed and `NVIDIA_VISIBLE_DEVICES=void` overrides image defaults.
  There is no Shared GPU connector or graphics selector. Per-NVIDIA-GPU
  filtering and VRAM quotas are not implemented.
- The agent listens on loopback with a fresh 256-bit token supplied through
  stdin. Host-folder relays are authenticated, bounded, private, and revoked on
  disconnection. My PC exposes only explicitly selected folders.
- Private network and Files/Data connections work across the two container
  engines. Secret-directory sharing requires two containers on the same engine.
- Terminals, scheduling, stop/start, snapshot/restore, local backups, and factory
  reset route to the recorded engine. Scheduling also respects effective WSL CPU
  and RAM limits, keeping memory for its kernel/daemon; it does not enlarge WSL
  by rewriting global host configuration.
- CUDA uses its own expanding WSL disk, not the QEMU storage slider or a
  per-container disk quota. Deleting files makes space reusable inside that disk;
  it does not promise immediate Windows VHDX compaction. Do not detach or run
  repair tools on a live disk. Storage queries are read-only native metadata calls.
- Normal app shutdown stops managed containers and syncs before ending its own
  distribution. The ordinary Stop recovery flow verifies exact distribution,
  directory, and absence of a live owner before terminating an abandoned runtime.
  A runtime owned by another live app is never force-stopped.

Local publications use the PC's private LAN address for WSL guests (not QEMU's
`10.0.2.2`). Host firewall/LAN routing still applies; private graph connections
do not need an inbound host firewall change. No firewall rule is created by setup.

## Build and test

The separate payload is built without replacing a running QEMU appliance. Run
from a Linux/WSL development toolchain with Go, gcc, and musl-gcc available:

```sh
bash scripts/build-cuda.sh
```

It produces `opendock-agent`, `opendock-mount-helper`, `opendock-cuda-probe`, and
`SHA256SUMS` under `src-tauri/resources/runtime/cuda`. Rebuild the desktop after
changing the payload: its expected hashes are embedded into the native binary.
The app verifies all three files before setup and offers **Update CUDA** when
the installed guest payload differs. Updates keep existing disks and refuse to
replace a running runtime. Close Yougori normally, reopen, update before starting
CUDA containers. No NVIDIA Linux kernel driver is installed.

Ordinary regression checks (no hardware mutation):

```powershell
npm test
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path runtime/cuda/host/Cargo.toml --lib
```

Agent tests: `go test -race ./...` from `appliance/agent` in Linux/WSL.

For the hardware integration test, prepare **only** the dedicated
`build/cuda/integration-runtime` using `runtime/cuda/install.ps1`, with `AgentPath`
pointing to `src-tauri/resources/runtime/cuda/opendock-agent` and `AssetsDirectory`
pointing to `runtime/cuda`. Then run from the repository root:

```powershell
$env:OPENDOCK_CUDA_TEST_ROOT = (Resolve-Path build/cuda/integration-runtime).Path
cargo test --manifest-path src-tauri/Cargo.toml --lib cuda_application_lifecycle_files_and_real_kernel -- --ignored --nocapture --test-threads=1
```

The test rejects other runtime directories. It uses disposable containers and
a temporary standard-engine appliance. The dedicated WSL test distribution and
cached downloads remain reusable after testing. Do not run these tests against
the app's real data directory. UI tests use simulated API responses; they do not
serve as evidence of GPU computation. No screenshots are needed.

## What remains outside this engine

Native GPU/CUDA for Windows VMs, Linux QEMU VMs, and direct-kernel MicroVMs remains
unfinished. A Windows GPU-PV backend requires HCS lifecycle integration plus
compatible guest kernels/drivers and actual guest workload verification. Running
Yougori as administrator alone does not add that implementation. The current
QEMU/Linux graphics path is not NVIDIA CUDA passthrough.

## Upstream components and primary references

- [NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
- [NVIDIA CDI](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)
- [NVIDIA toolkit installation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [Ubuntu base checksums](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/SHA256SUMS)
- [nerdctl 2.3.5](https://github.com/containerd/nerdctl/releases/tag/v2.3.5)
- [Read-only native VHDX information](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/ns-virtdisk-open_virtual_disk_parameters)

The installer pins Ubuntu 24.04.4 and nerdctl 2.3.5 by checksum and installs
`nvidia-container-toolkit-base` 1.20.0-1 from NVIDIA's signed repository. Upstream
components retain their licenses. NVIDIA driver libraries come from the user's
installed Windows driver; this project does not redistribute that driver.
