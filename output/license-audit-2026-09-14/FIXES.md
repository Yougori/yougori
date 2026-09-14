# Staging license corrections — 14 September 2026

The current staging runtime has no unresolved findings in the completed engineering license review. This statement covers the recorded source tree and exact runtime bytes. It is not a legal certification or a clearance of the older public `main` branch, Git history or installer downloads.

The owner requested fixes and pushes on **staging only**. Main promotion and new installer releases remain separate.

| Audit finding | Correction |
| --- | --- |
| QEMU's in-process ANGLE DLL contained Apache SPIRV/Vulkan implementations | Rebuilt ANGLE from its exact retained revision and MSYS2 portability patches with D3D11 only. The 33 reachable targets and 1,633 compiler/source inputs exclude SPIRV-Tools, Vulkan Loader, VMA, SwiftShader and other disabled implementations. Preprocessing also proves that Roboto glyph data is absent. |
| Missing AMD VMA notice and incomplete embedded-component attribution | Added the exact historical VMA MIT notice. Both current runtime directories now contain full ANGLE/Chromium/xxHash/Khronos/generated-parser/compiler-support notices, also included in the main runtime notice collection. |
| Package metadata and ordinary import checks missed native components | Added a pinned review of all 77 Windows PE identities/imports, an explicit dynamic load graph, the exact ANGLE build record, component license decisions, source/header hashes, complete notices and regression checks. Replacing a DLL or regenerating an inventory does not update that approval automatically. |
| Future staging could copy the broad MSYS2 ANGLE DLLs again | Both staging scripts require an inspected D3D11-only build and check its binary and notice hashes. Offline source restoration/build instructions are included. |
| Public default branch predates the fixes | Kept changes on staging as instructed. Main must receive the reviewed changes when the owner is ready. Earlier distributed binary versions retain their own source/notice obligations. |

The rebuilt GLES DLL is 6,124,032 bytes (`f40b2c8eddf09fc52ba4701620776f8cbdde55d06d8c317c21e844936d758a8e`). The rebuilt EGL implementation is 252,928 bytes (`06f40e31e81b93a9dca4ec9a6241449aa0a007873e7abd799337d480c9908ed2`). Both QEMU runtime copies match. QEMU executables, the GPU-selection bridge and existing firmware identities were preserved.

License exceptions are explicit. Six Khronos Apache headers supply API declarations/constants/platform types without executable implementation; their source and Apache notice are retained. This narrow interface review does not cover Apache implementation libraries. Bison-generated output, GNU compiler support and LLVM PSTL use the recorded output/runtime exceptions. Chromium logging adaptations are covered by the retained Chromium BSD text. Android-only Bionic TLS snippets are outside the Windows compilation. See [component decisions](../../compliance/native.json) and [build/input evidence](../../compliance/evidence/angle-build.json).

The original audit remains unchanged as the record of what was found before these fixes: [baseline audit](REPORT.md). The fresh [native-literal comparison](native-code-traces-fixed.json) finds zero SPIRV-Tools, Vulkan Loader or VMA matches. Two common ANGLE extension/validation strings also occur in Vulkan source files; those strings alone do not imply backend inclusion. The actual target graph and compiler dependencies establish the exclusion.

Validation completed locally:

- 20 JavaScript compliance regressions and 13 Python collector/native-source regressions passed.
- Eight isolated, diskless GPU tests passed across ordinary and secure QEMU: automatic selection, both physical adapters, and refusal of an unavailable adapter.
- Real non-root GPU rendering passed in Alpine and Ubuntu containers. The Alpine test also switched from Intel to NVIDIA and retained hardware rendering.
- ESLint, the TypeScript/Vite production build, runtime payload checks and the complete matching-source archive checks passed.
- The final source inventory contains 237 archives, with zero recorded current-staging blockers. Runtime notices contain recognized texts for all 207 recorded source/package entries. Earlier npm/Rust/copied-UI/noVNC and firmware audit results remain applicable; these dependencies were not changed.

[GPU initialization evidence](../../compliance/evidence/angle-gpu-smoke.json), [actual rendering log](../../compliance/evidence/angle-render-test.txt), [compiler commands](../../compliance/evidence/angle-commands.txt), [target closure](../../compliance/evidence/angle-targets.json), [rebuild procedure](../../docs/rebuilding-third-party.md#windows-angle-graphics).

The runtime correction was pushed in `5be80b54a167c66940b771d51c13aced2ea1b8d2`. The new Linux checks exposed an existing Python 3.10 incompatibility in the Go source hash helper; `46bc2677e0b4e5a85da3122750c760577d6bdc44` corrected it without changing hash semantics. All thirteen Python tests then passed on Ubuntu 22.04.

The [matching source-only prerelease](https://github.com/Yougori/yougori/releases/tag/staging-sources-9b13340292f535bc) is public. An anonymous download of all 1,147,140,870 ZIP bytes matched SHA-256 `3d47cccfa14bf7b17a0b5d649f82aa4ac9ab94d45c44ee1e59352089fcbcc3a2`; public/embedded indexes, archive checksums and ZIP integrity also matched. [Verification evidence](source-publication.json) and the [verification script](verify-current-source-download.py) are retained. `npm run release:distribution` passed after this verification.

[Draft PR #4](https://github.com/Yougori/yougori/pull/4) holds the changes for review. The [staging workflows](https://github.com/Yougori/yougori/actions?query=branch%3Astaging) record the checked commits. Their final result is attached to the source prerelease as `staging-validation.json` when verification finishes. No main merge or new application installer publication is part of this work.
