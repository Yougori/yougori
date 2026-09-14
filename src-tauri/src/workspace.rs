use crate::{
    host_files::HostFolderServer,
    models::{Environment, EnvironmentKind, EnvironmentStatus},
    runtime::RuntimeManager,
    store::PlatformStore,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    process::Child,
    sync::Mutex,
    task::JoinHandle,
};
use uuid::Uuid;

pub mod cloudflare;
pub mod installers;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PublicationKind {
    Local,
    Public,
    Cloudflare,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication {
    pub id: String,
    pub environment_id: String,
    pub port: u16,
    pub kind: PublicationKind,
    pub host_port: u16,
    pub urls: Vec<String>,
    pub status: String,
    pub message: String,
    pub cloudflare_account: bool,
}
struct LivePublication {
    info: Publication,
    task: JoinHandle<()>,
    cloudflare: Option<Child>,
    logs: Option<JoinHandle<()>>,
    tunnel_id: Option<String>,
    _cloudflare_config: Option<cloudflare::ConfigFile>,
    _vm_forward: Option<VmForward>,
}
struct VmForward(u16, u16);
impl Drop for VmForward {
    fn drop(&mut self) {
        let (qmp, port) = (self.0, self.1);
        tokio::spawn(async move {
            RuntimeManager::remove_workspace_vm_port(qmp, port).await;
        });
    }
}
impl Drop for LivePublication {
    fn drop(&mut self) {
        self.task.abort();
        if let Some(logs) = &self.logs {
            logs.abort();
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostShare {
    pub id: String,
    pub environment_id: String,
    pub path: String,
    pub read_only: bool,
    pub mount_path: Option<String>,
    pub guest_url: String,
}
struct LiveShare {
    info: HostShare,
    environment: Environment,
    _server: HostFolderServer,
}
#[derive(Clone)]
struct TerminalLease {
    environment: Environment,
    owner: String,
}
pub struct WorkspaceManager {
    root: PathBuf,
    publications: Mutex<HashMap<String, LivePublication>>,
    shares: Mutex<HashMap<String, LiveShare>>,
    terminals: Mutex<HashMap<String, TerminalLease>>,
    operations: Mutex<()>,
    local_ports_key: Mutex<String>,
}
impl WorkspaceManager {
    pub async fn host_shares_for(&self, environment_id: &str) -> Vec<HostShare> {
        let mut shares = self
            .shares
            .lock()
            .await
            .values()
            .filter(|share| share.info.environment_id == environment_id)
            .map(|share| share.info.clone())
            .collect::<Vec<_>>();
        shares.sort_by(|a, b| a.id.cmp(&b.id));
        shares
    }
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.into(),
            publications: Mutex::new(HashMap::new()),
            shares: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            operations: Mutex::new(()),
            local_ports_key: Mutex::new(String::new()),
        }
    }
    pub async fn cleanup(&self, store: &PlatformStore, runtime: &RuntimeManager) {
        let Ok(state) = store.snapshot() else { return };
        let running = |id: &str| {
            state
                .environments
                .iter()
                .any(|e| e.id == id && e.status == EnvironmentStatus::Running)
        };
        let mut routes = self.publications.lock().await;
        let stale = routes
            .iter()
            .filter(|(_, p)| !running(&p.info.environment_id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in stale {
            routes.remove(&id);
        }
        for route in routes.values_mut() {
            if let Some(child) = route.cloudflare.as_mut() {
                if child.try_wait().ok().flatten().is_some() {
                    route.info.status = "error".into();
                    route.info.message =
                        "Cloudflare Tunnel disconnected. Remove and reconnect it.".into();
                    route.info.urls.clear();
                }
            }
        }
        drop(routes);
        let stale_shares = self
            .shares
            .lock()
            .await
            .iter()
            .filter(|(_, share)| !running(&share.info.environment_id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in stale_shares {
            self.remove_share(&id, runtime).await;
        }
        let mut sessions = self.terminals.lock().await;
        let stale = sessions
            .iter()
            .filter(|(_, lease)| !running(&lease.environment.id))
            .map(|(id, lease)| (id.clone(), lease.clone()))
            .collect::<Vec<_>>();
        for (id, _) in &stale {
            sessions.remove(id);
        }
        drop(sessions);
        for (id, lease) in stale {
            let _ = runtime
                .workspace_request(
                    &lease.environment,
                    "/v1/terminal/close",
                    json!({"id":runtime_id(&lease.environment),"sessionId":id}),
                )
                .await;
        }
        let _ = self.sync_local_ports(store, runtime).await;
    }
    pub async fn sync_local_ports(
        &self,
        store: &PlatformStore,
        runtime: &RuntimeManager,
    ) -> Result<(), String> {
        let mut last_key = self.local_ports_key.lock().await;
        let mut ports = self
            .publications
            .lock()
            .await
            .values()
            .filter(|p| p.info.kind == PublicationKind::Local)
            .map(|p| p.info.host_port)
            .collect::<Vec<_>>();
        ports.sort();
        ports.dedup();
        let state = store.snapshot()?;
        let mut environments = state
            .environments
            .into_iter()
            .filter(|e| {
                e.kind == EnvironmentKind::Container
                    && e.network_access
                    && e.status == EnvironmentStatus::Running
            })
            .collect::<Vec<_>>();
        environments.sort_by(|a, b| a.id.cmp(&b.id));
        let ids = environments
            .iter()
            .map(|e| runtime_id(e).to_owned())
            .collect::<Vec<_>>();
        let host_address = lan_address();
        let key = serde_json::to_string(&json!([ports, ids, host_address])).map_err(|e| e.to_string())?;
        if *last_key == key || (last_key.is_empty() && ports.is_empty()) {
            return Ok(());
        }
        runtime.update_local_service_ports(&ids, &ports, &host_address).await?;
        *last_key = key;
        Ok(())
    }
    pub async fn remove_share(&self, id: &str, runtime: &RuntimeManager) {
        let share = self.shares.lock().await.remove(id);
        if let Some(share) = share {
            let env = share.environment.clone();
            let mounted = share.info.mount_path.is_some();
            // Revoke host access before waiting for the guest to unmount it.
            drop(share);
            if mounted {
                let _ = runtime
                    .workspace_request(
                        &env,
                        "/v1/shares/detach",
                        json!({"id":runtime_id(&env),"shareId":id}),
                    )
                    .await;
            }
        }
    }
    pub async fn shutdown(&self, runtime: &RuntimeManager) {
        self.publications.lock().await.clear();
        // Revoke all file servers immediately; the runtime shuts down the guest mounts next.
        self.shares.lock().await.clear();
        self.terminals.lock().await.clear();
        let _ = runtime;
    }
    pub async fn close_window(
        &self,
        window: &str,
        _store: &PlatformStore,
        runtime: &RuntimeManager,
    ) {
        let sessions = self
            .terminals
            .lock()
            .await
            .iter()
            .filter(|(_, lease)| lease.owner == window)
            .map(|(session, lease)| (session.clone(), lease.clone()))
            .collect::<Vec<_>>();
        for (session, lease) in sessions {
            self.terminals.lock().await.remove(&session);
            let env = lease.environment;
            let _ = runtime
                .workspace_request(
                    &env,
                    "/v1/terminal/close",
                    json!({"id":runtime_id(&env),"sessionId":session}),
                )
                .await;
        }
    }
}
fn runtime_id(env: &Environment) -> &str {
    env.runtime_id.as_deref().unwrap_or(&env.id)
}
fn environment(store: &PlatformStore, id: &str) -> Result<Environment, String> {
    let env = store
        .snapshot()?
        .environments
        .into_iter()
        .find(|e| e.id == id)
        .ok_or("Environment not found")?;
    if env.status != EnvironmentStatus::Running {
        return Err("Start the environment first".into());
    }
    Ok(env)
}
fn background(command: &mut tokio::process::Command) {
    command.kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x08000000);
    }
}
fn private_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v| private_peer(IpAddr::V4(v)))
        }
    }
}
fn lan_address() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.0.2.1:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

#[tauri::command]
pub async fn terminal_action(
    environment_id: String,
    session_id: String,
    action: String,
    data: Option<String>,
    offset: Option<u64>,
    cols: Option<u16>,
    rows: Option<u16>,
    window: WebviewWindow,
    store: State<'_, PlatformStore>,
    runtime: State<'_, RuntimeManager>,
    manager: State<'_, WorkspaceManager>,
) -> Result<Value, String> {
    terminal_action_for_owner(environment_id, session_id, action, data, offset, cols, rows, window.label(), &store, &runtime, &manager).await
}

pub(crate) async fn terminal_action_for_owner(
    environment_id: String,
    session_id: String,
    action: String,
    data: Option<String>,
    offset: Option<u64>,
    cols: Option<u16>,
    rows: Option<u16>,
    owner: &str,
    store: &PlatformStore,
    runtime: &RuntimeManager,
    manager: &WorkspaceManager,
) -> Result<Value, String> {
    if !session_id.starts_with("term-")
        || session_id.len() > 80
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid terminal identifier".into());
    }
    if !["create", "read", "write", "resize", "close"].contains(&action.as_str()) {
        return Err("Invalid terminal action".into());
    }
    let env = environment(&store, &environment_id)?;
    let mut sessions = manager.terminals.lock().await;
    if action == "create" {
        if sessions.len() >= 64 {
            return Err("Close an unused terminal first".into());
        }
        if sessions.contains_key(&session_id) {
            return Err("Terminal already exists".into());
        }
        sessions.insert(
            session_id.clone(),
            TerminalLease {
                environment: env.clone(),
                owner: owner.into(),
            },
        );
    } else if !sessions.get(&session_id).is_some_and(|lease| {
        lease.environment.id == environment_id && lease.owner == owner
    }) {
        if action == "close" {
            return Ok(json!({"ok":true}));
        }
        return Err("Terminal is closed or belongs to another window".into());
    }
    drop(sessions);
    let result=runtime.workspace_request(&env,&format!("/v1/terminal/{action}"),json!({"id":runtime_id(&env),"sessionId":session_id,"data":data.unwrap_or_default(),"offset":offset.unwrap_or_default(),"cols":cols.unwrap_or(80),"rows":rows.unwrap_or(24)})).await;
    if action == "create"
        && result.is_ok()
        && !manager.terminals.lock().await.contains_key(&session_id)
    {
        let _ = runtime
            .workspace_request(
                &env,
                "/v1/terminal/close",
                json!({"id":runtime_id(&env),"sessionId":session_id}),
            )
            .await;
    }
    if action == "close" || (action == "create" && result.is_err()) {
        manager.terminals.lock().await.remove(&session_id);
    }
    result
}

#[tauri::command]
pub async fn list_environment_services(
    environment_id: String,
    store: State<'_, PlatformStore>,
    runtime: State<'_, RuntimeManager>,
    manager: State<'_, WorkspaceManager>,
) -> Result<Value, String> {
    let state = store.snapshot()?;
    let env = state.environments.iter().find(|e|e.id==environment_id).ok_or("Environment not found")?;
    if env.kind == EnvironmentKind::Cloud {
        return Ok(json!({"services":[],"publications":[],"shares":[],"notice":"Cloud nodes use private TCP connection rules. Local network and Public access publishing are unavailable."}));
    }
    let (mut services, notice) = if env.status != EnvironmentStatus::Running {
        (json!([]), "Start this environment to discover listening services or publish ports.".to_string())
    } else { match runtime
        .workspace_request(&env, "/v1/services/list", json!({"id":runtime_id(&env)}))
        .await
    {
        Ok(value) => (value, String::new()),
        Err(error) => (json!([]), error),
    }};
    if let Some(services)=services.as_array_mut() {
        for port in state.manual_service_ports.get(&environment_id).into_iter().flatten() {
            if !services.iter().any(|service|service["port"]==*port) {
                services.push(json!({"port":port,"name":"Manual port","protocol":"tcp","address":""}));
            }
        }
    }
    let publications = manager
        .publications
        .lock()
        .await
        .values()
        .filter(|p| p.info.environment_id == environment_id)
        .map(|p| p.info.clone())
        .collect::<Vec<_>>();
    let shares = manager.host_shares_for(&environment_id).await;
    Ok(json!({"services":services,"publications":publications,"shares":shares,"notice":notice}))
}

#[tauri::command]
pub fn get_manual_service_ports(store:State<'_,PlatformStore>)->Result<std::collections::BTreeMap<String,Vec<u16>>,String> {
    Ok(store.snapshot()?.manual_service_ports)
}

#[tauri::command]
pub fn set_manual_service_port(environment_id:String,port:u16,present:bool,app:AppHandle,store:State<'_,PlatformStore>)->Result<std::collections::BTreeMap<String,Vec<u16>>,String> {
    if port==0 || port==7443 {return Err("Choose an application port between 1 and 65535; 7443 is reserved.".into());}
    let state=store.mutate(|state| {
        let environment=state.environments.iter().find(|e|e.id==environment_id).ok_or("Environment not found")?;
        if environment.kind==EnvironmentKind::Cloud {return Err("Cloud ports belong in private connection rules, not Local network or Public access publishing".into());}
        let ports=state.manual_service_ports.entry(environment_id).or_default();
        if present && !ports.contains(&port) {if ports.len()>=128 {return Err("Remove an unused manual port first (128 per environment).".into());} ports.push(port);ports.sort_unstable();}
        if !present {ports.retain(|p|*p!=port);}
        Ok(())
    })?;
    let _=app.emit("opendock-service-ports",&state.manual_service_ports);
    Ok(state.manual_service_ports)
}

async fn agent_stream(base: &str, token: &str, id: &str, port: u16) -> Result<TcpStream, String> {
    let url = url::Url::parse(base).map_err(|e| e.to_string())?;
    let mut stream = TcpStream::connect(("127.0.0.1", url.port().ok_or("Missing agent port")?))
        .await
        .map_err(|e| e.to_string())?;
    let request=format!("CONNECT /v1/services/connect?id={id}&port={port} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut response = Vec::new();
    while !response.ends_with(b"\r\n\r\n") {
        response.push(stream.read_u8().await.map_err(|e| e.to_string())?);
        if response.len() > 16 * 1024 {
            return Err("Invalid guest response".into());
        }
    }
    if !response.starts_with(b"HTTP/1.1 200 ") {
        return Err("The guest service is not accepting connections".into());
    }
    Ok(stream)
}
async fn cloudflared(root: &Path) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("OPENDOCK_CLOUDFLARED_PATH") {
        return Ok(PathBuf::from(path));
    }
    let path = root.join(if cfg!(windows) { "tools/cloudflared-2026.8.3.exe" } else { "tools/cloudflared-2026.8.3" });
    #[cfg(target_os = "macos")]
    {
        let _ = path;
        // Finder has a minimal PATH. Homebrew owns signing and updates for the
        // preview; never silently execute a similarly named file from cwd.
        let prefix = if cfg!(target_arch = "aarch64") { "/opt/homebrew" } else { "/usr/local" };
        let executable = PathBuf::from(prefix).join("opt/cloudflared/bin/cloudflared");
        if !executable.is_file() {
            return Err("Public access needs Cloudflare Tunnel on this Mac. Run 'brew install cloudflared', then retry. Nothing was published.".into());
        }
        return Ok(executable);
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = path;
        return Ok(PathBuf::from("cloudflared"));
    }
    #[cfg(any(windows, target_os = "linux"))]
    {
        #[cfg(windows)]
        const HASH: &str = "83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae";
        #[cfg(target_os = "linux")]
        const HASH: &str = "f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e";
        if path.is_file() {
            let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
            if hex::encode(Sha256::digest(&bytes)) == HASH {
                return Ok(path);
            }
        }
        let url = if cfg!(windows) { "https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-windows-amd64.exe" } else { "https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-linux-amd64" };
        let mut response=reqwest::Client::new().get(url).timeout(Duration::from_secs(180)).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
        if response.content_length().unwrap_or(0) > 100 * 1024 * 1024 {
            return Err("Unexpected Cloudflare download size".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 100 * 1024 * 1024 {
                return Err("Unexpected Cloudflare download size".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.len() > 100 * 1024 * 1024 || hex::encode(Sha256::digest(&bytes)) != HASH {
            return Err("Cloudflare download verification failed".into());
        }
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).await.map_err(|e| e.to_string())?;
        }
        Ok(path)
    }
}

#[tauri::command]
pub async fn publish_environment_service(
    window: WebviewWindow,
    environment_id: String,
    port: u16,
    kind: PublicationKind,
    host_port: Option<u16>,
    cloudflare: Option<cloudflare::AccountOptions>,
    store: State<'_, PlatformStore>,
    runtime: State<'_, RuntimeManager>,
    manager: State<'_, WorkspaceManager>,
) -> Result<Publication, String> {
    if cloudflare.is_some() && window.label() != "main" {
        return Err("Connect your Cloudflare account from the main Yougori window".into());
    }
    publish_service(
        environment_id,
        port,
        kind,
        host_port,
        cloudflare,
        &store,
        &runtime,
        &manager,
    )
    .await
}
pub(crate) async fn publish_service(
    environment_id: String,
    port: u16,
    kind: PublicationKind,
    host_port: Option<u16>,
    cloudflare: Option<cloudflare::AccountOptions>,
    store: &PlatformStore,
    runtime: &RuntimeManager,
    manager: &WorkspaceManager,
) -> Result<Publication, String> {
    if port == 0 || port == 7443 {
        return Err("Choose an application port, not the guest control port".into());
    }
    let _operation = manager.operations.lock().await;
    if manager.publications.lock().await.len() >= 128 {
        return Err("Disconnect an unused service first".into());
    }
    let env = environment(&store, &environment_id)?;
    if cloudflare.is_some() && kind != PublicationKind::Cloudflare {
        return Err("Cloudflare credentials can only be used for a Cloudflare publication".into());
    }
    if env.kind == EnvironmentKind::Cloud { return Err("Cloud nodes cannot connect to Local network or Public access. Use private node connections.".into()); }
    let account = cloudflare
        .map(|options| cloudflare::Account::resolve(&environment_id, port, host_port, options))
        .transpose()?;
    if let Some(existing) = manager.publications.lock().await.values().find(|p| {
        p.info.environment_id == environment_id && p.info.port == port && p.info.kind == kind
    }) {
        if existing.info.cloudflare_account != account.is_some()
            || account.as_ref().is_some_and(|account| {
                existing.tunnel_id.as_deref() != Some(account.tunnel_id.as_str())
                    || existing.info.urls != vec![account.public_url()]
                    || host_port != Some(existing.info.host_port)
            })
        {
            return Err("Disconnect the current Cloudflare publication before changing its account or route".into());
        }
        return Ok(existing.info.clone());
    }
    if let Some(account) = &account {
        if manager.publications.lock().await.values().any(|p| {
            p.tunnel_id.as_deref() == Some(account.tunnel_id.as_str())
        }) {
            return Err("This Cloudflare tunnel is already connected in Yougori. Use a dedicated tunnel for each published service.".into());
        }
    }
    let agent = runtime.workspace_endpoint(&env).await.ok();
    let vm_forward = if agent.is_none() && env.kind == EnvironmentKind::FullVm {
        let (qmp, port) = runtime.forward_workspace_vm_port(&env, port).await?;
        Some(VmForward(qmp, port))
    } else {
        None
    };
    if agent.is_none() && vm_forward.is_none() {
        return Err("This environment cannot expose services".into());
    }
    let listener = TcpListener::bind((
        if kind == PublicationKind::Cloudflare {
            "127.0.0.1"
        } else {
            "0.0.0.0"
        },
        host_port.unwrap_or(0),
    ))
    .await
    .map_err(|e| format!("Cannot bind host port: {e}"))?;
    let host_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let local_only = kind == PublicationKind::Local;
    let id = runtime_id(&env).to_owned();
    let forwarded_port = vm_forward.as_ref().map(|f| f.1);
    let task = tokio::spawn(async move {
        let mut clients = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                result=listener.accept()=>{let Ok((mut client,peer))=result else{break};if local_only&&!private_peer(peer.ip()){continue}if clients.len()>=256{continue}let agent=agent.clone();let id=id.clone();clients.spawn(async move{let connection=tokio::time::timeout(Duration::from_secs(12),async{if let Some((base,token))=agent{agent_stream(&base,&token,&id,port).await}else{TcpStream::connect(("127.0.0.1",forwarded_port.unwrap())).await.map_err(|e|e.to_string())}}).await;if let Ok(Ok(mut upstream))=connection{let _=tokio::io::copy_bidirectional(&mut client,&mut upstream).await;}});},
                _=clients.join_next(),if !clients.is_empty()=>{}
            }
        }
    });
    let mut live = LivePublication {
        info: Publication {
            id: format!("pub-{}", Uuid::new_v4().simple()),
            environment_id,
            port,
            kind: kind.clone(),
            host_port,
            urls: vec![
                format!("http://127.0.0.1:{host_port}"),
                format!("http://{}:{host_port}", lan_address()),
                format!("http://10.0.2.2:{host_port}"),
            ],
            status: "active".into(),
            message: if kind == PublicationKind::Public {
                "Direct publishing is listening. Internet reachability requires your public IP and router/firewall port forwarding; Yougori does not change them automatically.".into()
            } else {
                "Local access is available on this PC and private network.".into()
            },
            cloudflare_account: account.is_some(),
        },
        task,
        cloudflare: None,
        logs: None,
        tunnel_id: account.as_ref().map(|a| a.tunnel_id.clone()),
        _cloudflare_config: None,
        _vm_forward: vm_forward,
    };
    if kind == PublicationKind::Cloudflare {
        let executable = cloudflared(&manager.root).await?;
        let started =
            cloudflare::start(&executable, &manager.root, host_port, account.as_ref()).await?;
        live.info.urls = vec![started.url];
        live.info.message = if account.is_some() {
            "Account tunnel connected. The configured hostname is shown; DNS, routing, and visitor authentication are controlled in your Cloudflare dashboard and have not been verified by Yougori.".into()
        } else { "Public HTTPS preview link. Anyone with the link can access this service; the link lasts while this tunnel runs.".into() };
        live.logs = Some(started.logs);
        live.cloudflare = Some(started.child);
        live._cloudflare_config = Some(started.config);
    }
    environment(store, &live.info.environment_id)?;
    if let Some(account) = &account {
        if let Err(error) = account.remember(&live.info.environment_id, port) {
            live.info.message.push_str(&format!(" {error}"));
        }
    }
    let info = live.info.clone();
    manager
        .publications
        .lock()
        .await
        .insert(info.id.clone(), live);
    if kind == PublicationKind::Local {
        if let Err(error) = manager.sync_local_ports(store, runtime).await {
            manager.publications.lock().await.remove(&info.id);
            return Err(format!(
                "Local guest access could not be configured: {error}"
            ));
        }
    }
    Ok(info)
}

#[tauri::command]
pub async fn unpublish_environment_service(
    publication_id: String,
    manager: State<'_, WorkspaceManager>,
    store: State<'_, PlatformStore>,
    runtime: State<'_, RuntimeManager>,
) -> Result<(), String> {
    manager.publications.lock().await.remove(&publication_id);
    manager.sync_local_ports(&store, &runtime).await
}

#[tauri::command]
pub async fn attach_host_folder(
    environment_id: String,
    path: String,
    read_only: bool,
    store: State<'_, PlatformStore>,
    runtime: State<'_, RuntimeManager>,
    manager: State<'_, WorkspaceManager>,
) -> Result<HostShare, String> {
    attach_folder(environment_id, path, read_only, &store, &runtime, &manager).await
}
async fn attach_folder(
    environment_id: String,
    path: String,
    read_only: bool,
    store: &PlatformStore,
    runtime: &RuntimeManager,
    manager: &WorkspaceManager,
) -> Result<HostShare, String> {
    let _operation = manager.operations.lock().await;
    let env = environment(&store, &environment_id)?;
    if env.kind == EnvironmentKind::Cloud { return Err("Cloud nodes use connection-owned shared folders, not direct My PC mounts".into()); }
    let folder = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let managed = manager.root.canonicalize().unwrap_or(manager.root.clone());
    if folder.starts_with(&managed) || managed.starts_with(&folder) || folder.parent().is_none() {
        return Err("Yougori's managed runtime directory cannot be shared".into());
    }
    if env.kind == EnvironmentKind::FullVm && !read_only {
        return Err("This VM supports read-only folder downloads/WebDAV. Use a managed container or microVM for writable mounts.".into());
    }
    if manager.shares.lock().await.len() >= 64 {
        return Err("Disconnect an unused shared folder first".into());
    }
    let display_path = folder.to_string_lossy().into_owned();
    if let Some(share) = manager
        .shares
        .lock()
        .await
        .values()
        .find(|s| s.info.environment_id == environment_id && s.info.path == display_path)
    {
        return Ok(share.info.clone());
    }
    let server = HostFolderServer::start(folder.clone(), read_only).await?;
    let id = format!("share-{}", Uuid::new_v4().simple());
    let endpoint = runtime.host_folder_endpoint(&env, &server).await?;
    let mount_path = if env.kind == EnvironmentKind::FullVm {
        None
    } else {
        let value=runtime.workspace_request(&env,"/v1/shares/attach",json!({"id":runtime_id(&env),"shareId":id,"endpoint":endpoint,"token":server.token,"readOnly":read_only})).await?;
        value["mountPath"].as_str().map(str::to_owned)
    };
    let info = HostShare {
        id: id.clone(),
        environment_id,
        path: folder.to_string_lossy().into_owned(),
        read_only,
        mount_path,
        guest_url: format!("{endpoint}/{}/", server.token),
    };
    manager.shares.lock().await.insert(
        id,
        LiveShare {
            info: info.clone(),
            environment: env,
            _server: server,
        },
    );
    if let Err(error) = environment(store, &info.environment_id) {
        manager.remove_share(&info.id, runtime).await;
        return Err(error);
    }
    Ok(info)
}
#[tauri::command]
pub async fn detach_host_folder(
    share_id: String,
    runtime: State<'_, RuntimeManager>,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    manager.remove_share(&share_id, &runtime).await;
    Ok(())
}

#[tauri::command]
pub fn list_environment_windows(app: AppHandle) -> Vec<Value> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("environment-"))
        .map(|(label, window)| json!({"label":label,"title":window.title().unwrap_or_default()}))
        .collect()
}
#[tauri::command]
pub fn focus_environment_window(label: String, app: AppHandle) -> Result<(), String> {
    if !label.starts_with("environment-") {
        return Err("Not an environment window".into());
    }
    let window = app.get_webview_window(&label).ok_or("Window is closed")?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn title_environment_window(
    environment_id: String,
    window: WebviewWindow,
    store: State<'_, PlatformStore>,
) -> Result<(), String> {
    if !window.label().starts_with("environment-") {
        return Ok(());
    }
    let env = environment(&store, &environment_id)?;
    window
        .set_title(&format!(
            "{} — Yougori",
            env.name.replace(['\r', '\n'], " ")
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn open_workspace_url(url: String) -> Result<(), String> {
    let url = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only web URLs can be opened".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(url.as_str())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        })
        .arg(url.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_routes_reject_public_peers() {
        assert!(private_peer("127.0.0.1".parse().unwrap()));
        assert!(private_peer("192.168.1.10".parse().unwrap()));
        assert!(!private_peer("8.8.8.8".parse().unwrap()));
        assert!(!private_peer("2001:4860:4860::8888".parse().unwrap()));
    }
}

#[cfg(test)]
#[path = "workspace_runtime_tests.rs"]
mod runtime_tests;
