# Yougori third-party notices

Yougori distributes third-party runtime components, including a locally modified
secure QEMU runtime. Copyright remains with each component's authors. The
Yougori Internal-Use License applies only to the code it covers; its resale,
redistribution, hosting, and modification restrictions do not override any
component's own license. Existing OpenDock names in upstream or project notices
are retained as historical attribution.

The links below identify upstream projects and source locations. They are not,
by themselves, a complete corresponding-source distribution or a written source
offer. They must not be represented as proof of GPL/LGPL release compliance.

## FAT filesystem support

The desktop uses fatfs 0.3.6 to create independent imported-files drives for VMs.
Upstream: https://github.com/rafalh/rust-fatfs

Copyright 2017 Rafał Harabień

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## QEMU and firmware

- QEMU Windows distribution: GPL version 2 at the project level; individual files and libraries carry their own GPL, LGPL, or other compatible licenses. The bundled distribution includes `runtime/qemu/COPYING`, `runtime/qemu/COPYING.LIB`, and its upstream `README.rst`. Use the bundled manifests and source records to identify the exact shipped build.
- EDK II UEFI firmware shipped by the QEMU distribution: BSD-2-Clause-Patent and component-specific compatible licenses.
- Windows binary distribution source and build information: https://qemu.weilnetz.de/w64/
- QEMU corresponding source: https://download.qemu.org/
- EDK II source: https://github.com/tianocore/edk2

### Modified Windows secure runtime

- Exact source revisions, package inventory, and component licenses are recorded
  in `runtime/qemu-secure/SOURCES.md`, `runtime/qemu-secure/PACKAGES.txt`, and
  the license files beside them.
- Local source, patches, and build information are packaged under
  `third-party-sources/runtime/security/`, `third-party-sources/runtime/gpu/`,
  and `third-party-sources/scripts/`. The security directory's own `LICENSE`
  identifies BSD-licensed TPM glue and the GPL-2.0-or-later QEMU backend.
- The EDK2 build also applies `edk2-svsm-probe.patch`; the older bundled source
  record's statement that EDK2 has no source patch is superseded by this notice
  and `third-party-sources/runtime/security/SOURCES.md`.
- These local patches and scripts are supplemental source material, not the
  complete upstream QEMU, firmware, library, or appliance source distributions.
  Their respective component-license rights remain intact.

## noVNC desktop client

- noVNC 1.7.0: MPL-2.0, with vendor files under their individual licenses.
  Upstream: https://github.com/novnc/noVNC/tree/v1.7.0
- The installed package's source, including the exact `core/` and `vendor/`
  files used by the build, is included in `third-party-sources/novnc/`.
  That directory also includes `AUTHORS`, package metadata, and the license
  texts in `docs/LICENSE*`. These sources may be used, modified, and
  redistributed under their own licenses, independently of Yougori's license.
- `scripts/patch-novnc.mjs` removes a historical viewport extension when present;
  fresh installations use upstream noVNC. The packaged sources reflect the
  package after this build preparation step.

## Embedded Linux appliance

- Alpine Linux 3.24: packages retain their individual licenses. Package identity, version, origin, and license metadata are preserved in the appliance package database at `/lib/apk/db/installed`.
- Linux kernel: GPL-2.0-only. Source: https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.24-stable/main/linux-lts
- BusyBox: GPL-2.0-only. Source: https://git.busybox.net/busybox/
- OpenRC: BSD-2-Clause. Source: https://github.com/OpenRC/openrc
- musl libc: MIT. Source: https://musl.libc.org/
- iproute2: GPL-2.0-only. Source: https://git.kernel.org/pub/scm/network/iproute2/iproute2.git/
- iptables: GPL-2.0-only. Source: https://git.netfilter.org/iptables/
- util-linux: GPL-2.0-or-later, LGPL-2.1-or-later, BSD, and component-specific compatible licenses. Source: https://github.com/util-linux/util-linux
- e2fsprogs: GPL-2.0-or-later, LGPL-2.0-or-later, and component-specific compatible licenses. Source: https://git.kernel.org/pub/scm/fs/ext2/e2fsprogs.git/
- Alpine package sources and exact package build recipes: https://gitlab.alpinelinux.org/alpine/aports

## OCI runtime

- nerdctl 2.3.5: Apache-2.0. Source: https://github.com/containerd/nerdctl/tree/v2.3.5
- containerd 2.3.3: Apache-2.0. Source: https://github.com/containerd/containerd/tree/v2.3.3
- runc 1.5.1: Apache-2.0. Source: https://github.com/opencontainers/runc/tree/v1.5.1
- CNI plugins 1.9.1: Apache-2.0. A license copy is included at `/usr/local/libexec/cni/LICENSE` inside the appliance. Source: https://github.com/containernetworking/plugins/tree/v1.9.1

## Workspace terminals and folder sharing

- xterm.js 5.5.0 and addon-fit 0.10.0: MIT. Source: https://github.com/xtermjs/xterm.js/tree/5.5.0
- Go-FUSE 2.5.1: BSD-3-Clause. Source: https://github.com/hanwen/go-fuse/tree/v2.5.1
- Go `golang.org/x/sys`: BSD-3-Clause. Source: https://go.googlesource.com/sys/
- Container startup configuration uses the containerd Go API, containerd/log, containerd/ttrpc, gRPC-Go, and Google RPC generated types (Apache-2.0), Go protobuf and `golang.org/x/net` / `golang.org/x/text` (BSD-3-Clause), and Logrus (MIT). Exact versions and upstream license texts are included in `WORKSPACE_LICENSES.txt`; the agent's `go.mod` and `go.sum` pin the source dependencies.
- License texts for these additions are included in `WORKSPACE_LICENSES.txt` beside this notice.
- Optional cloudflared 2026.8.3 is downloaded directly from Cloudflare's release when the user enables a tunnel. It is not bundled in Yougori. Source and Apache-2.0 license: https://github.com/cloudflare/cloudflared/tree/2026.8.3

The appliance is assembled by `scripts/build-appliance.sh`; the Windows runtime is assembled by `scripts/build-bundled-runtime.ps1`. Those scripts identify the downloaded versions and verify upstream or pinned cryptographic checksums. This notice is informational and does not replace any license text distributed with a component.
