# GPU/CUDA implementation work log

## GPU environment category update (2026-09-08)

- New environment now has a dedicated **GPU → NVIDIA CUDA** category. New GPU
  containers include GPU access; standard containers, Internet and host folders
  are not silently granted access or migrated. GPU nodes retain the existing
  container/provider disk format, IDs, snapshots and files.
- Removed the Shared GPU graph connector, its per-node badge/wires and old picker.
  My PC and Internet remain centered below the graph. Legacy graphics settings
  are retained on disk. Restored/older CUDA nodes with GPU access disabled have
  an explicit Enable GPU access action in their stopped node's settings.
- Added read-only Windows x64/build, WSL and NVIDIA driver/device checks, a recheck
  action, unsupported-computer guidance, and setup/create guards. NVIDIA WSL
  prerequisite rules accept Pascal and later WDDM GPUs, R495+ drivers, Intel/AMD
  x64 CPUs, and hybrid graphics laptops. This does not guarantee application or
  newer toolkit compatibility. Native Linux/macOS/ARM GPU backends and non-NVIDIA
  GPU computing are still not implemented.
- GPU image catalog defaults to Ubuntu 24.04, offers Ubuntu 22.04, Debian 12 and
  Python 3.12 Slim, plus custom glibc images. Stock Alpine/BusyBox choices are
  rejected with guidance. No newest-toolkit requirement is imposed on all GPUs.
- Verified: 214 frontend tests + 4 viewport tests, production build, lint,
  all-target native check, 121 native library tests, 6 CUDA host tests. Explicit
  read-only compatibility check passed on this Windows/RTX 5090 laptop; simulated
  prerequisite cases cover older NVIDIA generations and unsupported setups.
- Seven targeted browser graph/category cases passed (including reruns after
  correcting the new category locator and allowing cold dev-server compilation).
  They verify removal, existing CUDA labels, unsupported creation, drag/click
  connections, layout and connector alignment. Screenshots/video/trace were off.
- No user containers/VMs were stopped, migrated or deleted. No screenshots taken.
  New GPU workload/download tests were not run in this update because the host
  drive is nearly full; the previously verified computation path is unchanged.

Requested: integrate usable GPU/CUDA across containers, VMs and MicroVMs while
preserving existing environments. No VirtualBox, UI skills or screenshots.

## Plan

1. Integrate the separately tested WSL2 CUDA container provider, persist its
   identity, route lifecycle/workspaces/backups, and test real GPU computation.
2. Add capability/setup/diagnostics UI with distinct graphics and CUDA results;
   never infer successful compute from a host adapter name.
3. Prototype and integrate Windows HCS GPU-PV for GPU VMs, using Windows' native
   interfaces and version-pinned, license-preserving guest components.
4. Add a lightweight GPU Linux VM profile with the necessary guest driver stack.
5. Run unit, integration and browser tests, including denied access, restart,
   persistence and backend boundaries. Preserve all existing QEMU/OCI data.

## Initial evidence (2026-09-08)

- Existing main runtime: QEMU/ANGLE/VirGL graphics; no native CUDA path.
- `runtime/cuda` has a standalone WSL2 provider and recorded RTX 5090 kernel tests.
- Current shell is NOT elevated. Windows HCS requires administrator access.
- User's Yougori process is running. Do not stop it or overwrite loaded runtime
  resources. Use isolated build/test data and binaries.
- HCS reference: https://learn.microsoft.com/en-us/virtualization/api/hcs/schemareference
- GPU-PV implementation reference: https://github.com/jamesstringer90/appsandbox
  (MIT core, separately licensed drivers). Upstream claims are not Yougori tests.

## Progress

- [x] Inspect existing runtime and prerequisite state (read-only).
- [x] CUDA application integration for Windows/WSL 2 NVIDIA containers.
- [x] Capability, setup/update, backup migration, and real CUDA diagnostics UI.
- [ ] HCS runtime / GPU VM validation.
- [ ] Lightweight GPU VM profile.
- [x] Container engine end-to-end verification; VM/MicroVM acceptance remains open.

Do not mark hardware-dependent behavior verified without a guest workload test.

## Implemented this pass

- Explicit persisted `openDockCuda` provider; immutable environment/snapshot
  routing, with no automatic adoption or movement of the standard pool.
- Lifecycle, configuration, terminals, metrics, scheduling, snapshots, local
  backups, factory-reset routing, and shutdown/recovery integrated into the app.
- Separate setup/update payload, SHA-256 validation, native ownership locks,
  exact WSL registry/disk identity checks, and no global WSL configuration edits.
- Native C verification inside the container as an unprivileged user: a GPU
  kernel computes 256 values, and every copied-back result is checked.
- My PC selected-folder access through a bounded authenticated private relay.
- Cross-engine private TCP and bidirectional Files/Data sharing, with revocation.
- Portable standard-container backup restore into a new CUDA container, keeping
  the original and backup and granting no network/GPU/folder permissions.
- Read-only native VHDX capacity/physical-size reporting, including while live.
- UI displays the difference between graphics and CUDA. Browser-preview fixtures
  never claim that a real driver was installed or a GPU calculation verified.

## Verification (2026-09-08)

- `npm test`: 205 Vitest tests plus 4 viewport tests passed.
- `npm run lint`: passed.
- `npm run build`: passed (production frontend and TypeScript).
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`: passed.
- `cargo build --manifest-path src-tauri/Cargo.toml --bin opendock`: passed;
  the native development executable was rebuilt without launching user VMs.
- Native library tests: 121 passed, 46 opt-in hardware tests skipped by default.
- CUDA host-library tests: 4 passed, 1 opt-in hardware test skipped by default.
- Agent `go test -race ./...`: passed in the WSL development toolchain.
- Explicit application CUDA hardware test passed on RTX 5090 Laptop GPU in
  266 seconds: Python and native C kernels, non-root computation, actual WSL
  resource ceilings, terminals, read/write My PC and detach, cross-engine private
  TCP/files and disconnect, OCI-to-CUDA backup migration, snapshot/restore,
  GPU denial after disconnect, clean shutdown/restart persistence, live/offline
  VHDX metadata, and simulated lost-owner recovery through the Stop path.
- These tests use `build/cuda/integration-runtime` plus disposable QEMU data;
  they do not use the application's real environment directory. No screenshots.

## Remaining work and release boundaries

The request for GPU/CUDA in **every VM and MicroVM is not finished**. No HCS VM
provider or GPU-capable lightweight guest profile was added. They need lifecycle,
display/input, network/files/backups integration and compatible guest driver
stacks, followed by actual guest workload tests. The shell is not elevated, so
HCS setup/validation also needs a future administrator-enabled session. Merely
running the existing QEMU implementation as administrator will not add CUDA.

Do not market native VM/MicroVM CUDA, general AMD/Intel compute support, per-GPU
CUDA filtering, VRAM quotas, or compatibility with every OCI image. LAN publishing
still depends on host firewall/routing; the hardware test verifies the private
graph bridge, not every external LAN configuration. Native GUI interaction and
Windows/Linux GPU-PV guest workloads were not tested this pass. The QEMU appliance
binary was not replaced; shared-agent source fixes reach it on its next payload
build, while the separately built CUDA payload contains them now.

The native all-artifact rebuild initially ran out of host disk space. No user
data or cache files were deleted. Windows lossless compression of the verified
`src-tauri/target/debug/incremental` build-cache directory reduced its physical
size by about 9.1 billion bytes. This is reversible and does not compress VM disks.
Subsequent native checks/tests use `CARGO_INCREMENTAL=0` in their command process
only, not a global environment setting.

See [CUDA setup and developer commands](cuda/README.md) for usage and reproduction.
