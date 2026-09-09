# Yougori rename compatibility

The product is Yougori. Installers, window titles, dashboard, instructions, CLI help, and bundled agent skill use this name. The desktop executable is `yougori.exe` on Windows; the CLI is `yougori-cli.exe`. In the built-in PowerShell terminal, `yougori` is also available.

Existing data is not moved, renamed, or deleted. These technical identifiers deliberately remain stable:

- `com.opendock.desktop`: Tauri application identity and its existing application-data/WebView storage. Keeping the identity also preserves installer upgrade identity.
- OS credential-vault service names, singleton locks, control pipes/sockets, runtime ownership names, CUDA WSL distribution names, and guest agent protocols.
- Serialized provider IDs, browser storage keys, guest `/opendock` directories, system users, snapshot tags, native branch identity, and shipped runtime binary filenames/checksums.
- Historical copyright notices and third-party source/patch attribution.

Changing these blindly could hide VM disks, orphan GPU containers, lose stored credentials, or allow two engines to write the same disk. They are compatibility identifiers, not the displayed product name. Existing compiled guest helpers may still print the former name; the maintained source messages use Yougori where they are not protocol fields. Rebuilding those helpers is a separate runtime release, not required for this rename.

New local backups use `backup.yougori`. The file picker also accepts `backup.opendock`; both use the same validated payload format. Keep `disk.data` beside either manifest.

New terminal workspaces default to `Yougori/Workspace` under the user's profile. If only an old `OpenDock` directory exists, its workspace is reused without moving user files. Redirected/conflicting paths still fail safely. Users may choose a different existing folder explicitly.

The bundle includes an `opendock-cli` compatibility copy so existing scripts and previously installed skills continue to work. New agent setup installs `skills/yougori`, leaving old/custom personal skills untouched. `YOUGORI_APP` is preferred for explicit engine location; `OPENDOCK_APP` remains supported. Both PowerShell command names work. No system PATH, personal skill, live workload, or project-folder rename is performed by this source change.
