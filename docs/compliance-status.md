# Third-party compliance work

Engineering review date: 2026-09-13. This record covers the current source tree,
frontend notices and runtime bytes in `compliance/release.json`.

## Changes completed

- Original Yougori code uses Apache-2.0 with Yougori LLC attribution in NOTICE,
  as selected by the project owner. Third-party components keep their licenses.
- Both Windows QEMU runtimes are built from exact revision
  `84f07211cc5b4fc6a371559bf8a5de4fb068e648`, with the recorded local patches.
  The previous stock runtime's JACK/Berkeley DB chain and unknown DLLs are gone.
- The TPM core/OpenSSL library runs in a separate BSD helper process. QEMU
  exchanges standard TPM command bytes and small lifecycle messages over
  anonymous pipes. Existing NV identities and firmware are preserved.
- All 70 DLL files have package or local-build provenance. The 26 third-party
  package/version pairs have collected source recipes, patches and distfiles.
  The local EGL bridge explicitly offers GPL-2.0-or-later or Apache-2.0; its
  QEMU distribution selects the GPL option.
- All 60 Alpine packages map to 35 exact aports source revisions with checked
  distfiles, including Linux, BusyBox and storage utilities.
- Pinned QEMU, TPM, EDK2 and firmware submodule sources are retained. All 18
  ordinary firmware/keymap files match the recorded QEMU source bytes.
- 134 Go dependency ZIPs match embedded Go module sums. Containerd, nerdctl,
  runc and CNI source trees match their embedded VCS revisions.
- The static OCI libraries also have matching Debian sources: glibc
  2.41-12+deb13u3, libseccomp 2.6.0-2 and btrfs-progs 6.14-1. The upstream build
  log and digest-checked amd64 build-base SPDX identify these inputs.
- The local mount helper rebuilt byte-for-byte using Ubuntu musl 1.2.2-4.
  Its complete libc copyright notice is included.
- Application notices cover 757 entries: 46 npm packages, 710 Cargo lockfile
  entries and the copied Coss UI source component. This includes Tailwind 4.3.3
  because its Preflight and utility CSS ship in the application, and conservatively
  includes Cargo build-only/other-target entries. Runtime
  notices cover Alpine, Go, Windows libraries and static OCI dependencies.
- All 26 copied Coss UI components and the shared class-name helper have explicit
  attribution and MIT terms. The upstream `apps/ui/` MIT exception is recorded
  at a pinned revision. Both declarations and license text are included in the
  application notice collection; Yougori's original changes retain Apache-2.0.
- A supplementary QEMU patch adds dated modification notices to all ten changed
  upstream source files. It retains the original functional patch bytes and
  binary build records. Verification against exported upstream sources confirms
  that removing only the new comment headers reproduces all 12 original
  build-source hashes.
- Frontend source/assets and copied UI files are now inventoried. Production
  CSS/module imports require notices even for npm development dependencies.
  The checker rejects missing copied-code license text, newly unreviewed source
  or assets, mismatched source indexes/checksums and stale publication evidence.
- The final zlib source gap was recovered without relaxing verification:
  GitHub had increased the generated patch's abbreviated blob-ID width;
  restoring the original width produced the exact recipe-pinned SHA-256.

## Validation

For the frontend/notice corrections, 15 JavaScript compliance tests and eight
Python collector tests passed, including omitted MIT notices, new copied files,
development-only CSS dependencies, changed source indexes and canonical source
archive generation. ESLint and the TypeScript/Vite production build passed.
The local source-material archive also matched byte-for-byte when regenerated
with Linux Python 3.10 and Node 24, confirming the CI cache preparation works
across Windows/Linux line endings and file permissions.
The QEMU annotation check restored the affected upstream files and verified
comment-only equivalence. No runtime rebuild was needed for these source notices.
The runtime checks described below are retained evidence from the earlier build.

The runtime passed disposable container/snapshot/network, full VM and microVM
checks. After the TPM process change, it passed Secure Boot rejection, secure
backup/restore, repeated ordinary and secure VM restarts, TPM cryptographic
self-tests, NV persistence, exclusive state locking, malformed-input handling,
normal helper cleanup and cleanup after forced QEMU termination.

The exported source archives were restored into a new directory. Applying the
provided QEMU patches reproduced all 12 changed source files byte-for-byte.
The original configure options and the 1,726-step Ninja dependency graph worked
from the exported trees. This was a configure/dry-run check, not a second full
compilation or a claim that all third-party builds are reproducible.

`docs/rebuilding-third-party.md` explains source restoration, component builds,
static-library relinking and installation of modified runtimes. Runtime checksum
manifests are editable integrity checks, not a vendor signature requirement.

## Preparing and distributing

The source archives are local in `build/compliance/bundle/`. The source index and
checksums select the archives for this runtime; unrelated old cache files are not
part of that bundle. The release report records the exact inventory and scope.

`npm run compliance:archives` checks evidence and archive bytes.
`npm run release:package` checks local packaging readiness, allowing installers
and their source archive to be prepared for review before publication.
`npm run release:distribution` additionally requires verified public source
access. Passing an automated check is an engineering result, not legal advice.

The intended delivery is the matching source bundle alongside each new installer,
with source index, checksums and rebuild instructions. Publishing the repository
alone would omit the large archives, which are deliberately ignored by Git.

The refreshed source bundle is prepared locally; its publication status is reset
until this exact source index has been published and verified.

Staging uses a dedicated source-bundle prerelease. The Linux workflow pins the
prior download URL and SHA-256 as a cache seed, recreates the current reviewed
local source material, and verifies all archives against the current inventory.
Windows, guest-agent and Linux checks run on staging pushes; main is promoted
separately after review. The source prerelease does not include app installers.

## Older releases still require follow-up

The current website EXE/MSI/DEB files have not been replaced or declared covered
by this new inventory. The retired stock QEMU identified itself as
`11.1.0 (v11.1.0-12130-ge470268ff4)`; its exact distributor source and several old
DLL mappings remain unverified. The previous evidence is retained under
`compliance/history/`. Current release preparation uses the replacement built
from available, recorded source. The historical source gap remains documented
separately.

A new source-built runtime addresses future releases. It does not retroactively
supply missing source or establish compatibility for the old binary combination.
Older recipients need the appropriate retained source materials too.

This record describes the prepared changes and local runtime validation. Git
history and the staging workflow runs record subsequent commits and CI results.
The publication field in `compliance/release.json` records source availability;
it is separate from the release of app installers or website downloads.
