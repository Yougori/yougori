use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Method {
    pub name: &'static str,
    pub summary: &'static str,
    /// `?` marks optional fields. Complex object examples come from the actual
    /// backend request shape, not an alternative configuration/state format.
    pub parameters: &'static str,
    pub example: Value,
    pub mutating: bool,
    pub confirmation: Option<&'static str>,
}

pub fn methods() -> Vec<Method> {
    let mut list = Vec::new();
    macro_rules! method {
        ($name:ident, $summary:literal, $params:literal, $example:expr, $write:expr, $confirm:expr) => {
            list.push(Method {
                name: stringify!($name),
                summary: $summary,
                parameters: $params,
                example: $example,
                mutating: $write,
                confirmation: $confirm,
            });
        };
    }
    let env = json!({"environmentId":"env-ID"});
    method!(scan_cloud_host, "Read candidate SSH host keys. Verify the fingerprint with the user/server administrator before trusting one; this does not authenticate or trust the server.", "host:string port:port", json!({"host":"server.example.com","port":22}), false, None);
    method!(add_cloud_environment, "Add an EXISTING Linux SSH server. No provisioning or power changes. Requires OpenSSH locally, Python 3 remotely and a verified host key. Connect/disconnect using set_environment_status running/stopped; never paused or restart.", "request:object", json!({"request":{"name":"Cloud database","vendor":"aws","host":"server.example.com","port":22,"username":"ubuntu","identityFile":"C:/Keys/server.pem","hostKey":"ssh-ed25519 VERIFIED_BASE64_HOST_KEY"}}), true, Some("Adds the existing cloud server and trusts the host key explicitly verified by the user."));
    method!(get_cloud_connection, "Get cloud SSH connection settings and connected private SOCKS/shared-files endpoints. Endpoint loopback addresses are inside the cloud server, not on this PC.", "environmentId:string", env.clone(), false, None);
    method!(get_host_terminal_info, "Inspect host shell, bundled CLI, agent skill setup and this client's host terminal sessions. This is host access, not a guest.", "", json!({}), false, None);
    method!(set_up_agent_access, "Install/update only the unmodified Yougori-managed Codex skill for this user; preserve custom edits.", "", json!({}), true, Some("Installs Yougori agent instructions in this user's Codex skills directory."));
    method!(host_terminal_action, "HOST computer terminal, not an isolated guest. request={sessionId:host-UNIQUE,action:create|read|write|resize|close,data?:base64,offset?:integer,cols?:integer,rows?:integer,cwd?:absolutePath}. Host shells refuse administrator elevation.", "request:object", json!({"request":{"sessionId":"host-cli-unique","action":"create","cols":100,"rows":24}}), true, None);
    let policy = json!({"cpu":{"min":0.5,"preferred":2,"max":4,"current":0},"memoryGb":{"min":0.5,"preferred":2,"max":4,"current":0},"priority":"normal","dynamic":true});
    method!(
        get_platform_state,
        "List environments, connections, snapshots, settings and host/provider state.",
        "",
        json!({}),
        false,
        None
    );
    method!(
        get_connection_skills,
        "Live agent instructions for the node's saved connections and My PC shares.",
        "environmentId:string",
        env.clone(),
        false,
        None
    );
    method!(create_environment, "Create Container, GPU (container/openDockCuda), VM (fullVm), or microVM (microVm). GPU needs compatible hardware/runtime. VM creation waits for disk preparation, not OS installation.", "request:object", json!({"request":{"name":"web","kind":"container","provider":"openDockOci","runtime":"docker.io/library/node:24","description":"","networkAccess":false,"gpuAccess":false,"resourcePolicy":policy.clone()}}), true, None);
    method!(
        set_environment_status,
        "Start, stop or pause using the same recovery and lifecycle checks as the desktop.",
        "environmentId:string status:running|stopped|paused",
        json!({"environmentId":"env-ID","status":"running"}),
        true,
        None
    );
    method!(restart_environment, "Stop and start this environment using normal runtime checks. This is a runtime restart, not guest OS installation progress.", "environmentId:string", env.clone(), true, None);
    method!(recover_environment_runtime, "Choose the correct abandoned-runtime recovery for the node's saved provider; never format its disk.", "environmentId:string confirmed:bool", json!({"environmentId":"env-ID","confirmed":true}), true, Some("Stops/recover the affected runtime, which may serve multiple containers."));
    method!(delete_environment, "Delete this environment and its managed data; source images/backups follow the desktop's retention rules.", "environmentId:string recoverRuntime?:bool", env.clone(), true, Some("Permanently deletes this environment's data."));
    method!(
        factory_reset_environment,
        "Erase guest data, retain source image. confirmation must be the exact environment name.",
        "environmentId:string confirmation:string",
        json!({"environmentId":"env-ID","confirmation":"EXACT_NAME"}),
        true,
        Some("Erases guest data. Back up anything needed first.")
    );
    method!(
        recover_container_runtime,
        "Recover only this Yougori runtime when no other live owner exists.",
        "environmentId:string confirmed:bool",
        json!({"environmentId":"env-ID","confirmed":true}),
        true,
        Some("Stops the affected runtime; may affect its other environments.")
    );
    method!(
        recover_vm_runtime,
        "Recover a failed VM runtime without formatting its disk.",
        "environmentId:string confirmed:bool",
        json!({"environmentId":"env-ID","confirmed":true}),
        true,
        Some("Stops/recover the affected VM runtime.")
    );
    method!(
        rename_environment,
        "Change only the environment's display name; keeps runtime IDs, disks and connections unchanged.",
        "environmentId:string name:string",
        json!({"environmentId":"env-ID","name":"Work VM"}),
        true,
        None
    );
    method!(
        update_resource_policy,
        "Set CPU cores and memory GB min/preferred/max. Dynamic allocation remains enabled.",
        "environmentId:string resourcePolicy:object",
        json!({"environmentId":"env-ID","resourcePolicy":policy}),
        true,
        None
    );
    method!(configure_resource_limits, "Change only the supplied CPU/memory ranges or priority; preserve the other saved limits. CPU cores, memory GB. Each range accepts min/preferred/max.", "environmentId:string cpu?:object memoryGb?:object priority?:low|normal|high|critical", json!({"environmentId":"env-ID","memoryGb":{"preferred":4,"max":8}}), true, None);
    method!(reclaim_storage, "Return unused container disk blocks to the host; compact only idle runtime storage. Keeps containers, snapshots, cached container images and exported backups. Reports deferred cleanup and measured disk reduction.", "", json!({}), true, Some("Reclaim unused storage; no running workloads are stopped."));
    method!(
        get_storage_allocation,
        "Inspect capacity, physical size and maximum available storage.",
        "environmentId?:string newVm?:bool",
        env.clone(),
        false,
        None
    );
    method!(
        expand_environment_storage,
        "Grow disk capacity in GB; stop affected workloads first. Does not shrink disks.",
        "environmentId:string capacityGb:number",
        json!({"environmentId":"env-ID","capacityGb":100}),
        true,
        None
    );
    method!(
        update_container_network,
        "Plug/unplug Internet for a container, microVM or VM. Private node links are separate.",
        "environmentId:string enabled:bool",
        json!({"environmentId":"env-ID","enabled":true}),
        true,
        None
    );
    method!(
        update_environment_gpu,
        "Change existing GPU access, subject to provider support and stopped-state requirements.",
        "environmentId:string enabled:bool",
        json!({"environmentId":"env-ID","enabled":true}),
        true,
        None
    );
    method!(create_connection, "Grant private node-to-node permissions across providers. Files is a designated folder, not a peer's entire disk.", "request:object", json!({"request":{"sourceId":"env-A","targetId":"env-B","direction":"bidirectional","permissions":["files","ports"],"ports":["5432"]}}), true, None);
    method!(
        set_connection_active,
        "Enable/disable a saved node connection.",
        "connectionId:string active:bool",
        json!({"connectionId":"conn-ID","active":false}),
        true,
        None
    );
    method!(
        delete_connection,
        "Remove a node connection and revoke access; retained shared data is not erased.",
        "connectionId:string",
        json!({"connectionId":"conn-ID"}),
        true,
        None
    );
    method!(attach_host_folder, "Share one explicitly chosen host folder. Inspect returned readOnly and mountPath/guestUrl for actual access.", "environmentId:string path:string readOnly:bool", json!({"environmentId":"env-ID","path":"C:/Projects/site","readOnly":true}), true, Some("Grants the environment access to this host folder."));
    method!(
        detach_host_folder,
        "Revoke one My PC folder share.",
        "shareId:string",
        json!({"shareId":"share-ID"}),
        true,
        None
    );
    method!(
        list_environment_services,
        "Discover guest TCP services and list live publications and My PC shares.",
        "environmentId:string",
        env.clone(),
        false,
        None
    );
    method!(
        get_manual_service_ports,
        "List persisted graph service-port declarations, including stopped nodes.",
        "",
        json!({}),
        false,
        None
    );
    method!(set_manual_service_port, "Add/remove a port on the graph. This does not start a service, publish a port, or grant access.", "environmentId:string port:port present:bool", json!({"environmentId":"env-ID","port":3000,"present":true}), true, None);
    method!(publish_environment_service, "Publish a TCP service to local LAN or Cloudflare HTTPS. Optional account credentials: cloudflare={hostname,token?,remember,routesReviewed}, plus fixed hostPort. No credentials means Quick Tunnel.", "environmentId:string port:port kind:local|cloudflare hostPort?:port cloudflare?:object", json!({"environmentId":"env-ID","port":3000,"kind":"cloudflare"}), true, Some("Exposes a guest service outside its private node network. Cloudflare URLs are public."));
    method!(
        unpublish_environment_service,
        "Close a service publication/tunnel.",
        "publicationId:string",
        json!({"publicationId":"pub-ID"}),
        true,
        None
    );
    method!(
        saved_cloudflare_account,
        "Inspect saved hostname/port; never returns the stored token.",
        "environmentId:string port:port",
        json!({"environmentId":"env-ID","port":3000}),
        false,
        None
    );
    method!(
        forget_cloudflare_account,
        "Remove saved Cloudflare credentials for this service from the OS vault.",
        "environmentId:string port:port",
        json!({"environmentId":"env-ID","port":3000}),
        true,
        Some("Removes the saved tunnel credential, not the Cloudflare account.")
    );
    method!(
        create_snapshot,
        "Create a local environment snapshot.",
        "environmentId:string name:string",
        json!({"environmentId":"env-ID","name":"before-change"}),
        true,
        None
    );
    method!(
        delete_snapshot,
        "Delete a saved snapshot.",
        "snapshotId:string",
        json!({"snapshotId":"snap-ID"}),
        true,
        Some("Permanently deletes this snapshot.")
    );
    method!(
        restore_snapshot,
        "Restore a snapshot, replacing the environment's current state.",
        "snapshotId:string",
        json!({"snapshotId":"snap-ID"}),
        true,
        Some("Replaces current guest data with the snapshot.")
    );
    method!(
        export_local_backup,
        "Save a local backup into an existing host folder.",
        "environmentId:string folder:string",
        json!({"environmentId":"env-ID","folder":"C:/Backups"}),
        true,
        None
    );
    method!(import_local_backup, "Import a backup as a new environment. Optional targetProvider supports explicit CUDA migration. Restored external permissions remain revoked.", "path:string targetProvider?:openDockOci|openDockCuda|qemu", json!({"path":"C:/Backups/example.opendock-backup"}), true, None);
    method!(add_backup_destination, "Add/verify a cloud backup destination. Supply credentials via stdin/private JSON file, not command arguments.", "request:object", json!({"request":{"name":"backup","provider":"awsS3","location":"s3://bucket/prefix","accessKey":"REDACTED","secretKey":"REDACTED"}}), true, Some("Stores credentials in the OS vault and contacts this backup provider."));
    method!(
        delete_backup_destination,
        "Remove a saved backup destination.",
        "destinationId:string",
        json!({"destinationId":"dest-ID"}),
        true,
        Some("Removes this destination and its local backup history.")
    );
    method!(
        run_backup,
        "Create/encrypt/upload a backup to a saved destination.",
        "environmentId:string destinationId:string",
        json!({"environmentId":"env-ID","destinationId":"dest-ID"}),
        true,
        Some("Uploads environment data to the selected destination.")
    );
    method!(
        restore_backup,
        "Restore a completed cloud backup.",
        "backupId:string",
        json!({"backupId":"backup-ID"}),
        true,
        Some("Restores backup data over the existing environment.")
    );
    method!(update_settings, "Save the complete settings object from get_platform_state, modifying only intended fields.", "settings:object", json!({"settings":{"theme":"system","launchAtStartup":false,"minimizeToTray":false,"pauseOnBattery":false,"telemetryEnabled":false,"dataDirectory":"","snapshotRetention":20,"bandwidthLimitMbps":0}}), true, None);
    method!(
        refresh_host_metrics,
        "Refresh host usage and enforce dynamic resource limits.",
        "",
        json!({}),
        false,
        None
    );
    method!(
        reset_platform_state,
        "Reset all managed platform state using the desktop's safety checks.",
        "",
        json!({}),
        true,
        Some("Resets the whole platform; do not use for an individual node.")
    );
    method!(
        get_cuda_runtime_status,
        "Read actual NVIDIA/WSL compatibility and installation checks.",
        "",
        json!({}),
        false,
        None
    );
    method!(
        install_cuda_runtime,
        "Install/update Yougori's dedicated CUDA runtime, not the user's other WSL distributions.",
        "",
        json!({}),
        true,
        Some("Installs/updates the dedicated WSL CUDA runtime.")
    );
    method!(
        verify_environment_cuda,
        "Execute a small real CUDA kernel inside this GPU container.",
        "environmentId:string",
        env.clone(),
        false,
        None
    );
    method!(
        get_shared_gpu_settings,
        "Inspect legacy QEMU graphics adapter settings; this is not CUDA passthrough.",
        "",
        json!({}),
        false,
        None
    );
    method!(set_shared_gpu_selection, "Change the legacy graphics adapter selection with the same stopped-runtime checks as the desktop.", "selectedId?:string", json!({"selectedId":null}), true, None);
    method!(execute_environment_command, "Execute a shell command inside an agent-equipped container/microVM. Full VMs need user-configured SSH or the desktop console.", "request:object", json!({"request":{"environmentId":"env-ID","command":"uname -a"}}), true, Some("Runs the supplied command inside the guest."));
    method!(
        read_environment_console,
        "Read the guest serial console.",
        "environmentId:string",
        env.clone(),
        false,
        None
    );
    method!(get_guest_session, "Get console connection details. Output may include a private console credential: do not publish it.", "environmentId:string", env.clone(), false, None);
    method!(terminal_action, "Create/read/write/resize/close CLI-owned terminal sessions. data is base64; use returned offset when reading.", "environmentId:string sessionId:string action:create|read|write|resize|close data?:string offset?:integer cols?:integer rows?:integer", json!({"environmentId":"env-ID","sessionId":"term-cli-unique","action":"create","cols":100,"rows":30}), true, None);
    method!(prepare_terminal_installer, "Stage a supported tool in a CLI-owned terminal; returns its short launcher command, without executing it.", "environmentId:string sessionId:string tool:codex|claude|gemini|ollama|opencode|kilo|openclaw", json!({"environmentId":"env-ID","sessionId":"term-cli-unique","tool":"ollama"}), true, Some("Stages a coding-tool installer inside this container."));
    method!(install_terminal_tool, "Stage and immediately start the supported tool installer in a CLI-owned terminal. Read terminal output for progress/result.", "environmentId:string sessionId:string tool:codex|claude|gemini|ollama|opencode|kilo|openclaw", json!({"environmentId":"env-ID","sessionId":"term-cli-unique","tool":"ollama"}), true, Some("Downloads/installs this tool inside the container."));
    method!(micro_vm_apps, "Manage built-in microVM guest app sessions. The runtime validates action/package/command.", "environmentId:string action:status|install|launch|stop|view sessionId?:string name?:string command?:string package?:string", json!({"environmentId":"env-ID","action":"status"}), true, None);
    method!(
        open_environment_window,
        "Open another graphical guest window (not an extra physical/virtual monitor).",
        "environmentId:string",
        env.clone(),
        true,
        None
    );
    method!(
        open_micro_vm_app_window,
        "Open a built-in microVM application session window.",
        "environmentId:string sessionId:string",
        json!({"environmentId":"env-ID","sessionId":"app-ID"}),
        true,
        None
    );
    method!(
        close_environment_window,
        "Close the specified guest window without stopping its environment.",
        "label:string",
        json!({"label":"environment-env-ID-WINDOW"}),
        true,
        None
    );
    method!(
        list_environment_windows,
        "List currently open guest windows.",
        "",
        json!({}),
        false,
        None
    );
    method!(
        focus_environment_window,
        "Focus a guest window.",
        "label:string",
        json!({"label":"environment-env-ID-WINDOW"}),
        true,
        None
    );
    method!(
        title_environment_window,
        "Refresh a specified guest window's title from its environment.",
        "environmentId:string label:string",
        json!({"environmentId":"env-ID","label":"environment-env-ID-WINDOW"}),
        true,
        None
    );
    method!(set_guest_keyboard_capture, "Set/release guest keyboard capture for a specific window using the existing capture token and viewport bounds.", "label:string token:string bounds?:object", json!({"label":"environment-env-ID-WINDOW","token":"TOKEN","bounds":null}), true, None);
    method!(
        open_workspace_url,
        "Open an HTTP(S) URL in the host browser.",
        "url:string",
        json!({"url":"http://127.0.0.1:13000"}),
        true,
        None
    );
    method!(
        app_status,
        "Check the running engine, version, local control endpoint and background mode.",
        "",
        json!({}),
        false,
        None
    );
    method!(
        app_show,
        "Open/focus the dashboard, including an engine started headlessly.",
        "",
        json!({}),
        true,
        None
    );
    method!(
        app_quit,
        "Gracefully stop the engine and all of its workloads/publications.",
        "",
        json!({}),
        true,
        Some("Stops all Yougori workloads and closes the desktop engine.")
    );
    method!(jobs_list, "List operation metadata (never request payloads/secrets). Results expire 30 minutes after completion.", "", json!({}), false, None);
    method!(
        jobs_get,
        "Get one operation's status and result. A running job is not completed work.",
        "jobId:string",
        json!({"jobId":"job-ID"}),
        false,
        None
    );
    list
}

pub fn find(name: &str) -> Result<Method, String> {
    methods()
        .into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("Unknown method '{name}'. Run yougori-cli schema."))
}

impl Method {
    pub fn validate(&self, params: &Value) -> Result<(), String> {
        let fields = params
            .as_object()
            .ok_or("Parameters must be a JSON object")?;
        let definitions = self
            .parameters
            .split_whitespace()
            .map(|s| s.split_once(':').unwrap())
            .collect::<Vec<_>>();
        for key in fields.keys() {
            if !definitions
                .iter()
                .any(|(name, _)| name.trim_end_matches('?') == key)
            {
                return Err(format!("Unknown parameter '{key}' for {}", self.name));
            }
        }
        for (name, kind) in definitions {
            let optional = name.ends_with('?');
            let key = name.trim_end_matches('?');
            let Some(value) = fields.get(key).filter(|v| !v.is_null()) else {
                if optional {
                    continue;
                }
                return Err(format!("Missing parameter '{key}' for {}", self.name));
            };
            let valid = match kind {
                "string" => value.is_string(),
                "bool" => value.is_boolean(),
                "object" => value.is_object(),
                "number" => value.as_f64().is_some_and(f64::is_finite),
                "integer" => value.as_u64().is_some(),
                "port" => value.as_u64().is_some_and(|v| (1..=65535).contains(&v)),
                options => value
                    .as_str()
                    .is_some_and(|v| options.split('|').any(|s| s == v)),
            };
            if !valid {
                return Err(format!("Parameter '{key}' must be {kind}"));
            }
        }
        Ok(())
    }
    pub fn confirmation_for(&self, params: &Value) -> Option<&'static str> {
        if self.name == "host_terminal_action"
            && !matches!(
                params["request"]["action"].as_str(),
                Some("read" | "resize")
            )
        {
            return Some(
                "Starts, controls, or ends a shell on the HOST computer, outside guest isolation.",
            );
        }
        if self.name == "terminal_action" && params["action"] == "write" {
            return Some("Sends input/commands to the guest terminal.");
        }
        if self.name == "micro_vm_apps" && params["action"] != "status" {
            return Some("Changes or runs applications inside the microVM.");
        }
        self.confirmation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_example_matches_its_contract_and_names_are_unique() {
        let mut names = std::collections::HashSet::new();
        for method in methods() {
            assert!(names.insert(method.name));
            method.validate(&method.example).unwrap();
        }
    }
    #[test]
    fn invalid_or_unknown_parameters_never_silently_widen_access() {
        let publish = find("publish_environment_service").unwrap();
        for params in [
            json!({"environmentId":"e","port":3000,"kind":"public"}),
            json!({"environmentId":"e","port":65536,"kind":"local"}),
            json!({"environmentId":"e","port":3000,"kind":"local","typo":true}),
        ] {
            assert!(publish.validate(&params).is_err());
        }
        assert!(publish.confirmation_for(&publish.example).is_some());
        assert!(find("terminal_action")
            .unwrap()
            .confirmation_for(&json!({"action":"write"}))
            .is_some());
        assert!(find("delete_environment").unwrap().confirmation.is_some());
        assert!(find("reclaim_storage").unwrap().confirmation.is_some());
        assert!(find("reclaim_storage").unwrap().validate(&json!({"path":"C:/"})).is_err());
    }
}
