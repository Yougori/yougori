# Release readiness

This checklist is a release gate, not a statement that every computer or feature
has been certified. Automated tests use mocked browser backends and disposable
runtime directories; they cannot replace a packaged-install test on clean PCs.

## Supported release scope

| Host / feature | Release scope |
| --- | --- |
| Windows 11, x64 Intel/AMD CPU | Current desktop target; test both CPU vendors before advertising coverage. |
| Windows Hypervisor Platform | Preferred acceleration when available. Test disabled/unavailable virtualization and the slower software fallback. |
| NVIDIA CUDA containers | Optional WSL 2 and compatible Windows NVIDIA driver/hardware required. Test setup, update, unavailable GPU, and a real CUDA kernel. |
| AMD/Intel GPU computing | Not implemented; never advertise CUDA support on these GPUs. |
| QEMU VMs / MicroVM CUDA | Not implemented. A working virtual display does not prove GPU compute. |
| Windows 10 host | Not certified; Windows VM warm-reboot runtime uses a Windows 11 API when available. |
| Windows ARM64, Linux/macOS desktop | No matching shipped runtime; packaging is rejected instead of producing a broken installer. |
| Windows/Linux guests | Compatibility depends on architecture, installation media, guest requirements and drivers; it is not a promise to run every OS/application. |

## Reproducible local checks

Use Node.js 22.12+ (22.x) or 24+, Rust stable MSVC, C++ Build Tools and WebView2.
Run from a normal, non-administrator PowerShell in the repository:

```powershell
npm ci
npm audit --audit-level=moderate
npm run verify
npm run test:e2e
npm run test:graph
npm run release:check
npm run desktop:build
```

The release preflight hashes all four bundled runtime payloads, rejects extra
unverified files, escaping paths and test-adapter builds, and checks matching
app versions. The CLI bundler uses the same target as the desktop, statically
links its Visual C++ runtime and checks the resulting PE imports, so this
separately built executable does not silently require an unbundled VC++
Redistributable on a fresh PC. Neither
command publishes, signs, installs drivers nor changes existing environments.

Publish changes to `staging` and follow the [promotion workflow](../CONTRIBUTING.md)
before merging them into `main`. Each push to `staging` automatically runs only
Windows verification. Other branches and pull requests do not automatically
trigger these workflows. Guest-agent, Linux desktop and macOS checks run only
when explicitly started; manual Windows runs also remain available.
CI does not install Windows/Ubuntu guests, exercise physical GPUs, use cloud
accounts, publish public tunnels, or certify installers. A passing workflow is
necessary, not sufficient, for release. Dependency audits must be rerun for each
release; a zero-advisory result is only a point-in-time check.

Browser tests locally use installed Google Chrome by default. CI instead
downloads the Chromium revision matched to the locked Playwright version and
sets `PLAYWRIGHT_BROWSER_CHANNEL=chromium`; it does not depend on whichever
Chrome version happens to be on the hosted runner. To use the same browser
locally, run `npx playwright install chromium --no-shell` and set that variable
before `npm run test:e2e` / `npm run test:graph`. Other supported Playwright
channels can be selected explicitly. These are developer test dependencies;
end users need WebView2, not Chrome, Node, Rust or Playwright.
The installer fixture and tutorial HTTP tests additionally use Git Bash and
Python 3 on the test host. CI checks these prerequisites explicitly so that a
missing tool cannot silently turn those tests into a green but skipped suite.
Some native integration groups need more than the application's basic launch
requirements: the capacity-resize test needs eight logical CPUs and enough free
RAM for a 4 GB container envelope; host-terminal tests need `npm run cli:bundle`,
and installed-helper tests need the pinned Cloudflare helper. These are test
prerequisites, not a claim that every user needs those developer tools.

For an explicit upstream tool-download smoke test (not part of normal CI):

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib workspace_installer_real_upstream_downloads -- --ignored --nocapture --test-threads=1
```

This defaults to OpenClaw. Set `YOUGORI_INSTALLER_SMOKE_TOOLS` to a comma-separated
list of `codex,claude,gemini,ollama,opencode,kilo,openclaw`, or `all`, to select other
tools. Each tool gets a fresh Ubuntu 24.04 container in a separate temporary
runtime, 3 GB container RAM, a 300-second provisioning deadline and a 600-second
installation deadline. Successful installation must finish through the real PTY
and pass a separate `--version` command. Output retention and cleanup are bounded.
The optional all-tools run can download multiple GB and take over an hour; it
does not sign in, start an inference/gateway service, download models, publish
ports, or modify user environments. A passing Ubuntu smoke test does not certify
every OCI base image or future upstream installer release.

## Packaged acceptance checks still required

Record the app version, machine/OS/driver versions, expected/actual result and
logs for each case. Use disposable accounts/environments and test data only.

- Fresh Windows user with no Node/Rust/Docker/QEMU developer tools. Install the
  actual installer, launch from Start and another working directory, use the
  bundled CLI, then reboot the host and launch again.
- Check paths containing spaces and non-ASCII characters; non-admin users;
  restricted corporate machines; offline launch; missing WebView2; proxy/DNS
  failure; low disk space; low memory; and virtualization unavailable.
- Create/start/pause/resume/restart/stop/delete each available environment kind.
  Verify ordinary stop/restart preserves data, explicit factory reset removes
  only the selected environment's data, and deletion frees managed storage.
- Complete Windows and Ubuntu installation, including multiple automatic guest
  restarts, then stop/start and verify saved files and guest boot identity.
- Independent terminals/windows; copy/paste; tool installers; service discovery;
  internet attach/detach; private connections across all supported pairs;
  one-way/read-only and bidirectional file permissions; disconnect revocation.
- Test local-only and explicitly authorized public publishing. Confirm no
  unintended host/guest ports are exposed and stopped environments lose their
  publication. Test optional Cloudflare credentials and invalid/expired ones.
- Test local backup and restore to a separate node; cancelled, truncated and
  corrupted backups; cloud providers with dedicated test credentials/buckets;
  interruption/retry; encryption-key recovery; and quota/access-denied errors.
- Test abrupt process/host shutdown recovery only with disposable data. A second
  app instance must not corrupt disks. Stop/recovery must target owned processes.
- Upgrade an installed previous release, preserving disks, snapshots, settings,
  CLI compatibility and pinned firmware. Uninstall/reinstall must not silently
  erase user data. Test both generated installer formats if both are shipped.
  New installers set `allowDowngrades: false`, preventing their installation
  over a newer registered version. Test this with two distinct version numbers.
  This installer guard cannot stop a previously built permissive installer or
  someone manually running an old copied executable; backups and compatibility
  checks remain necessary. Reinstalling the same version is not a downgrade.

## Publication requirements

- Choose and include the project's own license before calling the release open
  source. No license is selected automatically on the owner's behalf.
- Audit third-party notices, exact corresponding-source distribution and local
  patches for shipped QEMU/Linux/other components. URLs alone are not a completed
  redistribution review; keep the corresponding source available with releases.
- Sign the desktop/installer with the publisher's certificate, timestamp it and
  validate the actual downloaded artifact. Signing credentials are not in this
  repository and no signing/publishing is performed by verification.
- Publish accurate minimum requirements, known limitations, backup/recovery
  guidance, support/security contact and release notes. Do not claim universal
  hardware compatibility, perfect isolation or guaranteed recovery.

Upstream references: [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[Tauri downgrade policy](https://v2.tauri.app/reference/config/#allowdowngrades),
[Playwright browser channels](https://playwright.dev/docs/browsers#chromium),
[NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/index.html).
The development dependency upgrade to Vitest 4.1.11 addresses
[GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

## Dependency review, 9 September 2026

- `npm audit` after the Vitest update: zero reported advisories, including
  development dependencies. This does not audit the bundled native runtimes.
- An OSV API query of 709 distinct crate versions across the desktop, CLI and
  CUDA lockfiles found seven distinct RustSec notices (one also has a GHSA alias).
  `cargo tree --target x86_64-pc-windows-msvc --invert ...` confirmed that the
  `glib` unsoundness and `proc-macro-error` maintenance notice are outside the
  current Windows target. They still block claiming a certified Linux desktop.
- Five `unic-*` crates remain transitive dependencies of Tauri's `urlpattern`.
  Their notices are **unmaintained dependency warnings**, not a demonstrated
  exploit in Yougori. There is no fixed version listed; resolving them requires
  an upstream migration, not silently suppressing advisories. Track this before
  each release. This review is not equivalent to a native-code security audit.
- The six module versions recorded in the guest agent's `go.sum` were also
  queried. The only match was `golang.org/x/sys`'s Windows-only
  `NewNTUnicodeString` overflow; the shipped agent is compiled for Linux and
  does not import that Windows package. Reassess if a Windows agent is added.

Sources: [OSV API](https://google.github.io/osv.dev/api/),
[GLib unsoundness](https://rustsec.org/advisories/RUSTSEC-2024-0429.html),
[proc-macro-error maintenance](https://rustsec.org/advisories/RUSTSEC-2024-0370.html),
[UNIC maintenance](https://rustsec.org/advisories/RUSTSEC-2025-0081.html),
[Go Windows string conversion](https://pkg.go.dev/vuln/GO-2026-5024).
