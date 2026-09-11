use super::*;
use crate::runtime::storage::StorageAllocation;

#[tauri::command]
pub async fn reclaim_storage(store: State<'_, PlatformStore>, runtime: State<'_, RuntimeManager>) -> Result<EnvironmentDeletionResult, String> {
    let _serial = CONTAINER_POLICY_OPERATIONS.lock().await;
    let mut cleanup = StorageCleanupResult::default();
    for provider in [RuntimeProviderKind::OpenDockOci, RuntimeProviderKind::OpenDockCuda] {
        match runtime.reclaim_container_storage(&provider).await {
            Ok(result) => {
                cleanup.reclaimed_disk_bytes = cleanup.reclaimed_disk_bytes.saturating_add(result.reclaimed_disk_bytes);
                cleanup.warnings.extend(result.warnings);
                cleanup.notes.extend(result.notes);
            }
            Err(error) => cleanup.warnings.push(format!("{} storage: {error}", if provider == RuntimeProviderKind::OpenDockCuda { "GPU" } else { "Standard container" })),
        }
    }
    let current = store.snapshot()?;
    match runtime.garbage_collect_vm_bases(&referenced_vm_sources(&current)).await {
        Ok(bytes) => cleanup.reclaimed_cache_bytes = bytes,
        Err(error) => cleanup.warnings.push(format!("Unused VM images were kept: {error}")),
    }
    cleanup.notes.sort();
    cleanup.notes.dedup();
    if let Some(sampler) = HOST_SAMPLER.get() {
        let mut sampler = sampler.lock().unwrap_or_else(|p| p.into_inner());
        sampler.disks.refresh(true);
        sampler.last_disk_refresh = Instant::now();
    }
    let state = store.mutate_ephemeral(|state| {
        state.host = collect_host_metrics(&state.host, runtime.storage_root());
        Ok(())
    })?;
    Ok(EnvironmentDeletionResult { state, storage_cleanup: cleanup })
}

#[tauri::command]
pub async fn get_storage_allocation(environment_id: Option<String>, new_vm: Option<bool>, store: State<'_, PlatformStore>, runtime: State<'_, RuntimeManager>) -> Result<StorageAllocation, String> {
    if environment_id.is_none() && new_vm.unwrap_or(false) { return runtime.new_vm_storage(); }
    let Some(id) = environment_id else { return runtime.new_vm_storage(); };
    let environment = store.snapshot()?.environments.into_iter().find(|e| e.id == id).ok_or("Environment not found")?;
    match provider(&environment) {
        RuntimeProviderKind::OpenDockOci | RuntimeProviderKind::OpenDockCuda => runtime.container_storage_allocation(runtime_id(&environment)).await,
        RuntimeProviderKind::Qemu => runtime.vm_storage_allocation(runtime_id(&environment), &vm_disk(&environment)?).await,
        _ => Err("Storage allocation is not available for this environment.".into()),
    }
}

#[tauri::command]
pub async fn expand_environment_storage(environment_id: String, capacity_gb: f64, store: State<'_, PlatformStore>, runtime: State<'_, RuntimeManager>) -> Result<StorageAllocation, String> {
    crate::runtime::storage::storage_bytes(capacity_gb)?;
    let _serial = CONTAINER_POLICY_OPERATIONS.lock().await;
    let state = store.snapshot()?;
    let environment = state.environments.iter().find(|e| e.id == environment_id).ok_or("Environment not found")?;
    match provider(environment) {
        RuntimeProviderKind::OpenDockOci | RuntimeProviderKind::OpenDockCuda => {
            if capacity_gb < 6.0 { return Err("Container storage limits start at 6 GB.".into()); }
            let allocation = runtime.set_container_storage(runtime_id(environment), capacity_gb).await?;
            store.mutate(|state| {
                let item = state.environments.iter_mut().find(|e| e.id == environment_id).ok_or("Environment not found")?;
                item.storage_limit_gb = Some(allocation.capacity_gb);
                Ok(())
            })?;
            Ok(allocation)
        },
        RuntimeProviderKind::Qemu if environment.kind != EnvironmentKind::ComputerBranch => {
            if environment.status != EnvironmentStatus::Stopped { return Err("Stop the environment before expanding storage.".into()); }
            runtime.grow_vm_storage(runtime_id(environment), &vm_disk(environment)?, capacity_gb).await
        },
        _ => Err("Storage expansion is not available for this environment.".into()),
    }
}
