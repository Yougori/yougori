# CLI operations

Run `yougori-cli help` and `yougori-cli schema` for the current complete command catalog. Schemas include required/optional parameters, examples, and confirmation requirements. In a development checkout replace `yougori-cli` with `npm run cli --`.

The desktop engine owns disks and runtime state. The CLI connects through a same-user local pipe/socket, never a public HTTP listener. `app start` launches the installed desktop executable with `--headless`; `app show` opens the dashboard; `app quit --yes` shuts down the engine and its workloads gracefully. In development, run `npm run desktop:dev -- -- -- --headless` in a separate terminal (the separators belong to npm, Tauri, then its runner; Vite is still needed for any windows you open).

## Create and configure

```text
yougori-cli env create --name web --kind container --image docker.io/library/node:24 --cpu 2 --memory 2
yougori-cli env create --name database --kind container --image docker.io/library/mongo:8 --startup image --memory 2
yougori-cli env create --name ai --kind gpu --image docker.io/library/ubuntu:24.04 --cpu 4 --memory 8
yougori-cli env create --name tiny --kind microvm --cpu 2 --memory 2
yougori-cli env create --name windows --kind vm --source C:/Images/Windows.iso --cpu 4 --memory 8 --storage 64
yougori-cli env start ENV_ID
yougori-cli env internet ENV_ID --enabled true
yougori-cli env resources ENV_ID --cpu-min 1 --cpu 2 --cpu-max 4 --memory-min 1 --memory 4 --memory-max 8
yougori-cli env storage ENV_ID --capacity 100
yougori-cli env open ENV_ID
yougori-cli env exec ENV_ID --command "uname -a" --yes
```

Creation returns the platform state including the new ID. Base-image containers default to a keep-alive process for terminal use. For database/server OCI images use `--startup image` to run their ENTRYPOINT/CMD, or `--command` for a custom startup command. Configure credentials as the application requires; image startup is not proof that a database is ready. A VM ISO starts an installer; it does not supply an already installed or licensed OS. Prefer custom JSON from `schema create_environment` when exact policies are needed. The CLI uses existing runtime checks; provider limits are not waived. If the shared OCI pool needs more capacity, create/configure the intended containers while its workloads are stopped; do not stop unrelated workloads without authorization. Disk expansion does not necessarily expand guest partitions. GPU setup: `gpu status`, `gpu setup --yes`, then `gpu test ENV_ID` runs the real CUDA check.

`env stop` uses normal backend stop/recovery semantics. Force recovery (`env recover ENV_ID --yes`) requires the affected runtime to have no other live owner. Factory reset (`env reset ENV_ID --confirmation EXACT_NAME --yes`) erases guest data but retains source image. Deletion and snapshot restore also require `--yes`. Back up first if data matters.

## Connect nodes and folders

### Existing cloud servers

`schema scan_cloud_host`, `schema add_cloud_environment` and `schema get_cloud_connection` describe the SSH node workflow (AWS EC2, Google Compute Engine, Azure VM, or another existing Linux server). This needs OpenSSH on the PC, Python 3 on the server, SSH reachability and a user-selected SSH identity file. Unlock encrypted keys in the local SSH agent first. No account provisioning, administrator install or remote system service is performed.

Scan candidate keys, then have the user verify the fingerprint through their provider/administrator before submitting hostKey. Never automatically trust a scanned key or bypass a changed-key failure. Add the node with `call add_cloud_environment --file request.json --yes`. Connect using `call set_environment_status` with environmentId and status=running; disconnect with status=stopped. These are connection states, not server power controls. Restart/pause, resource allocation, factory reset, snapshots and Local network/Public access publishing are unavailable. Removing the node only removes Yougori access, not the remote machine/data.

Connected cloud nodes support the regular terminal and env exec commands. Node links allow selected TCP ports and designated shared folders. Local nodes reach cloud peerAddress:port (forwarded to the server's loopback service). From a cloud terminal use the SOCKS5 URL in the current Skills/cloudProxy or $OPENDOCK_SOCKS_PROXY to reach allowed local peers; there is no direct private NIC inside the cloud OS. The shared-files browser/API uses $OPENDOCK_SHARED_FILES inside the cloud server, with the existing file API and direction permissions. No automatic whole-disk access, UDP, ping, LAN routes or transitive connections. Yougori disconnection closes its terminals/tunnels, leaving independent remote services running. Refresh Skills after reconnecting because loopback endpoints can change.

### Local nodes and selected folders

```text
yougori-cli connection create --source ENV_A --target ENV_B --direction bidirectional --permissions files,ports --ports 5432
yougori-cli env skills ENV_A
yougori-cli share add ENV_A --path C:/Projects/site --read-only true --yes
yougori-cli ports list ENV_A
yougori-cli ports add ENV_A --port 3000
yougori-cli ports publish ENV_A --port 3000 --kind local --host-port 13000 --yes
yougori-cli ports publish ENV_A --port 3000 --kind cloudflare --yes
yougori-cli ports unpublish PUBLICATION_ID
```

Connections work across containers, GPU containers, microVMs and VMs where the runtime supports enforcement. For a website calling a database, point the website's **server backend** at the DB's private address from Skills, not localhost. Browsers outside Yougori cannot access this private address. The DB must listen on its guest interface and authenticate the website. A stopped peer cannot serve traffic.

Host shares/publications are session-scoped and revoked when the environment or engine stops. Full-VM My PC access may use a private read-only file browser rather than a mounted drive. Inspect the actual returned mountPath/guestUrl. Do not promise write access when the backend reports read-only access.

`local` exposes the TCP service to this PC/private LAN, subject to firewalls. `cloudflare` publishes a public HTTPS link; direct-public-IP publishing is not offered by the CLI. For an account tunnel use `schema publish_environment_service` and supply the optional cloudflare object, fixed hostPort, hostname, token, remember, and routesReviewed. Review dashboard routes yourself; Yougori does not configure DNS or visitor authentication. Never silently fall back from a failed account tunnel to a Quick Tunnel.

`ports add` / `ports remove` only change the persisted graph declaration; they do not start a guest process, open a firewall, or unpublish an existing listener. Use `ports unpublish PUBLICATION_ID` to revoke access. CLI and desktop declarations are synchronized, including stopped environments.

## Desktop terminal and agent setup

Users can open **Terminal** in the dashboard and press **Set up AI agent access** instead of typing a skill-install command. This writes only Yougori's skill into this user's Codex skills directory (respecting an absolute `CODEX_HOME`). Repeating setup is safe. An update replaces only unchanged Yougori-managed files; personal edits are not overwritten. Open a new Codex session afterward. Codex, Claude, and Gemini launch buttons appear for detected local commands; they start in a fresh tab and do not install or log in to an agent. **Copy agent guide** supplies instructions for other agents without installing a skill into their configuration.

The integrated host terminal defaults to `Yougori/Workspace` inside the user's profile, created on first use, with the bundled CLI added to that session's PATH, not the system PATH. New shell/agent tabs use that workspace unless the user explicitly chooses a project with the folder picker. An existing tab's old home-folder location is not inherited. Changing the starting folder does not limit OS file access; do not describe it as a sandbox or permission grant. PowerShell runs without user profiles; Yougori refuses to create host shells when the app is elevated. The panel has up to four shells, bounded output history, and no terminal transcript saved by Yougori. Programs you run may keep their own history or logs. Hide preserves sessions; ending a tab terminates its shell and its attached Windows job processes. Programs launched independently through the OS may outlive the shell.

Automation equivalents are `get_host_terminal_info`, `set_up_agent_access`, and `host_terminal_action` in `schema`. Host create/write/close requests require `--yes`; read/resize do not. Host session IDs start with `host-`; data is base64 UTF-8; retain the returned byte offset while polling. CLI-owned host sessions are separate from dashboard shells. Ordinary `terminal` commands remain guest terminals. Never send an agent launch or command into an existing busy shell or password prompt; create a fresh host session for an explicitly requested host command.

## Raw API and execution

For raw JSON, `create_environment.request` accepts `name`, `kind` (`container`, `microVm`, `fullVm`), `provider` (`openDockOci`, `openDockCuda`, `qemu`), `runtime` (OCI image, VM media path, or `builtin:alpine`), `description`, `containerCommand`, `networkAccess`, `gpuAccess`, optional `storageGb`, and `resourcePolicy`. The policy has `cpu` and `memoryGb` ranges (`min`, `preferred`, `max`) and `priority` (`low`, `normal`, `high`, `critical`). To update an entire saved policy, include each range's `current` value from state; prefer `env resources` for partial changes. Legacy native-sandbox/computer-branch fields are not a supported way to run host applications.

`create_connection.request` accepts `sourceId`, `targetId`, `direction` (`oneWay` or `bidirectional`), `permissions` (an array of `network`, `ports`, `files`, `volumes`, `data`, `secrets`), `ports` (an array of TCP port strings), and optional `volume`. Ask only for needed permissions; the backend rejects unsupported combinations. `network` allows more than specific ports. Use the returned enforcement status and live Skills to verify actual access.

`snapshot`, `backup`, `settings`, `terminal`, `microvm`, and `window` commands mirror backend features. Read the catalog for their exact options. `call METHOD --file -` reads a JSON parameter object from stdin; `--json` accepts an inline object but should not contain secrets. `--dry-run` validates syntax/confirmation requirements without dispatching the operation; it does not prove runtime readiness. Read-only commands need no `--yes`.

`terminal create` returns a session owned by the CLI, separate from desktop terminals. Supply the same session ID for read/write/resize/close. Data uses base64, exactly as the desktop terminal protocol; reading returns data, offset, and done. `terminal install` stages an existing supported tool installer and starts it in that terminal; inspect subsequent terminal output for install success. `env exec` executes in standard/CUDA containers and built-in agent microVMs. Full VMs require their guest console or user-configured SSH; CLI access does not magically add a guest agent.

Machine output is JSON. Long operations return durable-for-this-engine-session job records, including failure and timestamps. Jobs are bounded and retained for 30 minutes after completion; restarting the engine loses job history, not persisted environment state. Closing a CLI client does not cancel an accepted operation. For interrupted VM creation, inspect the persisted node/error. Never automatically repeat create, restore, reset, or publish after an unknown outcome.
