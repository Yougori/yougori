# Branded desktop installers

Yougori's installer artwork uses the existing root `logo.svg`: the same cube
logo as the app. The graphite, warm-ivory and muted-green palette complements
the desktop workspace. Native buttons, keyboard navigation, license acceptance,
upgrade checks and uninstall behavior remain provided by Tauri's installers.

## Platform appearance

- Windows setup EXE: branded welcome/finish sidebar, page header, setup icon
  and uninstall icon/header. The MSI gets a matching sidebar and top banner.
- macOS DMG: a branded background with aligned Yougori and Applications icons
  and a drag-to-install instruction. It must be built and checked on a Mac.
- Linux DEB: the existing Yougori app icons and package description appear where
  supported by the desktop/software manager. Linux controls the installation
  dialog; a DEB cannot supply a Windows-style custom setup wizard.

The publisher metadata is `Yougori LLC`. This is not a digital signature:
Windows trust prompts and macOS Gatekeeper are controlled by the OS. Signing
and notarization require the appropriate certificates and release setup;
branding does not bypass them. The application identifier stays unchanged to
preserve existing installation/data compatibility.

Older development installers used different publisher metadata. Before a
public release, test upgrades from those previews, including custom install
locations and switching between MSI and EXE installers.

## Build a setup file

On Windows, from the repository root:

```powershell
npm run desktop:build
```

The EXE is in `src-tauri/target/release/bundle/nsis/` and the MSI is in
`src-tauri/target/release/bundle/msi/`. Running `desktop:dev` launches the app,
not the setup wizard. Use the existing Linux/macOS platform guides to build
on those systems. No installers are published by these commands.

## Change or regenerate artwork

Edit `scripts/generate-installer-branding.mjs` to adjust layout, colors or copy.
Use a Windows machine with Segoe UI installed for the reference text rendering:

```powershell
npx playwright install chromium --no-shell
npm run branding:generate
npm run branding:check
```

The generator renders vector artwork using the existing logo and Playwright's
Chromium. It writes genuine 24-bit BMP files for Windows and a PNG for macOS
into `src-tauri/installer/`. Commit those assets and their integrity manifest
alongside any generator/logo changes. Normal builds do not launch a browser
or regenerate artwork; they validate the committed files before packaging.

PNG artwork previews are generated under the ignored `artifacts/installer-branding/`
directory. Native installer text and controls are drawn by the OS on top of
the artwork, so inspect a built installer at normal and high-DPI scaling before
shipping. macOS Finder controls and Linux software-manager dialogs also need
native platform checks.
