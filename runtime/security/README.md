# Secure Windows VMs

Recognized Windows 10/11 x64 installation media automatically receive a
private TPM 2.0 and enforced Secure Boot. Existing WIN11 environments enable
these on their next **stop/start**, keeping the existing disk and legacy
firmware variables. Original filenames and the official x64 Windows ISO
volume label are used as OS hints. Linux, Windows 7 and unknown images keep
the existing firmware profile. This is not a promise that every custom ISO,
older Windows version, or application meets all of its other requirements.

No host firmware changes, host TPM access, paid service, login, driver or
TPM/Secure Boot registry bypass is involved. WHPX acceleration remains enabled.
Windows installation and licensing are still the user's responsibility.

## Persistence and backups

Each environment has `vm-security.json`, pointing to its private
`security-<uuid>/tpm.nv` and `uefi-vars.json`. Do not delete/reset these files:
encrypted guests can depend on them. Missing/corrupt state fails closed;
OpenDock never manufactures a replacement identity for an existing profile.
Retain guest BitLocker recovery keys separately. Local backups contain the
software TPM's private data and are not encrypted by OpenDock; keep them in
a private, encrypted location. Cloud backups use the existing encrypted path.

Stopped-VM local/cloud backups include the disk, TPM NV and UEFI variables.
They use an OpenDock QCOW2 extension and backup manifest version 2. Older
OpenDock versions reject them. Restore uses the existing disk transaction
plus a staged security generation, so rollback restores both together.
Use **Load local backup**, not a generic disk import or a third-party
qemu-img conversion (which can discard the security extension).

The Snapshot button creates a complete disk-and-security artifact for a
stopped TPM-enabled VM. Disk-only internal snapshots and live memory
snapshots/migration are blocked for these VMs. Firmware is
pinned by hash; changing it can affect measured boot and encrypted guests.
The runtime updater retains content-addressed firmware images for existing
VMs and backups. New VMs use the corrected default; existing profiles do not
silently change their measured-boot firmware. A deliberate firmware upgrade
can require a BitLocker recovery key if encryption is enabled. Restore the matching runtime if
OpenDock reports a firmware mismatch; do not reset the TPM to work around it.

## Building from source (developers only)

End users run the bundled runtime. Developers need Git, MSVC C++ Build Tools
(for the existing GPU-selection bridge), an MSYS2 UCRT64
toolchain at `build/secure-runtime/toolchain/msys64`, and WSL Ubuntu 22.04.
Obtain MSYS2 from https://www.msys2.org/ and verify its published checksum.
No Developer Mode, administrator QEMU process, or global PATH change is needed.

In that MSYS2 UCRT64 shell install the signed build packages:

```sh
pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-meson mingw-w64-ucrt-x86_64-ninja mingw-w64-ucrt-x86_64-glib2 mingw-w64-ucrt-x86_64-pixman mingw-w64-ucrt-x86_64-libslirp mingw-w64-ucrt-x86_64-openssl mingw-w64-ucrt-x86_64-gnutls mingw-w64-ucrt-x86_64-zstd mingw-w64-ucrt-x86_64-virglrenderer mingw-w64-ucrt-x86_64-angleproject git make diffutils
```

In WSL install `build-essential nasm uuid-dev acpica-tools python3-venv pesign`.
Then, with OpenDock and its VMs closed, run from PowerShell:

```powershell
./scripts/build-secure-runtime.ps1 -Install
```

Without `-Install` the script only stages a new directory. It verifies source
commit IDs, applies the checked-in patches, builds TPM/QEMU/EDK2, enrolls public
trust objects, resolves DLL dependencies, includes licenses and writes hashes.
It preserves an existing runtime instead of overwriting mapped executables.
`-SkipFirmware` reuses the existing built firmware for incremental QEMU work.
Native compilation may require several GB of scratch space; none of those
toolchains, caches or intermediate objects are shipped in the app.

## Tests

All full VMs on Windows use this native QEMU build, including guests without
Secure Boot. `qemu-whpx-reboot.patch` resets WHPX partition state on guest reset,
fixing a reproduced `Unexpected VP exit code 4` / paused-guest failure on the
Windows 11 host. Regular guests keep their original pflash firmware; upgrading
the executable does not replace existing TPM identities or firmware variables.
Windows 10 hosts lack the optional reset API and are not covered by this test.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml secure_vm_backups_preserve_identity_and_roll_back -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml secure_boot_rejects_unsigned_installer -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib installer_guest_restarts -- --ignored --nocapture --test-threads=1
./scripts/test-windows-setup.ps1 -Iso 'C:\path\Win11_x64.iso'
./scripts/test-windows-setup.ps1 -Iso 'C:\path\Win11_x64.iso' -Restart -MemoryGb 29
```

The Windows test requires working WHPX acceleration (software fallback is a
test failure). It uses a fresh disposable VM, leaves the ISO read-only,
starts a test-only WinPE observer and requires Windows to report TPM 2.0,
SecureBoot=1, SetupMode=0 and a visible Windows Setup process/window. It does
not take screenshots, accept a license or install Windows. The separate EFI
restart fixture now calls the actual UEFI ResetSystem service instead of
bypassing firmware with chipset writes, and leaves stale data in the pinned
OVMF SNP metadata page to prevent this regression from returning. The opt-in `-Restart` Windows test
requires another visible, TPM/Secure-Boot-verified Windows Setup session after
a WinPE-requested reboot. It reproduced the old firmware's invalid VMGEXIT
fault (VirtMmCommunication SVSM probe) before the SEV-SNP guard was added.
The separate EFI security test proves an untrusted executable is actually rejected.

`runtime/security/test-tpm.c` additionally tests crypto self-tests, fresh
entropy, persistent NV, exclusive file locking, malformed command bounds,
torn-write recovery and refusal to overwrite missing/corrupt identities.
Compile it with UCRT64 GCC and run it against `opendock-tpm.dll` with a new
disposable state filename. It never calls the developer computer's TPM.
