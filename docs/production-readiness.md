# Yougori validation report

Validation date: 9 September 2026. Scope: the Windows x64 desktop, its bundled
CLI, OCI appliance, microVM/VM runtime, guest agents and NVIDIA CUDA integration.

## Release decision

This is an engineering validation report, not certification for every computer.
The current release target is Windows x64. Do not advertise native AMD/Intel GPU
compute, CUDA inside ordinary QEMU VMs/microVMs, or ARM/macOS/Linux desktop support.
NVIDIA CUDA containers require compatible NVIDIA hardware/drivers and WSL 2.

The release still requires clean-machine installer/upgrade/uninstall acceptance,
publisher signing, a project license and third-party redistribution review.
Paid-provider credentials and live public publishing were not used during this
run. See [the release checklist](release-readiness.md) for those release gates.

## Fixes made during this review

- Backup imports reject unsafe archive paths and entries. Failed secure-VM
  imports clean up staged disks instead of leaking storage.
- Host file sharing rejects ambiguous HTTP framing, duplicate authentication
  headers and oversized requests.
- The cloud guest agent bounds terminal writes without holding its global lock,
  rejects duplicate streams, and cleans up disconnected execution sessions.
- CLI safety flags reject invalid booleans, conflicting targets/actions and
  duplicate aliases. The CLI checks the runtime server's OS user before sending
  request data.
- Production bundles cannot enable the browser test backend. A second developer
  launch cannot force-kill a running desktop and its guests to reclaim a port.
- Publishing, service-port and folder dialogs prevent duplicate submissions and
  accidental dismissal while an operation is pending.
- Failed installer preparation cleans up its owned terminal; closing a tab
  cancels queued paste work. VM displays have a connection timeout and an
  explicit reconnect action. Rendering failures show a recoverable error page.
- The real Ollama download exposed a disk-full failure caused by retaining a
  multi-GB uncompressed archive during extraction. Ollama now extracts directly
  from the compressed archive, with both pipeline exit statuses checked. Tests
  cover decompression/extraction failures and prevent false success messages.
- Small-window sidebar actions remain reachable. Nonmodal notifications cannot
  block modal buttons, and persistent notifications can be dismissed.
- Release preflight verifies all runtime payload hashes, rejects unverified
  extras and unsupported targets, and checks version consistency. Installers
  reject downgrades while preserving the existing application-data identifier.
- The separately bundled CLI now links its C++ runtime statically. A PE import
  check rejects accidental dependencies on an unbundled Visual C++ runtime.
  The portable CLI was also run from outside the repository and connected to
  the running desktop using a read-only status request.
- Updated the vulnerable test dependency. Added CI, regression tests, isolated
  browser-test ports and repeatable disposable native integration test groups.

## What the tests exercise

Completed gates:

- Frontend: **284 unit tests passed** across 41 files; lint and TypeScript passed.
- Build/portability scripts: **13 tests passed**.
- Bounded native-test process harness: **six regressions passed**, covering output
  floods, incremental progress, preserved failure status and process/pipe timeouts.
- Browser: **120 tests passed**, zero retries, in 3.3 minutes. Screenshot, video
  and trace capture were disabled.
- CLI: **21 tests passed**, including an actual Windows named-pipe ownership check.
- Desktop Rust: **144 tests passed**; 49 opt-in integration/experimental tests are
  marked ignored in the ordinary unit run and must be accounted for separately.
  Native `cargo check --all-targets` and the complete ordinary Cargo test command
  (including the binary/doc-test targets) passed.
- Disposable native integration: **39 tests passed** (14 boot/storage/recovery,
  17 workload/connection/backup/app, six host-integration, one real CUDA lifecycle
  and one Windows Setup/restart test). No failed cases in these completed groups.
- Linux Go guest agent: **41 tests passed** with the race detector; `go vet` passed.
- Python cloud guest agent: **13 integration tests passed** on Linux.
- CUDA host library: **6 tests passed**; two hardware/driver-dependent tests remain
  explicitly ignored in that unit-test target. The separate real CUDA application
  lifecycle test passed on an NVIDIA GeForce RTX 5090 Laptop GPU.
- Windows Setup: real hardware-accelerated boot, TPM 2.0, enforced Secure Boot,
  guest restart and return to the visible installer passed in **137.4 seconds**.
  This is not a completed Windows installation.
- `npm audit`: **zero reported vulnerabilities** at the time of this run.

Real upstream tool downloads were exercised in fresh Ubuntu 24.04 containers,
without sign-in, models, services or public ports:

| Tool | Verified installed version | Result |
| --- | --- | --- |
| Codex | 0.153.4 | Passed |
| Claude Code | 2.1.266 | Passed |
| Gemini CLI | 0.59.0 | Passed |
| Ollama | 0.33.3 | Passed after the disk-space fix |
| OpenCode | 1.18.29 | Passed |
| Kilo Code | 7.5.16 | Passed |
| OpenClaw | 2026.9.3 | Passed |

The initial seven-tool run intentionally remains recorded as failed: it found
Ollama's extraction problem while the other six tools passed. The focused Ollama
rerun passed after the fix in 162.4 seconds. Its warning that no Ollama server was
running is expected: this test installs/verifies the client without starting a
service. Mocked installer tests additionally cover eight package-manager families
and failure paths; they do not certify real installations on every OCI image.

| Area | Verification |
| --- | --- |
| Dashboard, graph and guide | Browser automation with the test adapter: creation, connections, ports, instructions, themes, dialogs, errors, terminal tabs and responsive layouts. This does not substitute for native runtime tests. |
| Containers | Real lifecycle, MongoDB/Redis/Nginx startup, resource enforcement and resizing, snapshots, backup/restore, factory reset, deletion and orphan recovery using temporary data. |
| MicroVMs | Real boot, terminals, files, snapshots/backups, resource changes, private networking, internet attach/detach and graphical-app support. |
| VMs | Real QEMU/QMP/VNC, boot selection, warm restarts, firmware/Secure Boot and unsigned-media rejection, disk sizing, identity-preserving backup/reset and owned-process recovery. |
| Connections and files | Private container/microVM exchanges, VM adapter routing, selected-folder read/write permissions, disconnect revocation, service discovery and forwarding. |
| NVIDIA CUDA | Real kernel computation and native-C verification, resource budgets, selected-folder access, OCI/CUDA file and network exchange, backup migration, snapshot restore, GPU disconnect denial and orphan recovery. |
| Host integration | Real PowerShell input/resize/cleanup, hidden WebView2 windows and IPC, Windows GPU measurement, temporary credential-vault records and isolated local Cloudflare-helper tests. |
| CLI and agents | CLI parsing/catalog, safety confirmation, same-user pipe verification, real lifecycle automation, Go guest-agent tests with race detection and Python cloud-agent integration tests. |

Tests use disposable runtimes and test-owned files. Existing saved environments
are not reset, deleted or used as integration fixtures. The Windows Setup check
reads the selected installation ISO without modifying it; it does not complete
a Windows installation. No screenshots, videos or browser traces are captured.
The final read-only inventory still showed all seven saved user environments,
all stopped. No disposable QEMU or native-test processes remained after testing.

## Built installers

The final `npm run desktop:build` completed successfully after the Ollama fix.
Read-only MSI and NSIS catalog checks found **277 of 277 expected files** in each
installer, with no missing files or size mismatches. The desktop, both CLI aliases
and all four runtime directories have the expected installed layout. Neither
installer was installed over the existing app during this review.

| Artifact under `src-tauri/target/release/bundle/` | Bytes | Signature |
| --- | ---: | --- |
| `msi/Yougori_1.0.0_x64_en-US.msi` | 212,869,401 | Not signed |
| `nsis/Yougori_1.0.0_x64-setup.exe` | 190,943,728 | Not signed |

Final SHA-256 values (supersede intermediate builds):

```text
MSI  D1649DCF0863DE6358D1F49C296A3AC9401DDF8049FCB5BB5A9A1A5F4DD8D4B0
EXE  DCC3400208B1BAB0FB3F2414FB4736CCDA869EB1EE72867B363DDE3C2D9BF1F7
```

Package contents and a successful build do not prove clean-PC installation,
upgrade/uninstall behavior or driver compatibility. Those remain release gates.

## Repeating the checks

```powershell
npm run verify
npm run test:e2e
npm run test:harness
npm run release:check
pwsh -NoProfile -File scripts/test-production-runtime.ps1 -Group smoke,workloads,host
npm run desktop:build
```

Native integration logs and per-test results are written under unique
`artifacts/production-runtime-*` directories. Browser results are written to
`artifacts/e2e-results.json`. These generated files are deliberately not committed.

This run's native evidence directories are:

- `production-runtime-20260909-013507-21943783`: 14 boot/storage/recovery passes.
- `production-runtime-20260909-013730-94f967da`: 17 real workload passes.
- `production-runtime-20260909-014212-cbfdcc81`: six host-integration passes.
- `production-runtime-20260909-013720-ac756b1f`: real NVIDIA CUDA lifecycle pass.
- `production-runtime-20260909-014931-11df5c1e`: Windows Setup and restart pass.
- `production-runtime-20260909-015900-149957c0`: seven-tool download run;
  six passes and the original Ollama disk-space failure.
- `production-runtime-20260909-020915-b7f0c07d`: corrected real Ollama install pass.

GPU, Windows Setup and real upstream tool downloads are explicit opt-in groups;
they need their documented hardware/media prerequisites. Do not point disposable
tests at a user's runtime directory. Normal runtime stop/start is tested to
preserve data; factory reset is intentionally destructive to its selected target.

## Remaining limitations

- This machine cannot establish behavior on every CPU, GPU, Windows version,
  corporate security policy, driver, proxy, filesystem or installation path.
- The guest boot tests do not certify every Windows/Ubuntu release or complete
  every installer and post-install driver setup sequence.
- Real AWS/Azure/Google-cloud connections and paid backup/account routes require
  dedicated acceptance accounts. Cloudflare helper tests do not prove public
  DNS, account routing or visitor authentication.
- Downloaded tools and arbitrary OCI images can change independently of Yougori.
  An install/version smoke test does not validate a tool's paid account or every
  workload it might run.
- Unit tests and dependency scans are not a penetration test. Container isolation
  and GPU sharing are not guarantees against malicious guest/kernel/driver code.
- The built-in host PowerShell terminal is explicitly **not isolated**. Its
  starting workspace directory does not restrict the OS account's file access.
- Screenshot/capture functionality was not executed, in accordance with the
  instruction not to take images.
- Dependency maintenance warnings and native binary/source-license obligations
  remain documented in the release checklist; none are hidden by a passing build.
