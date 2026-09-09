mod backup;
mod automation;
mod local_backup;
mod commands;
mod instance_lock;
mod host_files;
mod host_terminal;
mod workspace;
mod guest_apps;
mod guest_keyboard;
mod models;
mod runtime;
mod scheduler;
mod store;
#[cfg(all(test, target_os = "windows"))]
mod window_smoke_tests;

use crate::store::PlatformStore;
use std::collections::HashSet;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let headless = std::env::args().any(|argument| argument == "--headless");
    // Acquire before constructing WebView/Tauri state so a duplicate launch exits
    // immediately without paying startup cost or turning a setup error into a panic.
    let instance_lock = match instance_lock::InstanceLock::acquire() {
        Ok(lock) => lock,
        Err(error) => {
            // A normal launcher click brings a headless engine's dashboard back
            // instead of starting another owner of the same guest disks.
            if !headless {
                let _ = tauri::async_runtime::block_on(yougori_cli::client::call(
                    &yougori_cli::client::request("app_show", serde_json::json!({})),
                ));
            }
            eprintln!("{error}");
            return;
        }
    };
    let mut context = tauri::generate_context!();
    if headless {
        for window in &mut context.config_mut().app.windows { window.create = false; }
    }
    let app = tauri::Builder::default()
        // Do not expose an unpainted WebView during native setup.
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = webview.window().show();
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let app_directory = app.path().app_data_dir()?;
            let resource_directory = app.path().resource_dir()?;
            let runtime = runtime::RuntimeManager::new(&resource_directory, &app_directory)
                .map_err(std::io::Error::other)?;
            tauri::async_runtime::block_on(runtime.cleanup_orphan_branch_boot_disks())
                .map_err(std::io::Error::other)?;
            let backup =
                backup::BackupManager::new(&app_directory).map_err(std::io::Error::other)?;
            let store = PlatformStore::load(app_directory.join("platform-state.json"))
                .map_err(std::io::Error::other)?;
            let mut state = store.snapshot().map_err(std::io::Error::other)?;
            runtime.restore_container_routes(&state).map_err(std::io::Error::other)?;
            // A durable state intent brackets every disk replacement. If the process
            // stopped before the restored state committed, reactivate the old disk;
            // if state committed first, finish deleting the retained rollback disk.
            let restore_intents = state
                .pending_vm_restores
                .iter()
                .cloned()
                .collect::<HashSet<_>>();
            let mut restore_candidates = restore_intents.clone();
            restore_candidates.extend(
                state
                    .environments
                    .iter()
                    .filter(|environment| {
                        environment.provider == Some(models::RuntimeProviderKind::Qemu)
                    })
                    .map(|environment| {
                        environment
                            .runtime_id
                            .clone()
                            .unwrap_or_else(|| environment.id.clone())
                    }),
            );
            for environment_id in restore_candidates {
                if !runtime
                    .has_pending_vm_backup_install(&environment_id)
                    .map_err(std::io::Error::other)?
                {
                    continue;
                }
                if restore_intents.contains(&environment_id) {
                    tauri::async_runtime::block_on(
                        runtime.rollback_vm_backup_install(&environment_id),
                    )
                    .map_err(std::io::Error::other)?;
                } else {
                    tauri::async_runtime::block_on(
                        runtime.finalize_vm_backup_install(&environment_id),
                    )
                    .map_err(std::io::Error::other)?;
                }
            }
            state.pending_vm_restores.clear();
            // A fresh install has no OCI state to protect, so creating/checking the appliance
            // disk can wait until the first container operation. Existing OCI environments
            // still get the compatibility check before their persisted status is restored.
            let has_oci_environments = state.environments.iter().any(|environment| {
                environment.provider == Some(models::RuntimeProviderKind::OpenDockOci)
            });
            let (appliance_reset, appliance_error) = if has_oci_environments {
                match tauri::async_runtime::block_on(runtime.prepare_appliance_overlay()) {
                    Ok(reset) => (reset, None),
                    // Keep the UI available so users can see the error and recover/delete.
                    // Preparation leaves the disk untouched when an external runtime owns it.
                    Err(error) => (false, Some(error)),
                }
            } else {
                (false, None)
            };
            state.host = commands::collect_host_metrics(&state.host, runtime.storage_root());
            state.host.storage_saved_gb = 0.0;
            state.providers = runtime.provider_statuses();
            if appliance_reset {
                for environment in &mut state.environments {
                    if environment.provider == Some(models::RuntimeProviderKind::OpenDockOci) {
                        environment.status = models::EnvironmentStatus::Error;
                        environment.last_error = Some(
                            "The previous OCI runtime disk was archived after an appliance upgrade or filesystem failure. Recreate this container; its archived runtime disk remains available for recovery."
                                .into(),
                        );
                    }
                }
            }
            commands::vm_creation::recover_interrupted(&mut state);
            commands::factory_reset::recover_interrupted(&mut state);
            for environment in &mut state.environments {
                if environment.provider == Some(models::RuntimeProviderKind::OpenDockOci) {
                    if let Some(error) = &appliance_error {
                        environment.status = models::EnvironmentStatus::Error;
                        environment.last_error = Some(error.clone());
                    }
                }
                if matches!(
                    environment.status,
                    models::EnvironmentStatus::Running
                        | models::EnvironmentStatus::Paused
                        | models::EnvironmentStatus::Provisioning
                ) {
                    environment.status = models::EnvironmentStatus::Stopped;
                    environment.cpu_usage = 0.0;
                    environment.memory_usage_gb = 0.0;
                    environment.network_rx_mbps = 0.0;
                    environment.resource_policy.cpu.current = 0.0;
                    environment.resource_policy.memory_gb.current = 0.0;
                    environment.control_endpoint = None;
                    environment.console_endpoint = None;
                }
            }
            for connection in &mut state.connections {
                connection.enforcement_status = Some(models::EnforcementStatus::Pending);
                connection.provider_rule_ids.clear();
            }
            for run in &mut state.backup_runs {
                if run.status == models::BackupRunStatus::Running {
                    run.status = models::BackupRunStatus::Failed;
                    run.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    run.last_error = Some("Yougori closed before this backup completed".into());
                }
            }
            store.replace(state).map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(runtime);
            app.manage(backup);
            app.manage(instance_lock);
            app.manage(workspace::WorkspaceManager::new(&app_directory));
            app.manage(host_terminal::HostTerminalManager::default());
            automation::start(app.handle(), headless).map_err(std::io::Error::other)?;
            let workspace_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticks = 0u8;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    workspace_app.state::<workspace::WorkspaceManager>().cleanup(
                        &workspace_app.state::<PlatformStore>(),
                        &workspace_app.state::<runtime::RuntimeManager>(),
                    ).await;
                    ticks = (ticks + 1) % 6;
                    if ticks == 0 { automation::headless_tick(&workspace_app).await; }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_terminal::get_host_terminal_info,
            host_terminal::set_up_agent_access,
            host_terminal::host_terminal_action,
            commands::get_platform_state,
            commands::cloud::scan_cloud_host,
            commands::cloud::add_cloud_environment,
            commands::cloud::get_cloud_connection,
            commands::connection_skills::get_connection_skills,
            commands::open_environment_window,
            commands::close_environment_window,
            commands::reset_platform_state,
            commands::create_environment,
            commands::set_environment_status,
            commands::delete_environment,
            commands::recover_container_runtime,
            commands::recover_vm_runtime,
            commands::update_resource_policy,
            commands::rename_environment,
            commands::storage::get_storage_allocation,
            commands::storage::reclaim_storage,
            commands::storage::expand_environment_storage,
            commands::factory_reset::factory_reset_environment,
            commands::update_container_network,
            commands::update_environment_gpu,
            runtime::gpu::get_shared_gpu_settings,
            runtime::cuda::get_cuda_runtime_status,
            runtime::cuda::install_cuda_runtime,
            runtime::cuda::verify_environment_cuda,
            runtime::gpu::set_shared_gpu_selection,
            commands::create_connection,
            commands::set_connection_active,
            commands::delete_connection,
            commands::create_snapshot,
            commands::delete_snapshot,
            commands::restore_snapshot,
            commands::add_backup_destination,
            commands::delete_backup_destination,
            commands::run_backup,
            commands::restore_backup,
            commands::update_settings,
            commands::refresh_host_metrics,
            local_backup::export_local_backup,
            local_backup::import_local_backup,
            commands::get_guest_session,
            commands::execute_environment_command,
            commands::read_environment_console,
            workspace::terminal_action,
            workspace::installers::prepare_terminal_installer,
            guest_apps::micro_vm_apps,
            guest_apps::open_micro_vm_app_window,
            workspace::list_environment_services,
            workspace::get_manual_service_ports,
            workspace::set_manual_service_port,
            workspace::publish_environment_service,
            workspace::cloudflare::saved_cloudflare_account,
            workspace::cloudflare::forget_cloudflare_account,
            workspace::unpublish_environment_service,
            workspace::attach_host_folder,
            workspace::detach_host_folder,
            workspace::list_environment_windows,
            workspace::focus_environment_window,
            workspace::title_environment_window,
            workspace::open_workspace_url,
            guest_keyboard::set_guest_keyboard_capture,
        ])
        .build(context)
        .expect("error while building Yougori");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { code: None, api, .. } = &event {
            if app_handle.state::<std::sync::Arc<automation::Control>>().headless {
                api.prevent_exit();
                return;
            }
        }
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Destroyed, .. } = &event {
            guest_keyboard::release_window(label);
        }
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &event {
            let app = app_handle.clone();
            let label = label.clone();
            tauri::async_runtime::spawn(async move {
                let host_app=app.clone();let owner=label.clone();
                let _=tokio::task::spawn_blocking(move ||host_app.state::<host_terminal::HostTerminalManager>().close_owner(&owner)).await;
                app.state::<workspace::WorkspaceManager>().close_window(&label, &app.state::<PlatformStore>(), &app.state::<runtime::RuntimeManager>()).await;
            });
        }
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            app_handle.state::<host_terminal::HostTerminalManager>().shutdown();
            let runtime = app_handle.state::<runtime::RuntimeManager>();
            tauri::async_runtime::block_on(app_handle.state::<workspace::WorkspaceManager>().shutdown(&runtime));
            tauri::async_runtime::block_on(runtime.shutdown_all());
        }
    });
}
