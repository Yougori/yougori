# Third-party compliance work

Engineering review date: 2026-09-14. This record covers the current source tree,
frontend notices and runtime bytes in `compliance/release.json`.

## Changes completed

- Original Yougori code uses AGPL-3.0-only with attribution in NOTICE and a
  separate paid commercial licensing option for rights Yougori LLC can grant,
  as selected by the project owner. Third-party components keep their licenses,
  and previously granted Apache permissions remain valid. See COMMERCIAL_LICENSE.md.
- Both Windows QEMU runtimes are built from exact revision
  `84f07211cc5b4fc6a371559bf8a5de4fb068e648`, with the recorded local patches.
  The previous stock runtime's JACK/Berkeley DB chain and unknown DLLs are gone.
- The TPM core/OpenSSL library runs in a separate BSD helper process. QEMU
  exchanges standard TPM command bytes and small lifecycle messages over
  anonymous pipes. Existing NV identities and firmware are preserved.
- All 70 DLL files have package or local-build provenance. The 25 remaining package DLL
  package/version pairs have collected source recipes, patches and distfiles.
  ANGLE is a separately recorded local build from the retained 26th package
  source archive; its top-level package label is not used as a complete license inventory.
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
  application notice collection; original Yougori changes in the current version
  are offered under AGPL-3.0-only, without withdrawing earlier Apache grants.
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

## Windows graphics correction on 14 September

Both runtimes now use D3D11-only ANGLE built from revision
`890b5d8fa2988e3719e0d80421bf3e927db9cd5c` with the retained MSYS2 portability
patches. The requested DLL targets have 33 reachable build targets. Their 1,633
compiler/source inputs exclude SPIRV-Tools, Vulkan Loader, VMA, SwiftShader and
other disabled implementations. The preprocessed overlay font function returns
`nullptr`; Apache Roboto glyph data is absent. The GL-to-D3D11 translator remains.

The GLES DLL is 6,124,032 bytes, SHA-256
`f40b2c8eddf09fc52ba4701620776f8cbdde55d06d8c317c21e844936d758a8e`.
The EGL implementation is 252,928 bytes, SHA-256
`06f40e31e81b93a9dca4ec9a6241449aa0a007873e7abd799337d480c9908ed2`.
Both runtime copies match these exact builds.

`compliance/native.json` records selected terms for ANGLE, Chromium helpers,
xxHash, Khronos interface headers, generated Bison/Flex output and compiler
support. The six Apache Khronos headers provide declarations, constants and
platform types; the review is limited to interface use under Apache section 1,
not incorporation of Apache implementation libraries. Full source/header terms
and the applicable compiler/output exceptions are retained.

`ANGLE-NOTICES.txt` accompanies each runtime and is included in
`RUNTIME_LICENSES.txt`. The omitted AMD VMA MIT notice is retained for the retired
package, even though VMA is absent from the new build. There are 208 runtime
source/package notice entries with recognized texts.

The compliance gate now pins all 77 Windows PE identities/imports and the
reviewed ANGLE build. It verifies dynamic loads through libepoxy and the EGL
bridge, checks each embedded component decision and its notice, and rejects
changed binaries, excluded implementation paths or missing evidence. Both
staging scripts require the inspected D3D11 build instead of copying the
package's broader ANGLE DLLs.

## Validation

The graphics correction passed 20 JavaScript compliance tests and 13 Python
collector/native-source tests. Eight diskless checks passed across both QEMU
runtimes, including automatic GPU selection, each physical adapter and rejection
of an unavailable adapter. Non-root rendering workloads passed in Alpine and
Ubuntu containers; the Alpine test also switched from Intel to NVIDIA without
losing the hardware renderer. The retained logs identify the actual renderer.
ESLint and the TypeScript/Vite production build passed. Exact-literal comparison against the old embedded implementations
now finds zero SPIRV-Tools, Vulkan Loader and VMA matches. Two remaining ANGLE
Vulkan-source literals are also used by shared validation/extension code; the
build graph and compiler inputs, rather than shared strings, establish exclusion.


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

Rebuilding a source bundle resets its publication status until the exact new
source index has been published and verified. The current result is recorded in
`compliance/release.json`; a prior download cannot approve a different index.

Staging uses a dedicated source-bundle prerelease. The Linux workflow pins the
prior download URL and SHA-256 as a cache seed, recreates the current reviewed
local source material, and verifies all archives against the current inventory.
Windows, guest-agent and Linux checks run on staging pushes; main is promoted
separately after review. The source prerelease does not include app installers.

## Main and older releases still require follow-up

The owner requested staging-only work. The public default `main` branch still
predates these corrections; promotion is a separate owner decision. This review
does not describe the whole public Git history as cleared.

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
