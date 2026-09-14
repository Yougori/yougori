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
- An outdated CUDA agent or unavailable GPU does not block host compaction of
  an already stopped, owned GPU disk. This path does not boot or terminate WSL.
  It can reclaim already discarded/zero blocks; further filesystem trim needs
  a working CUDA runtime. Standard-container and VM-cache cleanup are attempted
  independently, and failures identify the affected storage pool.
- Results distinguish measured container-disk reduction from VM cache cleanup.
  Host free-space metrics refresh immediately. Other programs may change the
  host's total free space concurrently. Zero reclaimed bytes are stated even
  when cleanup has warnings or notes, rather than being hidden by those notes.
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

CUDA setup now normalizes Rust's extended Windows paths before passing them to
Windows PowerShell 5 filesystem commands. It also suppresses the UTF-8 preamble
that .NET Framework can insert into a redirected stdin stream; otherwise Linux
tar sees a corrupted archive. Setup validates all payload files before import
and reports its actual failure, with the log path, instead of blaming a working
WSL installation or NVIDIA driver. Existing container storage is retained.

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

## Verification — 10 September 2026

- Reproduced the reported `Join-Path` failure with a canonical `\\?\C:\...`
  payload path in Windows PowerShell 5. Fixed setup stages every helper from
  paths containing spaces and brackets; missing files fail before WSL mutation.
- Reproduced the extra `ef bb bf` bytes on the binary pipe. A real child-process
  transfer test now checks every received byte and restores the caller encoding.
- A fresh isolated WSL CUDA installation and a native app-driven update both
  succeeded with the fixed scripts. The previous copied test fixture was kept
  because its ownership manifest referenced the repository's former location.
- Standard-container integration reclaimed 267,911,168 host bytes. A running
  peer stayed running; its file survived idle compaction, restart and a second
  cleanup. Report: `artifacts/production-runtime-20260910-140650-d4ada046`.
- CUDA integration reclaimed 276,824,064 host bytes while its manifest indicated
  an obsolete payload. Cleanup did not start that payload; the peer's file and
  a real CUDA kernel calculation passed after restart. Report:
  `artifacts/production-runtime-20260910-141410-1d48253a`.
- 306 frontend tests, 150 native unit tests and seven CUDA-host unit tests passed.
  All 31 Node packaging tests passed, including the three PowerShell regressions.
- The installed user's CUDA runtime was updated under the exclusive runtime
  ownership lock with its verified bundled payload. CLI status now reports
  `installed: true`, `supported: true`, `updateAvailable: false`. Its container
  disks were retained; the repair issued no stop commands to user environments.
- The installed app's subsequent `reclaim_storage` call recovered 102,825,984
  bytes and returned no warnings. All environments were stopped when that call
  completed; the previously reported CUDA-update error was gone.
- Windows EXE/MSI and Ubuntu DEB were rebuilt. Both Windows archives passed
  integrity checks and contained the fresh application, including the path,
  binary-transfer and reclamation changes. Ubuntu package checks and its isolated
  non-root installed app/CLI smoke test passed. The local website uses distinct
  `-20260910-storage-fix` filenames and updated SHA-256 metadata. No website was
  published and no GitHub release assets were uploaded by this task.
- Automatic approval review rejected unregistering the newly created disposable
  CUDA distribution (`OpenDock-CUDA-16bdaddcd42d`) as "blocked by policy". Its
  stopped test disk remains in `build/cuda/integration-runtime`; user CUDA data
  and the earlier copied fixture remain separate and intact.
