# Source checkout setup

Git contains application source, lockfiles, build scripts, product AI guides,
license notices, verified runtime payloads, and compiled EFI helpers. It excludes
local development-agent setup, personal documents, credentials, and build caches.
Cloning this repository does not clone any other repository automatically.
Explicit dependency/build commands can download their documented upstream
dependencies; source links in third-party notices are attribution, not commands.

## Windows desktop prerequisites

Install Node.js 24.19.0 with npm 11.17.0, the stable Rust MSVC toolchain, Visual
Studio C++/Windows SDK, and WebView2 as described in the main README. Then run:

```powershell
npm ci
npm run cli:bundle
npm run release:check
npm run desktop:dev
```

The bundled runtime lives in `src-tauri/resources/runtime/`; EFI helpers are in
`src-tauri/boot-helper/`. You do not need WSL or the runtime build toolchains for
an ordinary Windows source checkout. Linux and macOS prerequisites and
limitations remain in their platform guides.

### Development window cannot reach localhost

`npm run desktop:dev` starts both the native engine and Vite. Keep that command
running while using the development app. Starting the debug executable with
`yougori-cli app start` starts only the engine; its dashboard still needs Vite.

On Windows, a second `npm run desktop:dev` now checks for an existing engine
before starting either part. This includes engines with no visible window.
If an old development engine is still running after Vite has closed, finish any
pending operations, then shut it down normally and restart development:

```powershell
.\src-tauri\resources\cli\yougori-cli.exe app quit --yes
npm run desktop:dev
```

`app quit` also stops that engine's workloads and publications. Container files,
VM disks and saved snapshots remain on disk. Installed release builds include
their frontend and do not need Vite.

## Full Windows verification before pushing

With the Node/npm versions above, stable Rust, Git Bash, Python 3 with the `py`
launcher, and PowerShell 7 available, run:

```powershell
npm run verify:windows
```

This runs the Windows workflow's dependency, checksum, frontend, native, portable
CLI, browser and process-harness checks locally. It installs Playwright's pinned
Chromium; the normal browser suite uses the same channel as CI. First-launch
onboarding is tested separately from returning-user interactions. No tests are
disabled, and this command does not commit, push, publish or trigger GitHub Actions.
It does not replace the Linux packaging/runtime checks or hardware-specific
release certification described in the platform guides.

## When GitHub checks run

Every push to `staging` automatically starts only Windows verification.
Guest-agent, Linux desktop preview and macOS checks are manual. Pushes to other
branches and pull requests have no automatic trigger. All workflows can still
be started with **Run workflow** in GitHub Actions. Wait for Windows verification
and any other checks relevant to the changes to pass, then follow the
[promotion workflow](../CONTRIBUTING.md) before merging into `main`.

## Maintainer runtime rebuilds

1. Prepare 7-Zip and Ubuntu 22.04 in WSL, then follow the runtime-build section
   of the README to rebuild standard QEMU and the Linux appliance. Use the
   `-RuntimeDirectory` option of `scripts/build-bundled-runtime.ps1` to stage
   outside the installed runtime; secure-runtime inputs must also be prepared.
2. Build and stage the secure runtime using
   [the secure-runtime instructions](../runtime/security/README.md). The QEMU
   build supports `YOUGORI_QEMU_BUILD_DIRECTORY`; the staging script accepts
   `-QemuBuildDirectory` and `-OutputDirectory`.
3. Build the CUDA payload with `scripts/build-cuda.sh` in the Linux build
   environment with Go, GCC, and musl-gcc. Its optional first argument selects
   a staged output directory.
4. Build the EFI helper with `scripts/build-boot-helper.ps1`, also using
   `-TestFixture` and `-RestartFixture` for the native test fixtures. If the
   production helper changes, regenerate the default Secure Boot enrollment
   with `scripts/build-secure-vars.sh <bootx64.efi> <firmware-output-directory>`
   before staging the secure runtime. Existing VM variable stores stay intact.
5. Scan staged payloads for personal paths and credentials, retain third-party
   notices, and verify checksums before replacing the bundled copies. Run
   `npm run release:check` and the bounded native runtime tests before committing.

Do not replace runtime files while Yougori or its guests are using them. Back up
the previous payloads outside the tracked runtime directory. Never package user
VM disks, backups, private keys, build caches, or generated development logs.
Distributing third-party binaries also requires satisfying their licenses;
checksum verification alone is not a license-compliance check.

## Source and release privacy

The secure QEMU build uses a neutral installation prefix and maps workspace
prefixes to `/yougori`; TPM builds also map compiler file paths. Go guest tools
use `-trimpath`. Rebuilt payloads still need a privacy scan before publication.

Yougori's built-in AI access guides under `skills/yougori/` are product source,
not developer-agent setup. The CLI compiles them into its agent-access feature.
They are intentionally retained. Development-only skill lockfiles and agent
configuration directories are excluded from Git.

Legacy identifiers used for credential lookup, saved-data compatibility, and
runtime protocols remain documented in [compatibility notes](yougori-rename.md).
They do not refer to the developer's personal repositories. Copyright and
third-party attribution notices must be retained under their licenses.
