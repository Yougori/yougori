# Storage allocation

New environment → Resources and node settings → Resource allocation include a
storage slider in GB. This selects disk capacity, not a CPU-style scheduling
range. Thin QCOW2 disks consume host space as guests write data.

- Containers share the appliance disk. Changing this pool affects every
  container; **it is not a per-container quota**. Stop all running/paused
  containers before expanding. The idle appliance shuts down cleanly and boots
  again when a container is next started.
- VMs and MicroVMs have separate disks. Stop the guest to expand its disk.
- Bundled Alpine filesystems grow automatically. Windows/custom guests may
  require extending their filesystem/partition inside the guest, e.g. Windows
  Disk Management → Extend Volume. Recovery partitions can prevent extending
  a Windows volume directly; Yougori does not move or delete them.
- Existing/imported disks are never shrunk. Larger imported disks retain their
  capacity. Existing backups remain self-contained and retain disk capacity.
- Limits use free space on the **runtime's actual volume**, with 2 GB reserved;
  other host drives are not added together. Sparse capacity is not a reservation
  or a guarantee that free host space will remain available.
- Storage expansion is immediate and durable in the disk itself, separate from
  Save policy. Dynamic allocation never shrinks disks or deletes guest files.

The bundled base image is not rebuilt/rebased for this feature. The agent and
small offline filesystem utility are delivered through initramfs. Early growth
runs before copying updates, so a full old root can gain space first.

Verification:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml storage_ -- --ignored --nocapture --test-threads=1
npx vitest run src/components/storage-allocation-editor.test.tsx src/api/platform-api.test.ts
```

Native integration tests use disposable images: VM creation with selected sizes,
grow-only imports, MicroVM filesystem expansion with file preservation, and
shared container expansion with running-workload protection. No user VM is
booted, resized, formatted, or removed by these tests.
