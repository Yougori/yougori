use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant, UNIX_EPOCH},
};

use reqwest::{Response, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::{
    available_port, command_output, configure_background_process, path_string, AgentEndpoint,
    ApplianceProcess, PerfSpan, RuntimeManager,
};
use crate::models::{CommandResult, ConnectionDirection, PermissionKind, ResourcePolicy};

#[derive(Debug, Clone)]
pub struct SnapshotArtifact {
    pub provider_snapshot_id: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub checksum_sha256: String,
}

#[derive(Debug, Clone, Default)]
pub struct ContainerStats {
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub network_rx_mbps: f64,
}

#[derive(Debug, Clone)]
pub struct ContainerTelemetry {
    pub id: String,
    pub running: bool,
    pub paused: bool,
    pub stats: ContainerStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    original_id: Option<&'a str>,
    id: &'a str,
    image: &'a str,
    command: &'a str,
    cpus: f64,
    memory_bytes: i64,
    network_access: bool,
    gpu_access: bool,
}

#[derive(Debug, Serialize)]
struct ActionRequest<'a> {
    id: &'a str,
    action: &'a str,
    #[serde(rename = "networkAccess")]
    network_access: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigurationRequest<'a> {
    id: &'a str,
    network_access: bool,
    gpu_access: bool,
    previous_network_access: bool,
    previous_gpu_access: bool,
    command: &'a str,
    cpus: f64,
    #[serde(rename = "memoryBytes")]
    memory_bytes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourcesRequest<'a> {
    id: &'a str,
    cpus: f64,
    memory_bytes: i64,
}

#[derive(Debug, Serialize)]
struct ExecRequest<'a> {
    id: &'a str,
    command: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRequest<'a> {
    id: &'a str,
    snapshot_id: &'a str,
    image: &'a str,
    command: &'a str,
    network_access: bool,
    gpu_access: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionRequest<'a> {
    id: &'a str,
    source_id: &'a str,
    target_id: &'a str,
    bidirectional: bool,
    ports: &'a [u16],
    allow_network: bool,
    shared_path: bool,
    allow_secrets: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCommandOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSnapshot {
    provider_snapshot_id: String,
    size_bytes: u64,
    checksum_sha256: String,
}

#[derive(Debug, Serialize)]
struct StatsBatchRequest<'a> {
    ids: &'a [String],
}

#[derive(Debug, Deserialize)]
struct StatsBatchResponse {
    entries: Vec<StatsBatchEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsBatchEntry {
    id: String,
    running: bool,
    #[serde(default)]
    paused: bool,
    cpu_percent: f64,
    memory_bytes: u64,
    network_rx_bytes: u64,
}

const APPLIANCE_OVERLAY_MARKER_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ApplianceOverlayMarker {
    schema_version: u32,
    base_sha256: String,
    backing_path: String,
    overlay: ApplianceOverlayFingerprint,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ApplianceOverlayFingerprint {
    length: u64,
    modified_unix_nanos: u64,
}

#[derive(Debug, Clone)]
struct ExistingApplianceMarker {
    base_sha256: String,
    backing_path: Option<String>,
    overlay: Option<ApplianceOverlayFingerprint>,
}

impl RuntimeManager {
    pub async fn provision_container(
        &self,
        id: &str,
        image: &str,
        command: &str,
        policy: &ResourcePolicy,
        network_access: bool,
        gpu_access: bool,
    ) -> Result<(), String> {
        let request = ProvisionRequest {
            original_id: None,
            id,
            image,
            command,
            cpus: policy.cpu.preferred,
            memory_bytes: gibibytes(policy.memory_gb.preferred)?,
            network_access,
            gpu_access,
        };
        let _: serde_json::Value = self
            .agent_post("/v1/containers/provision", &request)
            .await?;
        Ok(())
    }

    pub async fn provision_reset_container(&self, id: &str, old_id: &str, environment: &crate::models::Environment) -> Result<(), String> {
        self.register_container_provider(id, &self.container_provider(old_id)?)?;
        let request = ProvisionRequest {
            original_id: Some(old_id), id, image: &environment.runtime,
            command: environment.container_command.as_deref().unwrap_or_default(),
            cpus: environment.resource_policy.cpu.preferred,
            memory_bytes: gibibytes(environment.resource_policy.memory_gb.preferred)?,
            network_access: environment.network_access, gpu_access: environment.gpu_access,
        };
        let _: serde_json::Value = self.agent_post("/v1/containers/provision", &request).await?;
        Ok(())
    }

    pub async fn container_action(
        &self,
        id: &str,
        action: &str,
        network_access: bool,
    ) -> Result<(), String> {
        let _lease = self.appliance_operations.read().await;
        // Mark starts conservatively before sending: a timed-out request may
        // have started a process, so resizing must wait for an explicit stop.
        if matches!(action, "start" | "resume") {
            self.container_endpoint(id).await?;
            if let Some(process) = self.appliance.lock().await.as_mut().filter(|_| self.container_provider(id).is_ok_and(|p| p == crate::models::RuntimeProviderKind::OpenDockOci)) {
                process.active_containers.insert(id.to_owned());
            }
        }
        let _: AgentCommandOutput = self
            .agent_post_unlocked(
                "/v1/containers/action",
                &ActionRequest {
                    id,
                    action,
                    network_access,
                },
            )
            .await?;
        if action == "stop" {
            if let Some(process) = self.appliance.lock().await.as_mut() {
                process.active_containers.remove(id);
            }
        }
        Ok(())
    }

    pub async fn container_failure_detail(&self, id: &str) -> Result<Option<String>, String> {
        let _lease = self.appliance_operations.read().await;
        let endpoint = self.container_endpoint(id).await?;
        let response = self.client
            .get(format!("{}/v1/containers/status/{id}", endpoint.base_url))
            .bearer_auth(&endpoint.token)
            .timeout(Duration::from_secs(18))
            .send().await.map_err(|e| e.to_string())?;
        let value: serde_json::Value = successful_response(response).await?
            .json().await.map_err(|e| e.to_string())?;
        if value["running"].as_bool() == Some(true) {
            return Ok(None);
        }
        Ok(Some(value["message"].as_str().filter(|m| !m.is_empty())
            .unwrap_or("The container process exited. Check its startup command and memory allocation.")
            .to_owned()))
    }

    pub async fn update_container_internet(&self, id: &str, enabled: bool) -> Result<(), String> {
        let _: AgentCommandOutput = self.agent_post(
            "/v1/containers/internet",
            &ActionRequest { id, action: "internet", network_access: enabled },
        ).await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_container_configuration(
        &self,
        id: &str,
        network_access: bool,
        gpu_access: bool,
        previous_network_access: bool,
        previous_gpu_access: bool,
        command: &str,
        policy: &ResourcePolicy,
    ) -> Result<(), String> {
        let _: AgentCommandOutput = self
            .agent_post(
                "/v1/containers/configuration",
                &ConfigurationRequest {
                    id,
                    network_access,
                    gpu_access,
                    previous_network_access,
                    previous_gpu_access,
                    command,
                    cpus: policy.cpu.preferred,
                    memory_bytes: gibibytes(policy.memory_gb.preferred)?,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn update_container_startup(
        &self,
        environment: &crate::models::Environment,
        command: &str,
    ) -> Result<(), String> {
        let _: AgentCommandOutput = self.agent_post(
            "/v1/containers/startup",
            &serde_json::json!({
                "id": environment.runtime_id.as_deref().unwrap_or(&environment.id),
                "command": command,
                "image": environment.runtime,
            }),
        ).await?;
        Ok(())
    }

    pub async fn delete_container(&self, id: &str) -> Result<(), String> {
        let _lease = self.appliance_operations.read().await;
        let _: AgentCommandOutput = self
            .agent_post_unlocked(
                "/v1/containers/delete",
                &ActionRequest {
                    id,
                    action: "delete",
                    network_access: false,
                },
            )
            .await?;
        if let Some(process) = self.appliance.lock().await.as_mut() {
            process.active_containers.remove(id);
        }
        self.network_samples.lock().await.remove(id);
        Ok(())
    }

    pub async fn update_container_resources(
        &self,
        id: &str,
        cpus: f64,
        memory_gb: f64,
    ) -> Result<(), String> {
        let _lease = self.appliance_operations.read().await;
        self.container_endpoint(id).await?;
        if self.container_provider(id)? == crate::models::RuntimeProviderKind::OpenDockCuda {
            let (cpu_capacity, memory_capacity) = self.cuda_capacity().await?;
            if cpus > cpu_capacity || memory_gb > memory_capacity {
                return Err(format!("CUDA allocation exceeds WSL's current budget of {cpu_capacity:.0} CPUs and {memory_capacity:.3} GB. Lower the allocation; your host may have more RAM than WSL."));
            }
        }
        let requested = super::appliance_capacity::ApplianceCapacity::for_workloads(cpus, memory_gb)?;
        if self.container_provider(id)? == crate::models::RuntimeProviderKind::OpenDockOci && !self.appliance.lock().await.as_ref().is_some_and(|p| p.capacity.contains(requested)) {
            return Err("Stop all containers and retry to expand the shared runtime before applying these limits".into());
        }
        let request = ResourcesRequest {
            id,
            cpus,
            memory_bytes: gibibytes(memory_gb)?,
        };
        let _: AgentCommandOutput = self
            .agent_post_unlocked("/v1/containers/resources", &request)
            .await?;
        Ok(())
    }

    pub async fn execute_container_command(
        &self,
        id: &str,
        command: &str,
    ) -> Result<CommandResult, String> {
        let output: AgentCommandOutput = self
            .agent_post("/v1/containers/exec", &ExecRequest { id, command })
            .await?;
        Ok(CommandResult {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    pub async fn create_container_snapshot(
        &self,
        id: &str,
        snapshot_id: &str,
        _image: &str,
        _command: &str,
    ) -> Result<SnapshotArtifact, String> {
        self.stream_container_snapshot(id, snapshot_id).await
    }

    async fn release_container_snapshot_data(&self, snapshot_id: &str) -> Result<(), String> {
        let _: serde_json::Value = self
            .agent_post(
                "/v1/snapshots/release",
                &SnapshotRequest {
                    id: "",
                    snapshot_id,
                    image: "",
                    command: "",
                    network_access: false,
                    gpu_access: false,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn restore_container_snapshot(
        &self,
        id: &str,
        snapshot_id: &str,
        image: &str,
        command: &str,
        network_access: bool,
        gpu_access: bool,
    ) -> Result<(), String> {
        self.register_container_provider(id, &self.read_route("snapshots", snapshot_id)?)?;
        let _: serde_json::Value = self
            .agent_post(
                "/v1/snapshots/restore",
                &SnapshotRequest {
                    id,
                    snapshot_id,
                    image,
                    command,
                    network_access,
                    gpu_access,
                },
            )
            .await?;
        if let Err(error) = self.release_container_snapshot_data(snapshot_id).await {
            // The container recreation already committed successfully. Report
            // cleanup diagnostically while keeping the restored runtime state
            // and host artifact usable for a later idempotent retry.
            eprintln!("Yougori snapshot {snapshot_id} guest cleanup deferred: {error}");
        }
        Ok(())
    }

    pub async fn import_container_snapshot(
        &self,
        snapshot_id: &str,
        artifact_path: &std::path::Path,
    ) -> Result<SnapshotArtifact, String> {
        let metadata = tokio::fs::metadata(artifact_path)
            .await
            .map_err(|error| format!("inspect restored OCI snapshot artifact: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("restored OCI snapshot artifact is empty or not a file".into());
        }
        let mut checksum_file = File::open(artifact_path)
            .map_err(|error| format!("open restored OCI snapshot artifact: {error}"))?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0_u8; 1024 * 1024];
        loop {
            let count = checksum_file
                .read(&mut buffer)
                .map_err(|error| format!("hash restored OCI snapshot artifact: {error}"))?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        let checksum_sha256 = hex::encode(digest.finalize());
        let file = tokio::fs::File::open(artifact_path)
            .await
            .map_err(|error| format!("open restored OCI snapshot artifact: {error}"))?;
        let snapshot_lease = self.appliance_operations.read().await;
        let endpoint = self.provider_endpoint(&self.read_route("snapshots", snapshot_id)?).await?;
        let response = self
            .client
            .post(format!(
                "{}/v1/snapshots/import/{}",
                endpoint.base_url, snapshot_id
            ))
            .bearer_auth(&endpoint.token)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/vnd.oci.image.layout.v1.tar",
            )
            .header(reqwest::header::CONTENT_LENGTH, metadata.len())
            .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
            .send()
            .await
            .map_err(|error| format!("upload restored OCI snapshot to appliance: {error}"))?;
        let response = successful_response(response).await?;
        let imported: AgentSnapshot = response
            .json()
            .await
            .map_err(|error| format!("decode imported OCI snapshot response: {error}"))?;
        drop(snapshot_lease);
        if imported.size_bytes != metadata.len()
            || !imported
                .checksum_sha256
                .eq_ignore_ascii_case(&checksum_sha256)
        {
            let _ = self.release_container_snapshot_data(snapshot_id).await;
            return Err(format!(
                "uploaded OCI snapshot verification failed: expected {} bytes with checksum {checksum_sha256}, appliance received {} bytes with checksum {}",
                metadata.len(), imported.size_bytes, imported.checksum_sha256
            ));
        }
        let local_path = self
            .data_root
            .join("snapshots")
            .join(format!("{snapshot_id}.oci.tar"));
        if artifact_path != local_path {
            let temporary = local_path.with_extension("tar.import.part");
            let _ = tokio::fs::remove_file(&temporary).await;
            tokio::fs::copy(artifact_path, &temporary)
                .await
                .map_err(|error| format!("store restored OCI snapshot locally: {error}"))?;
            let copied = tokio::fs::OpenOptions::new()
                .write(true)
                .open(&temporary)
                .await
                .map_err(|error| format!("open copied OCI snapshot artifact: {error}"))?;
            copied
                .sync_all()
                .await
                .map_err(|error| format!("flush copied OCI snapshot artifact: {error}"))?;
            drop(copied);
            let _ = tokio::fs::remove_file(&local_path).await;
            tokio::fs::rename(&temporary, &local_path)
                .await
                .map_err(|error| format!("finalize restored OCI snapshot artifact: {error}"))?;
        }
        Ok(SnapshotArtifact {
            provider_snapshot_id: imported.provider_snapshot_id,
            path: local_path,
            size_bytes: metadata.len(),
            checksum_sha256,
        })
    }

    pub async fn delete_container_snapshot(
        &self,
        id: &str,
        snapshot_id: &str,
    ) -> Result<(), String> {
        let _: serde_json::Value = self
            .agent_post(
                "/v1/snapshots/delete",
                &SnapshotRequest {
                    id,
                    snapshot_id,
                    image: "",
                    command: "",
                    network_access: false,
                    gpu_access: false,
                },
            )
            .await?;
        let path = self
            .data_root
            .join("snapshots")
            .join(format!("{snapshot_id}.oci.tar"));
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove local snapshot artifact: {error}")),
        }
    }

    pub async fn apply_container_connection(
        &self,
        id: &str,
        source_id: &str,
        target_id: &str,
        direction: &ConnectionDirection,
        permissions: &[PermissionKind],
        ports: &[u16],
    ) -> Result<String, String> {
        let request = ConnectionRequest {
            id,
            source_id,
            target_id,
            bidirectional: *direction == ConnectionDirection::Bidirectional,
            ports,
            allow_network: permissions.contains(&PermissionKind::Network),
            shared_path: permissions.iter().any(|permission| {
                matches!(
                    permission,
                    PermissionKind::Files | PermissionKind::Volumes | PermissionKind::Data
                )
            }),
            allow_secrets: permissions.contains(&PermissionKind::Secrets),
        };
        let value: serde_json::Value = self.agent_post("/v1/connections/apply", &request).await?;
        value
            .get("ruleId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "the appliance did not return a connection rule identifier".into())
    }

    pub async fn remove_container_connection(
        &self,
        id: &str,
        source_id: &str,
        target_id: &str,
    ) -> Result<(), String> {
        let request = ConnectionRequest {
            id,
            source_id,
            target_id,
            bidirectional: false,
            ports: &[],
            allow_network: false,
            shared_path: false,
            allow_secrets: false,
        };
        let _: serde_json::Value = self.agent_post("/v1/connections/remove", &request).await?;
        Ok(())
    }

    pub async fn container_telemetry(
        &self,
        ids: &[String],
    ) -> Result<Vec<ContainerTelemetry>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        const MAX_BATCH_IDS: usize = 256;
        let mut entries = Vec::with_capacity(ids.len());
        let mut qemu_ids = Vec::new();
        let mut cuda_ids = Vec::new();
        for id in ids {
            if self.container_provider(id)? == crate::models::RuntimeProviderKind::OpenDockCuda { cuda_ids.push(id.clone()); }
            else { qemu_ids.push(id.clone()); }
        }
        for chunk in qemu_ids.chunks(MAX_BATCH_IDS).chain(cuda_ids.chunks(MAX_BATCH_IDS)) {
            let mut response: StatsBatchResponse = self
                .agent_post("/v1/stats/batch", &StatsBatchRequest { ids: chunk })
                .await?;
            entries.append(&mut response.entries);
        }
        let now = Instant::now();
        let mut samples = self.network_samples.lock().await;
        let telemetry = entries
            .into_iter()
            .map(|entry| {
                let network_rx_mbps = if entry.running {
                    samples
                        .insert(entry.id.clone(), (entry.network_rx_bytes, now))
                        .and_then(|(previous_bytes, previous_time)| {
                            entry
                                .network_rx_bytes
                                .checked_sub(previous_bytes)
                                .map(|bytes| {
                                    (bytes, now.duration_since(previous_time).as_secs_f64())
                                })
                        })
                        .filter(|(_, elapsed)| *elapsed > 0.0)
                        .map(|(bytes, elapsed)| bytes as f64 * 8.0 / elapsed / 1_000_000.0)
                        .unwrap_or_default()
                } else {
                    samples.remove(&entry.id);
                    0.0
                };
                ContainerTelemetry {
                    id: entry.id,
                    running: entry.running,
                    paused: entry.paused,
                    stats: ContainerStats {
                        cpu_percent: entry.cpu_percent,
                        memory_bytes: entry.memory_bytes,
                        network_rx_mbps,
                    },
                }
            })
            .collect();
        Ok(telemetry)
    }

    async fn agent_post<B, R>(&self, path: &str, body: &B) -> Result<R, String>
    where
        B: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        let _lease = self.appliance_operations.read().await;
        self.agent_post_unlocked(path, body).await
    }

    async fn agent_post_unlocked<B, R>(&self, path: &str, body: &B) -> Result<R, String>
    where B: Serialize + ?Sized, R: DeserializeOwned,
    {
        let body = serde_json::to_value(body).map_err(|e| e.to_string())?;
        let endpoint = self.provider_endpoint(&self.request_provider(path, &body)?).await?;
        let response = self
            .client
            .post(format!("{}{}", endpoint.base_url, path))
            .bearer_auth(&endpoint.token)
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("request Yougori appliance operation: {error}"))?;
        let response = successful_response(response).await?;
        response
            .json::<R>()
            .await
            .map_err(|error| format!("decode Yougori appliance response: {error}"))
    }

    pub(super) async fn appliance_endpoint(&self) -> Result<AgentEndpoint, String> {
        let _gpu_lease = self.gpu_launches.read().await;
        let mut process_guard = self.appliance.lock().await;
        if let Some(process) = process_guard.as_mut() {
            match process.child.try_wait() {
                Ok(None) => {
                    if self.health(&process.endpoint).await.is_ok() {
                        return Ok(process.endpoint.clone());
                    }
                }
                Ok(Some(_)) => {
                    process_guard.take();
                }
                Err(error) => return Err(format!("inspect Yougori appliance process: {error}")),
            }
        }

        if let Some(mut stale) = process_guard.take() {
            let _ = stale.child.kill().await;
            let _ = stale.child.wait().await;
        }
        // Never inspect, rebase, or archive a disk still owned by an older app's VM.
        self.check_external_appliance(false).await?;
        self.prepare_appliance_overlay().await?;
        let _boot_trace = PerfSpan::new("appliance boot");
        let endpoint = AgentEndpoint {
            base_url: format!("http://127.0.0.1:{}", available_port()?),
            token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
        };

        let accelerators = super::host_platform::x86_accelerators(std::env::consts::OS, std::env::consts::ARCH, false);
        let mut last_error = String::new();
        let capacity = *self.appliance_capacity.lock().map_err(|_| "Container capacity lock poisoned")?;
        let gpu_launch = self.prepare_gpu_launch(&self.data_root.join("appliance")).await?;
        if !cfg!(target_os = "windows") && gpu_launch.explicit() {
            return Err("The saved GPU selection requires the Windows GPU runtime. No GPU fallback was started.".into());
        }
        // Non-Windows QEMU does not include the custom graphics bridge. Skip
        // that attempt entirely instead of failing before the ordinary boot.
        for gpu_enabled in if cfg!(target_os = "windows") { vec![true, false] } else { vec![false] } {
            if !gpu_enabled && gpu_launch.explicit() { break; }
            for accelerator in accelerators {
                let mut child = self.spawn_appliance(&endpoint, accelerator, gpu_enabled, &gpu_launch)?;
                let deadline = Instant::now() + super::host_platform::guest_boot_timeout();
                loop {
                    if let Some(status) = child
                        .try_wait()
                        .map_err(|error| format!("inspect Yougori appliance boot: {error}"))?
                    {
                        last_error = format!(
                            "Yougori appliance exited during boot with {status}: {}",
                            self.appliance_log_tail()
                        );
                        break;
                    }
                    if self.health(&endpoint).await.is_ok() {
                        let gpu = if gpu_enabled {
                            match gpu_launch.verify(child.id().ok_or("Graphics runtime has no process ID")?) {
                                Ok(gpu) => gpu,
                                Err(error) => { let _ = child.kill().await; let _ = child.wait().await; return Err(error); }
                            }
                        } else { None };
                        *process_guard = Some(ApplianceProcess {
                            child,
                            endpoint: endpoint.clone(),
                            capacity,
                            active_containers: Default::default(),
                            gpu,
                        });
                        return Ok(endpoint);
                    }
                    if Instant::now() >= deadline {
                        last_error = format!(
                            "Yougori appliance did not become ready: {}",
                            self.appliance_log_tail()
                        );
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(350)).await;
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }
        Err(if gpu_launch.explicit() { format!("Selected GPU runtime failed. No fallback was started. {last_error}") } else { last_error })
    }

    async fn health(&self, endpoint: &AgentEndpoint) -> Result<(), String> {
        let response = self
            .client
            .get(format!("{}/v1/health", endpoint.base_url))
            .bearer_auth(&endpoint.token)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("appliance health returned {}", response.status()))
        }
    }

    pub(crate) async fn prepare_appliance_overlay(&self) -> Result<bool, String> {
        self.appliance_preparation
            .get_or_try_init(|| async { self.prepare_appliance_overlay_once().await })
            .await
            .copied()
    }

    async fn prepare_appliance_overlay_once(&self) -> Result<bool, String> {
        self.check_external_appliance(false).await?;
        let _prepare_trace = PerfSpan::new("appliance overlay preparation");
        let overlay = self.data_root.join("appliance/system.qcow2");
        let marker_path = self
            .data_root
            .join("appliance/appliance-overlay-state.json");
        let legacy_marker = self.data_root.join("appliance/appliance-base.sha256");
        let base_digest = &self.appliance_base_digest;
        let backing_path = canonical_path(&self.layout.appliance_base);
        let recorded = read_appliance_marker(&marker_path, &legacy_marker);
        // A qcow2 overlay is inseparable from the exact backing-file contents.
        // Older builds did not record that identity, so rebasing those overlays
        // onto a newly bundled appliance could silently corrupt the guest disk.
        let base_changed = appliance_base_changed(
            recorded.as_ref().map(|marker| marker.base_sha256.as_str()),
            base_digest,
        );
        let mut reset = false;
        if overlay.exists() && base_changed {
            archive_appliance_overlay(&overlay)?;
            let _ = fs::remove_file(&marker_path);
            let _ = fs::remove_file(&legacy_marker);
            reset = true;
        }
        if overlay.exists() {
            let fingerprint = appliance_overlay_fingerprint(&overlay)?;
            let marker_is_current = recorded.as_ref().is_some_and(|marker| {
                marker.base_sha256 == *base_digest
                    && marker.backing_path.as_deref() == Some(backing_path.as_str())
                    && marker.overlay.as_ref() == Some(&fingerprint)
            });
            if marker_is_current {
                return Ok(reset);
            }

            let backing_path_changed = recorded
                .as_ref()
                .and_then(|marker| marker.backing_path.as_deref())
                != Some(backing_path.as_str());
            if backing_path_changed {
                command_output(
                    &self.layout.qemu_img,
                    &[
                        "rebase".into(),
                        "-u".into(),
                        "-f".into(),
                        "qcow2".into(),
                        "-F".into(),
                        "qcow2".into(),
                        "-b".into(),
                        path_string(&self.layout.appliance_base),
                        path_string(&overlay),
                    ],
                    "rebase Yougori appliance data",
                )
                .await?;
            }
            if let Err(_error) = command_output(
                &self.layout.qemu_img,
                &["check".into(), "-q".into(), path_string(&overlay)],
                "check Yougori appliance data",
            )
            .await
            {
                // A changed overlay fingerprint without a clean-shutdown marker can indicate
                // an interrupted write. Preserve the disk for recovery and start clean.
                archive_appliance_overlay(&overlay)?;
                reset = true;
            } else {
                write_appliance_marker(&marker_path, base_digest, &backing_path, &overlay)?;
                let _ = fs::remove_file(&legacy_marker);
                return Ok(reset);
            }
        }
        command_output(
            &self.layout.qemu_img,
            &[
                "create".into(),
                "-f".into(),
                "qcow2".into(),
                "-F".into(),
                "qcow2".into(),
                "-b".into(),
                path_string(&self.layout.appliance_base),
                path_string(&overlay),
            ],
            "create Yougori appliance data",
        )
        .await?;
        write_appliance_marker(&marker_path, base_digest, &backing_path, &overlay)?;
        let _ = fs::remove_file(&legacy_marker);
        Ok(reset)
    }

    pub(super) fn record_appliance_overlay_state(&self) -> Result<(), String> {
        let overlay = self.data_root.join("appliance/system.qcow2");
        if !overlay.is_file() {
            return Ok(());
        }
        write_appliance_marker(
            &self
                .data_root
                .join("appliance/appliance-overlay-state.json"),
            &self.appliance_base_digest,
            &canonical_path(&self.layout.appliance_base),
            &overlay,
        )
    }

    fn spawn_appliance(
        &self,
        endpoint: &AgentEndpoint,
        accelerator: &str,
        gpu_enabled: bool,
        gpu_launch: &super::gpu::GpuLaunch,
    ) -> Result<tokio::process::Child, String> {
        let port = endpoint
            .base_url
            .rsplit(':')
            .next()
            .ok_or("invalid appliance endpoint")?;
        let overlay = self.data_root.join("appliance/system.qcow2");
        let log_path = self.data_root.join("appliance/serial.log");
        let error_path = self.data_root.join("appliance/qemu.log");
        File::create(&log_path)
            .map_err(|error| format!("reset {}: {error}", log_path.display()))?;
        let error_log = File::create(&error_path)
            .map_err(|error| format!("create {}: {error}", error_path.display()))?;
        let capacity = *self.appliance_capacity.lock().map_err(|_| "Container capacity lock poisoned")?;
        let appliance_cpus = capacity.cpus.to_string();
        let appliance_memory = capacity.memory_mib.to_string();
        let mut command = tokio::process::Command::new(&self.layout.qemu_system);
        command
            .current_dir(self.layout.qemu_system.parent().unwrap_or(&self.layout.root))
            .args([
                "-name",
                "OpenDock Internal OCI Runtime",
                "-machine",
                if accelerator == "whpx" { "q35,kernel-irqchip=off" } else { "q35" },
                "-accel",
                accelerator,
                // qemu64 hides SSE4/AVX and breaks current database images.
                // KVM/HVF can pass through the host; WHPX/TCG use QEMU's
                // maximum supported feature set for the selected accelerator.
                "-cpu",
                if matches!(accelerator, "kvm" | "hvf") { "host" } else { "max" },
                "-smp",
                &appliance_cpus,
                "-m",
                &appliance_memory,
                "-no-user-config",
                "-nodefaults",
                "-kernel",
                &path_string(&self.layout.appliance_kernel),
                "-initrd",
                &path_string(&self.layout.appliance_initramfs),
                "-append",
                &format!(
                    "root=/dev/vda rw rootfstype=ext4 console=ttyS0 modules=virtio_pci,virtio_blk,virtio_net,virtio_gpu,drm,ext4 opendock.token={}",
                    endpoint.token
                ),
                "-blockdev",
                &serde_json::json!({
                    "driver": "file",
                    "filename": path_string(&overlay),
                    "discard": "unmap",
                    "node-name": "opendock-appliance-file"
                })
                .to_string(),
                "-blockdev",
                &serde_json::json!({
                    "driver": "qcow2",
                    "file": "opendock-appliance-file",
                    "discard": "unmap",
                    "node-name": "opendock-appliance-disk"
                })
                .to_string(),
                "-device",
                "virtio-blk-pci,drive=opendock-appliance-disk",
                "-netdev",
                &format!("user,id=net0,hostfwd=tcp:127.0.0.1:{port}-:7443"),
                "-device",
                "virtio-net-pci,netdev=net0",
                "-device",
                "virtio-rng-pci",
                "-serial",
                &format!("file:{}", path_string(&log_path)),
                "-monitor",
                "none",
                "-no-reboot",
                "-rtc",
                "base=utc",
                "-L",
                &path_string(&self.layout.qemu_data()),
            ]);
        if gpu_enabled {
            command.args([
                "-device",
                "virtio-gpu-gl-pci,max_outputs=1",
                "-display",
                "egl-headless",
            ]);
        } else {
            command.args(["-display", "none"]);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(error_log));
        configure_background_process(&mut command);
        if gpu_enabled { gpu_launch.configure(&mut command)?; }
        command
            .spawn()
            .map_err(|error| format!("start bundled Yougori appliance: {error}"))
    }

    fn appliance_log_tail(&self) -> String {
        let paths = [
            self.data_root.join("appliance/qemu.log"),
            self.data_root.join("appliance/serial.log"),
        ];
        let mut combined = String::new();
        for path in paths {
            if let Ok(mut file) = File::open(path) {
                const TAIL_BYTES: u64 = 8 * 1024;
                let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
                if length > TAIL_BYTES {
                    let _ = file.seek(SeekFrom::Start(length - TAIL_BYTES));
                }
                let mut bytes = Vec::new();
                let _ = file.take(TAIL_BYTES).read_to_end(&mut bytes);
                combined.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        combined.trim().to_string()
    }
}

pub(super) async fn successful_response(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("error")?.as_str().map(str::to_owned))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            status
                .canonical_reason()
                .unwrap_or("runtime request failed")
                .into()
        });
    let prefix = match status {
        StatusCode::CONFLICT => "runtime rejected the operation",
        StatusCode::BAD_REQUEST => "invalid runtime operation",
        StatusCode::UNAUTHORIZED => "runtime authentication failed",
        _ => "runtime operation failed",
    };
    Err(format!("{prefix}: {detail}"))
}

fn gibibytes(value: f64) -> Result<i64, String> {
    if !value.is_finite() || value <= 0.0 || value > 1024.0 {
        return Err("memory allocation is outside the supported range".into());
    }
    Ok((value * 1_073_741_824.0).round() as i64)
}

fn read_appliance_marker(
    marker_path: &std::path::Path,
    legacy_marker: &std::path::Path,
) -> Option<ExistingApplianceMarker> {
    let previous_path = appliance_marker_previous_path(marker_path);
    for candidate in [marker_path, previous_path.as_path()] {
        if let Ok(contents) = fs::read(candidate) {
            if let Ok(marker) = serde_json::from_slice::<ApplianceOverlayMarker>(&contents) {
                if marker.schema_version == APPLIANCE_OVERLAY_MARKER_VERSION {
                    return Some(ExistingApplianceMarker {
                        base_sha256: marker.base_sha256,
                        backing_path: Some(marker.backing_path),
                        overlay: Some(marker.overlay),
                    });
                }
            }
        }
    }
    fs::read_to_string(legacy_marker)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(|base_sha256| ExistingApplianceMarker {
            base_sha256,
            backing_path: None,
            overlay: None,
        })
}

fn write_appliance_marker(
    marker_path: &std::path::Path,
    base_sha256: &str,
    backing_path: &str,
    overlay: &std::path::Path,
) -> Result<(), String> {
    let marker = ApplianceOverlayMarker {
        schema_version: APPLIANCE_OVERLAY_MARKER_VERSION,
        base_sha256: base_sha256.to_owned(),
        backing_path: backing_path.to_owned(),
        overlay: appliance_overlay_fingerprint(overlay)?,
    };
    let parent = marker_path
        .parent()
        .ok_or_else(|| format!("invalid appliance marker path: {}", marker_path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create appliance marker directory: {error}"))?;
    let temporary = parent.join(format!(
        ".appliance-overlay-state-{}.tmp",
        Uuid::new_v4().simple()
    ));
    let contents = serde_json::to_vec(&marker)
        .map_err(|error| format!("encode appliance state marker: {error}"))?;
    fs::write(&temporary, contents)
        .map_err(|error| format!("write appliance state marker: {error}"))?;
    let previous = appliance_marker_previous_path(marker_path);
    if previous.exists() {
        fs::remove_file(&previous)
            .map_err(|error| format!("remove stale appliance state marker: {error}"))?;
    }
    let had_current = marker_path.exists();
    if had_current {
        fs::rename(marker_path, &previous)
            .map_err(|error| format!("stage previous appliance state marker: {error}"))?;
    }
    match fs::rename(&temporary, marker_path) {
        Ok(()) => {
            let _ = fs::remove_file(previous);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            if had_current {
                let _ = fs::rename(&previous, marker_path);
            }
            Err(format!("commit appliance state marker: {error}"))
        }
    }
}

fn appliance_marker_previous_path(marker_path: &std::path::Path) -> PathBuf {
    marker_path.with_file_name("appliance-overlay-state.previous.json")
}

fn appliance_overlay_fingerprint(
    overlay: &std::path::Path,
) -> Result<ApplianceOverlayFingerprint, String> {
    let metadata = fs::metadata(overlay)
        .map_err(|error| format!("inspect appliance data {}: {error}", overlay.display()))?;
    let modified_unix_nanos = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(u64::MAX as u128) as u64)
        .unwrap_or_default();
    Ok(ApplianceOverlayFingerprint {
        length: metadata.len(),
        modified_unix_nanos,
    })
}

fn archive_appliance_overlay(overlay: &std::path::Path) -> Result<PathBuf, String> {
    let parent = overlay
        .parent()
        .ok_or_else(|| format!("invalid appliance data path: {}", overlay.display()))?;
    // Keep one recovery image at most. Remove older archives before moving the
    // current overlay, so a cleanup error leaves the active disk untouched and
    // the archive operation can be retried safely.
    for entry in
        fs::read_dir(parent).map_err(|error| format!("list archived appliance data: {error}"))?
    {
        let entry = entry.map_err(|error| format!("inspect archived appliance data: {error}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("system-incompatible-") && name.ends_with(".qcow2") {
            fs::remove_file(entry.path()).map_err(|error| {
                format!(
                    "remove superseded incompatible appliance data {}: {error}",
                    entry.path().display()
                )
            })?;
        }
    }
    let archived = parent.join(format!(
        "system-incompatible-{}.qcow2",
        Uuid::new_v4().simple()
    ));
    fs::rename(overlay, &archived).map_err(|error| {
        format!(
            "archive incompatible appliance data as {}: {error}",
            archived.display()
        )
    })?;
    Ok(archived)
}

fn canonical_path(path: &std::path::Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn appliance_base_changed(recorded_digest: Option<&str>, current_digest: &str) -> bool {
    recorded_digest != Some(current_digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_gibibytes_without_decimal_unit_confusion() {
        assert_eq!(gibibytes(1.5).unwrap(), 1_610_612_736);
    }

    #[test]
    fn rejects_unversioned_or_mismatched_appliance_overlays() {
        assert!(appliance_base_changed(None, "current"));
        assert!(appliance_base_changed(Some("previous"), "current"));
        assert!(!appliance_base_changed(Some("current"), "current"));
    }

    #[test]
    fn overlay_marker_detects_an_unrecorded_disk_change() {
        let directory = tempfile::tempdir().unwrap();
        let overlay = directory.path().join("system.qcow2");
        let marker = directory.path().join("state.json");
        let legacy = directory.path().join("legacy.sha256");
        fs::write(&overlay, b"initial-overlay").unwrap();
        write_appliance_marker(&marker, "base-digest", "C:/runtime/base.qcow2", &overlay).unwrap();
        let recorded = read_appliance_marker(&marker, &legacy).unwrap();
        assert_eq!(
            recorded.overlay,
            Some(appliance_overlay_fingerprint(&overlay).unwrap())
        );

        fs::write(&overlay, b"changed-overlay-with-a-different-length").unwrap();
        assert_ne!(
            recorded.overlay,
            Some(appliance_overlay_fingerprint(&overlay).unwrap())
        );
    }

    #[test]
    fn incompatible_appliance_archives_are_capped_at_one() {
        let directory = tempfile::tempdir().unwrap();
        let overlay = directory.path().join("system.qcow2");
        fs::write(&overlay, b"current").unwrap();
        fs::write(
            directory.path().join("system-incompatible-old-a.qcow2"),
            b"old-a",
        )
        .unwrap();
        fs::write(
            directory.path().join("system-incompatible-old-b.qcow2"),
            b"old-b",
        )
        .unwrap();

        let archived = archive_appliance_overlay(&overlay).unwrap();
        assert!(!overlay.exists());
        assert!(archived.is_file());
        let archives = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with("system-incompatible-") && name.ends_with(".qcow2")
            })
            .count();
        assert_eq!(archives, 1);
    }

    #[tokio::test]
    async fn appliance_preparation_state_runs_successful_work_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let cell = tokio::sync::OnceCell::new();
        let calls = AtomicUsize::new(0);
        for _ in 0..3 {
            let prepared = cell
                .get_or_try_init(|| async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok::<bool, String>(false)
                })
                .await
                .unwrap();
            assert!(!prepared);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "boots the bundled appliance and pulls a real OCI image"]
    async fn bundled_appliance_runs_snapshots_and_enforces_connections() {
        use crate::models::{Priority, ResourceRange};

        let app_data = tempfile::tempdir().unwrap();
        let manifest_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let manager = RuntimeManager::new(&manifest_directory, app_data.path()).unwrap();
        let policy = ResourcePolicy {
            cpu: ResourceRange {
                min: 0.25,
                preferred: 0.5,
                max: 1.0,
                current: 0.0,
            },
            memory_gb: ResourceRange {
                min: 0.125,
                preferred: 0.125,
                max: 0.5,
                current: 0.0,
            },
            priority: Priority::Normal,
            dynamic: true,
        };
        let source = "env-appliance-source";
        let target = "env-appliance-target";
        let internet = "env-appliance-internet";
        let gpu = "env-appliance-gpu";
        let image = "quay.io/libpod/alpine:latest";
        for id in [source, target] {
            manager
                .provision_container(id, image, "sleep 2147483647", &policy, false, false)
                .await
                .unwrap();
            manager.container_action(id, "start", false).await.unwrap();
        }

        let deleted = "env-appliance-deleted";
        manager
            .provision_container(deleted, image, "sleep 2147483647", &policy, false, false)
            .await
            .unwrap();
        manager.delete_container(deleted).await.unwrap();
        manager.delete_container(deleted).await.unwrap();
        let missing = "env-appliance-missing";
        let telemetry = manager
            .container_telemetry(&[source.to_owned(), deleted.to_owned(), missing.to_owned()])
            .await
            .unwrap();
        assert_eq!(telemetry.len(), 3, "{telemetry:?}");
        let source_telemetry = telemetry.iter().find(|entry| entry.id == source).unwrap();
        assert!(source_telemetry.running, "{source_telemetry:?}");
        assert!(
            source_telemetry.stats.memory_bytes > 0,
            "{source_telemetry:?}"
        );
        for absent in [deleted, missing] {
            let absent_telemetry = telemetry.iter().find(|entry| entry.id == absent).unwrap();
            assert!(!absent_telemetry.running, "{absent_telemetry:?}");
            assert_eq!(absent_telemetry.stats.memory_bytes, 0);
            assert_eq!(absent_telemetry.stats.cpu_percent, 0.0);
            assert_eq!(absent_telemetry.stats.network_rx_mbps, 0.0);
        }

        let command = manager
            .execute_container_command(source, "printf 'real-runtime'")
            .await
            .unwrap();
        assert_eq!(command.exit_code, 0);
        assert_eq!(command.stdout, "real-runtime");

        manager
            .provision_container(internet, image, "sleep 2147483647", &policy, false, false)
            .await
            .unwrap();
        manager
            .update_container_configuration(
                internet,
                true,
                false,
                false,
                false,
                "sleep 2147483647",
                &policy,
            )
            .await
            .unwrap();
        manager
            .container_action(internet, "start", true)
            .await
            .unwrap();
        let public_internet = manager
            .execute_container_command(
                internet,
                "wget -qO- https://example.com | grep -q 'Example Domain'",
            )
            .await
            .unwrap();
        assert_eq!(public_internet.exit_code, 0, "{}", public_internet.stderr);
        let private_network = manager
            .execute_container_command(internet, "ping -c 1 -W 1 10.0.2.2")
            .await
            .unwrap();
        assert_ne!(private_network.exit_code, 0);

        manager
            .provision_container(gpu, image, "sleep 2147483647", &policy, false, true)
            .await
            .unwrap();
        manager.container_action(gpu, "start", false).await.unwrap();
        let shared_gpu = manager
            .execute_container_command(gpu, "test -c /dev/dri/renderD128")
            .await
            .unwrap();
        assert_eq!(shared_gpu.exit_code, 0, "{}", shared_gpu.stderr);

        let connection = "connection-appliance-test";
        manager
            .apply_container_connection(
                connection,
                source,
                target,
                &ConnectionDirection::OneWay,
                &[
                    PermissionKind::Ports,
                    PermissionKind::Files,
                    PermissionKind::Secrets,
                ],
                &[45678],
            )
            .await
            .unwrap();
        let source_write = manager
            .execute_container_command(
                source,
                &format!(
                    "printf shared-value > /opendock/shared/{connection}/value && printf secret-value > /opendock/secrets/{connection}/value"
                ),
            )
            .await
            .unwrap();
        assert_eq!(source_write.exit_code, 0, "{}", source_write.stderr);
        let target_read = manager
            .execute_container_command(
                target,
                &format!(
                    "cat /opendock/shared/{connection}/value /opendock/secrets/{connection}/value"
                ),
            )
            .await
            .unwrap();
        assert_eq!(target_read.exit_code, 0, "{}", target_read.stderr);
        assert_eq!(target_read.stdout, "shared-valuesecret-value");
        let target_write = manager
            .execute_container_command(
                target,
                &format!("printf forbidden > /opendock/shared/{connection}/target-write"),
            )
            .await
            .unwrap();
        assert_ne!(target_write.exit_code, 0);

        let server = manager
            .execute_container_command(
                target,
                "/bin/busybox sh -c 'while true; do printf allowed | /bin/busybox nc -l -p 45678; done' </dev/null >/tmp/opendock-server.log 2>&1 &",
            )
            .await
            .unwrap();
        assert_eq!(server.exit_code, 0, "{}", server.stderr);
        let allowed = manager
            .execute_container_command(
                source,
                &format!("/bin/busybox nc -w 3 {target} 45678 </dev/null"),
            )
            .await
            .unwrap();
        assert_eq!(allowed.exit_code, 0, "{}", allowed.stderr);
        assert_eq!(allowed.stdout, "allowed");
        let denied = manager
            .execute_container_command(source, &format!("/bin/busybox ping -c 1 -W 1 {target}"))
            .await
            .unwrap();
        assert_ne!(denied.exit_code, 0);

        manager
            .remove_container_connection(connection, source, target)
            .await
            .unwrap();
        let checkpoint = manager
            .execute_container_command(source, "printf snapshot-state > /snapshot-proof")
            .await
            .unwrap();
        assert_eq!(checkpoint.exit_code, 0, "{}", checkpoint.stderr);
        let snapshot_id = "snapshot-appliance-test";
        let snapshot = manager
            .create_container_snapshot(source, snapshot_id, image, "sleep 2147483647")
            .await
            .unwrap();
        assert!(snapshot.size_bytes > 0);
        assert!(snapshot.path.is_file());
        assert_eq!(snapshot.checksum_sha256.len(), 64);
        // Creation already released both guest copies. A second release proves
        // the authenticated cleanup operation is idempotent.
        manager
            .release_container_snapshot_data(snapshot_id)
            .await
            .unwrap();
        let changed = manager
            .execute_container_command(source, "printf changed > /snapshot-proof")
            .await
            .unwrap();
        assert_eq!(changed.exit_code, 0, "{}", changed.stderr);
        manager
            .import_container_snapshot(snapshot_id, &snapshot.path)
            .await
            .unwrap();
        manager
            .restore_container_snapshot(
                source,
                snapshot_id,
                image,
                "sleep 2147483647",
                false,
                false,
            )
            .await
            .unwrap();
        manager
            .release_container_snapshot_data(snapshot_id)
            .await
            .unwrap();
        manager
            .update_container_resources(source, policy.cpu.preferred, policy.memory_gb.preferred)
            .await
            .unwrap();
        manager
            .container_action(source, "start", false)
            .await
            .unwrap();
        let restored = manager
            .execute_container_command(source, "cat /snapshot-proof")
            .await
            .unwrap();
        assert_eq!(restored.exit_code, 0, "{}", restored.stderr);
        assert_eq!(restored.stdout, "snapshot-state");
        manager
            .delete_container_snapshot(source, snapshot_id)
            .await
            .unwrap();
        manager
            .delete_container_snapshot(source, snapshot_id)
            .await
            .unwrap();
        for id in [source, target, internet, gpu] {
            manager.delete_container(id).await.unwrap();
        }
        manager.shutdown_all().await;
    }
}
