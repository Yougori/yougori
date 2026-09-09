# Yougori licensing and source distribution

The original Yougori software is licensed by **Yougori LLC** under the root
`LICENSE` (Yougori Internal-Use License, version 1.0). It is a restricted-use
license. It does not relicense third-party code or revoke rights already granted
for separately licensed project files.

## What users may do

| Activity | Terms for original Yougori code |
| --- | --- |
| Personal use or internal use by a business | Permitted, including for-profit work |
| Backups and private modifications of lawfully supplied source | Permitted |
| Employees or contractors operating it for that internal use | Permitted |
| Running, publishing, or selling the user's own applications | Permitted; customers may access those applications |
| Selling or giving away Yougori or a modified Yougori | Requires separate written permission |
| Providing customers access to Yougori's management UI, CLI, API, or a wrapper | Requires separate written permission |

The license controls; this table is only a summary. Component licenses and
mandatory rights under applicable law take precedence where applicable.

## Packaging implemented here

- `bundle.licenseFile` references the root license, and all three desktop
  configurations also package it as `LICENSE` alongside third-party notices.
- npm and the native/CLI/CUDA Rust package metadata identify that same file.
- Every desktop package includes the installed noVNC package under
  `third-party-sources/novnc/`, including its actual source and license notices.
  Normal frontend preparation runs before packaging, so it is the source used
  by that build. Do not replace it with an unrelated version.
- Windows packages include the security source/patches, GPU helper source, and
  build scripts under `third-party-sources/`, with their existing notices intact.
- Runtime files covered by SHA256SUMS have not been edited to change notices.
  The top-level notice corrects the older EDK2 source-record omission; the next
  runtime rebuild can regenerate its bundled copy and checksum manifest.

## Corresponding source is a separate release deliverable

The license text and local patches do not complete a GPL/LGPL source release.
This work has not assembled or verified the complete corresponding source for
every shipped binary, nor established the legal classification of every
integration. A source inventory alone is not a complete source distribution.

For each installer version, collect and retain the exact applicable upstream
source, local changes, required interface definitions, package recipes, and
build/install scripts. Preserve submodule revisions and component licenses.
Include LGPL relinking material or other required means where applicable.
Associate those materials with the binary runtime manifests for that release.

Concrete source records currently available:

| Shipped component | Available records | Remaining source-distribution work |
| --- | --- | --- |
| Standard QEMU and its libraries/firmware | `runtime/qemu/` notices and upstream distribution records | Collect exact matching source/build material, not merely upstream homepages |
| Modified secure QEMU, TPM glue, EDK2, and DLLs | `runtime/security/`, bundled `SOURCES.md` / `PACKAGES.txt`, build scripts, local source caches when present | Archive complete pinned upstream trees, submodules, modifications, and matching library source/build material |
| Linux appliance and CUDA guest components | Build scripts, package databases in the actual images, storage notices, runtime manifests | Inventory the actual shipped image versions and collect their corresponding source and build material |
| noVNC | Installed package source and licenses, included with desktop bundles | Verify that each released bundle contains the same source used in its frontend build |
| Other JavaScript, Rust, and Go dependencies | Lockfiles, manifests, and existing component notices | Finish a release-specific dependency/license inventory and provide any additional required notices/source |

For downloadable GPL binaries, arrange a license-compliant source distribution
for the same release. A private GitHub repository inaccessible to recipients
does not provide that access. This project does not currently publish a source
archive or make a written fulfillment offer; do not advertise one without
actually establishing it. No release was uploaded as part of this change.

QEMU is launched as a separate process by the Rust application, which is evidence
relevant to separation but is not a legal determination. The GPL backend and
patches incorporated into QEMU retain GPL terms. Have the actual combined release
and applicable local law reviewed before representing it as fully compliant.

References: [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.en.html),
[GPLv2 distribution FAQ](https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.en.html),
[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
