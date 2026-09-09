# Shared GPU selection on Windows

The unmodified QEMU Windows EGL path opens the default display. Yougori's small
`libEGL.dll` bridge redirects display creation to ANGLE's D3D11 backend using the
selected adapter LUID. It forwards the complete upstream export table to the
original, preserved `libEGL_angle.dll`; no QEMU or ANGLE source fork is required.

After initialization, it queries the actual D3D11 device's DXGI adapter. A missing
or mismatched explicit selection fails initialization. This is important because
ANGLE itself permits fallback when the requested LUID is no longer available.
The native runtime also checks the report's process ID and adapter identity before
accepting startup. Automatic mode keeps upstream behavior and reports the adapter
when verification is available. Missing Automatic verification is shown explicitly.

Enumeration skips software adapters. Selection is stored by PCI hardware identity
and resolved to the current LUID at launch, so ordinary reboots do not invalidate
it. Identical boards additionally use their LUID and may require re-selection
after a reboot. There are no Windows registry changes or host driver installs.

All containers share one selection; GPU-enabled full VMs use it too. Changes are
serialized against launches, require all containers and GPU full VMs stopped,
and cleanly stop only an idle appliance while preserving its disk. The selection
is host-specific and is not exported in environment backups.

Rebuild with MSVC C++ Build Tools:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-gpu-bridge.ps1
```

Close Yougori before rebuilding DLLs used by an active runtime. The script
preserves upstream ANGLE and updates the bundled checksums. Normal source users
can use the checked-in binaries without rebuilding the bridge. GPU verification
is local and does not publish services or open display windows.

References:

- https://github.com/google/angle/blob/main/extensions/EGL_ANGLE_platform_angle_d3d_luid.txt
- https://github.com/google/angle/blob/main/extensions/EGL_ANGLE_device_d3d.txt
- https://github.com/qemu/qemu/blob/master/ui/egl-helpers.c

This is shared graphics acceleration, not CUDA, VRAM partitioning, or PCI GPU
passthrough. Existing upstream licensing notices remain in the bundled runtime.
