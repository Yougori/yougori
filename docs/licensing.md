# Licensing and source distribution

Original Yougori code in this source tree is licensed by **Yougori LLC** under
[Apache-2.0](../LICENSE), except where a file or directory has a separate notice.
[NOTICE](../NOTICE) carries the Yougori attribution.

## What this permits

You may use, modify and redistribute the code, including commercially and as a
hosted service. When redistributing, follow Apache-2.0 section 4: provide the
license, retain applicable notices, identify modifications, and preserve NOTICE
attribution in a permitted place. A public advertising credit is not required
simply because someone uses Yougori to build or host an independent product.
Apache-2.0 does not require proprietary forks to disclose their own source and
does not grant general rights to Yougori trademarks.

The previous Internal-Use License remains in Git history. Existing installers may
contain that older text; updating this repository does not rebuild those files.
Review the license supplied with the particular version.

## Third-party components

The Apache license does not relicense third-party components or files with their
own notices. QEMU patches and `runtime/security/tpm-qemu.c` retain their GPL terms;
TPM platform glue under `runtime/security/LICENSE` remains BSD-2-Clause. Linux
packages, firmware, DLLs, noVNC and other dependencies keep their own licenses.

The copied Coss UI components and shared class-name helper retain MIT for their
upstream portions. See `src/components/ui/LICENSE.txt` and the exact file mapping
in `compliance/frontend.json`. Coss's `apps/ui/` MIT exception and package
declaration are retained at a pinned revision in `compliance/notices/`.
Tailwind contributes production CSS even though it is an npm development
dependency. Its full MIT notice is included in `APPLICATION_LICENSES.txt`.

Original Yougori source/build material supplied as required corresponding source
for a separately licensed component may additionally be used, modified and
redistributed under that component's applicable license to the extent necessary
to exercise its rights. This provision does not change third-party licenses.

See [third-party notices](../src-tauri/resources/THIRD_PARTY_NOTICES.md),
`APPLICATION_LICENSES.txt`, `RUNTIME_LICENSES.txt` and `WORKSPACE_LICENSES.txt`. Package-level license
fields can describe multiple files under different licenses; they do not establish
compatibility of the actual linked binaries.

## Collecting and checking source materials

`compliance/evidence/` records runtime file hashes, the embedded Alpine package
database, Windows DLL provenance, and application/guest dependencies. Large
archives live outside Git in `build/compliance/bundle/`. `compliance/release.json`
ties those archives to input hashes and records unresolved items. See
[current status](compliance-status.md).

The inventory reads the repository's immutable appliance base through a temporary
sparse raw file. It removes that scratch file afterwards. It does not boot the
appliance, inspect user container disks or change running environments.

From the repository root, with Python 3.12+, Git, GitHub CLI and 7-Zip available:

The OCI collector uses the retained upstream release log and build-base
attestations. Keep `oci-build-provenance.tar.gz` from the matching source bundle
in `build/compliance/bundle/`, with its source index and checksums. Restore those
public evidence files before running the collectors; do not substitute evidence
from a different release if an upstream log has expired.

```powershell
python -c "import tarfile; tarfile.open('build/compliance/bundle/oci-build-provenance.tar.gz').extractall('build/compliance', filter='data')"
python scripts/collect-compliance.py inventory
python scripts/collect-compliance.py alpine
python scripts/collect-compliance.py local
python scripts/collect-compliance.py msys
python scripts/collect-compliance.py go
python scripts/compliance-oci-sources.py
python scripts/collect-compliance.py notices
python scripts/compliance-qemu-notices.py
python scripts/compliance-runtime-notices.py
node scripts/compliance-inspect-runtime.mjs
python scripts/collect-compliance.py report
npm run compliance:archives
```

Collectors do not execute downloaded APKBUILD or PKGBUILD scripts. Alpine recipes
are selected by the exact revision in the shipped package database, and distfiles
must match their SHA-512 checksums. MSYS recipes must match the PKGBUILD SHA-256
in the matching binary package's BUILDINFO. Guest Go dependency ZIPs must match
the `h1:` sums embedded in shipped binaries. Unverified entries remain blocked.
Never substitute a nearby version or silently accept a changed upstream patch.

QEMU/firmware archives contain committed upstream trees, with initialized
submodules and QEMU subprojects archived separately. The local build-material
archive contains the project's patches and build scripts. Preserve revisions and
restore submodules at the recorded paths. These are source inputs, not a claim of
reproducible builds or complete release coverage.

`npm run compliance:check` verifies evidence without approving distribution.
It also inventories frontend source, images, fonts and build configuration,
requires explicit provenance for copied UI files, and checks notices for packages
imported by production code/CSS even when marked as development dependencies.
List additional packages that contribute generated assets indirectly in
`compliance/frontend.json`. New or removed source/assets and missing license
texts require a fresh inventory and review. These checks detect changes and
missing recorded notices; determining the origin of newly copied code still
requires a source review.
Text input hashes normalize line endings; runtime and archive hashes cover the
original bytes. This lets the same source review survive ordinary Git newline
conversion without accepting changes to runtime binaries.
`npm run compliance:archives` also verifies every local source archive.
It checks that `SOURCE_INDEX.json` and `SHA256SUMS` match the current release
inventory. Previous publication verification cannot approve a changed index.

For source-only notice/build-script changes with unchanged upstream archives,
refresh notices and QEMU annotation evidence as above, then run:

```powershell
python scripts/collect-compliance.py material
python scripts/collect-compliance.py report
npm run test:compliance
npm run compliance:archives
python scripts/package-compliance.py
```

Regeneration clears the publication status. Publish and verify the resulting
matching source bundle before distributing a new release.

The Linux workflow can seed its cache from the pinned prior source ZIP, then
run `python3 scripts/collect-compliance.py cache` (Python 3.10+ for this action).
This recreates only the project's local source/build-material archive with
canonical line endings and permissions. Every upstream archive must still match
the current checked-in inventory. It fails if any required upstream input is
missing or changed. A cache seed is not publication of the new source bundle.
`npm run release:package` rejects unresolved findings, changed inputs, missing
archives and absent engineering-review records. Installer builds run this local
check, including preview packaging. `npm run release:distribution` additionally
requires verified public source access. This allows a concrete installer and
source bundle to be prepared before publication. Development and ordinary tests
remain available.

See [rebuild instructions](rebuilding-third-party.md) for using the exported
source trees without Git metadata, replacing libraries and relinking static
components.

## Publication and older copies

The intended source-delivery method is downloadable matching source archives
alongside the installers, with a source index and checksums. Upstream links,
private caches or an inventory alone do not give recipients that access. Do not
advertise a written source offer without a real fulfillment process.

Retain materials for each distributed installer and check applicable retention
obligations. New releases do not resolve missing materials for older copies.
Review the actual combined binaries, LGPL replacement/relinking requirements,
installation information where applicable and source completeness before recording
readiness. Automated checks do not establish a legal conclusion.

If actual incorporation or linking requires a different license for original
Yougori code, review the compatible GPL version before changing it. Merely
choosing GPL for the application does not supply missing corresponding source,
relicense third-party GPL-2.0-only code, or cure incompatible library combinations.

References: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0),
[GPLv2](https://opensource.org/license/gpl-2.0),
[GNU license FAQ](https://www.gnu.org/licenses/gpl-faq.en.html),
[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
