# Private environment connections

Containers, MicroVMs and full VMs have left/right graph connectors. OCI pairs
retain their existing veth links and optional shared directories. Connections
involving a VM use a separate host-only Ethernet adapter, independent of the
Internet adapter. No administrator bridge/TAP configuration on the Windows host
is required.

- QEMU full VMs: a second e1000e NIC, DHCP address and subnet only (no router/DNS).
- QEMU MicroVMs: a second virtio-MMIO NIC; built-in Alpine configures it directly.
  Custom guests need their own DHCP client or the static address shown in Skills.
- Containers connected to VMs: an ephemeral TAP inside the container's network
  namespace. The managed appliance's authenticated API creates it. The helper
  authenticates its loopback tunnel using a one-use 256-bit secret. No package
  installation is required inside the container.

Existing VMs need one normal stop/start to receive the new NIC. Updated agent
code is bundled in `initramfs-virt`; it does not replace guest data disks. The
connection editor explains pending adapter/guest setup requirements.
The node's configuration sidebar can disconnect, reconnect, retry or remove a
connection without deleting either environment's data. Pending/error rules are
labelled on the graph instead of appearing fully enforced.

## Access enforcement

The Rust fabric binds each socket to one runtime identity and validates Ethernet
source MAC and IPv4 source address. It forwards ARP only to explicitly connected
peers, and permits IPv4 TCP/UDP/ICMP echo under the network permission. Port-only
rules allow specified TCP destination ports. One-way rules permit return traffic
for existing flows, not new reverse connections. Removing a rule clears its flow
state immediately. IPv6, multicast, fragments, other L2 protocols and traffic to
the host/LAN are not bridged. Individual guest firewalls still apply.

Each peer has a bounded 128-frame queue and each rule at most 4096 tracked flows,
with a five-minute idle timeout. Network-only peers have no polling loop. A hash-address
collision fails closed rather than reassigning another live guest's address.
QEMU socket backends are bound to host loopback; like the existing QMP transport,
they assume a trusted local host user, not protection against malicious programs
already running as that host user.

## Shared files and data — all combinations

New connections default to **Files + Bidirectional**. Files, Volumes and Data
mean one designated folder per connection, not unrestricted guest-disk access.
They do not automatically collect existing guest files or expose live databases.
Copy documents, projects or database exports into the connection folder.

- Container/container: existing appliance-backed shared bind mounts are retained.
- Any pairing involving a VM: the folder is persisted under the application data
  directory `runtime/connection-files/CONNECTION_ID` on this computer.
- Managed containers and built-in MicroVMs mount it at
  `/opendock/shared/CONNECTION_ID` without installing anything in an OCI image.
- Windows and Linux full VMs use `http://10.192.0.1:7444` in their guest browser.
  It supports folders, upload, download, UTF-8 text editing and non-recursive
  deletion. Files are not automatically mounted as a Windows drive.
- Custom MicroVMs without the Yougori agent use the same browser/HTTP API after
  configuring their private NIC. Automatic FUSE mounts require the built-in agent.

Bidirectional folders allow both endpoints to read/write. In one-way mode the
source writes and the destination reads. Files/Data require neither Internet nor
an extra TCP port grant. Other peer services still require their own network rules.
Secrets remain a separate container-only feature.

The browser runs over the existing private adapter: no extra NIC, DNS, default
route, host port, driver, SSH installation or guest password is added. A lazily
created smoltcp TCP endpoint serves each guest at `10.192.0.1:7444`, with eight
bounded sockets, 32 KB receive/send buffers, 1 MB request limit and idle expiry.
Requests are bound to the fabric socket identity. Clients cannot select another
source identity. Guest MAC/IP spoofing, DNS rebinding and cross-origin browser
requests are blocked. The backend authorizes the connection before every request,
enforces read-only permissions and confined paths, and rechecks revocation before
returning data. Host-only FUSE tokens are never given to the browser or Skills.

Disconnect closes the share servers and unmounts available managed endpoints.
Unexpected guest disconnection also revokes its shares. Already downloaded copies
cannot be revoked. Reconnecting retains folder contents; revocation is not deletion.
Cross-VM connection folders are **not included in individual VM snapshots/backups**.
Export important shared files separately. Removing a connection keeps its folder
on this computer to prevent accidental shared-data loss.

### Guest file API

GET `/connections` lists only this endpoint's connected folders. POST `/api` with
`Content-Type: application/json` and `X-OpenDock-Files: 1`; JSON fields include
`connectionId`, `operation`, and relative `path`. Operations: list, stat, read
(offset/length, base64 response), create, write (offset/base64 data), truncate
(length), mkdir, rename (destination), remove (non-recursive). Reads/writes use
at most 256 KB per chunk. Browser uploads stream 128 KB chunks; browser downloads
are capped at 128 MB and the text editor at 1 MB. Larger transfers use mounted
folders or the chunked API. This is a file exchange facility, not a POSIX/SMB
database filesystem or remote command-execution service. Use authenticated
SSH/SFTP separately for files outside the connection folder or remote commands.

## Skills

An environment window shows **Skills** beside the coding-tool controls only when
it has a saved node-to-node connection. Containers, MicroVMs and VMs all qualify.
My PC, Internet or GPU alone do not show Skills. Disabled links and stopped peers
still qualify so their unavailable state can be explained. The dialog lists every
direct incoming/outgoing peer, not transitive neighbors; dangling saved links are
marked missing instead of reusing old addresses.

Open it and choose **Copy skills**. The Markdown describes current peer addresses,
directions, allowed ports, readiness, shared-directory/browser/API permissions,
SSH/SFTP prerequisites for other files and safe editing. Runtime tokens, passwords, raw errors,
control endpoints and unrelated environment metadata are excluded. The agent
must run inside the source environment or use separately configured guest access;
copying text does not itself grant access. The dialog refreshes on relevant state
changes, every 10 seconds while open, and with **Refresh**. **Copy skills** fetches
a fresh snapshot first and refuses to copy cached instructions if that fails.

Per-link issues distinguish source/peer stopped, paused, starting, needs-attention,
disabled, pending, failed and unverified policy states, missing peers and invalid
permissions. Each includes a safe next step. Configured policy rights are separate
from currently usable network/read/write access. Ready means applied policy and
two Running nodes, not a successful guest boot or an application health check.
The shared native/browser instruction document includes a bounded-retry guide for
timeouts, refused connections, authentication, read-only files, missing mounts,
disk-full, partial transfers and changed TLS/SSH identity. It never tells agents
to reset/delete disks, widen permissions or disable firewalls automatically.

Skills also includes **My PC** attachments for that environment, read from live
shares when the dialog opens: selected host-folder paths, exact guest mount paths,
read-only/editable permissions and current availability. It never lists unrelated
folders or reads their contents. Writable mounts edit the original host files;
these are outside environment snapshots/backups. Full VMs currently have read-only
host-folder downloads/WebDAV rather than writable mounts. Their token-bearing URL
is deliberately excluded from Skills: use **Copy guest folder location** in that
environment's My PC connection, then open it privately inside the guest. This is
separate from the connection-file browser above. Re-open Skills after connecting
or disconnecting folders. Stopping an environment or closing Yougori ends its
live My PC shares.

## Verification

`cargo test --manifest-path src-tauri/Cargo.toml fabric` runs packet-level tests.
Ignored tests in `runtime/fabric/integration.rs` boot disposable MicroVMs and an
OCI appliance for real traffic, permission, revocation and restart checks.
`full_vm_test.rs` boots disposable Q35 Linux guests to exercise the full-VM
e1000e socket backend, DHCP and browser file protocol without Internet. Mixed
tests verify mounted read/write, both directions, browser/mount interoperability
and revocation. These tests do not touch the user's VM disks and are not a Windows
desktop UI installation test.
Frontend tests exercise graph connections and copyable Skills in all three window
types with screenshot, trace and video recording disabled.
