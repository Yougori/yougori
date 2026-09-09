//! Optional Windows CUDA container backend. No dependency on Tauri or QEMU.
//! The application owns one instance and must await shutdown before exit.
#[cfg(windows)]
mod storage;
mod compatibility;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::Mutex,
};

#[derive(Clone, Debug)]
pub struct Endpoint {
    pub base_url: String,
    pub token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub supported: bool,
    pub installed: bool,
    pub running: bool,
    pub update_available: bool,
    pub detail: String,
    pub checks: Vec<compatibility::Check>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    version: u32,
    distribution: String,
    identity: String,
    payload_checksum: Option<String>,
}

struct Process {
    child: Child,
    endpoint: Endpoint,
    // Windows releases this exclusive handle even if the app crashes. Other
    // live Yougori instances cannot recover, update or start this runtime.
    _ownership: std::fs::File,
}

pub struct CudaRuntime {
    directory: PathBuf,
    process: Mutex<Option<Process>>,
    client: reqwest::Client,
}

fn identity(directory: &Path) -> Result<(String, String), String> {
    if !directory.is_absolute() || directory.parent().is_none() {
        return Err("CUDA storage must be a dedicated absolute directory".into());
    }
    let absolute = std::path::absolute(directory).map_err(|e| e.to_string())?;
    let normalized = absolute
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .trim_end_matches(['\\', '/'])
        .to_lowercase();
    #[cfg(windows)]
    let normalized = normalized.replace('/', "\\");
    let digest = hex::encode(Sha256::digest(normalized.as_bytes()));
    Ok((format!("OpenDock-CUDA-{}", &digest[..12]), digest))
}

fn hidden(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

impl CudaRuntime {
    fn ownership(&self) -> Result<std::fs::File, String> {
        std::fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        options.open(self.directory.join("runtime-owner.lock")).map_err(|error| {
            if error.raw_os_error() == Some(32) || error.raw_os_error() == Some(33) {
                "[OPENDOCK_RUNTIME_BUSY] Another live Yougori instance owns this CUDA runtime. Close that instance normally; its containers were not interrupted.".into()
            } else { format!("Lock CUDA runtime: {error}") }
        })
    }

    async fn verify_owned(&self, installation: &Installed, terminate: bool) -> Result<(), String> {
        let assets = self.directory.join("bootstrap");
        tokio::fs::create_dir_all(&assets)
            .await
            .map_err(|e| e.to_string())?;
        let script = assets.join("verify-owned.ps1");
        tokio::fs::write(&script, include_str!("../../verify-owned.ps1"))
            .await
            .map_err(|e| e.to_string())?;
        let mut command = hidden("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script)
            .arg("-DataDirectory")
            .arg(&self.directory)
            .arg("-Distribution")
            .arg(&installation.distribution);
        if terminate {
            command.arg("-Terminate");
        }
        let status = tokio::time::timeout(Duration::from_secs(45), command.status())
            .await
            .map_err(|_| "CUDA ownership check timed out; no other runtime was targeted")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("The CUDA distribution could not be verified against its owned storage. No other WSL distribution was touched.".into());
        }
        Ok(())
    }

    /// Explicit Stop-button recovery only. Never terminate a live app's runtime.
    pub async fn recover_abandoned(&self) -> Result<(), String> {
        if !cfg!(windows) {
            return Err("CUDA runtime recovery requires Windows".into());
        }
        let mut guard = self.process.lock().await;
        if let Some(process) = guard.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err("The current app owns this CUDA runtime. Stop its containers normally; running workloads were not force-stopped.".into());
            }
        }
        *guard = None;
        let _ownership = self.ownership()?;
        let installation = self.installation()?;
        self.verify_owned(&installation, true).await
    }
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        identity(&directory)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            directory,
            process: Mutex::new(None),
            client,
        })
    }

    fn installation(&self) -> Result<Installed, String> {
        let path = self.directory.join("installed.json");
        let metadata = std::fs::metadata(&path)
            .map_err(|_| "Install the optional WSL 2 CUDA backend first")?;
        if metadata.len() > 4096 {
            return Err("Invalid CUDA installation manifest".into());
        }
        let installation: Installed =
            serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Read CUDA installation: {e}"))?;
        let (name, digest) = identity(&self.directory)?;
        if installation.version != 1
            || installation.distribution != name
            || installation.identity != digest
        {
            return Err(
                "CUDA installation belongs to a different storage directory; it was not started"
                    .into(),
            );
        }
        Ok(installation)
    }

    pub fn installed_payload_checksum(&self) -> Option<String> {
        self.installation().ok()?.payload_checksum
    }

    pub fn storage_path(&self) -> PathBuf {
        self.directory.join("distribution/ext4.vhdx")
    }

    pub fn storage_sizes(&self) -> Result<(u64, u64), String> {
        #[cfg(windows)]
        {
            storage::sizes(&self.storage_path())
        }
        #[cfg(not(windows))]
        {
            Err("CUDA storage requires Windows and WSL 2".into())
        }
    }

    pub async fn status(&self) -> Status {
        let mut guard = self.process.lock().await;
        let running = guard
            .as_mut()
            .is_some_and(|p| p.child.try_wait().is_ok_and(|s| s.is_none()));
        let result = self.installation();
        drop(guard);
        let checks = compatibility::checks().await;
        let supported = checks.iter().all(|c| c.passed);
        let blocked = checks.iter().filter(|c| !c.passed).map(|c| c.detail.as_str()).collect::<Vec<_>>().join(" ");
        Status {
            supported,
            installed: result.is_ok(),
            running,
            update_available: false,
            checks,
            detail: if !supported {
                blocked
            } else if running {
                "CUDA runtime running. Use Test CUDA in the environment settings to verify a real GPU calculation.".into()
            } else {
                result
                    .map(|_| "CUDA runtime installed; starts only when needed.".into())
                    .unwrap_or_else(|e| e)
            },
        }
    }

    pub async fn install(&self, agent: &Path) -> Result<(), String> {
        let checks = compatibility::checks().await;
        if checks.iter().any(|c| !c.passed) {
            return Err(checks.iter().filter(|c| !c.passed).map(|c| c.detail.as_str()).collect::<Vec<_>>().join(" "));
        }
        let mut guard = self.process.lock().await;
        if guard
            .as_mut()
            .is_some_and(|p| !p.child.try_wait().is_ok_and(|s| s.is_some()))
        {
            return Err(
                "Stop CUDA containers and shut down their runtime before updating it".into(),
            );
        }
        *guard = None;
        let _ownership = self.ownership()?;
        let assets = self.directory.join("bootstrap");
        tokio::fs::create_dir_all(&assets)
            .await
            .map_err(|e| e.to_string())?;
        for (name, contents) in [
            ("install.ps1", include_str!("../../install.ps1")),
            ("setup.sh", include_str!("../../setup.sh")),
            ("start.sh", include_str!("../../start.sh")),
            ("wsl.conf", include_str!("../../wsl.conf")),
        ] {
            tokio::fs::write(assets.join(name), contents)
                .await
                .map_err(|e| e.to_string())?;
        }
        let log =
            std::fs::File::create(self.directory.join("setup.log")).map_err(|e| e.to_string())?;
        let mut command = hidden("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(assets.join("install.ps1"))
            .arg("-DataDirectory")
            .arg(&self.directory)
            .arg("-AgentPath")
            .arg(agent)
            .arg("-AssetsDirectory")
            .arg(&assets)
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        // Installation is deliberately not cancelled halfway through WSL import.
        // A failure leaves its owned disk intact and can be retried explicitly.
        let status = command
            .status()
            .await
            .map_err(|e| format!("Start CUDA setup: {e}"))?;
        if !status.success() {
            return Err(format!(
                "CUDA setup failed. This backend needs WSL 2 and a current Windows NVIDIA driver. See {} for the exact setup error; existing disks were preserved.",
                self.directory.join("setup.log").display()
            ));
        }
        self.installation()?;
        *guard = None;
        Ok(())
    }

    pub async fn current_endpoint(&self) -> Result<Endpoint, String> {
        let mut guard = self.process.lock().await;
        let process = guard.as_mut().ok_or("The CUDA runtime is stopped")?;
        if process
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err(
                "The CUDA runtime exited; stop and start the container to reconnect".into(),
            );
        }
        Ok(process.endpoint.clone())
    }

    pub async fn ensure_started(&self) -> Result<Endpoint, String> {
        if !cfg!(windows) {
            return Err("WSL CUDA containers require Windows".into());
        }
        let mut guard = self.process.lock().await;
        if let Some(process) = guard.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                if self.health(&process.endpoint).await {
                    return Ok(process.endpoint.clone());
                }
                return Err(
                    "CUDA runtime is not responding. No live workload was restarted.".into(),
                );
            }
        }
        *guard = None;
        let installation = self.installation()?;
        let ownership = self.ownership()?;
        self.verify_owned(&installation, false).await?;
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let endpoint = Endpoint {
            base_url: format!("http://127.0.0.1:{port}"),
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        let log =
            std::fs::File::create(self.directory.join("runtime.log")).map_err(|e| e.to_string())?;
        let mut command = hidden("wsl.exe");
        command
            .args([
                "-d",
                &installation.distribution,
                "-u",
                "root",
                "--exec",
                "/bin/bash",
                "/usr/local/sbin/opendock-cuda-start",
            ])
            .stdin(Stdio::piped())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Start WSL CUDA runtime: {e}"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or("CUDA launcher has no input pipe")?;
        stdin
            .write_all(format!("{}\n{port}\n", endpoint.token).as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        drop(stdin);
        // Keep ownership even on a health timeout; a slow startup is not grounds
        // to kill workloads or launch a second container daemon.
        *guard = Some(Process {
            child,
            endpoint: endpoint.clone(),
            _ownership: ownership,
        });
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            if guard
                .as_mut()
                .unwrap()
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                let log =
                    std::fs::read_to_string(self.directory.join("runtime.log")).unwrap_or_default();
                if log.contains("already owned by another Yougori process")
                    || log.contains("already owned by another OpenDock process") {
                    return Err("[OPENDOCK_RUNTIME_BUSY] An abandoned Yougori CUDA runtime is still running. Press Stop to recover it. A runtime owned by another live app will not be stopped.".into());
                }
                return Err(format!(
                    "CUDA runtime exited. Check WSL and the Windows NVIDIA driver. See {}",
                    self.directory.join("runtime.log").display()
                ));
            }
            if self.health(&endpoint).await {
                return Ok(endpoint);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("CUDA runtime did not become ready. It was not force-restarted; inspect its runtime log.".into());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    async fn health(&self, endpoint: &Endpoint) -> bool {
        self.client
            .get(format!("{}/v1/health", endpoint.base_url))
            .bearer_auth(&endpoint.token)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        let mut guard = self.process.lock().await;
        self.shutdown_locked(&mut guard).await
    }

    async fn shutdown_locked(&self, guard: &mut Option<Process>) -> Result<(), String> {
        let Some(process) = guard.as_mut() else {
            return Ok(());
        };
        if process
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            let response = self
                .client
                .post(format!("{}/v1/system/shutdown", process.endpoint.base_url))
                .bearer_auth(&process.endpoint.token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err("CUDA runtime refused shutdown".into());
            }
            tokio::time::timeout(Duration::from_secs(45), process.child.wait())
                .await
                .map_err(|_| {
                    "CUDA runtime is still shutting down; its disk was not force-detached"
                })?
                .map_err(|e| e.to_string())?;
        }
        let installation = self.installation()?;
        self.verify_owned(&installation, true).await?;
        *guard = None;
        Ok(())
    }

    /// Caller holds the runtime-wide operation writer lock and has verified
    /// there are no running/paused containers in the agent, not just the UI.
    pub async fn compact_idle_storage(&self) -> Result<(), String> {
        #[cfg(windows)] {
            let mut guard = self.process.lock().await;
            if guard.is_none() { return Err("CUDA runtime ownership is missing; storage was not changed.".into()); }
            self.shutdown_locked(&mut guard).await?;
            let ownership = self.ownership()?;
            self.verify_owned(&self.installation()?, false).await?;
            let path = self.storage_path();
            // Keep the ownership handle IN the blocking task, even if its
            // caller is cancelled. A second app cannot reopen during compact.
            tokio::task::spawn_blocking(move || {
                let _ownership = ownership;
                storage::compact(&path)
            }).await.map_err(|e| format!("CUDA compaction task: {e}"))?
        }
        #[cfg(not(windows))] { Err("CUDA compaction requires Windows".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "compacts only the explicitly prepared idle integration-runtime VHDX"]
    async fn compact_pretrimmed_test_disk() -> Result<(), String> {
        let path = PathBuf::from(std::env::var("OPENDOCK_CUDA_TEST_ROOT").map_err(|_| "test root required")?);
        let expected = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../build/cuda/integration-runtime").canonicalize().map_err(|e| e.to_string())?;
        if path.canonicalize().map_err(|e| e.to_string())? != expected { return Err("Refusing user CUDA disk".into()); }
        let runtime = CudaRuntime::new(path)?;
        let _owner = runtime.ownership()?;
        runtime.verify_owned(&runtime.installation()?, false).await?;
        let before = runtime.storage_sizes()?.1;
        storage::compact(&runtime.storage_path())?;
        eprintln!("Native VHDX compaction: {before} -> {}", runtime.storage_sizes()?.1);
        Ok(())
    }
    #[test]
    fn names_are_stable_scoped_and_never_shell_arguments() {
        let directory = std::env::temp_dir().join("Yougori CUDA test");
        let (name, digest) = identity(&directory).unwrap();
        assert!(name.starts_with("OpenDock-CUDA-"));
        assert_eq!(name.len(), 26);
        assert_eq!(digest.len(), 64);
        assert_ne!(identity(&directory.join("other")).unwrap().0, name);
        assert!(identity(Path::new("relative")).is_err());
        #[cfg(windows)]
        {
            assert_eq!(
                identity(Path::new("C:/Users/Test/CUDA/")).unwrap(),
                identity(Path::new("c:\\users\\test\\cuda")).unwrap()
            );
            assert_eq!(
                identity(Path::new("\\\\?\\C:\\Users\\Test\\CUDA")).unwrap(),
                identity(Path::new("c:\\users\\test\\cuda")).unwrap()
            );
        }
    }
    #[test]
    #[cfg(windows)]
    fn live_owner_prevents_recovery_or_installation() {
        let directory = tempfile::tempdir().unwrap();
        let first = CudaRuntime::new(directory.path().to_owned()).unwrap();
        let second = CudaRuntime::new(directory.path().to_owned()).unwrap();
        let ownership = first.ownership().unwrap();
        assert!(second
            .ownership()
            .unwrap_err()
            .contains("Another live Yougori"));
        drop(ownership);
        assert!(second.ownership().is_ok());
    }
    #[test]
    fn copied_or_malformed_installation_is_not_adopted() {
        let directory = tempfile::tempdir().unwrap();
        let runtime = CudaRuntime::new(directory.path().to_owned()).unwrap();
        assert!(runtime.installation().is_err());
        let (name, digest) = identity(directory.path()).unwrap();
        std::fs::write(
            directory.path().join("installed.json"),
            serde_json::json!({"version":1,"distribution":name,"identity":digest}).to_string(),
        )
        .unwrap();
        assert!(runtime.installation().is_ok());
        std::fs::write(
            directory.path().join("installed.json"),
            serde_json::json!({"version":1,"distribution":"Ubuntu-22.04","identity":digest})
                .to_string(),
        )
        .unwrap();
        assert!(runtime.installation().is_err());
    }

    #[tokio::test]
    #[ignore = "requires the explicitly installed build/cuda/integration-runtime test distribution"]
    async fn native_lifecycle_runs_cuda_and_preserves_data_on_shutdown() -> Result<(), String> {
        let root = PathBuf::from(
            std::env::var("OPENDOCK_CUDA_TEST_ROOT")
                .map_err(|_| "Set OPENDOCK_CUDA_TEST_ROOT to the dedicated test runtime")?,
        );
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../build/cuda/integration-runtime")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if root.canonicalize().map_err(|e| e.to_string())? != expected {
            return Err("This test cannot run against user CUDA storage".into());
        }
        let runtime = CudaRuntime::new(root)?;
        if runtime.current_endpoint().await.is_ok() {
            return Err("Fresh manager unexpectedly has an endpoint".into());
        }
        let endpoint = runtime.ensure_started().await?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?;
        let id = format!("cuda-native-test-{}", uuid::Uuid::new_v4().simple());
        async fn post(
            client: &reqwest::Client,
            endpoint: &Endpoint,
            path: &str,
            body: serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            let response = client
                .post(format!("{}{path}", endpoint.base_url))
                .bearer_auth(&endpoint.token)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let success = response.status().is_success();
            let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            if !success {
                return Err(value.to_string());
            }
            Ok(value)
        }
        let result = async {
            post(&client, &endpoint, "/v1/containers/provision", serde_json::json!({"id":id,"image":"docker.io/library/python:3.12-slim","command":"sleep 2147483647","cpus":1,"memoryBytes":536870912,"networkAccess":false,"gpuAccess":true})).await?;
            post(&client, &endpoint, "/v1/containers/action", serde_json::json!({"id":id,"action":"start","networkAccess":false})).await?;
            let command = format!("printf survived > /root/opendock-shutdown-test\npython3 - <<'OPENDOCK_CUDA_PROBE'\n{}\nOPENDOCK_CUDA_PROBE", include_str!("../../kernel-probe.py"));
            let reply = post(&client, &endpoint, "/v1/containers/exec", serde_json::json!({"id":id,"command":command})).await?;
            if reply["exitCode"] != 0 || !reply["stdout"].as_str().unwrap_or_default().contains("CUDA KERNEL PASS") { return Err(reply.to_string()); }
            runtime.shutdown().await?;
            if runtime.status().await.running { return Err("Runtime remained running after shutdown".into()); }
            let endpoint = runtime.ensure_started().await?;
            post(&client, &endpoint, "/v1/containers/action", serde_json::json!({"id":id,"action":"start","networkAccess":false})).await?;
            let reply = post(&client, &endpoint, "/v1/containers/exec", serde_json::json!({"id":id,"command":"test -f /root/opendock-shutdown-test && test -e /dev/dxg"})).await?;
            if reply["exitCode"] != 0 { return Err("CUDA container did not survive full runtime shutdown".into()); }
            Ok(())
        }.await;
        if let Ok(endpoint) = runtime.current_endpoint().await {
            let cleanup = post(
                &client,
                &endpoint,
                "/v1/containers/delete",
                serde_json::json!({"id":id,"action":"delete","networkAccess":false}),
            )
            .await;
            if let Err(error) = cleanup {
                eprintln!("CUDA test cleanup: {error}");
            }
        }
        let shutdown = runtime.shutdown().await;
        result.and(shutdown)
    }
}
