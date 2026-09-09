use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

fn fixture(id: &str, kind: &str) -> Environment {
    serde_json::from_value(json!({
        "id":id,"name":id,"kind":kind,"status":"running","runtime":"builtin:alpine",
        "provider":if kind=="container"{"openDockOci"}else{"qemu"},"runtimeId":id,
        "description":"workspace integration fixture","createdAt":"2026-01-01T00:00:00Z",
        "cpuUsage":0,"memoryUsageGb":0,"storageDeltaGb":0,"networkRxMbps":0,"networkAccess":kind=="container",
        "resourcePolicy":{"cpu":{"min":0.5,"preferred":1,"max":1,"current":1},"memoryGb":{"min":0.125,"preferred":0.25,"max":0.5,"current":0.25},"priority":"normal","dynamic":true}
    })).unwrap()
}

async fn exercise_workspace(kind: &str) -> Result<(), String> {
    let data = tempfile::tempdir().unwrap();
    let selected = tempfile::tempdir().unwrap();
    std::fs::write(selected.path().join("hello.txt"), "selected-folder-only").unwrap();
    let runtime = RuntimeManager::new(&PathBuf::from(env!("CARGO_MANIFEST_DIR")), data.path())?;
    let manager = WorkspaceManager::new(data.path());
    let store = PlatformStore::load(data.path().join("platform-state.json"))?;
    let env = fixture("env-workspace-test", kind);
    let result=async {
        eprintln!("Booting isolated {kind} workspace fixture");
        if kind=="container" {
            runtime.provision_container(&env.id,"quay.io/libpod/alpine:latest","sleep 2147483647",&env.resource_policy,true,false).await?;
            runtime.container_action(&env.id,"start",true).await?;
        } else {
            let provisioned=runtime.provision_micro_vm(&env.id,"builtin:alpine").await?;
            runtime.start_micro_vm(&env.id,&provisioned.disk_path,&provisioned.source_path,&env.resource_policy).await?;
        }
        store.mutate(|s|{s.environments.push(env.clone());Ok(())})?;
        eprintln!("Checking independent persistent PTYs");
        let request=|action:&str,session:&str,data:&str| (format!("/v1/terminal/{action}"),json!({"id":env.id,"sessionId":session,"data":data,"cols":100,"rows":30}));
        for session in ["term-one","term-two"] {let(path,body)=request("create",session,"");runtime.workspace_request(&env,&path,body).await?;}
        let(path,body)=request("write","term-one",&STANDARD.encode(b"export OD_SESSION_MARKER=one; cd /tmp; printf 'READY:%s:%s\\n' \"$OD_SESSION_MARKER\" \"$PWD\"\r"));runtime.workspace_request(&env,&path,body).await?;
        let(path,body)=request("write","term-two",&STANDARD.encode(b"printf 'SECOND:%s\\n' \"${OD_SESSION_MARKER:-empty}\"\r"));runtime.workspace_request(&env,&path,body).await?;
        for(session,expected)in[("term-one","READY:one:/tmp"),("term-two","SECOND:empty")] {
            let deadline=tokio::time::Instant::now()+Duration::from_secs(12);
            loop {let(path,body)=request("read",session,"");let output=runtime.workspace_request(&env,&path,body).await?;let bytes=STANDARD.decode(output["data"].as_str().unwrap_or_default()).map_err(|e|e.to_string())?;if String::from_utf8_lossy(&bytes).contains(expected){break}if tokio::time::Instant::now()>deadline{return Err(format!("Terminal did not produce {expected}: {}",String::from_utf8_lossy(&bytes)));}tokio::time::sleep(Duration::from_millis(150)).await;}
        }
        eprintln!("Starting a localhost-only guest HTTP service");
        let command="/bin/busybox sh -c 'while true; do printf \"HTTP/1.1 200 OK\\r\\nContent-Length: 17\\r\\nConnection: close\\r\\n\\r\\nworkspace-http-ok\" | /bin/busybox nc -l -s 127.0.0.1 -p 4200 -w 2; done' </dev/null >/tmp/opendock-workspace-server.log 2>&1 &";
        let output=if kind=="container"{runtime.execute_container_command(&env.id,command).await?}else{runtime.execute_micro_vm_command(&env.id,command).await?};
        if output.exit_code!=0{return Err(format!("Test HTTP server: {}",output.stderr));}
        tokio::time::sleep(Duration::from_millis(400)).await;
        let services=runtime.workspace_request(&env,"/v1/services/list",json!({"id":env.id})).await?;
        if !services.as_array().unwrap().iter().any(|s|s["port"]==4200){return Err(format!("Missing service discovery: {services}"));}
        let publication=publish_service(env.id.clone(),4200,PublicationKind::Local,None,None,&store,&runtime,&manager).await?;
        let client=reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap();
        let output=client.get(format!("http://127.0.0.1:{}",publication.host_port)).send().await.map_err(|e|e.to_string())?.text().await.map_err(|e|e.to_string())?;
        if output!="workspace-http-ok"{return Err(format!("Guest forwarding returned {output}"));}
        if kind=="container" {
            let output=runtime.execute_container_command(&env.id,&format!("wget -q -T 5 -O - http://10.0.2.2:{}",publication.host_port)).await?;
            if output.exit_code!=0||output.stdout!="workspace-http-ok"{return Err(format!("Local guest route: {} {}",output.stdout,output.stderr));}
            let blocked=runtime.execute_container_command(&env.id,"ping -c 1 -W 1 10.0.2.2 >/dev/null 2>&1").await?;
            if blocked.exit_code==0{return Err("Local publishing opened unrelated host access".into());}
        }
        eprintln!("Checking selected-folder FUSE mounts, write permissions and revocation");
        for read_only in [true,false] {
            let share=attach_folder(env.id.clone(),selected.path().to_string_lossy().into_owned(),read_only,&store,&runtime,&manager).await?;
            let mount=share.mount_path.as_ref().ok_or("Missing FUSE mount")?;
            let command=format!("cat '{mount}/hello.txt'; printf changed > '{mount}/written.txt'");
            let output=if kind=="container"{runtime.execute_container_command(&env.id,&command).await?}else{runtime.execute_micro_vm_command(&env.id,&command).await?};
            if output.stdout!="selected-folder-only"{return Err(format!("Read shared folder: {} {}",output.stdout,output.stderr));}
            if read_only && output.exit_code==0{return Err("Read-only share allowed a write".into());}
            if !read_only && (output.exit_code!=0||std::fs::read_to_string(selected.path().join("written.txt")).unwrap_or_default()!="changed"){return Err(format!("Writable share failed: {}",output.stderr));}
            manager.remove_share(&share.id,&runtime).await;
            let uri=url::Url::parse(&share.guest_url).unwrap();
            if client.get(format!("http://127.0.0.1:{}{}",uri.port().unwrap(),uri.path())).send().await.is_ok(){return Err("Share server still accessible after disconnect".into());}
        }
        for session in ["term-one","term-two"] {let(path,body)=request("close",session,"");runtime.workspace_request(&env,&path,body).await?;}
        if kind=="container"{runtime.container_action(&env.id,"stop",true).await?;}else{runtime.vm_action(&env.id,"stop").await?;}
        store.mutate(|s|{s.environments[0].status=EnvironmentStatus::Stopped;Ok(())})?;
        manager.cleanup(&store,&runtime).await;
        if !manager.publications.lock().await.is_empty(){return Err("Publication survived stopping the environment".into());}
        tokio::time::sleep(Duration::from_millis(100)).await;
        if client.get(format!("http://127.0.0.1:{}",publication.host_port)).send().await.is_ok(){return Err("Published host port remained open".into());}
        Ok(())
    }.await;
    if let Err(error) = &result {
        eprintln!("Workspace failed: {error}");
        if kind == "microVm" {
            let serial = data.path().join("runtime/environments").join(&env.id).join("serial.log");
            if let Ok(log) = std::fs::read_to_string(serial) { eprintln!("Guest boot log: {}", log.chars().rev().take(6000).collect::<String>().chars().rev().collect::<String>()); }
        }
    }
    manager.shutdown(&runtime).await;
    runtime.shutdown_all().await;
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "boots an isolated microVM and tests real PTYs, folder mounts and local service forwarding"]
async fn workspace_microvm_end_to_end() {
    exercise_workspace("microVm").await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "boots an isolated OCI appliance and tests real PTYs, folder mounts and localhost forwarding"]
async fn workspace_container_end_to_end() {
    exercise_workspace("container").await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "starts an isolated q35 VM to check manual port forwarding and concurrent display connections"]
async fn workspace_fullvm_forwarding_and_viewers() {
    let data = tempfile::tempdir().unwrap();
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let runtime = RuntimeManager::new(&resources, data.path()).unwrap();
    let manager = WorkspaceManager::new(data.path());
    let store = PlatformStore::load(data.path().join("state.json")).unwrap();
    let mut env = fixture("env-workspace-desktop", "fullVm");
    env.resource_policy.memory_gb.preferred = 0.5;
    let source = data.path().join("blank.qcow2");
    let mut command =
        tokio::process::Command::new(if cfg!(target_os = "linux") { PathBuf::from("/usr/bin/qemu-img") } else if cfg!(target_os = "macos") { PathBuf::from(if cfg!(target_arch = "aarch64") { "/opt/homebrew/opt/qemu/bin/qemu-img" } else { "/usr/local/opt/qemu/bin/qemu-img" }) } else { resources.join("resources/runtime/qemu/qemu-img.exe") });
    command
        .args(["create", "-f", "qcow2"])
        .arg(&source)
        .arg("128M");
    background(&mut command);
    assert!(command.output().await.unwrap().status.success());
    let provisioned = runtime
        .provision_vm(&env.id, source.to_str().unwrap())
        .await
        .unwrap();
    let console = runtime
        .start_vm(
            &env.id,
            &provisioned.disk_path,
            &provisioned.source_path,
            &env.resource_policy,
            false,
        )
        .await
        .unwrap();
    store
        .mutate(|s| {
            s.environments.push(env.clone());
            Ok(())
        })
        .unwrap();
    let result=async {
        let display_port=url::Url::parse(&console.websocket_url).unwrap().port().unwrap();
        let mut viewers=Vec::new();
        for _ in 0..2 {
            let mut stream=TcpStream::connect(("127.0.0.1",display_port)).await.map_err(|e|e.to_string())?;
            stream.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").await.map_err(|e|e.to_string())?;
            let mut bytes=vec![0;1024];let n=tokio::time::timeout(Duration::from_secs(5),stream.read(&mut bytes)).await.map_err(|e|e.to_string())?.map_err(|e|e.to_string())?;
            if !String::from_utf8_lossy(&bytes[..n]).contains("101 Switching Protocols"){return Err("VM display handshake failed".into());}
            viewers.push(stream);
        }
        let publication=publish_service(env.id.clone(),3000,PublicationKind::Local,None,None,&store,&runtime,&manager).await?;
        let forward_port=manager.publications.lock().await[&publication.id]._vm_forward.as_ref().unwrap().1;
        let probe=TcpStream::connect(("127.0.0.1",forward_port)).await.map_err(|e|format!("QMP hostfwd was not created: {e}"))?;
        drop(probe);
        manager.publications.lock().await.remove(&publication.id);
        tokio::time::sleep(Duration::from_millis(300)).await;
        if TcpStream::connect(("127.0.0.1",forward_port)).await.is_ok(){return Err("QMP hostfwd survived disconnect".into());}
        let selected=tempfile::tempdir().unwrap();
        let share=attach_folder(env.id.clone(),selected.path().to_string_lossy().into_owned(),true,&store,&runtime,&manager).await?;
        if share.mount_path.is_some(){return Err("Agentless VM reported a mounted folder".into());}
        if !share.guest_url.starts_with("http://10.0.2.2:"){return Err("Agentless VM folder URL missing".into());}
        manager.remove_share(&share.id,&runtime).await;
        Ok::<(),String>(())
    }.await;
    manager.shutdown(&runtime).await;
    runtime.shutdown_all().await;
    result.unwrap();
}
