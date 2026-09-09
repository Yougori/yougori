use super::*;
use std::future::Future;

/// Persist and announce the real node before polling the expensive disk import.
/// The async command continues even after its creation form has been closed.
pub(super) async fn create_on_graph(
    request: &CreateEnvironmentRequest,
    policy: ResourcePolicy,
    id: &str,
    store: &PlatformStore,
    provision: impl Future<Output = Result<(String, String), String>>,
    notify: impl Fn(&PlatformState),
) -> Result<PlatformState, String> {
    let pending = Environment {
        id: id.into(),
        name: request.name.trim().into(),
        kind: EnvironmentKind::FullVm,
        status: EnvironmentStatus::Provisioning,
        runtime: request.runtime.trim().into(),
        provider: Some(RuntimeProviderKind::Qemu),
        runtime_id: Some(id.into()),
        runtime_path: None,
        control_endpoint: None,
        console_endpoint: None,
        container_command: None,
        network_access: false,
        gpu_access: request.gpu_access,
        sandbox_policy: None,
        last_error: None,
        description: request.description.trim().into(),
        branch_type: None,
        created_at: now(),
        last_opened_at: None,
        cpu_usage: 0.0,
        memory_usage_gb: 0.0,
        storage_delta_gb: 0.0,
        network_rx_mbps: 0.0,
        resource_policy: policy,
    };
    let state = store.mutate(|state| {
        if state
            .environments
            .iter()
            .any(|item| item.name.eq_ignore_ascii_case(&pending.name))
        {
            return Err("An environment with this name already exists".into());
        }
        state.environments.insert(0, pending);
        Ok(())
    })?;
    notify(&state);
    let result = provision.await;
    let finalized = store.mutate(|state| {
        let environment = state.environments.iter_mut().find(|item| item.id == id)
            .ok_or("The VM creation record is missing")?;
        match &result {
            Ok((disk, source)) => {
                environment.runtime_path = Some(disk.clone());
                environment.runtime = source.clone();
                environment.status = EnvironmentStatus::Stopped;
                environment.last_error = None;
            }
            Err(error) => {
                environment.status = EnvironmentStatus::Error;
                environment.last_error = Some(format!("VM preparation failed: {error}\nDelete this node and create the VM again. Your original boot media was not changed."));
            }
        }
        Ok(())
    });
    let state = match finalized {
        Ok(state) => state,
        Err(error) => {
            let message = format!("Could not save the VM preparation result: {error}. Free disk space, then delete this incomplete node and create it again.");
            // Even if the disk is full, do not leave an endless spinner in memory.
            // The persisted Provisioning state is recovered as an error on restart.
            if let Ok(state) = store.mutate_ephemeral(|state| {
                if let Some(environment) = state.environments.iter_mut().find(|item| item.id == id)
                {
                    environment.status = EnvironmentStatus::Error;
                    environment.last_error = Some(message.clone());
                }
                Ok(())
            }) {
                notify(&state);
            }
            return Err(message);
        }
    };
    notify(&state);
    result.map(|_| state)
}

pub(crate) fn recover_interrupted(state: &mut PlatformState) {
    for environment in &mut state.environments {
        if environment.kind == EnvironmentKind::FullVm
            && environment.status == EnvironmentStatus::Provisioning
        {
            environment.status = EnvironmentStatus::Error;
            environment.last_error = Some("Yougori closed before VM preparation finished. Delete this incomplete node and create the VM again. Your original boot media was not changed.".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn fixture() -> (CreateEnvironmentRequest, ResourcePolicy) {
        let policy: ResourcePolicy = serde_json::from_value(serde_json::json!({
            "cpu":{"min":1,"preferred":2,"max":4,"current":0},
            "memoryGb":{"min":1,"preferred":2,"max":4,"current":0},
            "priority":"normal","dynamic":false
        }))
        .unwrap();
        let request = serde_json::from_value(serde_json::json!({
            "name":"Test VM","kind":"fullVm","runtime":"test.iso","provider":"qemu",
            "description":"VM creation test","resourcePolicy":policy
        }))
        .unwrap();
        (request, policy)
    }

    #[tokio::test]
    async fn vm_creation_persists_and_notifies_before_disk_work_then_updates_same_node() {
        let data = tempfile::tempdir().unwrap();
        let path = data.path().join("state.json");
        let store = PlatformStore::load(path.clone()).unwrap();
        let (request, policy) = fixture();
        let events = Mutex::new(Vec::new());
        let result = create_on_graph(
            &request,
            policy,
            "env-create",
            &store,
            async {
                let pending = PlatformStore::load(path).unwrap().snapshot().unwrap();
                assert_eq!(
                    pending.environments[0].status,
                    EnvironmentStatus::Provisioning
                );
                assert!(pending.environments[0].runtime_path.is_none());
                assert_eq!(events.lock().unwrap().len(), 1);
                // Preserve independent edits while disk preparation is in flight.
                store
                    .mutate(|state| {
                        state.environments[0].description = "Preserved edit".into();
                        Ok(())
                    })
                    .unwrap();
                Ok(("managed/system.qcow2".into(), "managed/source.iso".into()))
            },
            |state| {
                events
                    .lock()
                    .unwrap()
                    .push(state.environments[0].status.clone())
            },
        )
        .await
        .unwrap();
        assert_eq!(result.environments.len(), 1);
        let environment = &result.environments[0];
        assert_eq!(environment.id, "env-create");
        assert_eq!(environment.description, "Preserved edit");
        assert_eq!(
            environment.runtime_path.as_deref(),
            Some("managed/system.qcow2")
        );
        assert_eq!(environment.runtime, "managed/source.iso");
        assert_eq!(
            *events.lock().unwrap(),
            vec![EnvironmentStatus::Provisioning, EnvironmentStatus::Stopped]
        );
    }

    #[tokio::test]
    async fn vm_creation_failure_stays_visible_and_duplicate_name_never_starts_work() {
        let data = tempfile::tempdir().unwrap();
        let store = PlatformStore::load(data.path().join("state.json")).unwrap();
        let (request, policy) = fixture();
        let failed = create_on_graph(
            &request,
            policy.clone(),
            "env-failure",
            &store,
            async { Err("Disk is full".into()) },
            |_| {},
        )
        .await;
        assert_eq!(failed.unwrap_err(), "Disk is full");
        let state = store.snapshot().unwrap();
        assert_eq!(state.environments[0].status, EnvironmentStatus::Error);
        assert!(state.environments[0]
            .last_error
            .as_ref()
            .unwrap()
            .contains("Disk is full"));
        assert!(state.environments[0].runtime_path.is_none());
        let duplicate = create_on_graph(
            &request,
            policy,
            "env-duplicate",
            &store,
            async { panic!("Duplicate must not import a disk") },
            |_| {},
        )
        .await;
        assert!(duplicate.unwrap_err().contains("already exists"));
        assert_eq!(store.snapshot().unwrap().environments.len(), 1);
    }

    #[tokio::test]
    async fn vm_creation_interruption_is_not_mistaken_for_a_ready_vm() {
        let data = tempfile::tempdir().unwrap();
        let store = PlatformStore::load(data.path().join("state.json")).unwrap();
        let (request, policy) = fixture();
        let task = create_on_graph(
            &request,
            policy,
            "env-interrupted",
            &store,
            std::future::pending(),
            |_| {},
        );
        tokio::pin!(task);
        tokio::select! {
            _ = &mut task => panic!("Preparation must still be in progress"),
            _ = tokio::time::sleep(Duration::from_millis(10)) => {}
        }
        let mut state = store.snapshot().unwrap();
        recover_interrupted(&mut state);
        assert_eq!(state.environments[0].status, EnvironmentStatus::Error);
        assert!(state.environments[0]
            .last_error
            .as_ref()
            .unwrap()
            .contains("closed before"));
    }

    #[tokio::test]
    async fn vm_creation_save_failure_clears_the_live_spinner() {
        let data = tempfile::tempdir().unwrap();
        let path = data.path().join("state.json");
        let store = PlatformStore::load(path.clone()).unwrap();
        let (request, policy) = fixture();
        let failed = create_on_graph(
            &request,
            policy,
            "env-save-failure",
            &store,
            async {
                // Block only this temporary fixture's final atomic write.
                std::fs::create_dir(path.with_extension("json.tmp")).unwrap();
                Ok(("managed/system.qcow2".into(), "managed/source.iso".into()))
            },
            |_| {},
        )
        .await;
        assert!(failed.unwrap_err().contains("Could not save"));
        assert_eq!(
            store.snapshot().unwrap().environments[0].status,
            EnvironmentStatus::Error
        );
        let persisted: PlatformState =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(
            persisted.environments[0].status,
            EnvironmentStatus::Provisioning
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "creates an isolated VM disk using bundled QEMU; never starts a VM or touches user environments"]
    async fn vm_creation_real_disk_keeps_the_announced_node_id() {
        let data = tempfile::tempdir().unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let runtime = RuntimeManager::new(&root, data.path()).unwrap();
        let store = PlatformStore::load(data.path().join("state.json")).unwrap();
        let (mut request, policy) = fixture();
        request.runtime = root
            .join("resources/runtime/appliance/appliance-base.qcow2")
            .to_string_lossy()
            .into_owned();
        let result = create_on_graph(
            &request,
            policy,
            "env-test-create",
            &store,
            async {
                assert_eq!(
                    store.snapshot()?.environments[0].status,
                    EnvironmentStatus::Provisioning
                );
                let disk = runtime
                    .provision_vm("env-test-create", &request.runtime)
                    .await?;
                Ok((
                    disk.disk_path.to_string_lossy().into_owned(),
                    disk.source_path.to_string_lossy().into_owned(),
                ))
            },
            |_| {},
        )
        .await
        .unwrap();
        let environment = &result.environments[0];
        assert_eq!(environment.id, "env-test-create");
        assert_eq!(environment.status, EnvironmentStatus::Stopped);
        assert!(PathBuf::from(environment.runtime_path.as_ref().unwrap()).is_file());
        runtime.delete_vm("env-test-create").await.unwrap();
        runtime.shutdown_all().await;
    }
}
