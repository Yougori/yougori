use crate::wire::{self, Request, Response};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub async fn call_at(endpoint: &str, request: &Request) -> Result<Value, String> {
    #[cfg(windows)]
    let mut stream = {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint) {
                Ok(stream)=>break stream,
                Err(error) if error.raw_os_error()==Some(231) && Instant::now()<deadline => tokio::time::sleep(Duration::from_millis(50)).await,
                Err(error)=>return Err(format!("Cannot reach the Yougori engine: {error}. Start/update Yougori, or run yougori-cli app start.")),
            }
        }
    };
    #[cfg(unix)]
    let mut stream = tokio::net::UnixStream::connect(endpoint)
        .await
        .map_err(|error| {
            format!("Cannot reach the Yougori engine: {error}. Run yougori-cli app start.")
        })?;
    #[cfg(windows)]
    wire::verify_pipe_server(&stream)
        .map_err(|error| format!("Cannot verify Yougori engine ownership: {error}. No request was sent."))?;
    #[cfg(unix)]
    if stream.peer_cred().map_err(|error| format!("Cannot verify Yougori engine ownership: {error}"))?.uid()
        != unsafe { libc::geteuid() }
    {
        return Err("Yougori control endpoint belongs to another user. No request was sent.".into());
    }
    let bytes = serde_json::to_vec(request).map_err(|e| e.to_string())?;
    let reply=tokio::time::timeout(Duration::from_secs(20), async {
        wire::write_frame(&mut stream,&bytes,wire::MAX_REQUEST).await?;
        wire::read_frame(&mut stream,wire::MAX_RESPONSE).await
    }).await.map_err(|_|"Yougori control request timed out. The outcome may be unknown; inspect jobs and state before repeating a mutation.")?.map_err(|e|format!("Yougori connection ended: {e}. Inspect jobs/state before repeating a mutation."))?;
    let response: Response =
        serde_json::from_slice(&reply).map_err(|_| "Invalid Yougori control response")?;
    if response.version != wire::VERSION {
        return Err("CLI/engine protocol mismatch. Update both Yougori and its CLI.".into());
    }
    if response.ok {
        Ok(response.result.unwrap_or(Value::Null))
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "Yougori operation failed".into()))
    }
}
pub async fn call(request: &Request) -> Result<Value, String> {
    call_at(&wire::endpoint().map_err(|e| e.to_string())?, request).await
}
pub fn request(method: &str, params: Value) -> Request {
    Request {
        version: wire::VERSION,
        method: method.into(),
        params,
        confirmed: false,
        dry_run: false,
    }
}

pub async fn wait_job_at(endpoint: &str, id: &str, seconds: u64) -> Result<Value, String> {
    let started = Instant::now();
    let mut last_progress = Instant::now();
    loop {
        let job = call_at(endpoint, &request("jobs_get", json!({"jobId":id})))
            .await
            .map_err(|e| format!("{e} Accepted job: {id}."))?;
        match job["status"].as_str() {
            Some("complete") => return Ok(job["result"].clone()),
            Some("failed") => {
                return Err(format!(
                    "{}: {} (job {id})",
                    job["method"].as_str().unwrap_or("Operation"),
                    job["error"].as_str().unwrap_or("Operation failed")
                ))
            }
            Some("running" | "queued") => {}
            _ => return Err("Invalid job status from Yougori".into()),
        }
        if started.elapsed() >= Duration::from_secs(seconds) {
            return Err(format!("Still running: {id}. The operation was NOT cancelled. Check 'yougori-cli jobs get {id}' before retrying."));
        }
        if last_progress.elapsed() >= Duration::from_secs(5) {
            eprintln!(
                "Yougori: {} — {}s ({id})",
                job["method"].as_str().unwrap_or("working"),
                started.elapsed().as_secs()
            );
            last_progress = Instant::now();
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
pub async fn wait_job(id: &str, seconds: u64) -> Result<Value, String> {
    wait_job_at(&wire::endpoint().map_err(|e| e.to_string())?, id, seconds).await
}

fn desktop_path(explicit: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = explicit
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("YOUGORI_APP").map(PathBuf::from))
        .or_else(|| std::env::var_os("OPENDOCK_APP").map(PathBuf::from))
    {
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
        return Err("The Yougori app path must be an existing absolute executable path".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = if cfg!(windows) {
        "yougori.exe"
    } else {
        "yougori"
    };
    let parent = exe.parent().ok_or("Cannot locate the CLI directory")?;
    let mut candidates = vec![parent.join(name)];
    #[cfg(target_os = "linux")]
    candidates.push(PathBuf::from("/usr/bin/yougori"));
    #[cfg(target_os = "macos")]
    {
        candidates.extend(macos_app_candidates(&exe));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(home).join("Applications/Yougori.app/Contents/MacOS/yougori"));
        }
        candidates.push(PathBuf::from("/Applications/Yougori.app/Contents/MacOS/yougori"));
    }
    if let Some(parent) = parent.parent() {
        candidates.push(parent.join(name));
    }
    candidates.extend([
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/target/debug")
            .join(name),
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/target/release")
            .join(name),
    ]);
    candidates.into_iter().find(|path|path.is_file()).ok_or_else(||"Cannot find the desktop engine. Use 'app start --app ABSOLUTE_PATH_TO_YOUGORI' or start 'npm run desktop:dev' in the source checkout.".into())
}

#[cfg(any(target_os = "macos", test))]
fn macos_app_candidates(cli: &Path) -> Vec<PathBuf> {
    // Resolve from Resources/cli in a moved or renamed .app, without assuming
    // it was installed in /Applications or requiring a global PATH entry.
    cli.ancestors()
        .filter(|p| p.file_name().is_some_and(|name| name == "Contents"))
        .map(|contents| contents.join("MacOS/yougori"))
        .collect()
}

#[cfg(test)]
mod macos_path_tests {
    use super::*;
    #[test]
    fn finds_engine_in_relocated_bundle_with_spaces() {
        assert_eq!(macos_app_candidates(Path::new("/Users/test/My Apps/Renamed.app/Contents/Resources/cli/yougori-cli")),
            vec![PathBuf::from("/Users/test/My Apps/Renamed.app/Contents/MacOS/yougori")]);
        assert!(macos_app_candidates(Path::new("/usr/bin/yougori-cli")).is_empty());
    }
}
pub async fn start(explicit: Option<&str>) -> Result<Value, String> {
    if let Ok(status) = call(&request("app_status", json!({}))).await {
        return Ok(status);
    }
    let executable = desktop_path(explicit)?;
    let mut command = std::process::Command::new(&executable);
    command
        .arg("--headless")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start Yougori: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if let Ok(status) = call(&request("app_status", json!({}))).await {
            return Ok(status);
        }
        if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Yougori exited during startup ({exit}). If an older desktop version is already open, close it normally and restart the updated build."));
        }
        if Instant::now() >= deadline {
            return Err("Yougori has not exposed its local control endpoint yet. The process was left running; check the desktop before starting another instance.".into());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
