# Installer boot helper

Yougori's x64 UEFI application runs **inside QEMU**, not on the host. It is
attached as a small read-only FAT disk only when the VM has installer media.
Firmware tries the VM's normal disk first, then this helper, then the ISO.

The helper finds optical/UDF filesystems and loads the selected media's own
`efi/microsoft/boot/cdboot_noprompt.efi`. This removes Windows Setup's timed
keyboard prompt. Other x64 UEFI ISOs use `EFI/BOOT/BOOTX64.EFI`. The helper
excludes its own volume, bounds device-path traversal, and never writes to
the ISO or partitions a disk. It does not automate installation, accept
licenses, bypass hardware checks, or change Secure Boot policy.

`bootx64.efi` is embedded into Yougori so end users do not need another compiler,
downloader, or paid component. Verified EFI files are tracked by Git, so
a fresh source checkout can compile the desktop without rebuilding them. The
source is `main.c` with minimal UEFI ABI declarations in `uefi.h`. Build with
Visual Studio C++ tools and the Windows SDK:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-boot-helper.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-boot-helper.ps1 -TestFixture
```

Add `-Check` to either command to verify a reproducible rebuild against the
bundled binary without replacing it.

Full VMs use `host` on KVM/HVF and `max` on TCG. On WHPX they use
`max,vmx=off,svm=off`: modern instructions without unsupported nested
virtualization features. They leave interrupt-controller selection to QEMU;
forcing `kernel-irqchip=off` hung Windows during multiprocessor startup, while
unmasked VMX caused an OVMF fault at MSR `0x3a` with the automatic controller.
Both adjustments retain hardware acceleration. This does not add a virtual TPM or enable
Secure Boot; those Windows setup requirements are a separate runtime concern.

Windows' no-prompt file is read through the ISO's UDF mapping, but loaded
against the matching El Torito device path. This preserves the DVD device
identity that Microsoft's loader requires. Filenames account for UDF case
sensitivity. Only the unmodified EFI file is loaded; nothing is extracted
onto the host or written back into the media.

`test-os.efi` is a test-only payload, not embedded in release builds. It emits
a fixed marker and idles; it does not install or run a host application.
The Rust tests verify FAT geometry, EFI architecture, integrity, no-key
installer startup, and preference for an already-bootable disk.

The real Windows-media test is opt-in. Set `OPENDOCK_TEST_WINDOWS_ISO` to a
local x64 Windows ISO, then run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml installer_boot_ -- --include-ignored --nocapture --test-threads=1
```

These boot-helper tests use temporary VM disks and read-only media. They never
send keyboard input, take screenshots, interact with existing VMs, or install Windows.
Boot diagnostics contain only status markers, written through guest debug
I/O port `0xe9` to a bounded 4 KB QEMU memory buffer (not an unbounded host log).

The loader-handoff test above is deliberately **not** a Windows Setup readiness
test. For that, use `scripts/test-windows-setup.ps1 -Iso <English-x64-ISO>`.
It runs the actual RuntimeManager with a disposable disk and a test-only USB
observer. After boot, it opens the guest's Shift+F10 console and starts that
observer, which reports visible window titles and Setup processes to its own
FAT disk. Success requires both a visible Windows Setup window and a Setup
process. There are no screenshots, unattended installation settings, license
acceptance, partitioning commands, hardware-check bypasses, or user VM changes.

ABI references: [UEFI specification](https://uefi.org/specifications),
[EDK2 UDF device paths](https://github.com/tianocore/edk2/blob/master/MdeModulePkg/Universal/Disk/PartitionDxe/Udf.c).

## Guest restart regression

Full VMs explicitly use `reboot=reset,shutdown=poweroff,panic=exit-failure`.
Windows Setup/Update restarts stay inside the same QEMU process and desktop
endpoint; they do not require clicking Start again. Installed disks keep first
boot priority even while the installer ISO remains attached. A successful guest
shutdown is reported as Stopped; abnormal process exits remain errors.
See [QEMU event actions](https://www.qemu.org/docs/master/system/invocation.html).

`test-restart.c` is a **test-only** EFI payload, never used in production installer
media. It requests three cold/warm resets through the guest chipset ports used
by OVMF (0xcf9 and 0x64), retains a disk-file
counter, then requests shutdown. The integration test checks all four boots use
the installed disk, the process/display/password stay the same, and shutdown
preserves the disk. This is not a complete Windows installation test.
It runs with both regular firmware and the Windows 11 TPM/Secure Boot profile.
The latter trusts the fixture's exact Authenticode hash only in its temporary
VM variables; neither the shipped trust database nor a user's VM is changed.
The WHPX partition-reset patch is described in `runtime/security/README.md`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-boot-helper.ps1 -RestartFixture
cargo test --manifest-path src-tauri/Cargo.toml --lib installer_guest_restarts -- --ignored --nocapture --test-threads=1
```
