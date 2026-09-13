**Yougori third-party license audit — 14 September 2026 (Europe/Warsaw)**

**Result: I would not describe the current GitHub project as fully compliant yet.** The recent fixes materially improve `staging`, but the default public branch still predates them. There is also a newly substantiated licensing concern inside the current Windows graphics runtime and a missing native-component notice.

This review focuses on third-party/open-source components and the public GitHub repository, as requested. Building or publishing new installers is outside the requested next steps. It is an engineering review of actual license evidence, not a legal certification; the combined-binary issue below needs qualified open-source licensing judgment.

| Scope checked | State observed |
| --- | --- |
| Local checkout and public `staging` | `111564d721258ff589f028f8a1867e6ef5fb854f` |
| Public `main`, also GitHub's default branch | `959ae46b2df53f965c1ddf33f57ec5ca17115c70` |
| Original code license on staging | Apache-2.0, with Yougori LLC attribution and third-party exceptions |
| Original code license on main | Yougori Internal-Use License 1.0 |
| Binary material in the repository | 279 tracked runtime files, including QEMU executables, 70 DLL files, Linux appliance/kernel material and firmware |

Repository downloads already include those binary components. Their source and notice obligations therefore remain relevant to GitHub even before a new installer exists. GPLv2 provides source-delivery requirements for executable/object-code distribution; simply calling a repository a source repository does not change the contents being supplied. [GPLv2, section 3](https://raw.githubusercontent.com/qemu/qemu/84f07211cc5b4fc6a371559bf8a5de4fb068e648/COPYING).

**1. Confirmed — the default GitHub branch has not received the licensing and third-party fixes.**

GitHub's public API identifies `main` as the default branch. Its license restricts redistribution and explicitly identifies itself as a restricted-use license. It consequently does not give the open-source permissions that the Apache-licensed staging branch gives. This is a mismatch with the intended public open-source project, rather than a claim that selecting a proprietary license for independently owned code is itself unlawful. [License currently reached through main's recorded commit](https://github.com/Yougori/yougori/blob/959ae46b2df53f965c1ddf33f57ec5ca17115c70/LICENSE).

At that main commit, the following staging corrections are absent:

- `NOTICE` and the new `APPLICATION_LICENSES.txt` / `RUNTIME_LICENSES.txt` collections.
- The Coss UI attribution/license file for the copied components.
- The dated QEMU modification-notice patch.
- The replacement stock QEMU runtime that removes JACK/Berkeley DB.

Main still contains `libdb-6.2.dll` with SHA-256 `4035b713d0b127c87a6f369950fe9fde052f042438e5a7cf53df0959a8349c90`, the Berkeley DB DLL identified under AGPLv3 in the retained prior audit. Its QEMU and JACK hashes likewise match the historical runtime. That leaves the previously documented source-coverage and GPL/AGPL combination concerns relevant to the public repository, independently of the website installers. This is not a finding that the entire application becomes AGPL.

**Action:** finish the remaining staging findings, then promote the reviewed licensing/source/runtime corrections to the branch intended for ordinary GitHub users. Keep an explicit source association for every retained binary version. Changing the current default-branch files alone does not resolve obligations for older copies already obtained from Git history.

Evidence: [public repository metadata](public-repository.json), [public branch commits](public-branches.json), [main file presence and binary hashes](main-branch-review.json), and the [retained historical audit](../license-audit-2026-09-13/REPORT.md). The Internal-Use License already exempts separately licensed components; this review does not assume that its restrictions automatically override the GPL/MIT licenses.

**2. High priority — the current QEMU/ANGLE graphics combination has a GPLv2/Apache-2.0 compatibility problem requiring resolution.**

This finding concerns the current staging runtime, not just the retired runtime. Both copies of `libGLESv2.dll` have SHA-256 `710e246f405a6f63005c0d91f385a1b7e62fb1cfc566fd0fbde01b7319a0d6a4` and map to MSYS2 ANGLE `2.1.r25748.890b5d8f-6`. The package metadata describes ANGLE as BSD-3-Clause, but that does not describe all code compiled into this DLL.

The exact retained recipe enables the Windows Vulkan backend and sets `angle_shared_libvulkan=false`. Inspection of the DLL found:

- **1,659 distinct source-file/literal matches** against non-test SPIRV-Tools implementation files from revision `257a227fbadf8176ea386c7d8fb9b889cbf08640`.
- **1,933 such matches** against non-test Vulkan Loader implementation files from revision `235d1d2cf617af03a2ecbf6e951287595138feda`.

These include distinctive parser and loader diagnostics, not merely library names or optional dependency declarations. SPIRV-Tools carries Apache-2.0, and the matched Vulkan Loader implementation explicitly carries Apache-2.0. The matched files and binary offsets are recorded in the evidence. [SPIRV-Tools license at the recorded revision](https://raw.githubusercontent.com/KhronosGroup/SPIRV-Tools/257a227fbadf8176ea386c7d8fb9b889cbf08640/LICENSE), [Vulkan Loader implementation license](https://raw.githubusercontent.com/KhronosGroup/Vulkan-Loader/235d1d2cf617af03a2ecbf6e951287595138feda/loader/extension_manual.c).

On the QEMU side, both current executables contain the distinctive diagnostics from `hw/virtio/iothread-vq-mapping.c`, whose upstream header explicitly says **GPL-2.0-only**. This corroborates inclusion of code that cannot simply be treated as GPLv2-or-later. The binaries do not expose a usable COFF function-symbol table, so these are source/build/string correlations, not a claim to have obtained a complete linker map. [Exact QEMU source file and license](https://raw.githubusercontent.com/qemu/qemu/84f07211cc5b4fc6a371559bf8a5de4fb068e648/hw/virtio/iothread-vq-mapping.c).

The application requests QEMU's `egl-headless` graphics path. QEMU imports libepoxy/virglrenderer, and the project's EGL bridge loads `libEGL_angle.dll` in the QEMU process; ANGLE's EGL loader loads its GLES implementation. The project's GPU documentation explicitly describes this arrangement. Selecting D3D11 at runtime does not remove the Vulkan/SPIRV code already incorporated into the supplied graphics DLL.

Apache-2.0 and GPLv2 are not generally compatible for a combined covered work. I found no recorded exception or other established licensing basis resolving this particular bundled, in-process combination. Whether a specific independent-work or linking exception applies requires legal judgment. **The evidence is sufficient to withhold a clean compatibility conclusion; it is not a court determination of infringement.** [Apache Software Foundation's compatibility explanation](https://www.apache.org/licenses/GPL-compatibility.html).

**Action:** resolve the native graphics stack before treating staging as cleared. A concrete engineering route to investigate is a rebuilt graphics configuration that excludes incompatible embedded components, followed by an inventory of the actual resulting DLLs. Alternatively, obtain and document a valid licensing basis for the exact combination. Adding notices or changing only Yougori's root license will not resolve incompatible component terms. Do not assume that choosing GPLv3 for the application relicenses GPL-2.0-only QEMU files.

Evidence: [native implementation traces](native-code-traces.json), [QEMU GPL-2.0-only source correlations](qemu-gpl2-only-symbols.json), [runtime GPU design](../../runtime/gpu/README.md), [EGL bridge](../../runtime/gpu/egl-bridge.c), and [recorded DLL imports](../../compliance/evidence/windows-pe-imports.json). Dynamic loads and code embedded inside a DLL are reasons that a PE import table alone is incomplete.

**3. Confirmed notice omission — Vulkan Memory Allocator's MIT attribution is missing from the prepared runtime notices.**

The exact ANGLE source inputs include Vulkan Memory Allocator. ANGLE's enabled Vulkan backend depends on its allocator implementation, and the retained MSYS2 recipe applies a patch to that implementation. The source archive's license carries **Copyright (c) 2017-2022 Advanced Micro Devices, Inc.** and the MIT permission/warranty text.

The prepared resource notices contain neither that AMD attribution nor the VMA license. The ANGLE entry in `compliance/evidence/runtime-notices.json` contains only `ucrt64/share/licenses/angleproject/LICENSE`, the base ANGLE BSD license. The allocator's source/license is retained inside the source inputs, so this is an omission from the prepared binary-side notice collection, not a claim that the license has been deleted from every source archive.

**Action:** include the exact VMA copyright and MIT text with the runtime, explicitly inventory VMA under the ANGLE DLL, and regenerate the notice evidence. Review the other embedded ANGLE components using their actual build inclusion and license terms. Generic Apache text already exists in the resources; absence of a separate Apache component name alone is not automatically an Apache notice violation.

Evidence: [native notice comparisons](angle-review.json), [exact retained VMA license](../../build/compliance/audit-2026-09-14/angle/bare-clones_vulkan_memory_allocator--LICENSE.txt), and the [runtime notice collector](../../scripts/compliance-runtime-notices.py).

The comparison evidence also lists candidate licenses from volk, xxHash and SPIRV-Headers. A failed exact-text comparison is only a candidate for review. For example, volk's relevant build dependency is conditional on a shared Vulkan loader, whereas this recipe selects a static loader. I have **not** counted every candidate as a confirmed violation or asserted that RapidJSON/SwiftShader is incorporated simply because a recipe mentions it.

**4. Confirmed control gap — the existing checks do not detect the native issues above.**

`npm run release:package` passes with zero *recorded* blockers despite findings 2 and 3. The runtime notice collector generally reads license files from each matched Windows binary package. Once it finds ANGLE's top-level license, it does not independently inventory the source-level dependencies compiled into that DLL. That leaves an incomplete native component/license view.

The current engineering record is explicitly limited and says automated checks are not legal approval. That limitation is appropriate. Nevertheless, the native compatibility and notice findings need to enter the component records and review decisions before those records can support a clean conclusion.

**Action:** add explicit records for embedded native components, their selected licenses, notice texts and parent binaries. Include reviewed dynamic-library loads as well as ordinary PE imports. Make an unresolved component/license review prevent an approval result. Preserve the existing hash checks; passing hashes establishes identity, not license compatibility.

Evidence: [package-check result](package-check.log), [collector](../../scripts/compliance-runtime-notices.py), [review record](../../compliance/engineering-review.json), and [release checker](../../scripts/compliance-check.mjs).

**What passed on staging**

| Area | Result and practical limit |
| --- | --- |
| Original source license | Standard Apache-2.0 and NOTICE; separately licensed source keeps its terms. Independent application code does not acquire another license just because separately licensed executables are supplied beside it. Actual linking remains subject to finding 2. |
| Copied UI | All 26 Coss UI components plus `src/lib/utils.ts` have explicit provenance and MIT notices. The pinned upstream UI-subtree MIT declaration is retained, rather than applying Coss's repository-wide AGPL default to the MIT exception. |
| Generated CSS | Tailwind 4.3.3 is included in the application notice collection, despite being marked as an npm development dependency. |
| Application inventory | 757 entries: 46 npm packages, 710 registry crates across three Cargo lockfiles, and one copied Coss component group. No production npm or registry-crate inventory omissions were found. |
| Rust package identity | All 710 available crate archives independently match their lockfile checksums. Compound/alternative license declarations are retained; this is not a conclusion about every possible target's system libraries. |
| Actual frontend build | An isolated Vite production build succeeded. All 34 npm packages contributing nonzero emitted JavaScript in that build have recorded notices. Tailwind's generated CSS is covered separately. |
| noVNC | All 66 archived package files match the installed source. Platform resource configurations include the source and licenses. |
| MPL components | noVNC and the five MPL-only crate entries have source records/archives. MPL permits separately licensed surrounding files while requiring the covered source to remain available on its terms. [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). |
| Source and runtime identity | 711 recorded input files and 237 local source archives pass the existing integrity checks; the complete runtime file set is checked. |
| QEMU change notices | Freshly restored the affected upstream source, applied the patches, and verified all ten dated notices. Removing only the notice comments reproduces all twelve recorded functional source hashes. |
| Ordinary firmware/keymaps | All 18 recorded files independently match the archived QEMU bytes, decompressing the supplied firmware blobs where needed. |
| Other runtime provenance | Retained evidence maps 70 DLL files to local builds or 26 external package/version pairs, and 60 Alpine packages to exact recipes/source inputs. Guest Go/OCI source records and static glibc/libseccomp/libbtrfs materials are retained. No new source-identity gap was found in these unchanged, hash-verified materials. |
| Replacement/relinking | Documentation provides source restoration, rebuilding/relinking and replacement instructions; checksum manifests are editable and the root license does not impose additional LGPL debugging restrictions. This review did not independently rebuild every native library. |

Verification evidence: [dependency inventory](inventory-check.json), [production frontend modules](frontend-build.json), [firmware comparisons](firmware-check.json), [QEMU patch verification](qemu-modification-notices.json), and [test output](compliance-tests.log). The compliance suite passed **15 JavaScript tests and eight Python tests**. Existing build warnings about mixed static/dynamic imports did not prevent the frontend build.

**Source availability and installer work deferred by scope**

Anonymous inspection found one public source prerelease. Its source index differs from the current local index only in `yougori-runtime-build-material.tar.gz`; all other 236 indexed archive identities are unchanged. The updated local material is present in the public staging source tree, and the workflow documents combining that tree with the prior source cache. Therefore, the unpublished refreshed ZIP **alone** is not treated here as proof that staging recipients lack all corresponding source. A clearly documented, version-matched source route is still necessary, especially for the binaries in main whose historical coverage is unresolved.

`npm run release:distribution` correctly fails because the refreshed bundle has not been published and verified. Publishing that ZIP and validating final installer contents are later release work. They are not substitutes for resolving findings 2 and 3. [Public source release](https://github.com/Yougori/yougori/releases/tag/staging-sources-675208851bd7ee4f), [current/public index comparison](public-distribution.json).

Before the scope clarification, the website's EXE/MSI/DEB were also streamed and hashed without execution. They still match the previously audited historical files. Those results are retained in `public-distribution.json`; replacing website downloads is not part of this report's requested action list. The prior audit remains the detailed record for those installers.

**Limits and handoff**

This review covers the supplied source, known copied components, dependency lockfiles, retained exact upstream material, compiled Windows runtime evidence, and current public GitHub branch state. It includes a source/header/provenance scan, not a proof that every unattributed snippet anywhere in the tree is original. There is no additional identified copied-code omission outside the findings above.

User-installed CUDA/Ubuntu/NVIDIA components, cloudflared, development-tool installers, container images and imported OS media are separate payloads obtained later; shipping preconfigured copies would require inspecting those actual artifacts. Contractor ownership was excluded following clarification. A macOS application bundle and newly built installers were not created or inspected, and every third-party kernel/library was not rebuilt. The scope does not certify security, privacy, patents or trademarks.

The audit added this report and supporting evidence under `output/license-audit-2026-09-14/`, plus ignored build/inspection artifacts. Existing tracked project files, licenses and approval records were unchanged. The remaining task is to resolve the native combination and notice findings, update their review records, and carry the reviewed source fixes to the intended public branch.
