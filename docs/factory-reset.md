# Persistence and factory reset

Environment disks are persistent. A normal stop/start keeps saved files, installed
packages and application data; snapshots are optional restore points, not a Save
button. Unsaved editor buffers and running processes are not persisted by disk
storage. Shut down normally to let applications flush their writes.

In a node's **Configuration → Overview → Factory reset**, shut down the environment,
click **Factory reset**, and type its exact name. Errors remain in the confirmation;
the action shows loading and prevents conflicting Start/Delete actions.

- Containers: recreate from the saved, locally cached OCI base reference, without
  pulling a new image. Remove only the retired container, its writable layer,
  anonymous volumes and local snapshots. The shared appliance disk is not reset.
- MicroVMs: recreate the writable disk from its immutable backing image and retain
  the kernel, initramfs, boot arguments and expanded capacity. Standalone built-in
  Alpine backups reset to bundled Alpine; a flattened custom backup without an
  original base cannot be reset safely and returns an actionable error.
- VMs: recreate from the managed original ISO or base disk and retain capacity.
  ISO-based VMs return to a blank disk and the installer, not an installed desktop.
  Secure VMs retain TPM/Secure Boot support but receive a new private TPM/firmware
  identity; old identity data is erased with the retired generation.

Name, description, node ID, resource policy and graph connection choices are kept.
Open publications, terminal sessions and folder shares are cleaned up when stopped;
reconnect them after starting. Host/shared folders, other environments and external
backups are not erased. Reset is file deletion, not forensic secure erasure of SSDs
or backups. Save a portable local backup before resetting anything important.

## Failure recovery

Reset prepares a separate runtime generation without modifying the current disk.
The durable platform-state journal first tracks the temporary generation; an atomic
state commit switches the node to the fresh generation and replaces the journal
entry with the retired generation and its snapshots. Only unreferenced generations
may be deleted. A missing image/preparation failure leaves the current disk intact.

After an interruption, the node shows an error. Retry **Factory reset** to clean up:
if the generation switch already committed, retry only finishes deletion and does
not wipe the fresh disk again. Pending resets block Start and backup/snapshot work.
Delete also finishes pending reset cleanup. Original images remain referenced and
are not garbage-collected as part of reset.

## Verification

`npm test` covers confirmation, cancel, errors, loading, exact-name validation and
browser-adapter isolation. `cargo test --lib factory_reset` covers safety helpers.
The ignored native tests boot disposable guests and check persisted files across
stop/start, wiped target data, retained capacity, unaffected siblings, snapshot
cleanup, fresh VM security identity, unchanged media, missing-source safety and
post-commit retry. They never reset a user's existing environment.

Run native integration tests with:

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib factory_reset -- --ignored --nocapture --test-threads=1
```
