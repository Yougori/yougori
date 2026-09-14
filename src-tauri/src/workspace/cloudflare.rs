//! Optional account tunnels. Secrets stay in native memory / the OS vault, never
//! platform JSON, command-line arguments, publication responses, or diagnostic logs.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tokio::io::AsyncBufRead;

// Keep existing saved tunnel credentials accessible after the product rename.
const VAULT_SERVICE: &str = "OpenDock.CloudflareTunnel.v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountOptions {
    pub hostname: String,
    pub token: Option<String>,
    #[serde(default)]
    pub remember: bool,
    #[serde(default)]
    pub routes_reviewed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Credentials {
    hostname: String,
    host_port: u16,
    token: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccount {
    saved: bool,
    hostname: String,
    host_port: Option<u16>,
}

pub(super) struct Account {
    credentials: Credentials,
    pub tunnel_id: String,
    remember: bool,
}

fn entry(environment_id: &str, port: u16) -> Result<keyring::Entry, String> {
    if environment_id.is_empty()
        || environment_id.len() > 128
        || !environment_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || port == 0
        || port == 7443
    {
        return Err("Invalid environment or service port".into());
    }
    keyring::Entry::new(VAULT_SERVICE, &format!("{environment_id}:{port}"))
        .map_err(|_| "Cannot open the OS credential vault".into())
}

fn load(environment_id: &str, port: u16) -> Result<Option<Credentials>, String> {
    match entry(environment_id, port)?.get_password() {
        Ok(value) if value.len() <= 4096 => serde_json::from_str(&value).map(Some).map_err(|_| "Saved Cloudflare credentials are invalid. Forget them and enter a new tunnel token.".into()),
        Ok(_) => Err("Saved Cloudflare credentials exceed the size limit".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Cannot read the OS credential vault. Enter a token for this session or unlock the vault.".into()),
    }
}

pub(super) fn hostname(value: &str) -> Result<String, String> {
    let name = value.trim().to_ascii_lowercase();
    if name.len() > 253
        || !name.contains('.')
        || name.parse::<IpAddr>().is_ok()
        || name.split('.').any(|part| {
            part.is_empty()
                || part.len() > 63
                || part.starts_with('-')
                || part.ends_with('-')
                || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err(
            "Enter a public hostname such as app.example.com, without https://, a port, or a path."
                .into(),
        );
    }
    if name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".trycloudflare.com")
    {
        return Err("Use a hostname on a domain you manage in Cloudflare, not a local address or Quick Tunnel link.".into());
    }
    Ok(name)
}

fn token_id(value: &str) -> Result<String, String> {
    let invalid = "Paste only the tunnel token (the eyJ… value), not the installation command, an API token, or your Cloudflare password.";
    if value.len() < 32 || value.len() > 2048 || value.bytes().any(|b| b.is_ascii_whitespace()) {
        return Err(invalid.into());
    }
    let decoded = STANDARD.decode(value).map_err(|_| invalid)?;
    let data: Value = serde_json::from_slice(&decoded).map_err(|_| invalid)?;
    let account = data["a"].as_str().ok_or(invalid)?;
    let secret = data["s"].as_str().ok_or(invalid)?;
    let id = Uuid::parse_str(data["t"].as_str().ok_or(invalid)?).map_err(|_| invalid)?;
    if account.len() != 32
        || !account.bytes().all(|b| b.is_ascii_hexdigit())
        || id.is_nil()
        // Cloudflared accepts a base64-encoded byte string, not a fixed-size key.
        || STANDARD.decode(secret).map_err(|_| invalid)?.is_empty()
    {
        return Err(invalid.into());
    }
    Ok(id.to_string())
}

impl Account {
    pub(super) fn resolve(
        environment_id: &str,
        port: u16,
        host_port: Option<u16>,
        options: AccountOptions,
    ) -> Result<Self, String> {
        if !options.routes_reviewed {
            return Err(
                "Review the dedicated tunnel's dashboard routes before connecting it.".into(),
            );
        }
        let host_port = host_port.filter(|p| *p != 0 && *p != 7443).ok_or(
            "Choose a fixed local tunnel port and configure that exact port in Cloudflare.",
        )?;
        let hostname = hostname(&options.hostname)?;
        let token = match options.token.filter(|value| !value.trim().is_empty()) {
            Some(value) => value.trim().to_owned(),
            None => {
                load(environment_id, port)?
                    .ok_or("Enter a tunnel token or save one first.")?
                    .token
            }
        };
        let tunnel_id = token_id(&token)?;
        Ok(Self {
            credentials: Credentials {
                hostname,
                host_port,
                token,
            },
            tunnel_id,
            remember: options.remember,
        })
    }

    pub(super) fn public_url(&self) -> String {
        format!("https://{}", self.credentials.hostname)
    }

    pub(super) fn remember(&self, environment_id: &str, port: u16) -> Result<(), String> {
        if !self.remember {
            return Ok(());
        }
        let serialized = serde_json::to_string(&self.credentials)
            .map_err(|_| "Cannot encode tunnel credentials")?;
        entry(environment_id, port)?.set_password(&serialized).map_err(|_| "Connected, but credentials could not be saved in the OS vault. You will need to paste the token next time.".into())
    }
}

fn check_scope(window: &WebviewWindow, store: &PlatformStore, id: &str) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Manage Cloudflare credentials from the main Yougori window".into());
    }
    if !store
        .snapshot()?
        .environments
        .iter()
        .any(|env| env.id == id)
    {
        return Err("Environment not found".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn saved_cloudflare_account(
    window: WebviewWindow,
    environment_id: String,
    port: u16,
    store: State<'_, PlatformStore>,
    manager: State<'_, WorkspaceManager>,
) -> Result<SavedAccount, String> {
    check_scope(&window, &store, &environment_id)?;
    saved_for_local_client(environment_id, port, &store, &manager).await
}

pub(crate) async fn saved_for_local_client(
    environment_id: String,
    port: u16,
    store: &PlatformStore,
    manager: &WorkspaceManager,
) -> Result<SavedAccount, String> {
    if !store.snapshot()?.environments.iter().any(|env| env.id == environment_id) {
        return Err("Environment not found".into());
    }
    let _operation = manager.operations.lock().await;
    Ok(match load(&environment_id, port)? {
        Some(value) => SavedAccount {
            saved: true,
            hostname: hostname(&value.hostname)?,
            host_port: Some(value.host_port),
        },
        None => SavedAccount::default(),
    })
}

#[tauri::command]
pub async fn forget_cloudflare_account(
    window: WebviewWindow,
    environment_id: String,
    port: u16,
    store: State<'_, PlatformStore>,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    check_scope(&window, &store, &environment_id)?;
    forget_for_local_client(environment_id, port, &store, &manager).await
}

pub(crate) async fn forget_for_local_client(
    environment_id: String,
    port: u16,
    store: &PlatformStore,
    manager: &WorkspaceManager,
) -> Result<(), String> {
    if !store.snapshot()?.environments.iter().any(|env| env.id == environment_id) {
        return Err("Environment not found".into());
    }
    let _operation = manager.operations.lock().await;
    match entry(&environment_id, port)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Cannot remove the saved token from the OS credential vault".into()),
    }
}

// A private, non-secret empty config prevents a user's global cloudflared config
// from changing Quick Tunnel behavior. Remove only this unique file on teardown.
pub(super) struct ConfigFile(PathBuf);
impl Drop for ConfigFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
impl ConfigFile {
    async fn create(root: &Path) -> Result<Self, String> {
        let folder = root.join("tools/cloudflare-sessions");
        tokio::fs::create_dir_all(&folder)
            .await
            .map_err(|_| "Cannot prepare tunnel config directory")?;
        let path = folder.join(format!("{}.json", Uuid::new_v4().simple()));
        let mut output = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
            .map_err(|_| "Cannot prepare tunnel config")?;
        let file = Self(path);
        output
            .write_all(b"{}\n")
            .await
            .map_err(|_| "Cannot write tunnel config")?;
        // Tokio file writes may still be queued when write_all returns. The
        // external tunnel process must not see an empty configuration file.
        output.flush().await.map_err(|_| "Cannot flush tunnel config")?;
        Ok(file)
    }
}

pub(super) struct Started {
    pub child: Child,
    pub logs: JoinHandle<()>,
    pub url: String,
    pub config: ConfigFile,
}

fn command(
    executable: &Path,
    config: &Path,
    port: u16,
    account: Option<&Account>,
) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(executable);
    // Override only cloudflared-specific configuration, not normal OS networking.
    for (name, _) in std::env::vars_os() {
        let upper = name.to_string_lossy().to_ascii_uppercase();
        if upper.starts_with("TUNNEL_") || upper.starts_with("CLOUDFLARED_") {
            command.env_remove(name);
        }
    }
    command
        .args(["tunnel", "--no-autoupdate", "--config"])
        .arg(config)
        .args(["--output", "json"]);
    if let Some(account) = account {
        // Supported environment variable keeps the token out of process listings.
        command
            .arg("run")
            .env("TUNNEL_TOKEN", &account.credentials.token);
    } else {
        command.args(["--url", &format!("http://127.0.0.1:{port}")]);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    background(&mut command);
    command
}

async fn bounded_line(reader: &mut (impl AsyncBufRead + Unpin)) -> Result<Option<String>, String> {
    let mut buffer = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| "Cannot read tunnel status")?;
        if available.is_empty() {
            return if buffer.is_empty() {
                Ok(None)
            } else {
                Ok(Some(String::from_utf8_lossy(&buffer).into_owned()))
            };
        }
        let take = available
            .iter()
            .position(|&b| b == b'\n')
            .map_or(available.len(), |n| n + 1);
        if buffer.len() + take > 64 * 1024 {
            return Err("Cloudflare returned an oversized status message".into());
        }
        let complete = available[take - 1] == b'\n';
        buffer.extend_from_slice(&available[..take]);
        reader.consume(take);
        if complete {
            return Ok(Some(String::from_utf8_lossy(&buffer).into_owned()));
        }
    }
}

fn quick_url(line: &str) -> Option<String> {
    line.split(|c: char| !(c.is_ascii_alphanumeric() || ":/.-".contains(c)))
        .find_map(|word| {
            let url = url::Url::parse(word).ok()?;
            let host = url.host_str()?;
            let label = host.strip_suffix(".trycloudflare.com")?;
            (url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-'))
            .then(|| format!("https://{host}"))
        })
}

pub(super) async fn start(
    executable: &Path,
    root: &Path,
    port: u16,
    account: Option<&Account>,
) -> Result<Started, String> {
    let config = ConfigFile::create(root).await?;
    let mut child = command(executable, &config.0, port, account)
        .spawn()
        .map_err(|_| "Could not start Cloudflare Tunnel")?;
    let mut reader = BufReader::new(child.stderr.take().ok_or("Missing tunnel status output")?);
    let status = tokio::time::timeout(
        Duration::from_secs(45),
        connected_url(&mut reader, account.map(Account::public_url)),
    )
    .await;
    let result = status
        .map_err(|_| startup_error(account.is_some(), true))
        .and_then(|r| r);
    let url = match result {
        Ok(url) => url,
        Err(error) => {
            let _ = child.kill().await;
            return Err(error);
        }
    };
    // Do not persist or expose raw helper logs: they may contain account details.
    let logs = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut reader, &mut tokio::io::sink()).await;
    });
    Ok(Started {
        child,
        logs,
        url,
        config,
    })
}

async fn connected_url(
    reader: &mut (impl AsyncBufRead + Unpin),
    account_url: Option<String>,
) -> Result<String, String> {
    let named = account_url.is_some();
    let mut url = account_url;
    let mut connected = false;
    while let Some(line) = bounded_line(reader).await? {
        if !named && url.is_none() {
            url = quick_url(&line);
        }
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            connected |= value["message"].as_str() == Some("Registered tunnel connection");
        }
        if connected {
            if let Some(url) = url {
                return Ok(url);
            }
        }
    }
    Err(startup_error(named, false))
}

fn startup_error(named: bool, timed_out: bool) -> String {
    let reason = if timed_out {
        "did not connect within 45 seconds"
    } else {
        "exited before connecting"
    };
    if named {
        format!("Cloudflare account tunnel {reason}. Check the tunnel token, dashboard configuration, and network access. No Quick Tunnel fallback was started.")
    } else {
        format!("Cloudflare Quick Tunnel {reason}. Check this PC's Internet connection and whether a firewall or VPN is blocking Cloudflare, then retry. No account or tunnel token is required.")
    }
}

#[cfg(test)]
mod tests;
