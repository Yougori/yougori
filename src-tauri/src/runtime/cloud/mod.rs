//! Existing servers only: pinned SSH, an ephemeral unprivileged connector, no
//! cloud account API, power operations, host/LAN routing or public listeners.
mod bridge;
use super::{connection_files::SharedFiles, fabric::Fabric};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    pub vendor: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub identity_file: String,
    pub host_key: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    pub key: String,
    pub fingerprint: String,
}
/// Environment console = file browser; control = SOCKS proxy. Neither is a
/// host listener: these loopback addresses belong to the connected server.
pub fn endpoints(info: &Value) -> Result<(Option<String>, Option<String>), String> {
    let port = |field: &str| {
        info[field]
            .as_u64()
            .filter(|p| (1..=65535).contains(p))
            .ok_or_else(|| "Cloud connector returned an invalid endpoint".to_string())
    };
    if info["platform"] != "linux" {
        return Err("Cloud connections require a Linux SSH server with Python 3".into());
    }
    Ok((
        Some(format!("http://127.0.0.1:{}", port("filesPort")?)),
        Some(format!("socks5h://127.0.0.1:{}", port("socksPort")?)),
    ))
}
pub fn validate(profile: &Profile, key_required: bool) -> Result<(), String> {
    if !(2..=80).contains(&profile.name.trim().len()) {
        return Err("Use a name between 2 and 80 characters".into());
    }
    if !["aws", "google", "azure", "other"].contains(&profile.vendor.as_str()) {
        return Err("Choose a cloud provider".into());
    }
    validate_host(&profile.host, profile.port)?;
    if profile.username.is_empty()
        || profile.username.len() > 64
        || profile.username.starts_with('-')
        || !profile
            .username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return Err("Enter a valid SSH username".into());
    }
    let key = Path::new(&profile.identity_file);
    if !key.is_absolute() || !key.is_file() {
        return Err(
            "Choose an existing SSH private key file (or its public key loaded in your SSH agent)"
                .into(),
        );
    }
    if profile.identity_file.contains(['\n', '\r', '\0']) {
        return Err("Invalid identity file".into());
    }
    if key_required {
        parse_key(&profile.host_key)?;
    }
    Ok(())
}
fn validate_host(host: &str, port: u16) -> Result<(), String> {
    if port == 0
        || host.is_empty()
        || host.len() > 253
        || !host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-:".contains(&c))
        || host.starts_with(['-', '.'])
    {
        return Err("Enter a hostname or IP address and an SSH port from 1 to 65535".into());
    }
    Ok(())
}
fn parse_key(key: &str) -> Result<HostKey, String> {
    let parts: Vec<_> = key.split(' ').collect();
    if parts.len() != 2
        || !["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"].contains(&parts[0])
        || parts[1].len() > 8192
    {
        return Err("Invalid SSH host key".into());
    }
    let bytes = B64
        .decode(parts[1])
        .map_err(|_| "Invalid SSH host key encoding")?;
    if bytes.len() < 16 {
        return Err("Invalid SSH host key".into());
    }
    Ok(HostKey {
        key: key.into(),
        fingerprint: format!(
            "SHA256:{}",
            B64.encode(Sha256::digest(bytes)).trim_end_matches('=')
        ),
    })
}
fn command(name: &str) -> Command {
    #[cfg(target_os = "windows")]
    let binary = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|p| p.join("System32/OpenSSH").join(format!("{name}.exe")))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| name.into());
    #[cfg(not(target_os = "windows"))]
    let binary = PathBuf::from(name);
    let mut cmd = Command::new(binary);
    cmd.kill_on_drop(true);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd
}
pub async fn scan(host: String, port: u16) -> Result<Vec<HostKey>, String> {
    validate_host(&host, port)?;
    let mut child = command("ssh-keyscan")
        .args([
            "-T",
            "5",
            "-p",
            &port.to_string(),
            "-t",
            "ed25519,ecdsa,rsa",
            &host,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("OpenSSH client is required: {e}"))?;
    let mut output = vec![];
    tokio::time::timeout(
        Duration::from_secs(12),
        child
            .stdout
            .take()
            .unwrap()
            .take(32769)
            .read_to_end(&mut output),
    )
    .await
    .map_err(|_| "Server identity check timed out")?
    .map_err(|e| e.to_string())?;
    let _ = child.kill().await;
    let _ = child.wait().await;
    if output.len() > 32768 {
        return Err("Server identity response was too large. No key was trusted.".into());
    }
    let mut keys = vec![];
    for line in String::from_utf8_lossy(&output).lines().take(20) {
        if line.starts_with('#') {
            continue;
        }
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() == 3 {
            if let Ok(key) = parse_key(&format!("{} {}", parts[1], parts[2])) {
                if !keys.iter().any(|k: &HostKey| k.key == key.key) {
                    keys.push(key);
                }
            }
        }
    }
    if keys.is_empty() {
        return Err("Cannot reach the SSH server. Check its address, SSH port, firewall and VPN. No server was trusted.".into());
    }
    Ok(keys)
}
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;
#[derive(Clone)]
pub(crate) struct Session {
    pub tx: mpsc::Sender<Value>,
    pending: Pending,
    stop: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    pub bridge: mpsc::Sender<Value>,
    pub info: Value,
}
impl Session {
    pub async fn request(&self, path: &str, body: Value) -> Result<Value, String> {
        rpc(&self.tx, &self.pending, path, body).await
    }
    fn close(&self) {
        if let Some(stop) = self.stop.lock().unwrap().take() {
            let _ = stop.send(());
        }
    }
}
async fn rpc(
    tx: &mpsc::Sender<Value>,
    pending: &Pending,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (send, receive) = oneshot::channel();
    {
        let mut pending = pending.lock().unwrap();
        if pending.len() >= 64 {
            return Err("Cloud connection is busy".into());
        }
        pending.insert(id.clone(), send);
    }
    let result = tokio::time::timeout(Duration::from_secs(25), async {
        tx.send(json!({"requestId":id,"path":path,"body":body}))
            .await
            .map_err(|_| "Cloud connection is closed")?;
        receive
            .await
            .map_err(|_| "Cloud connection was interrupted")?
    })
    .await
    .map_err(|_| "Cloud operation timed out".to_string())
    .and_then(|v| v);
    pending.lock().unwrap().remove(&id);
    result
}
pub struct Cloud {
    root: PathBuf,
    sessions: tokio::sync::Mutex<HashMap<String, Session>>,
}
impl Cloud {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            sessions: Default::default(),
        }
    }
    fn directory(&self, id: &str) -> Result<PathBuf, String> {
        if !id.starts_with("env-")
            || id.len() > 80
            || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("Invalid cloud node ID".into());
        }
        Ok(self.root.join(id))
    }
    pub fn save(&self, id: &str, profile: &Profile) -> Result<(), String> {
        validate(profile, true)?;
        let dir = self.directory(id)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let host = if profile.port == 22 {
            profile.host.clone()
        } else {
            format!("[{}]:{}", profile.host, profile.port)
        };
        // Only a public host key and the path to a user-selected private key are
        // persisted. Private key material never enters platform state or logs.
        std::fs::write(
            dir.join("known_hosts"),
            format!("{host} {}\n", profile.host_key),
        )
        .map_err(|e| e.to_string())?;
        std::fs::write(
            dir.join("profile.json"),
            serde_json::to_vec(profile).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
    pub fn profile(&self, id: &str) -> Result<Profile, String> {
        let bytes = std::fs::read(self.directory(id)?.join("profile.json"))
            .map_err(|e| format!("Read cloud connection settings: {e}"))?;
        if bytes.len() > 16384 {
            return Err("Cloud profile is too large".into());
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid cloud profile: {e}"))
    }
    pub fn forget(&self, id: &str) -> Result<(), String> {
        let dir = self.directory(id)?;
        if !dir.exists() {
            return Ok(());
        }
        let resolved = dir.canonicalize().map_err(|e| e.to_string())?;
        let root = self.root.canonicalize().map_err(|e| e.to_string())?;
        if resolved.parent() != Some(root.as_path()) {
            return Err("Cloud metadata path is outside its storage folder".into());
        }
        // Only Yougori's own metadata, never the user's selected identity file
        // or connection-owned shared data. No recursive deletion.
        for name in ["profile.json", "known_hosts"] {
            match std::fs::remove_file(dir.join(name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        let _ = std::fs::remove_dir(dir);
        Ok(())
    }
    pub async fn session(&self, id: &str) -> Result<Session, String> {
        self.sessions.lock().await.get(id).filter(|s|!s.tx.is_closed()).cloned().ok_or_else(||"Cloud server is disconnected. Choose Connect; Yougori will not start or stop the server.".into())
    }
    pub async fn connected(&self, id: &str) -> bool {
        self.session(id).await.is_ok()
    }
    pub async fn disconnect(&self, id: &str) {
        if let Some(session) = self.sessions.lock().await.remove(id) {
            session.close();
        }
    }
    pub async fn shutdown(&self) {
        for (_, session) in self.sessions.lock().await.drain() {
            session.close();
        }
    }
    pub async fn connect(
        &self,
        id: &str,
        fabric: Fabric,
        files: SharedFiles,
    ) -> Result<Value, String> {
        if let Ok(session) = self.session(id).await {
            return Ok(session.info);
        }
        let profile = self.profile(id)?;
        validate(&profile, true)?;
        let known = self.directory(id)?.join("known_hosts");
        let mut cmd = command("ssh");
        cmd.args([
            "-F",
            "none",
            "-T",
            "-a",
            "-x",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "UpdateHostKeys=no",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=10",
            "-o",
            "ServerAliveCountMax=2",
            "-o",
            "PermitLocalCommand=no",
            "-o",
            "GlobalKnownHostsFile=none",
            "-o",
        ]);
        cmd.arg(format!("UserKnownHostsFile=\"{}\"", known.display()))
            .arg("-i")
            .arg(&profile.identity_file)
            .arg("-p")
            .arg(profile.port.to_string())
            .arg("-l")
            .arg(&profile.username)
            .arg(&profile.host);
        // ASCII base64 avoids command-shell interpolation, Unicode and quoting
        // differences. The connector is held in memory, not installed remotely.
        cmd.arg(format!(
            "python3 -u -c \"import base64;exec(base64.b64decode('{}'))\"",
            B64.encode(include_bytes!("agent.py"))
        ));
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("OpenSSH client is required: {e}"))?;
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (tx, mut rx) = mpsc::channel::<Value>(128);
        let (bridge_tx, bridge_rx) = mpsc::channel(128);
        let pending: Pending = Default::default();
        let (stop, stopped) = oneshot::channel();
        let session = Session {
            tx: tx.clone(),
            pending: pending.clone(),
            stop: Arc::new(Mutex::new(Some(stop))),
            bridge: bridge_tx.clone(),
            info: Value::Null,
        };
        let own = id.to_owned();
        let task_session = session.clone();
        tokio::spawn(async move {
            let mut tasks = tokio::task::JoinSet::new();
            let errors = Arc::new(Mutex::new(Vec::new()));
            let error_copy = errors.clone();
            tasks.spawn(async move {
                let mut bytes = vec![];
                let _ = stderr.take(16384).read_to_end(&mut bytes).await;
                *error_copy.lock().unwrap() = bytes;
            });
            let io = async {
                let writer = async {
                    while let Some(frame) = rx.recv().await {
                        let mut bytes = serde_json::to_vec(&frame).map_err(|e| e.to_string())?;
                        bytes.push(b'\n');
                        stdin.write_all(&bytes).await.map_err(|e| e.to_string())?;
                    }
                    Ok::<(), String>(())
                };
                let reader = async {
                    let mut reader = BufReader::new(stdout);
                    loop {
                        let mut bytes = Vec::new();
                        let n = (&mut reader)
                            .take(2 * 1024 * 1024 + 1)
                            .read_until(b'\n', &mut bytes)
                            .await
                            .map_err(|e| e.to_string())?;
                        if n == 0 || n > 2 * 1024 * 1024 {
                            return Err("Cloud connector ended or sent an invalid frame".into());
                        }
                        let frame: Value = serde_json::from_slice(&bytes)
                            .map_err(|_| "Cloud connector returned invalid data")?;
                        if let Some(event) = frame["event"].as_str() {
                            if event == "files" {
                                if tasks.len() > 32 {
                                    return Err("Too many cloud file requests".into());
                                }
                                let tx = tx.clone();
                                let files = files.clone();
                                let own = own.clone();
                                tasks.spawn(async move {
                                    let response=match B64.decode(frame["data"].as_str().unwrap_or("")) { Ok(data) if data.len()<=1024*1024+32768=>json!({"requestId":frame["requestId"],"result":B64.encode(files.http(&own,&data).await)}), _=>json!({"requestId":frame["requestId"],"error":"Invalid file request"}) };
                                    let _=tx.send(response).await;
                                });
                            } else {
                                bridge_tx
                                    .send(frame)
                                    .await
                                    .map_err(|_| "Private cloud bridge closed")?;
                            }
                        } else if let Some(key) = frame["requestId"].as_str() {
                            if let Some(send) = pending.lock().unwrap().remove(key) {
                                let _ = send.send(if let Some(error) = frame["error"].as_str() {
                                    Err(error.into())
                                } else {
                                    Ok(frame["result"].clone())
                                });
                            }
                        }
                        while tasks.try_join_next().is_some() {}
                    }
                };
                tokio::select! { result=writer=>result, result=reader=>result }
            };
            tokio::select! { _=stopped=>{}, _=io=>{} }
            let _ = child.kill().await;
            let _ = child.wait().await;
            // Let stderr finish before surfacing useful authentication/setup errors.
            let _ = tokio::time::timeout(Duration::from_millis(100), async {
                while tasks.join_next().await.is_some() {}
            })
            .await;
            let detail = String::from_utf8_lossy(&errors.lock().unwrap())
                .trim()
                .to_owned();
            let message = if detail.is_empty() {
                "Cloud connection closed. Check SSH connectivity and retry Connect.".into()
            } else {
                format!("Could not connect over SSH: {detail}\nRequires a Linux server with Python 3 and key-based SSH. For an encrypted key, unlock it in your SSH agent first. The server was not powered off.")
            };
            for (_, send) in task_session.pending.lock().unwrap().drain() {
                let _ = send.send(Err(message.clone()));
            }
            tasks.abort_all();
            let _ = task_session.bridge.send(json!({"event":"shutdown"})).await;
        });
        let info = match session.request("health", json!({})).await {
            Ok(info) => info,
            Err(error) => {
                session.close();
                return Err(error);
            }
        };
        if let Err(error) = endpoints(&info) {
            session.close();
            return Err(error);
        }
        if let Err(error) = bridge::start(id, fabric, session.clone(), bridge_rx).await {
            session.close();
            return Err(error);
        }
        let session = Session {
            info: info.clone(),
            ..session
        };
        self.sessions.lock().await.insert(id.into(), session);
        Ok(info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_endpoints_keep_browser_and_proxy_in_the_correct_fields() {
        assert_eq!(
            endpoints(&json!({"platform":"linux","socksPort":1234,"filesPort":5678})).unwrap(),
            (
                Some("http://127.0.0.1:5678".into()),
                Some("socks5h://127.0.0.1:1234".into())
            )
        );
        for info in [
            json!({"platform":"win32","socksPort":1234,"filesPort":5678}),
            json!({"platform":"linux","socksPort":0,"filesPort":5678}),
            json!({"platform":"linux","socksPort":1234,"filesPort":65536}),
        ] {
            assert!(endpoints(&info).is_err());
        }
    }
    #[test]
    fn rejects_option_and_shell_injection() {
        for h in [
            "-oProxyCommand=calc",
            "x;touch",
            "user@host",
            "host\nfoo",
            "host/path",
            "",
        ] {
            assert!(validate_host(h, 22).is_err());
        }
        assert!(validate_host("ec2.example.com", 22).is_ok());
        assert!(validate_host("2001:db8::1", 22).is_ok());
        assert!(validate_host("host", 0).is_err());
        assert!(parse_key("ssh-ed25519 bad\ninjected key").is_err());
    }
    #[test]
    fn profile_paths_cannot_escape_root() {
        let cloud = Cloud::new("root".into());
        for id in ["../x", "env-../x", "env-a/b", "env-C:\\x"] {
            assert!(cloud.directory(id).is_err());
        }
    }
    #[test]
    fn removing_cloud_metadata_preserves_selected_key_and_unrelated_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("cloud");
        let dir = root.join("env-test");
        std::fs::create_dir_all(&dir).unwrap();
        let key = temp.path().join("private-key.pem");
        std::fs::write(&key, "fixture-only").unwrap();
        std::fs::write(dir.join("profile.json"), "{}").unwrap();
        std::fs::write(dir.join("known_hosts"), "public key").unwrap();
        std::fs::write(dir.join("keep.txt"), "keep").unwrap();
        Cloud::new(root).forget("env-test").unwrap();
        assert!(key.is_file());
        assert!(dir.join("keep.txt").is_file());
        assert!(!dir.join("profile.json").exists());
        assert!(!dir.join("known_hosts").exists());
    }
}
