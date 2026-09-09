use super::RuntimeManager;
use crate::models::{RuntimeProviderKind, StorageCleanupResult};
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct TrimResult {
    busy: bool,
    warnings: Vec<String>,
}

// Generated in the verified appliance directory, never from user input.
// Drop also attempts cleanup when a caller cancels maintenance.
struct CompactScratch(std::path::PathBuf);
impl Drop for CompactScratch {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;
    use std::path::Path;

    #[tokio::test]
    #[ignore = "boots disposable containers and measures actual host allocation"]
    async fn deletion_reclaims_disk_blocks_and_preserves_peer() -> Result<(), String> {
        macro_rules! check { ($condition:expr) => { if !$condition { return Err(format!("Reclamation check failed: {}", stringify!($condition))); } }; }
        let data = tempfile::tempdir().unwrap();
        let runtime = RuntimeManager::new(Path::new(env!("CARGO_MANIFEST_DIR")), data.path())?;
        let policy = ResourcePolicy {
            cpu: ResourceRange { min: 1.0, preferred: 1.0, max: 1.0, current: 0.0 },
            memory_gb: ResourceRange { min: 0.5, preferred: 0.5, max: 0.5, current: 0.0 },
            priority: Priority::Normal, dynamic: true,
        };
        let result = async {
            for id in ["reclaim-delete", "reclaim-keep"] {
                runtime.provision_container(id, "quay.io/libpod/alpine:latest", "sleep 2147483647", &policy, false, false).await?;
                runtime.container_action(id, "start", false).await?;
            }
            let marker = runtime.execute_container_command("reclaim-keep", "echo peer-safe > /root/marker; sync").await?;
            check!(marker.exit_code == 0);
            let output = runtime.execute_container_command("reclaim-delete", "dd if=/dev/urandom of=/root/reclaim-test bs=1048576 count=256; sync").await?;
            check!(output.exit_code == 0);
            runtime.delete_container("reclaim-delete").await?;
            let result = runtime.reclaim_container_storage(&RuntimeProviderKind::OpenDockOci).await?;
            eprintln!("Reclaim result: {}", serde_json::to_string(&result).unwrap());
            #[cfg(windows)] check!(result.warnings.iter().any(|w| w.contains("running or paused")));
            let output = runtime.execute_container_command("reclaim-keep", "cat /root/marker").await?;
            check!(output.stdout.trim() == "peer-safe");
            runtime.container_action("reclaim-keep", "stop", false).await?;
            let compacted = runtime.reclaim_container_storage(&RuntimeProviderKind::OpenDockOci).await?;
            eprintln!("Idle compaction: {}", serde_json::to_string(&compacted).unwrap());
            check!(compacted.warnings.is_empty());
            check!(result.reclaimed_disk_bytes + compacted.reclaimed_disk_bytes > 128 * 1024 * 1024);
            runtime.container_action("reclaim-keep", "start", false).await?;
            check!(runtime.execute_container_command("reclaim-keep", "cat /root/marker").await?.stdout.trim() == "peer-safe");
            runtime.container_action("reclaim-keep", "stop", false).await?;
            let again = runtime.reclaim_container_storage(&RuntimeProviderKind::OpenDockOci).await?;
            check!(again.warnings.is_empty());
            Ok(())
        }.await;
        runtime.shutdown_all().await;
        result
    }
}

impl RuntimeManager {
    /// No filesystem formatting or stopping peers. The
    /// writer lease excludes provision/start/snapshot/exec operations while an
    /// idle CUDA disk is detached and compacted. FITRIM itself is live-safe.
    pub async fn reclaim_container_storage(&self, provider: &RuntimeProviderKind) -> Result<StorageCleanupResult, String> {
        if !provider.is_container() { return Err("Only managed container pools support shared-disk reclamation.".into()); }
        let _lease = self.appliance_operations.write().await;
        let cuda = *provider == RuntimeProviderKind::OpenDockCuda;
        let path = if cuda { self.cuda.storage_path() } else { self.data_root.join("appliance/system.qcow2") };
        if !path.exists() { return Ok(StorageCleanupResult::default()); }
        let before = if cuda { self.cuda.storage_sizes()?.1 } else { (self.inspect_storage(&path, true).await?.physical_gb * 1_073_741_824.0) as u64 };
        let endpoint = self.provider_endpoint(provider).await?;
        let response = self.client.post(format!("{}/v1/storage/reclaim", endpoint.base_url))
            .bearer_auth(&endpoint.token).timeout(Duration::from_secs(100)).send().await
            .map_err(|e| format!("Storage cleanup could not reach the runtime: {e}. Retry Storage → Reclaim space."))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err("This runtime needs the updated storage helper. Close Yougori normally and reopen it (update NVIDIA CUDA under New environment → GPU if requested), then choose Storage → Reclaim space. Container data was kept.".into());
        }
        let result: TrimResult = response.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        let mut cleanup = StorageCleanupResult { warnings: result.warnings, ..Default::default() };
        if cuda || cfg!(windows) {
            if result.busy {
                cleanup.warnings.push(format!("{} containers are still running or paused. Free space is reusable inside their disk; stop them and choose Storage → Reclaim space to return it to Windows. No workloads were stopped.", if cuda { "GPU" } else { "Standard" }));
            } else {
                let compact = if cuda { self.cuda.compact_idle_storage().await } else { self.compact_idle_appliance().await };
                if let Err(error) = compact { cleanup.warnings.push(error); }
            }
        }
        let after = if cuda { self.cuda.storage_sizes().map(|s| s.1) } else { self.inspect_storage(&path, true).await.map(|s| (s.physical_gb * 1_073_741_824.0) as u64) };
        match after {
            Ok(after) => cleanup.reclaimed_disk_bytes = before.saturating_sub(after),
            Err(error) => cleanup.warnings.push(format!("Cleanup ran, but reclaimed space could not be measured: {error}")),
        }
        cleanup.notes.push("Container runtimes, cached base images and saved snapshots still use space. They are kept for other containers and offline reset/restore; exported backups and original installers are never removed.".into());
        Ok(cleanup)
    }

    async fn compact_idle_appliance(&self) -> Result<(), String> {
        let mut guard = self.appliance.lock().await;
        if let Some(process) = guard.as_mut() {
            if !process.active_containers.is_empty() { return Err("Standard containers are still running or paused; stop them before reclaiming space.".into()); }
            if process.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                self.client.post(format!("{}/v1/system/shutdown", process.endpoint.base_url))
                    .bearer_auth(&process.endpoint.token).timeout(Duration::from_secs(5)).send().await.map_err(|e| e.to_string())?
                    .error_for_status().map_err(|e| e.to_string())?;
                let status = tokio::time::timeout(Duration::from_secs(30), process.child.wait()).await
                    .map_err(|_| "The idle container runtime is still shutting down. Retry Reclaim space; it was not force-stopped.")?.map_err(|e| e.to_string())?;
                if !status.success() { return Err("Container runtime did not shut down cleanly. Its disk was kept unchanged.".into()); }
                self.record_appliance_overlay_state()?;
            }
        }
        guard.take();
        self.check_external_appliance(false).await?;
        let directory = self.data_root.join("appliance").canonicalize().map_err(|e| e.to_string())?;
        if directory.parent() != Some(self.data_root.canonicalize().map_err(|e| e.to_string())?.as_path()) {
            return Err("Container storage was redirected; compaction was refused.".into());
        }
        let disk = directory.join("system.qcow2");
        let metadata = std::fs::symlink_metadata(&disk).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || disk.canonicalize().map_err(|e| e.to_string())? != disk {
            return Err("Container disk is not a regular owned file.".into());
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(1 | 4); }
        // On Windows, allow readers and atomic replacement, but deny new writers.
        let _disk_guard = options.open(&disk).map_err(|e| format!("Lock idle container disk: {e}"))?;
        let allocation = self.inspect_storage(&disk, true).await?;
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let available = super::storage::runtime_disk(&disks, &directory).ok_or("Cannot read free space for compaction")?.available_space();
        let required = (allocation.physical_gb * 1_073_741_824.0) as u64 + 256 * 1024 * 1024;
        if available < required { return Err(format!("Safe compaction needs {:.2} GB of temporary free space on the Yougori drive. Data was kept; free some space and retry Reclaim space.", required as f64 / 1_073_741_824.0)); }
        let temporary = directory.join(format!(".compact-{}.qcow2", uuid::Uuid::new_v4().simple()));
        let _scratch = CompactScratch(temporary.clone());
        let result = tokio::time::timeout(Duration::from_secs(600), async {
            super::command_output(&self.layout.qemu_img, &[
                "convert".into(), "-f".into(), "qcow2".into(), "-O".into(), "qcow2".into(),
                "-B".into(), super::path_string(&self.layout.appliance_base), "-F".into(), "qcow2".into(),
                super::path_string(&disk), super::path_string(&temporary),
            ], "compact idle container disk").await?;
            super::command_output(&self.layout.qemu_img, &["check".into(), "-q".into(), super::path_string(&temporary)], "verify compacted container disk").await?;
            super::command_output(&self.layout.qemu_img, &["compare".into(), "-f".into(), "qcow2".into(), "-F".into(), "qcow2".into(), super::path_string(&disk), super::path_string(&temporary)], "verify container data is unchanged").await?;
            std::fs::OpenOptions::new().read(true).write(true).open(&temporary).and_then(|f| f.sync_all()).map_err(|e| format!("Flush compacted disk: {e}"))?;
            // One atomic replacement only after content comparison. Failure
            // keeps the original; no remove-then-rename crash window.
            std::fs::rename(&temporary, &disk).map_err(|e| format!("Commit compacted disk: {e}"))?;
            self.record_appliance_overlay_state()?;
            Ok::<_, String>(())
        }).await.map_err(|_| "Container disk compaction took too long. The original disk was kept; retry Reclaim space.".to_string())?;
        result
    }
}
