# Guest display and host keys

The embedded VM viewer always preserves the framebuffer's aspect ratio, with no
cropping or non-uniform stretching. By default the foreground, visible viewer
asks the guest to match its window using the VNC SetDesktopSize extension. The
guest display device, driver, and desktop must support and accept that request.
Until a matching resolution is actually received, the complete desktop remains
proportional, with bars if necessary. Sending a resize request is not evidence
that the guest accepted it. A basic VGA display cannot adapt this way.

**Workspace actions → Keep guest resolution** disables guest resize requests;
**Auto-resize guest resolution** enables them again. Background windows, hidden
views, and disconnected viewers cannot keep resizing a shared desktop. noVNC
negotiates protocol support and throttles requests. Its original proportional
renderer and pointer mapping are retained.

**Fit window to desktop** resizes the native viewer window to the guest's existing
aspect ratio, removing bars without needing a guest driver. It respects minimum
window dimensions and the monitor work area. Maximized/full-screen windows must
be restored first. This action never changes the guest's disk, GPU, or drivers.

`scripts/patch-novnc.mjs` now removes the former stretching extension from
existing noVNC 1.7.0 installations; clean installs remain unmodified. It refuses
unrecognized modifications or versions. Tests cover correct proportions in wide
and portrait windows, exact fitting at matching aspect ratios, pointer mapping,
zero-size viewports, and foreground-only resolution control.

On Windows hosts, only the left/right Windows keys are intercepted, and only
while the corresponding OpenDock guest window is foreground and the pointer is
inside the visible guest display. The native gate rechecks foreground HWND and
pointer position for every key-down; frontend hover alone is not trusted.
Events are delivered only to the owning window and carry a view-specific token.
Leaving the display, losing focus, switching tabs, or disconnecting releases the
guest keys. A captured physical key-up is consumed even after leaving the guest,
so it cannot open the host Start menu. Ordinary keys are not recorded or routed
through the native hook. Host-reserved secure sequences such as Ctrl+Alt+Delete
are not intercepted. Browser-only previews do not promise OS-key isolation.

## Current limitations

Additional windows still mirror one desktop. Real extended monitors require
guest display drivers plus per-monitor runtime and viewer support; window count
alone does not create guest monitors. Do not silently replace a working VM's
primary adapter or claim that a mirrored window is a second monitor.

Shared GPU currently selects the host EGL/VirGL renderer. It is neither PCI
passthrough nor GPU partitioning. A successful adapter probe confirms the host
renderer opened the selected adapter, not that a guest driver uses acceleration.
Linux needs compatible VirtIO/Mesa drivers. The supported Windows path does not
currently provide accelerated 3D/DirectX/CUDA or expose the host Intel/NVIDIA GPU
in Task Manager. Installing a display-only VirtIO driver does not change that.

GPU-enabled VMs now use one primary `virtio-vga-gl` adapter, retaining its
VGA/firmware fallback. Previously VNC displayed a separate basic VGA device and
the accelerated VirtIO device was secondary. This fixes which adapter displays
the Linux desktop; it does not manufacture a Windows 3D driver. Changes apply
on the next VM start, with no disk or firmware conversion.

GPU-connected containers receive only `/dev/dri/renderD128` (DRM render node,
character major 226), read/write device access, and supplementary group 65532.
The managed appliance owns that node as root:65532 with mode 0660. No privileged
container, complete `/dev/dri` mount, host user-folder access, or world-writable
device is needed. These arguments are used for creation, reconfiguration, and
snapshot restoration. Previously configured containers need to be stopped and
have Shared GPU disconnected/reconnected to regenerate their OCI device policy.

The image still supplies its own ABI-compatible userspace graphics libraries.
In particular, Alpine 3.24's packaged Mesa excludes the VirGL Gallium driver;
installing `mesa-dri-gallium` there still falls back to llvmpipe. Alpine 3.23's
Mesa includes VirGL. Do not silently downgrade a user's image or report that all
OCI images are accelerated. The dedicated non-root integration test opens the
assigned DRM device, creates a real GBM/EGL/GLES context, rejects software
renderers, submits an off-screen GPU workload, and checks that a disconnected
container has no GPU device. It performs no screenshots or pixel readback.

Validated with Alpine 3.23 on Intel and NVIDIA host adapters (including changing
adapters between clean starts while retaining the same container), and Ubuntu
24.04 on Intel. Both ran the workload as UID 10001. This is not a claim that
arbitrary OCI images, CUDA, or Windows guest 3D are supported. The Windows Setup
probe also supports `-Gpu -Restart` to verify the primary adapter's firmware
fallback with a visible WinPE installer, TPM 2.0, Secure Boot, and a guest reboot.

Relevant upstream references:

- [QEMU VirtIO GPU requirements](https://www.qemu.org/docs/master/system/devices/virtio/virtio-gpu.html)
- [Alpine 3.24 Mesa driver build list](https://github.com/alpinelinux/aports/blob/3.24-stable/main/mesa/APKBUILD)
- [Alpine 3.23 Mesa driver build list](https://github.com/alpinelinux/aports/blob/3.23-stable/main/mesa/APKBUILD)
- [SPICE multi-monitor guest-driver requirements](https://www.spice-space.org/multiple-monitors.html)
