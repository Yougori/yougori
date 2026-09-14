# Storage allocation

New environment → Resources and node settings → Resource allocation include a
storage slider in GB. Containers have individual writable storage limits.
VMs and MicroVMs have separate thin disks that consume host space as guests write.

- Standard and GPU containers each have a kernel-enforced project quota.
  Choose from 6 GB to the available maximum at creation or in Configuration.
  The default is 20 GB, capped by available space.
  Writable root files, private image-declared volumes and container logs count
  toward the same node's limit. Increasing or decreasing an enabled quota applies
  online without restarting that container or its peers. A new limit must be
  above current usage. Reducing a quota does not shrink the filesystem or delete files.
- Runtime services and read-only image caches are reused. Cached images,
  snapshots and explicitly connected folders consume additional space outside
  the writable quota. A quota is a limit, not a host-space reservation.
- Existing installations migrate their owned container data to a quota-enabled
  filesystem before containerd starts. Source files remain until copies have
  been verified and the new mounts and recovery state have been saved durably.
  This one-time update needs temporary room for a copy of existing runtime data.
  An interrupted copy is retried from the originals. After migration, stop
  each legacy container once to enable its limit; peers can stay running.
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

The bundled base image is not rebuilt or rebased. The agent and offline
filesystem utility are delivered through initramfs. The standard runtime's
backing disk grows to use space available on the host drive; old fixed pool
sizes no longer constrain node storage. CUDA uses its own WSL disk. Both
backends mount a private sparse ext4 store with project quotas. Reclaim space
trims that store before returning unused outer disk blocks to the host.

Standard containers can also gain CPU/RAM capacity while other containers run.
All host CPUs are exposed at boot and cgroups enforce each node's CPU limit.
QEMU memory is added and brought online as required, subject to available host
RAM. Stopped node definitions do not reserve runtime RAM.

Hotplug readiness is verified against the online state of every added DIMM's
memory blocks. Linux's `MemTotal` excludes kernel reservations, so it is not
compared with the attached RAM using a fixed allowance. This avoids false
timeouts when a runtime starts with a large initial memory allocation.

Container deletion confirms the container name is absent before removing its
node. Idle cleanup checks the live container list under the runtime operation
lock, so a workload that exits by itself cannot leave stale bookkeeping that
prevents the empty runtime from shutting down and returning its RAM. Cleanup
keeps genuinely running or paused peers alive.

Verification:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml container_storage_limits_are_independent_and_enforced -- --ignored --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml container_capacity_grows_without_losing_data_or_restarting_active_workloads -- --ignored --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml deletion_reclaims_disk_blocks_and_preserves_peer -- --ignored --nocapture --test-threads=1
npx vitest run src/components/storage-allocation-editor.test.tsx src/api/platform-api.test.ts
```

Native integration tests use disposable images: VM creation with selected sizes,
grow-only imports, MicroVM filesystem expansion with file preservation, and
independent container quotas, private volumes, online expansion and restart
persistence. The legacy migration test takes OPENDOCK_LEGACY_INITRAMFS pointing
to the preceding release's boot payload. CUDA tests require the explicit
build/cuda/integration-runtime directory via OPENDOCK_CUDA_TEST_ROOT. No user VM is
booted, resized, formatted, or removed by these tests.
The large-capacity regression requires enough available host RAM to reserve
roughly 37 GB for its isolated runtime.
