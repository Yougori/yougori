//! Explicit, durable routing for the optional CUDA container provider.
//! GPU access is a permission, never a signal to silently move a container.
use super::{AgentEndpoint, RuntimeManager};
use crate::models::{PlatformState, RuntimeProviderKind};
use serde_json::Value;
use std::{fs, io::Write, path::PathBuf};

impl RuntimeManager {
    pub async fn recover_container_provider(
        &self,
        provider: &RuntimeProviderKind,
    ) -> Result<(), String> {
        match provider {
            RuntimeProviderKind::OpenDockOci => self.recover_orphaned_container_runtime().await,
            RuntimeProviderKind::OpenDockCuda => self.cuda.recover_abandoned().await,
            _ => Err("Only container providers support container runtime recovery".into()),
        }
    }
    fn route_path(&self, scope: &str, id: &str) -> Result<PathBuf, String> {
        super::vm::validate_runtime_identifier("GPU runtime route", id)?;
        if !matches!(scope, "containers" | "snapshots") {
            return Err("Invalid runtime routing scope".into());
        }
        Ok(self
            .data_root
            .join("provider-routes")
            .join(scope)
            .join(format!("{id}.json")))
    }

    pub(super) fn read_route(&self, scope: &str, id: &str) -> Result<RuntimeProviderKind, String> {
        let path = self.route_path(scope, id)?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RuntimeProviderKind::OpenDockOci)
            }
            Err(error) => return Err(format!("Read container provider: {error}")),
        };
        if !metadata.is_file() || metadata.len() > 128 {
            return Err("Container provider metadata is invalid; no runtime was started".into());
        }
        let provider: RuntimeProviderKind =
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|_| "Container provider metadata is damaged; no runtime was started")?;
        if !provider.is_container() {
            return Err("Invalid container provider".into());
        }
        Ok(provider)
    }

    fn write_route(
        &self,
        scope: &str,
        id: &str,
        provider: &RuntimeProviderKind,
    ) -> Result<(), String> {
        if !provider.is_container() {
            return Err("Expected a container provider".into());
        }
        let path = self.route_path(scope, id)?;
        fs::create_dir_all(path.parent().ok_or("Invalid provider directory")?)
            .map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(provider).map_err(|e| e.to_string())?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| format!("Save container provider: {e}"))?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if self.read_route(scope, id)? != *provider {
                    return Err("This environment belongs to a different runtime. Moving its data requires an explicit backup/import; no data was moved.".into());
                }
                Ok(())
            }
            Err(error) => Err(format!("Save container provider: {error}")),
        }
    }

    pub fn container_provider(&self, id: &str) -> Result<RuntimeProviderKind, String> {
        self.read_route("containers", id)
    }
    pub fn register_container_provider(
        &self,
        id: &str,
        provider: &RuntimeProviderKind,
    ) -> Result<(), String> {
        self.write_route("containers", id, provider)
    }
    pub fn register_snapshot_provider(
        &self,
        id: &str,
        provider: &RuntimeProviderKind,
    ) -> Result<(), String> {
        self.write_route("snapshots", id, provider)
    }

    pub fn restore_container_routes(&self, state: &PlatformState) -> Result<(), String> {
        for environment in &state.environments {
            if let Some(provider) = &environment.provider {
                if provider.is_container() {
                    self.register_container_provider(
                        environment.runtime_id.as_deref().unwrap_or(&environment.id),
                        provider,
                    )?;
                }
            }
        }
        for snapshot in &state.snapshots {
            if let Some(provider) = snapshot
                .environment_state
                .as_ref()
                .and_then(|s| s.provider.as_ref())
            {
                if provider.is_container() {
                    self.register_snapshot_provider(&snapshot.id, provider)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn request_provider(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<RuntimeProviderKind, String> {
        if path.starts_with("/v1/connections/") {
            let source = body["sourceId"]
                .as_str()
                .ok_or("Missing connection source")?;
            let target = body["targetId"]
                .as_str()
                .ok_or("Missing connection target")?;
            let provider = self.container_provider(source)?;
            if self.container_provider(target)? != provider {
                return Err("Cross-runtime connections must use the private network bridge".into());
            }
            return Ok(provider);
        }
        if let Some(ids) = body["ids"].as_array() {
            let mut provider = None;
            for id in ids {
                let current =
                    self.container_provider(id.as_str().ok_or("Invalid container identifier")?)?;
                if provider.as_ref().is_some_and(|p| p != &current) {
                    return Err("Telemetry batches must be grouped by runtime".into());
                }
                provider = Some(current);
            }
            return Ok(provider.unwrap_or(RuntimeProviderKind::OpenDockOci));
        }
        if let Some(id) = body["id"].as_str().filter(|id| !id.is_empty()) {
            return self.container_provider(id);
        }
        if let Some(id) = body["snapshotId"].as_str() {
            return self.read_route("snapshots", id);
        }
        Err("Container operation has no explicit runtime identity".into())
    }

    pub(super) async fn provider_endpoint(
        &self,
        provider: &RuntimeProviderKind,
    ) -> Result<AgentEndpoint, String> {
        match provider {
            RuntimeProviderKind::OpenDockOci => self.appliance_endpoint().await,
            RuntimeProviderKind::OpenDockCuda => {
                // Never boot an obsolete guest payload. An already owned live
                // runtime remains stoppable even if the app files were updated.
                if self.cuda.current_endpoint().await.is_err() {
                    self.require_cuda_installation().await?;
                }
                let endpoint = self.cuda.ensure_started().await?;
                Ok(AgentEndpoint {
                    base_url: endpoint.base_url,
                    token: endpoint.token,
                })
            }
            _ => Err("Not a container runtime".into()),
        }
    }

    pub(super) async fn container_endpoint(&self, id: &str) -> Result<AgentEndpoint, String> {
        self.provider_endpoint(&self.container_provider(id)?).await
    }

    pub async fn cuda_status(&self) -> opendock_cuda_runtime::Status {
        use sha2::{Digest, Sha256};
        let mut status = self.cuda.status().await;
        let expected = hex::encode(Sha256::digest(include_bytes!(
            "../../resources/runtime/cuda/SHA256SUMS"
        )));
        status.update_available = status.installed
            && self.cuda.installed_payload_checksum().as_deref() != Some(expected.as_str());
        if status.update_available && status.supported {
            status.detail = if status.running { "A CUDA runtime update is available. Close Yougori normally, reopen it, then update here before starting CUDA containers." } else { "A CUDA runtime update is required for this Yougori version. Existing container disks will be kept." }.into();
        }
        status
    }
    pub async fn require_cuda_installation(&self) -> Result<(), String> {
        let status = self.cuda_status().await;
        if !status.supported || !status.installed || status.update_available {
            return Err(format!(
                "Open New environment → GPU to check this computer and set up or update NVIDIA CUDA first. {}",
                status.detail
            ));
        }
        Ok(())
    }
    pub async fn ensure_cuda_capacity(&self) -> Result<(f64, f64), String> {
        self.provider_endpoint(&RuntimeProviderKind::OpenDockCuda)
            .await?;
        self.cuda_capacity().await
    }
    pub async fn cuda_capacity(&self) -> Result<(f64, f64), String> {
        let endpoint = self.cuda.current_endpoint().await?;
        let health: Value = self
            .client
            .get(format!("{}/v1/health", endpoint.base_url))
            .bearer_auth(endpoint.token)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let cpus = health["cpuCount"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or("Update the CUDA runtime to read its actual CPU capacity")?;
        let bytes = health["memoryBytes"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or("Update the CUDA runtime to read its actual memory capacity")?;
        // Leave the WSL kernel, CUDA runtime and container daemon 0.5 GB.
        Ok((
            cpus as f64,
            ((bytes as f64 / 1_073_741_824.0 - 0.5).max(0.0) * 8.0).floor() / 8.0,
        ))
    }
    #[cfg(test)]
    pub async fn cuda_storage(&self) -> Result<super::storage::StorageAllocation, String> {
        let (capacity, physical) = self.cuda.storage_sizes()?;
        let path = self.cuda.storage_path();
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let disk = super::storage::runtime_disk(
            &disks,
            path.parent().ok_or("Invalid CUDA storage directory")?,
        )
        .ok_or("Cannot determine free space on the CUDA runtime drive")?;
        let gb = 1_073_741_824.0;
        let maximum = disk.available_space().saturating_sub(2 * gb as u64) as f64 / gb;
        Ok(super::storage::StorageAllocation {
            capacity_gb: capacity as f64 / gb,
            physical_gb: physical as f64 / gb,
            maximum_gb: maximum.min(capacity as f64 / gb).floor(),
            shared: true,
            limit_enforced: None,
        })
    }

    pub async fn install_cuda(&self) -> Result<opendock_cuda_runtime::Status, String> {
        // Separate payload: never replace the initramfs or DLLs of a running VM.
        let agent = self.layout.root.join("cuda/opendock-agent");
        if !agent.is_file() {
            return Err(
                "The CUDA guest agent is missing. Rebuild the CUDA payload or reinstall Yougori."
                    .into(),
            );
        }
        use sha2::{Digest, Sha256};
        for name in [
            "opendock-agent",
            "opendock-mount-helper",
            "opendock-cuda-probe",
        ] {
            let expected = include_str!("../../resources/runtime/cuda/SHA256SUMS")
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    let hash = parts.next()?;
                    (parts.next()? == name).then_some(hash)
                })
                .ok_or("CUDA payload checksum is missing")?;
            let bytes = tokio::fs::read(self.layout.root.join("cuda").join(name))
                .await
                .map_err(|_| format!("CUDA payload {name} is missing; reinstall Yougori"))?;
            if hex::encode(Sha256::digest(&bytes)) != expected {
                return Err(format!(
                    "CUDA payload {name} verification failed; setup was not started"
                ));
            }
        }
        self.cuda.install(&agent).await?;
        Ok(self.cuda_status().await)
    }
}

#[tauri::command]
pub async fn get_cuda_runtime_status(
    runtime: tauri::State<'_, RuntimeManager>,
) -> Result<opendock_cuda_runtime::Status, String> {
    Ok(runtime.cuda_status().await)
}

#[tauri::command]
pub async fn install_cuda_runtime(
    runtime: tauri::State<'_, RuntimeManager>,
) -> Result<opendock_cuda_runtime::Status, String> {
    runtime.install_cuda().await
}

#[tauri::command]
pub async fn verify_environment_cuda(
    environment_id: String,
    store: tauri::State<'_, crate::store::PlatformStore>,
    runtime: tauri::State<'_, RuntimeManager>,
) -> Result<Value, String> {
    let environment = store
        .snapshot()?
        .environments
        .into_iter()
        .find(|e| e.id == environment_id)
        .ok_or("Environment not found")?;
    if environment.provider != Some(RuntimeProviderKind::OpenDockCuda) {
        return Err("Native CUDA requires the NVIDIA CUDA container engine. The current QEMU VM/MicroVM engine does not expose CUDA.".into());
    }
    if environment.status != crate::models::EnvironmentStatus::Running {
        return Err("Start this container before testing CUDA.".into());
    }
    if !environment.gpu_access {
        return Err("Enable GPU access in this environment's settings, then start it before testing CUDA.".into());
    }
    let id = environment.runtime_id.as_deref().unwrap_or(&environment.id);
    runtime
        .workspace_request(&environment, "/v1/gpu/verify", serde_json::json!({"id":id}))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_is_explicit_and_rejects_cross_backend_batches() -> Result<(), String> {
        let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
        let runtime = RuntimeManager::new(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")),
            directory.path(),
        )?;
        runtime.register_container_provider("cuda-test", &RuntimeProviderKind::OpenDockCuda)?;
        assert_eq!(
            runtime.container_provider("legacy-test")?,
            RuntimeProviderKind::OpenDockOci
        );
        assert_eq!(
            runtime.container_provider("cuda-test")?,
            RuntimeProviderKind::OpenDockCuda
        );
        assert!(runtime
            .register_container_provider("cuda-test", &RuntimeProviderKind::OpenDockOci)
            .is_err());
        assert!(runtime
            .register_container_provider("../unsafe", &RuntimeProviderKind::OpenDockCuda)
            .is_err());
        assert!(runtime
            .request_provider(
                "/v1/stats/batch",
                &serde_json::json!({"ids":["legacy-test","cuda-test"]})
            )
            .is_err());
        assert!(runtime
            .request_provider(
                "/v1/connections/apply",
                &serde_json::json!({"sourceId":"legacy-test","targetId":"cuda-test"})
            )
            .is_err());
        runtime.register_snapshot_provider("snapshot-test", &RuntimeProviderKind::OpenDockCuda)?;
        assert_eq!(
            runtime.request_provider(
                "/v1/snapshots/release",
                &serde_json::json!({"id":"","snapshotId":"snapshot-test"})
            )?,
            RuntimeProviderKind::OpenDockCuda
        );
        Ok(())
    }
}
