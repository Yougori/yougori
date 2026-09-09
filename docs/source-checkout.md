# Source checkout setup

Git contains the application source, lockfiles, build scripts, product AI guides,
and applicable license notices. It excludes local development-agent setup,
personal documents, caches, generated runtime payloads, and compiled EFI files.
Cloning this repository does not clone any other repository automatically.
Explicit dependency/build commands can download their documented upstream
dependencies; source links in third-party notices are attribution, not commands.

## Windows desktop prerequisites

The desktop needs locally prepared payloads in `src-tauri/resources/runtime/`
and `src-tauri/boot-helper/bootx64.efi`. A fresh clone is not a ready-to-run
installer. Preserve existing local runtime files if already prepared.

1. Install the Node, Rust, Visual Studio C++/Windows SDK, and WebView2 prerequisites
   listed in the main README, then run `npm ci`.
2. Prepare 7-Zip and Ubuntu 22.04 in WSL, then follow the runtime-build section
   of the README and run `npm run runtime:build` to prepare standard QEMU and
   the Linux appliance. This step alone does not prepare every release payload.
3. Build the secure runtime using [the secure-runtime build instructions](../runtime/security/README.md).
   They describe the separate MSYS2/WSL dependencies and staging/install steps.
4. Build the CUDA guest payload with `scripts/build-cuda.sh` in the Linux build
   environment with Go, GCC, and musl-gcc. It writes the separate `runtime/cuda`
   files and checksum manifest used by the native build.
5. From PowerShell, run `./scripts/build-boot-helper.ps1`. Native fixture tests
   also need the `-TestFixture` and `-RestartFixture` builds.
6. Run `npm run cli:bundle`, then `npm run release:check` before packaging.

Do not run runtime replacement steps while Yougori or its guests are using
those files. Never replace required runtime images with user VM disks or backups.
Linux and macOS prerequisites and limitations remain in their platform guides;
they also require the generated appliance payload and applicable embedded build
inputs. Merely installing a host QEMU package does not generate those inputs.

Existing full desktop CI workflows require prepared runtime inputs. A checkout
without them cannot pass their release/native packaging stages. No runtime
download URL or release asset is configured or invented by this source cleanup.

## Source and release privacy

Generated runtime files stay local and are excluded from normal Git additions.
They are still included when building an installer. Excluding a binary from Git
does not sanitize an installer that later packages that local binary.

The secure QEMU build script maps workspace prefixes to `/yougori` so future
builds do not embed the builder's home directory through compiler file macros.
Previously compiled local payloads must be rebuilt and rescanned before release;
the cleanup did not edit or replace binaries in use.

Yougori's built-in AI access guides under `skills/yougori/` are product source,
not developer-agent setup. The CLI compiles them into its agent-access feature.
They are intentionally retained. Development-only skill lockfiles and agent
configuration directories are excluded from Git.

Legacy identifiers used for credential lookup, saved-data compatibility, and
runtime protocols remain documented in [compatibility notes](yougori-rename.md).
They do not refer to the developer's personal repositories. Copyright and
third-party attribution notices must be retained under their licenses.
