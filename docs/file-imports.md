# Copy files by dropping them on a node

Drop files or folders from your computer onto a **running** environment node.
The node highlights the destination and shows copy progress. You can continue
using the graph while the copy runs; there is no transfer popup to wait in.

- **Containers, GPU containers and built-in microVMs:** an independent copy is
  created on the guest disk in `/yougori-import-<unique ID>/`. The node shows the
  complete destination when copying finishes. These files are included in normal
  guest disk snapshots and backups.
- **Full VMs:** the copy appears on a separate writable USB drive labelled
  `YOUGORI`. Open it in Windows File Explorer or your Linux file manager. Each
  drop creates another independent drive, which reconnects after restarting the
  VM. No guest-agent installation is needed.

The source files are opened **read-only**. Copying does not move, rename, delete,
mount or share the originals, enable My PC access, or connect Internet access.
Guest edits and deletions affect only the copies. Uploaded programs are never
automatically executed. Repeated drops use separate destinations and do not
overwrite a previous copy.

Folders retain their structure, hidden files and empty directories. Symbolic
links and Windows reparse points (including junctions) are skipped and counted
in the completion message, so they cannot pull another folder into the copy.
Unreadable source files and detected source changes produce an error. Avoid
editing the selected files until copying finishes. Interrupted transfers
are reported as failures; a failed guest-side copy may leave an incomplete
directory at the location shown in the error. The originals remain unchanged.

## Imported drives in full VMs

Open the VM's configuration and use **Imported files** to see its drives. Shut
down the VM before connecting or disconnecting one. Disconnecting keeps the
independent image and any guest edits saved with that VM. Up to 12 imported
drives can be connected at once. Removing the VM also removes its import drives.
Connected and disconnected drives are counted in the VM's storage usage.

These extra drives are separate from the VM's main disk and are **not included
in its snapshots or backups**. Copy files onto the main guest disk if you want
them included. The configuration panel also explains this distinction.

The drive uses FAT for Windows/Linux compatibility. Individual files must be
smaller than 4 GiB, and names must be compatible with Windows. Case-colliding
names fail instead of silently replacing a file. Other copy destinations do not
have the FAT file-size limit.

## Limits and availability

- Start stopped or paused environments before dropping files. Cloud nodes,
  computer branches and tutorial preview nodes are not copy destinations.
- Custom microVMs need a compatible Yougori guest agent. Older container and
  microVM agents show an update/restart message instead of reporting success.
- A drop can select up to 256 top-level items and include 128 nested directories.
  There is no fixed total file-count or 64 GiB transfer limit. Large folders,
  including dependency trees, are processed incrementally with their file list
  stored temporarily on disk. The node shows the number of items found while
  scanning. Available host and guest disk space still determine what fits.
- Before staging a copy, Yougori checks space for temporary and guest copies
  and keeps a 2 GiB host free-space allowance. A changing disk can still fill
  during a transfer, in which case the copy fails visibly.
- Transfers allow up to 24 hours, including guest extraction, so large projects
  are not stopped by the previous 30-minute timeout.

## Implementation and verification

The desktop packages only ordinary files/directories into a temporary archive
and streams it through the authenticated runtime control connection. The agent
validates archive paths and entry types and uses directory descriptors with
`O_NOFOLLOW` to prevent extraction through links. Containers receive files through
their kernel-provided task root, with the container user's ownership; microVMs
receive files on their own disk. Shared filesystems cannot be copy roots.
Full VM imports are standalone
FAT images attached through QMP, with no source paths passed to QEMU.

Tests cover source preservation after guest edits/deletions, nested binary and
hidden files, duplicate drops, links/junctions and unsafe archives, native drag
coordinates at high DPI, node targeting and progress/error states. Disposable
runtime tests exercise actual container/microVM transfers and a Q35 VM's USB
hot-plug, guest reads/writes and persistence across restart. No screenshots or
image previews are used.
The large-folder regression test sends 100,005 real files through the complete
desktop-to-container copy path and verifies the source remains unchanged.

The same operations are available through the CLI methods
`copy_files_to_environment`, `list_imported_drives`, and
`set_imported_drive_attached`. Copy requests take an `environmentId` and a
nonempty `paths` array of absolute source paths.
