//! Connection-owned folders. No guest disks or arbitrary host folders are exposed.
#[cfg(test)]
mod tests;
use super::RuntimeManager;
use crate::{
    host_files::HostFolderServer,
    models::{ConnectionDirection, Environment, EnvironmentKind, PermissionKind},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub const GUEST_URL: &str = "http://10.192.0.1:7444";
#[derive(Default, Clone)]
pub struct SharedFiles(Arc<Mutex<HashMap<String, Arc<Share>>>>);
struct Share {
    environments: [Environment; 2],
    source: String,
    target: String,
    label: String,
    both: bool,
    source_server: HostFolderServer,
    target_server: HostFolderServer,
}
fn storage_permission(permissions: &[PermissionKind]) -> bool {
    permissions.iter().any(|p| {
        matches!(
            p,
            PermissionKind::Files | PermissionKind::Volumes | PermissionKind::Data
        )
    })
}
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
impl SharedFiles {
    pub fn remove(&self, id: &str) {
        if let Some(share) = self.0.lock().unwrap().remove(id) {
            share.source_server.stop();
            share.target_server.stop();
        }
    }
    pub fn remove_environment(&self, id: &str) {
        self.0.lock().unwrap().retain(|_, s| {
            if s.source == id || s.target == id {
                s.source_server.stop();
                s.target_server.stop();
                false
            } else {
                true
            }
        });
    }
    pub fn available(&self, environment: &str) -> bool {
        self.0
            .lock()
            .unwrap()
            .values()
            .any(|s| s.source == environment || s.target == environment)
    }
    pub async fn http(&self, environment: &str, request: &[u8]) -> Vec<u8> {
        let result = self.handle(environment, request).await;
        let (status, kind, body) = match result {
            Ok(v) => v,
            Err(error) => (
                403,
                "application/json",
                serde_json::to_vec(&json!({"error":error})).unwrap(),
            ),
        };
        let csp = format!("default-src 'none'; script-src 'sha256-{}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", script_hash());
        let mut response = format!("HTTP/1.1 {status} Response\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {csp}\r\n\r\n", body.len()).into_bytes();
        response.extend(body);
        response
    }
    async fn handle(
        &self,
        environment: &str,
        request: &[u8],
    ) -> Result<(u16, &'static str, Vec<u8>), String> {
        let split = request
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or("Invalid request")?;
        let header = std::str::from_utf8(&request[..split]).map_err(|_| "Invalid headers")?;
        let mut first = header.lines().next().unwrap_or_default().split_whitespace();
        let method = first.next().unwrap_or_default();
        let uri = first.next().unwrap_or_default();
        // Reject DNS rebinding and cross-origin form/fetch attacks. No CORS headers.
        if !header.lines().any(|l| {
            l.split_once(':').is_some_and(|(k, v)| {
                k.eq_ignore_ascii_case("host") && v.trim() == "10.192.0.1:7444"
            })
        }) {
            return Err("Invalid file service host".into());
        }
        if header.lines().any(|l| {
            l.split_once(':')
                .is_some_and(|(k, v)| k.eq_ignore_ascii_case("origin") && v.trim() != GUEST_URL)
        }) {
            return Err("Cross-origin file access is blocked".into());
        }
        if method == "GET" && uri == "/" {
            return Ok((
                200,
                "text/html; charset=utf-8",
                include_bytes!("connection_files.html").to_vec(),
            ));
        }
        if method == "GET" && uri == "/connections" {
            let shares = self.0.lock().unwrap();
            let entries: Vec<_> = shares.iter().filter(|(_,s)| s.source == environment || s.target == environment).map(|(id,s)| json!({"id":id,"label":s.label,"writable":s.source == environment || s.both})).collect();
            return Ok((
                200,
                "application/json",
                serde_json::to_vec(&entries).unwrap(),
            ));
        }
        if method != "POST"
            || uri != "/api"
            || !header.lines().any(|l| {
                l.split_once(':').is_some_and(|(k, v)| {
                    k.eq_ignore_ascii_case("x-opendock-files") && v.trim() == "1"
                })
            })
        {
            return Err("Use the shared files API with X-OpenDock-Files: 1".into());
        }
        let mut body: Value =
            serde_json::from_slice(&request[split + 4..]).map_err(|_| "Invalid file request")?;
        let id = body
            .get("connectionId")
            .and_then(Value::as_str)
            .ok_or("Choose a connection")?
            .to_owned();
        let share = self
            .0
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or("This connection is disconnected")?;
        let server = if share.source == environment {
            &share.source_server
        } else if share.target == environment {
            &share.target_server
        } else {
            return Err("This environment cannot access that connection".into());
        };
        body.as_object_mut()
            .ok_or("Invalid file request")?
            .remove("connectionId");
        // Reuse the authenticated, path-confined and read-only-enforcing file API.
        static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
        let reply = CLIENT
            .get_or_init(reqwest::Client::new)
            .post(format!("http://127.0.0.1:{}/files", server.port))
            .bearer_auth(&server.token)
            .json(&body)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|_| "Shared folder is unavailable")?;
        let status = reply.status().as_u16();
        let bytes = reply
            .bytes()
            .await
            .map_err(|_| "File operation failed")?
            .to_vec();
        if !self
            .0
            .lock()
            .unwrap()
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, &share))
        {
            return Err("This connection was disconnected".into());
        }
        Ok((status, "application/json", bytes))
    }
}
fn script_hash() -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let html = include_str!("connection_files.html");
    let script = html
        .split_once("<script>")
        .unwrap()
        .1
        .split_once("</script>")
        .unwrap()
        .0;
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()))
}

impl RuntimeManager {
    pub async fn remove_shared_files(&self, id: &str) {
        let environments = self
            .shared_files
            .0
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.environments.clone());
        self.shared_files.remove(id);
        if let Some(environments) = environments {
            for env in environments {
                if !matches!(env.kind, EnvironmentKind::FullVm | EnvironmentKind::Cloud) {
                    let endpoint_id = env.runtime_id.as_deref().unwrap_or(&env.id);
                    let _ = self
                        .workspace_request(
                            &env,
                            "/v1/shares/detach",
                            json!({"id":endpoint_id,"shareId":id}),
                        )
                        .await;
                }
            }
        }
    }
    pub async fn apply_shared_files(
        &self,
        id: &str,
        source: &Environment,
        target: &Environment,
        direction: &ConnectionDirection,
        permissions: &[PermissionKind],
    ) -> Result<(), String> {
        if !storage_permission(permissions) {
            self.remove_shared_files(id).await;
            return Ok(());
        }
        if !safe_id(id) {
            return Err("Invalid connection identifier".into());
        }
        let source_id = source.runtime_id.as_deref().unwrap_or(&source.id);
        let target_id = target.runtime_id.as_deref().unwrap_or(&target.id);
        let both = *direction == ConnectionDirection::Bidirectional;
        let existing = self.shared_files.0.lock().unwrap().get(id).cloned();
        let share = match existing
            .filter(|s| s.source == source_id && s.target == target_id && s.both == both)
        {
            Some(s) => s,
            None => {
                let parent = self.data_root.join("connection-files");
                std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
                let parent = parent.canonicalize().map_err(|e| e.to_string())?;
                let root = parent.join(id);
                if !root.exists() {
                    std::fs::create_dir(&root).map_err(|e| e.to_string())?;
                }
                let meta = std::fs::symlink_metadata(&root).map_err(|e| e.to_string())?;
                if !meta.is_dir()
                    || meta.file_type().is_symlink()
                    || root.canonicalize().map_err(|e| e.to_string())? != root
                {
                    return Err("Unsafe connection folder".into());
                }
                self.shared_files.remove(id);
                Arc::new(Share {
                    environments: [source.clone(), target.clone()],
                    source: source_id.into(),
                    target: target_id.into(),
                    label: format!("{} ↔ {}", source.name, target.name),
                    both,
                    source_server: HostFolderServer::start(root.clone(), false).await?,
                    target_server: HostFolderServer::start(root, !both).await?,
                })
            }
        };
        // Publish first so mounted clients can reach their endpoint; rollback on error.
        self.shared_files
            .0
            .lock()
            .unwrap()
            .insert(id.into(), share.clone());
        for (env, server, read_only) in [
            (source, &share.source_server, false),
            (target, &share.target_server, !both),
        ] {
            if matches!(env.kind, EnvironmentKind::FullVm | EnvironmentKind::Cloud) {
                continue;
            }
            // Custom MicroVMs without our agent can still use the browser/API.
            if env.kind == EnvironmentKind::MicroVm && self.workspace_endpoint(env).await.is_err() {
                continue;
            }
            let endpoint_id = env.runtime_id.as_deref().unwrap_or(&env.id);
            let endpoint = match self.host_folder_endpoint(env, server).await {
                Ok(endpoint) => endpoint,
                Err(error) => {
                    self.remove_shared_files(id).await;
                    return Err(format!("Shared files: {error}"));
                }
            };
            let result = self.workspace_request(env,"/v1/shares/attach",json!({"id":endpoint_id,"shareId":id,"endpoint":endpoint,"token":server.token,"readOnly":read_only,"connection":true})).await;
            if let Err(error) = result {
                self.remove_shared_files(id).await;
                return Err(format!("Shared files: {error}. Restart older containers/MicroVMs to load the updated agent, then retry the connection."));
            }
        }
        Ok(())
    }
}
