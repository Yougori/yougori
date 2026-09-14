**Yougori open-source license audit — 13 September 2026**

Historical application-license descriptions have been removed from this published copy. The third-party findings below retain their original review scope and date.

Reviewed commit: `df88df89ba4a671cf71f1311f1e79f8f49b22af5`.

**Result: licensing compliance gaps remain. I would not treat the repository or its currently published installers as cleared for distribution.** The problems are missing third-party notices, incomplete modification notices, and unresolved coverage of binaries already being distributed. Changing the root license alone would not resolve them.

This is an engineering review of license evidence and distribution behavior. Whether a particular combined work infringes copyright, and how to resolve past distributions, requires legal judgment. “Confirmed” below describes an observed fact or omission; it is not a court finding.

**1. High priority — the website still distributes older binaries whose matching source coverage is unresolved.**

I downloaded the EXE, MSI and DEB linked by the live website. All three exactly match the historical records already marked `payload-source-coverage-pending`:

| Public download | Bytes | SHA-256 |
| --- | ---: | --- |
| `Yougori_1.0.0_x64-setup-20260912-201cfe7.exe` | 195,261,049 | `05e189fa1834816b2eb641d895769280a0e743faf61fea639bfe2ffc47c6df34` |
| `Yougori_1.0.0_x64_en-US-20260912-201cfe7.msi` | 218,529,963 | `554c944ab5546ee6746039a8caf60eb962c3e9ad77a50533c8a547955b227e1e` |
| `Yougori_1.0.0_amd64-20260911-5666954.deb` | 139,600,780 | `8ec08fcbbdde9d68bc31cb63a6a728b766720bad1bcb23634175a36f89f333ad` |

The Windows EXE was unpacked without running it. Selected MSI resources matched its QEMU executables, JACK and Berkeley DB libraries, TPM library, and notices byte for byte. The DEB's complete file inventory was inspected. All three carry the older Internal-Use License; the new application and runtime notice collections are absent from their extracted resource inventories. Older notices and noVNC sources do exist, so this is not a claim that those installers contain no attribution at all.

The [existing historical warning](C:/Users/Argon/Desktop/yougori/docs/compliance-status.md:77) explicitly leaves the retired stock QEMU's exact source/build inputs and some DLL mappings unresolved. The publicly available [staging source release](https://github.com/Yougori/yougori/releases/tag/staging-sources-675208851bd7ee4f) covers a replacement runtime and expressly distinguishes older installers. I found no evidence establishing complete matching source delivery for the older Windows payload. The DEB also still needs a release-specific source association; it should not be assumed to contain the Windows DLL issue.

GPLv2 binary distribution requires an applicable source-delivery route. Its source definition includes the relevant modules, interface definitions, and build/install scripts. A nearby source version or a general upstream link does not establish coverage for a different build. [GPLv2 distributed by QEMU, section 3](https://raw.githubusercontent.com/qemu/qemu/84f07211cc5b4fc6a371559bf8a5de4fb068e648/COPYING).

**Action:** prioritize replacing or suspending downloads whose coverage cannot be established. Associate each distributed installer with its exact source package and notices, and make that package available to recipients. Preserve the historical binaries and source evidence so earlier recipients can be supported. A replacement release does not establish compliance for copies already distributed.

Evidence: [EXE download verification](downloaded-installer.json), [MSI/DEB download verification](downloaded-msi-deb.json), [EXE contents](old-installer-files.json), [MSI comparisons](msi-payload-comparison.json), [DEB inventory](deb-inventory.json).

**2. High priority — the old Windows QEMU has an unresolved GPL/AGPL combination.**

Independent PE import inspection of the downloaded installer confirmed:

`qemu-system-x86_64.exe → libjack64.dll → libdb-6.2.dll`

The database DLL's SHA-256 is `4035b713d0b127c87a6f369950fe9fde052f042438e5a7cf53df0959a8349c90`. It matches the retained MSYS2 Berkeley DB `6.2.32-1` package. I inspected that package's actual license, which states GNU AGPL version 3. This finding is supported by the library bytes and license text, rather than just a package label.

QEMU describes its project license as GPLv2, with per-file terms. The actual licensing of this older linked combination has not been established. It is a serious compatibility question; I am not concluding that every Yougori source file becomes AGPL merely because these programs are bundled. [QEMU licensing](https://www.qemu.org/docs/master/about/license.html).

The old secure runtime also loads its TPM library in the QEMU process, and that library imports OpenSSL 3. The corresponding historical source shows this design. The current version moves the TPM/OpenSSL implementation into a separate helper process. Apache-2.0/GPLv2 compatibility makes that historical arrangement another combination requiring review. [Apache's compatibility explanation](https://www.apache.org/licenses/GPL-compatibility.html).

**Action:** resolve the old combined binary's applicable terms with qualified open-source counsel, including any needed rights from the relevant licensors. Use the replacement runtime for future releases once its remaining notice issues are fixed. Do not declare the historical issue cured solely because the dependency was removed from current source.

Evidence: [actual old DLL imports](old-pe-imports.json), [historical DLL identities](C:/Users/Argon/Desktop/yougori/compliance/history/stock-windows-dlls.json). The extracted Berkeley DB license is retained in `build/compliance/audit-2026-09-13/upstream-evidence/berkeley-db-license.json`.

**3. Confirmed omission — Coss UI is copied into the source tree without its license attribution.**

[components.json:22](C:/Users/Argon/Desktop/yougori/components.json:22) points to the Coss registry. I compared all 26 files in `src/components/ui/` against that registry: 22 match exactly after rewriting the registry's import paths to this project's aliases; another three are more than 97% similar. The substantially modified combobox retains related upstream material too.

No Coss attribution or MIT declaration for these copied components appears in the root NOTICE, component directory, or the three supplied license collections and third-party overview. The npm inventory's Base UI license covers Base UI, a separate dependency; it does not identify the copied Coss wrappers.

Coss has mixed licensing. Its **`apps/ui/` subtree is explicitly MIT licensed**, even though its repository defaults to AGPL. The comparison must use the subtree's terms. [Pinned licensing declaration](https://github.com/cosscom/coss/blob/e937becd2d5ffb5c621eed6f8b1f223cbb6051e7/LICENSING.md), [UI project's MIT declaration](https://github.com/cosscom/coss/blob/e937becd2d5ffb5c621eed6f8b1f223cbb6051e7/apps/ui/README.md).

**Action:** add a vendored-component record identifying the relevant files and upstream revision; preserve the applicable upstream ownership notices and full MIT terms in the source distribution and installer notices. Establish the correct notice from the upstream UI material rather than inventing a copyright owner or copying the root AGPL license.

Evidence: [26-file comparison](coss-comparison.json), [comparison after import rewriting](coss-import-normalized.json). The upstream Git tree inspected was `e937becd2d5ffb5c621eed6f8b1f223cbb6051e7`; the registry comparison establishes provenance, not the precise original import date/revision.

**4. Confirmed omission — Tailwind's emitted CSS has no accompanying Tailwind notice.**

[src/styles.css:1](C:/Users/Argon/Desktop/yougori/src/styles.css:1) imports Tailwind. A fresh production frontend build contains Tailwind's Preflight CSS and utility rules. Its output contains neither Tailwind's copyright notice nor its license banner. The supplied application/runtime/workspace notice collections also omit Tailwind Labs and the `tailwindcss` component.

The reason is visible in [collect-compliance.py:696](C:/Users/Argon/Desktop/yougori/scripts/collect-compliance.py:696): it skips every npm package marked `dev`. Tailwind is classified that way even though its CSS is incorporated into the shipped frontend. Its MIT terms require preserving the copyright and permission notice with copies or substantial portions. [Tailwind license](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE).

**Action:** include the installed Tailwind version's complete MIT notice in the packaged notices. Distinguish tools that merely run during a build from packages whose code, styles, templates or assets are incorporated into its output. Review other build-generated material using the same rule.

The isolated build is in `build/compliance/audit-2026-09-13/frontend/`; it did not overwrite the existing `dist/` directory.

**5. Modification-notice gap — local GPL patches do not consistently put dated change notices in the modified files.**

The QEMU patches preserve upstream licensing and identify their functional changes. However, the supplied modifications to files such as `accel/whpx/whpx-common.c` and `hw/tpm/tpm_ppi.c` do not add dated local modification notices. The PPI patch has an OpenDock explanation, but no change date. The reboot patch identifies the upstream proposal in its patch preamble, without adding a dated local change notice to the modified source files.

GPLv2 section 2(a) calls for prominent notices in modified files stating the change and its date. Repository history and an overall engineering-review date should not be relied on as the only implementation of that requirement in exported source archives. [GPLv2 section 2(a)](https://raw.githubusercontent.com/qemu/qemu/84f07211cc5b4fc6a371559bf8a5de4fb068e648/COPYING).

**Action:** update the local patches to place an appropriate dated modification notice in each changed GPL-covered file, preserving existing authorship. Regenerate and revalidate the corresponding-source package and its index. Do not fabricate historical dates.

Evidence: [reboot patch](C:/Users/Argon/Desktop/yougori/runtime/security/qemu-whpx-reboot.patch:1), [PPI patch](C:/Users/Argon/Desktop/yougori/runtime/security/qemu-whpx-tpm-ppi.patch:1), [TPM build patch](C:/Users/Argon/Desktop/yougori/runtime/security/qemu-windows-tpm.patch:1).

**What the current repository gets right**

| Area | Review result |
| --- | --- |
| Application inventory | All 45 production npm entries and all 710 unique registry crates from the three Cargo lockfiles are represented; no missing entries or metadata discrepancies in the independent comparison. |
| Cargo provenance | All 710 cached/downloaded crate archives independently hash to their lockfile checksums. This verifies package identity, not every possible license interpretation. |
| Current corresponding source | All 237 indexed local source archives pass checksums; all 457 recorded input files pass the compliance check. |
| Public source access | Anonymous download of the public source index matches the local index exactly. GitHub reports the expected source ZIP size/digest. I did not download the entire 1.15 GB ZIP again; the prior full-download result remains recorded separately. |
| noVNC | All 66 archived package files match the installed package. Packaging configurations include its source and notices on Windows, Linux and macOS. |
| MPL crates | Source archives exist for the five MPL crates identified in the Cargo inventory: cssparser, cssparser-macros, dtoa-short, option-ext and selectors. MPL permits separately licensed surrounding files while requiring source availability for covered files. [Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). |
| Current Windows runtime | 70 DLL files have recorded provenance. The current PE dependency graph has no JACK/Berkeley DB chain; the TPM/OpenSSL implementation is in a separate process. |
| GNU library choices | Checked the actual source declarations for GMP, libunistring and libidn2 rather than assuming their package labels were definitive. Their available GPLv2-or-later library options avoid a simplistic LGPLv3-only conclusion. |
| Firmware | All 18 recorded ordinary firmware/keymap payloads independently match the pinned QEMU source-tree bytes, decompressing EDK2 blobs where needed. |
| Appliance and OCI | Evidence covers 60 Alpine packages, exact recipes, 134 Go dependency ZIPs, main OCI source revisions, and static glibc/libseccomp/libbtrfs materials. Rebuild/relink instructions and third-party notices are present. |
| Replacement rights | Documentation permits replacing/rebuilding libraries and updating editable runtime integrity manifests. The review did not identify a vendor signing-key requirement for modified runtimes. |
| Tool-only dependencies | Examined all 358 npm development entries, including MPL Lightning CSS and CC-BY caniuse-lite. Merely using a compiler or data set does not by itself license the whole output under its terms; incorporated content needs separate consideration. |

The independent application/source checks are reproducible with [check-inventory.py](check-inventory.py); results are in [inventory-check.json](inventory-check.json). Firmware results are in [firmware-check.json](firmware-check.json).

**Why the current green check is insufficient**

`npm run release:distribution` passes despite the findings above. It verifies recorded hashes, an empty blocker list and an existing approved review/publication record. It does not discover copied UI code, determine which development packages contribute distributable content, or independently evaluate license obligations. Historical issues are recorded outside the blocker list for the replacement runtime.

Extend the inventory to vendored files, relevant generated content, and their notices. Include packaging configurations and relevant manifests in the reviewed input scope. Connect each public installer to its particular source index. Place a clear matching-source link beside downloads and in the distributed notices, including the location of MPL crate sources. Re-run the legal/engineering review after fixing the omissions rather than treating the old approval field as permanent.

**Assets, optional downloads and review limits**

All 853 tracked paths were inventoried, with searches across first-party source, scripts, patches, license files and build configuration for provenance and license indicators. Raster/vector assets, installer artwork and branding were included in the inventory. The main application uses installed system fonts; there are no tracked font binaries. Discord and X artwork in the README are identifiable third-party brand assets whose exact download provenance is not recorded. I did not establish an infringement from their appearance; preserve their origin/permission separately from the code license. Git history alone cannot establish ownership of artwork or detect every unattributed copied fragment.

Optional CUDA/Ubuntu/NVIDIA setup, cloudflared, external development-tool installers, container images and imported OS media are obtained at runtime from external providers or supplied by the user. The inspected packaging does not bundle their entire downloaded payloads. Redistributing preconfigured images, backups or cached downloads would require a separate inventory of what those artifacts actually contain.

Windows installer resources, current Windows library imports, Linux packaging and all three platform configurations were reviewed. A macOS application bundle was not built or inspected on this Windows machine. I did not perform a new complete rebuild of every upstream C/C++ library, kernel or firmware. Native DLL provenance does not by itself prove the notice coverage of all code embedded inside those DLLs; optional/static/header dependencies in ANGLE merit a further build-level notice review. In particular, finding RapidJSON in a build recipe is not proof that a shipped DLL incorporates its optional capture implementation, and this audit does not assert that as a confirmed violation.

The three older direct-download links in README returned 404, while the site's newer listed downloads remained available. Repair those links as part of release cleanup; a broken README link is not itself a license violation. [Link-check evidence](readme-download-check.json).

**Verification performed during this review**

- `npm run test:compliance`: 9 JavaScript tests and 7 Python tests passed.
- `npm run release:distribution`: passed, including 11 branding tests and runtime/archive verification; its scope limitation is explained above.
- Independent inventory checker: 710 crate checksums matched; no production npm or registry-crate inventory omissions; archived noVNC source matched.
- Isolated Vite production build: succeeded; inspected its emitted CSS. Vite reported existing mixed static/dynamic import warnings.
- Public EXE/MSI/DEB: full downloads hashed; EXE selected resources, matching MSI resources, and the full DEB file inventory inspected without installation or execution.

No application source, license, compliance approval, repository history or public download was changed. This report and local audit evidence are the additions. Resolve the historical distribution issue and the current notice omissions before relying on a clean compliance claim.
