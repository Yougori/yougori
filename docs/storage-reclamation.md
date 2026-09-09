# Storage after deleting an environment

Deleting a container removes its writable data and its managed snapshots. Its
shared runtime disk is not the same thing as the container's files. On Windows,
free blocks inside that disk may still occupy host storage until compaction.

Both UI and CLI deletion now attempt filesystem trim and safe disk compaction.
Failures after deletion are reported as cleanup warnings, not as a failed
deletion. Snapshot deletion errors retain the environment record for retry.

Use **Storage → Reclaim space** to retry deferred cleanup, including storage
left over from deletions made with older versions. CLI equivalent:

```text
yougori-cli call reclaim_storage --json "{}" --yes
```

- Running or paused containers are never stopped for reclamation. On Windows,
  stop the containers in the affected standard/GPU pool before retrying.
- Standard container compaction preserves capacity and the backing image. It
  needs temporary free space, validates the new QCOW2, compares guest contents,
  flushes the result, then atomically replaces the old disk. Failures before
  replacement retain the original. It never formats a filesystem.
- CUDA compaction verifies ownership, shuts down only Yougori's idle WSL
  distribution, and uses the Windows virtual-disk API. It never uses global
  `wsl --shutdown` or touches other distributions. Permission/driver failures
  are reported; no automatic elevation is requested.
- Results distinguish measured container-disk reduction from VM cache cleanup.
  Host free-space metrics refresh immediately. Other programs may change the
  host's total free space concurrently.
- Runtime files, container base-image caches, saved snapshots, original
  installers and exported backups may still consume storage. Container images
  are preserved for offline factory reset and restore. VM source caches are
  removed only when no dependency remains.
- Unlisted old snapshot files are not proof that their contents are disposable.
  This operation does not blindly delete unregistered snapshots, archived
  recovery disks, host folders or user backups.

Existing standard containers receive the helper through the updated initramfs;
the immutable base disk does not change. Close/reopen the app normally to load
it. GPU runtimes may request an update in **New environment → GPU**.

Implementation references: [QEMU discard and block options](https://www.qemu.org/docs/master/system/invocation.html)
and [Windows CompactVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-compactvirtualdisk).

## Verification — 9 September 2026

- Disposable standard-container integration: 268,435,456 host bytes reclaimed;
  a running peer was not stopped, its marker survived compaction and restart,
  and repeated cleanup succeeded.
- Dedicated CUDA test distribution: 291,504,128 host bytes reclaimed; peer data
  survived and a real CUDA kernel check passed afterward. WSL required its idle
  utility-VM teardown delay; the implementation now waits up to 90 seconds for
  sharing locks rather than stopping unrelated WSL sessions.
- 290 frontend tests, 144 ordinary native tests, 21 CLI tests, six CUDA-host unit
  tests, the Go agent suite, and six dashboard browser tests passed. Earlier
  browser attempts timed out during concurrent native builds; the final run
  passed without retries or relaxed assertions.
- Frontend production build, lint, native compilation, bundled CLI schema/dry
  run, and release payload verification passed. Installers were not rebuilt.

No saved user VM, container disk or unlisted snapshot was deleted by these tests.
The 27.2 GB historical unlisted snapshot found during diagnosis remains intact;
it requires separate review, not an assumption that unlisted means disposable.
