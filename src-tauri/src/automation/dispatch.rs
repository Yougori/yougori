use crate::{
    backup::BackupManager,
    commands, guest_apps, guest_keyboard, local_backup,
    models::*,
    runtime::{self, RuntimeManager},
    store::PlatformStore,
    workspace::{self, WorkspaceManager},
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn arg<T: DeserializeOwned>(params: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(params.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Invalid {key}: {e}"))
}
fn encoded(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn merge_limits(policy: &mut ResourcePolicy, p: &Value) -> Result<(), String> {
    for (key, range) in [
        ("cpu", &mut policy.cpu),
        ("memoryGb", &mut policy.memory_gb),
    ] {
        if let Some(value) = p.get(key).filter(|v| !v.is_null()) {
            for (field, value) in value
                .as_object()
                .ok_or("A resource range must be an object")?
            {
                let number = value
                    .as_f64()
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .ok_or("Resource values must be positive numbers")?;
                match field.as_str() {
                    "min" => range.min = number,
                    "preferred" => range.preferred = number,
                    "max" => range.max = number,
                    _ => return Err(format!("Unknown resource field: {field}")),
                }
            }
        }
    }
    if p.get("priority").is_some_and(|v| !v.is_null()) {
        policy.priority = arg(p, "priority")?;
    }
    commands::validate_policy(policy)
}

pub(super) fn validate(method: &str, p: &Value) -> Result<(), String> {
    // Validate nested native types even on dry runs, without touching runtime state.
    match method {
        "add_cloud_environment" => {
            let _: crate::runtime::cloud::Profile = arg(p,"request")?;
        },
        "host_terminal_action" => {
            let request: crate::host_terminal::HostRequest = arg(p, "request")?;
            crate::host_terminal::validate_request(&request)?;
        }
        "create_environment" => {
            let _: CreateEnvironmentRequest = arg(p, "request")?;
        }
        "create_connection" => {
            let _: CreateConnectionRequest = arg(p, "request")?;
        }
        "update_resource_policy" => {
            let _: ResourcePolicy = arg(p, "resourcePolicy")?;
        }
        "add_backup_destination" => {
            let _: AddDestinationRequest = arg(p, "request")?;
        }
        "execute_environment_command" => {
            let _: ExecuteCommandRequest = arg(p, "request")?;
        }
        "update_settings" => {
            let _: AppSettings = arg(p, "settings")?;
        }
        "publish_environment_service" => {
            let _: Option<workspace::cloudflare::AccountOptions> = arg(p, "cloudflare")?;
        }
        "set_guest_keyboard_capture" => {
            let _: Option<guest_keyboard::CaptureBounds> = arg(p, "bounds")?;
        }
        _ => {}
    }
    Ok(())
}

pub(super) async fn dispatch(app: &AppHandle, method: &str, p: &Value) -> Result<Value, String> {
    let store = app.state::<PlatformStore>();
    let runtime = app.state::<RuntimeManager>();
    let backup = app.state::<BackupManager>();
    let manager = app.state::<WorkspaceManager>();
    macro_rules! a {
        ($key:literal) => {
            arg(p, $key)?
        };
    }
    let window = || {
        app.get_webview_window(p["label"].as_str().unwrap_or(""))
            .filter(|w| w.label().starts_with("environment-env-"))
            .ok_or_else(|| "Guest window is closed or the label is invalid".to_string())
    };
    match method {
        "scan_cloud_host" => encoded(commands::cloud::scan_cloud_host(a!("host"),a!("port")).await?),
        "add_cloud_environment" => encoded(commands::cloud::add_cloud_environment(a!("request"),store,runtime)?),
        "get_cloud_connection" => encoded(commands::cloud::get_cloud_connection(a!("environmentId"),store,runtime).await?),
        "get_host_terminal_info" => crate::host_terminal::info(app, "cli-host"),
        "set_up_agent_access" => encoded(crate::host_terminal::setup_access(app).await?),
        "host_terminal_action" => encoded(
            crate::host_terminal::action_for_owner(app, a!("request"), "cli-host".into()).await?,
        ),
        "get_platform_state" => encoded(commands::get_platform_state(store)?),
        "get_connection_skills" => encoded(
            commands::connection_skills::get_connection_skills(a!("environmentId"), store, manager)
                .await?,
        ),
        "create_environment" => {
            encoded(commands::create_environment(a!("request"), app.clone(), store, runtime).await?)
        }
        "set_environment_status" => encoded(
            commands::set_environment_status(a!("environmentId"), a!("status"), store, runtime)
                .await?,
        ),
        "restart_environment" => {
            let id: String = a!("environmentId");
            if store.snapshot()?.environments.iter().any(|e|e.id==id && e.kind==EnvironmentKind::Cloud) {return Err("Cloud nodes support Connect/Disconnect, not Restart".into());}
            commands::set_environment_status(
                id.clone(),
                EnvironmentStatus::Stopped,
                store.clone(),
                runtime.clone(),
            )
            .await?;
            encoded(
                commands::set_environment_status(id, EnvironmentStatus::Running, store, runtime)
                    .await?,
            )
        }
        "recover_environment_runtime" => {
            let id: String = a!("environmentId");
            let env = store
                .snapshot()?
                .environments
                .into_iter()
                .find(|e| e.id == id)
                .ok_or("Environment not found")?;
            if env
                .provider
                .as_ref()
                .is_some_and(RuntimeProviderKind::is_container)
                || env.kind == EnvironmentKind::Container
            {
                encoded(
                    commands::recover_container_runtime(id, a!("confirmed"), store, runtime)
                        .await?,
                )
            } else {
                encoded(commands::recover_vm_runtime(id, a!("confirmed"), store, runtime).await?)
            }
        }
        "delete_environment" => encoded(
            commands::delete_environment(
                a!("environmentId"),
                a!("recoverRuntime"),
                store,
                runtime,
                backup,
            )
            .await?,
        ),
        "factory_reset_environment" => encoded(
            commands::factory_reset::factory_reset_environment(
                a!("environmentId"),
                a!("confirmation"),
                store,
                runtime,
                backup,
                manager,
            )
            .await?,
        ),
        "recover_container_runtime" => encoded(
            commands::recover_container_runtime(
                a!("environmentId"),
                a!("confirmed"),
                store,
                runtime,
            )
            .await?,
        ),
        "recover_vm_runtime" => encoded(
            commands::recover_vm_runtime(a!("environmentId"), a!("confirmed"), store, runtime)
                .await?,
        ),
        "rename_environment" => encoded(commands::rename_environment(a!("environmentId"), a!("name"), store).await?),
        "update_resource_policy" => encoded(
            commands::update_resource_policy(
                a!("environmentId"),
                a!("resourcePolicy"),
                store,
                runtime,
            )
            .await?,
        ),
        "configure_resource_limits" => {
            let id: String = a!("environmentId");
            let mut policy = store
                .snapshot()?
                .environments
                .into_iter()
                .find(|e| e.id == id)
                .ok_or("Environment not found")?
                .resource_policy;
            merge_limits(&mut policy, p)?;
            encoded(commands::update_resource_policy(id, policy, store, runtime).await?)
        }
        "reclaim_storage" => encoded(commands::storage::reclaim_storage(store, runtime).await?),
        "get_storage_allocation" => encoded(
            commands::storage::get_storage_allocation(
                a!("environmentId"),
                a!("newVm"),
                store,
                runtime,
            )
            .await?,
        ),
        "expand_environment_storage" => encoded(
            commands::storage::expand_environment_storage(
                a!("environmentId"),
                a!("capacityGb"),
                store,
                runtime,
            )
            .await?,
        ),
        "update_container_network" => encoded(
            commands::update_container_network(a!("environmentId"), a!("enabled"), store, runtime)
                .await?,
        ),
        "update_environment_gpu" => encoded(
            commands::update_environment_gpu(a!("environmentId"), a!("enabled"), store, runtime)
                .await?,
        ),
        "create_connection" => {
            encoded(commands::create_connection(a!("request"), store, runtime).await?)
        }
        "set_connection_active" => encoded(
            commands::set_connection_active(a!("connectionId"), a!("active"), store, runtime)
                .await?,
        ),
        "delete_connection" => {
            encoded(commands::delete_connection(a!("connectionId"), store, runtime).await?)
        }
        "attach_host_folder" => encoded(
            workspace::attach_host_folder(
                a!("environmentId"),
                a!("path"),
                a!("readOnly"),
                store,
                runtime,
                manager,
            )
            .await?,
        ),
        "detach_host_folder" => {
            encoded(workspace::detach_host_folder(a!("shareId"), runtime, manager).await?)
        }
        "list_environment_services" => encoded(
            workspace::list_environment_services(a!("environmentId"), store, runtime, manager)
                .await?,
        ),
        "get_manual_service_ports" => encoded(workspace::get_manual_service_ports(store)?),
        "set_manual_service_port" => encoded(workspace::set_manual_service_port(
            a!("environmentId"),
            a!("port"),
            a!("present"),
            app.clone(),
            store,
        )?),
        // Only reachable over an OS-authenticated local transport. Webview
        // commands retain their original main-window credential restrictions.
        "publish_environment_service" => encoded(
            workspace::publish_service(
                a!("environmentId"),
                a!("port"),
                a!("kind"),
                a!("hostPort"),
                a!("cloudflare"),
                &store,
                &runtime,
                &manager,
            )
            .await?,
        ),
        "unpublish_environment_service" => encoded(
            workspace::unpublish_environment_service(a!("publicationId"), manager, store, runtime)
                .await?,
        ),
        "saved_cloudflare_account" => encoded(
            workspace::cloudflare::saved_for_local_client(
                a!("environmentId"),
                a!("port"),
                &store,
                &manager,
            )
            .await?,
        ),
        "forget_cloudflare_account" => encoded(
            workspace::cloudflare::forget_for_local_client(
                a!("environmentId"),
                a!("port"),
                &store,
                &manager,
            )
            .await?,
        ),
        "create_snapshot" => encoded(
            commands::create_snapshot(a!("environmentId"), a!("name"), store, runtime, backup)
                .await?,
        ),
        "delete_snapshot" => {
            encoded(commands::delete_snapshot(a!("snapshotId"), store, runtime, backup).await?)
        }
        "restore_snapshot" => {
            encoded(commands::restore_snapshot(a!("snapshotId"), store, runtime).await?)
        }
        "export_local_backup" => encoded(
            local_backup::export_local_backup(a!("environmentId"), a!("folder"), store, runtime)
                .await?,
        ),
        "import_local_backup" => encoded(
            local_backup::import_local_backup(
                a!("path"),
                a!("targetProvider"),
                store,
                runtime,
                backup,
            )
            .await?,
        ),
        "add_backup_destination" => {
            encoded(commands::add_backup_destination(a!("request"), store, backup).await?)
        }
        "delete_backup_destination" => encoded(commands::delete_backup_destination(
            a!("destinationId"),
            store,
            backup,
        )?),
        "run_backup" => encoded(
            commands::run_backup(
                a!("environmentId"),
                a!("destinationId"),
                store,
                runtime,
                backup,
            )
            .await?,
        ),
        "restore_backup" => {
            encoded(commands::restore_backup(a!("backupId"), store, runtime, backup).await?)
        }
        "update_settings" => {
            encoded(commands::update_settings(a!("settings"), store, runtime, backup).await?)
        }
        "reset_platform_state" => {
            encoded(commands::reset_platform_state(store, runtime, backup).await?)
        }
        "refresh_host_metrics" => encoded(commands::refresh_host_metrics(store, runtime).await?),
        "get_cuda_runtime_status" => {
            encoded(runtime::cuda::get_cuda_runtime_status(runtime).await?)
        }
        "install_cuda_runtime" => encoded(runtime::cuda::install_cuda_runtime(runtime).await?),
        "verify_environment_cuda" => encoded(
            runtime::cuda::verify_environment_cuda(a!("environmentId"), store, runtime).await?,
        ),
        "get_shared_gpu_settings" => encoded(runtime::gpu::get_shared_gpu_settings(runtime).await?),
        "set_shared_gpu_selection" => {
            encoded(runtime::gpu::set_shared_gpu_selection(a!("selectedId"), runtime).await?)
        }
        "execute_environment_command" => {
            encoded(commands::execute_environment_command(a!("request"), store, runtime).await?)
        }
        "read_environment_console" => {
            encoded(commands::read_environment_console(a!("environmentId"), store, runtime).await?)
        }
        "get_guest_session" => {
            encoded(commands::get_guest_session(a!("environmentId"), store, runtime).await?)
        }
        "terminal_action" => {
            workspace::terminal_action_for_owner(
                a!("environmentId"),
                a!("sessionId"),
                a!("action"),
                a!("data"),
                a!("offset"),
                a!("cols"),
                a!("rows"),
                "cli",
                &store,
                &runtime,
                &manager,
            )
            .await
        }
        "prepare_terminal_installer" | "install_terminal_tool" => {
            let command = workspace::installers::prepare_for_owner(
                a!("environmentId"),
                a!("sessionId"),
                a!("tool"),
                "cli",
                &store,
                &runtime,
                &manager,
            )
            .await?;
            if method == "prepare_terminal_installer" {
                return encoded(command);
            }
            use base64::Engine;
            let data = base64::engine::general_purpose::STANDARD.encode(format!("{command}\r"));
            workspace::terminal_action_for_owner(
                a!("environmentId"),
                a!("sessionId"),
                "write".into(),
                Some(data),
                None,
                None,
                None,
                "cli",
                &store,
                &runtime,
                &manager,
            )
            .await?;
            Ok(
                json!({"started":true,"sessionId":p["sessionId"],"message":"Read this terminal's output for install progress and result."}),
            )
        }
        "micro_vm_apps" => {
            guest_apps::micro_vm_apps(
                a!("environmentId"),
                a!("action"),
                a!("sessionId"),
                a!("name"),
                a!("command"),
                a!("package"),
                store,
                runtime,
            )
            .await
        }
        "open_environment_window" => encoded(
            commands::open_environment_window(a!("environmentId"), app.clone(), store).await?,
        ),
        "open_micro_vm_app_window" => encoded(
            guest_apps::open_micro_vm_app_window(
                a!("environmentId"),
                a!("sessionId"),
                app.clone(),
                store,
            )
            .await?,
        ),
        "close_environment_window" => encoded(commands::close_environment_window(window()?)?),
        "list_environment_windows" => encoded(workspace::list_environment_windows(app.clone())),
        "focus_environment_window" => encoded(workspace::focus_environment_window(
            a!("label"),
            app.clone(),
        )?),
        "title_environment_window" => encoded(workspace::title_environment_window(
            a!("environmentId"),
            window()?,
            store,
        )?),
        "set_guest_keyboard_capture" => encoded(guest_keyboard::set_guest_keyboard_capture(
            window()?,
            a!("token"),
            a!("bounds"),
        )?),
        "open_workspace_url" => encoded(workspace::open_workspace_url(a!("url"))?),
        "app_show" => {
            if let Some(window) = app.get_webview_window("main") {
                window.show().map_err(|e| e.to_string())?;
                window.unminimize().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            } else {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == "main")
                    .ok_or("Dashboard configuration missing")?;
                tauri::WebviewWindowBuilder::from_config(app, config)
                    .map_err(|e| e.to_string())?
                    .build()
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({"visible":true}))
        }
        "app_quit" => {
            // Complete the acknowledgement before the event loop exits. The
            // normal ExitRequested handler gracefully tears down all runtimes.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                app.exit(0);
            });
            Ok(json!({"shutdownRequested":true}))
        }
        _ => Err(format!("No backend handler for {method}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_resource_edits_preserve_other_limits_and_priority() {
        let mut policy:ResourcePolicy=serde_json::from_value(json!({"cpu":{"min":1,"preferred":2,"max":4,"current":2},"memoryGb":{"min":1,"preferred":4,"max":8,"current":4},"priority":"high"})).unwrap();
        merge_limits(&mut policy, &json!({"cpu":{"preferred":3}})).unwrap();
        assert_eq!(policy.cpu.preferred, 3.0);
        assert_eq!(policy.memory_gb.preferred, 4.0);
        assert_eq!(policy.priority, Priority::High);
        assert!(merge_limits(&mut policy, &json!({"cpu":{"preferrred":8}})).is_err());
        assert!(merge_limits(&mut policy, &json!({"cpu":{"preferred":9}})).is_err());
    }
    #[test]
    fn every_desktop_command_has_a_cli_contract_and_dispatch() {
        let source = include_str!("../lib.rs");
        let handlers = source
            .split("tauri::generate_handler![")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap();
        let dispatch = include_str!("dispatch.rs");
        for line in handlers.lines() {
            let name = line
                .trim()
                .trim_end_matches(',')
                .rsplit("::")
                .next()
                .unwrap_or("");
            if name.is_empty() {
                continue;
            }
            yougori_cli::catalog::find(name)
                .unwrap_or_else(|_| panic!("Missing CLI contract for desktop command {name}"));
            assert!(
                dispatch.contains(&format!("\"{name}\"")),
                "Missing dispatch for {name}"
            );
        }
        for method in yougori_cli::catalog::methods() {
            validate(method.name, &method.example)
                .unwrap_or_else(|e| panic!("{}: {e}", method.name));
        }
    }
}
