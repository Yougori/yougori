use super::*;
use crate::runtime::{
    available_port, configure_background_process, import_drive, vm, AgentEndpoint, VmProcess,
};
use crate::{file_import::copy_files, models::*, store::PlatformStore};
use serde_json::json;
use std::{fs, process::Stdio};

fn environment(id: &str, kind: EnvironmentKind) -> Environment {
    let mut value = json!({"id":id,"name":id,"kind":"container","status":"running","runtime":"builtin:alpine","description":"File-copy fixture","createdAt":"2026-09-10T00:00:00Z","cpuUsage":0,"memoryUsageGb":0,"storageDeltaGb":0,"networkRxMbps":0,"resourcePolicy":{"cpu":{"min":1,"preferred":1,"max":1,"current":0},"memoryGb":{"min":0.5,"preferred":0.5,"max":0.5,"current":0},"priority":"normal","dynamic":false}});
    value["kind"] = serde_json::to_value(&kind).unwrap();
    let mut env: Environment = serde_json::from_value(value).unwrap();
    env.provider = Some(if kind == EnvironmentKind::Container {
        RuntimeProviderKind::OpenDockOci
    } else {
        RuntimeProviderKind::Qemu
    });
    env
}

async fn execute(
    runtime: &RuntimeManager,
    env: &Environment,
    command: &str,
) -> Result<CommandResult, String> {
    if env.kind == EnvironmentKind::Container {
        runtime.execute_container_command(&env.id, command).await
    } else {
        runtime.execute_micro_vm_command(&env.id, command).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "boots only disposable container and microVM fixtures; copies, edits and deletes fixture files"]
async fn file_import_real_container_and_microvm_preserve_host_sources() -> Result<(), String> {
    let data = tempfile::tempdir().unwrap();
    let runtime = RuntimeManager::new(Path::new(env!("CARGO_MANIFEST_DIR")), data.path())?;
    let store = PlatformStore::load(data.path().join("state.json"))?;
    let source = data.path().join("source folder ü");
    fs::create_dir_all(source.join("nested/empty")).unwrap();
    fs::write(source.join("nested/data.bin"), vec![0x42; 300_000]).unwrap();
    fs::write(source.join(".hidden"), b"host-original").unwrap();
    let result = async {
        for (id, kind, nonroot) in [("import-container", EnvironmentKind::Container, false), ("import-container-user", EnvironmentKind::Container, true), ("import-micro", EnvironmentKind::MicroVm, false)] {
            let env = environment(id, kind.clone());
            if kind == EnvironmentKind::Container {
                let command = if nonroot { "exec su -s /bin/sh nobody -c 'exec sleep 2147483647'" } else { "sleep 2147483647" };
                runtime.provision_container(&env.id, "quay.io/libpod/alpine:latest", command, &env.resource_policy, false, false).await?;
                runtime.container_action(&env.id, "start", false).await?;
            } else {
                let provisioned = runtime.provision_micro_vm(&env.id, "builtin:alpine").await?;
                runtime.start_micro_vm(&env.id, &provisioned.disk_path, &provisioned.source_path, &env.resource_policy).await?;
            }
            store.mutate(|state| { state.environments.push(env.clone()); Ok(()) })?;
            let deadline = Instant::now() + Duration::from_secs(90);
            loop { if execute(&runtime, &env, "true").await.is_ok() { break; } if Instant::now() >= deadline { return Err("Guest did not become ready".into()); } tokio::time::sleep(Duration::from_millis(300)).await; }
            let copy = copy_files(&env.id, vec![source.to_string_lossy().into_owned()], &store, &runtime, |_| {}).await?;
            let duplicate = copy_files(&env.id, vec![source.to_string_lossy().into_owned()], &store, &runtime, |_| {}).await?;
            if copy.destination == duplicate.destination { return Err("Repeated drop reused the first destination".into()); }
            let path = format!("{}/source folder ü", copy.destination);
            if nonroot {
                let owned = execute(&runtime, &env, &format!("test $(stat -c %u '{path}') = 65534 && su -s /bin/sh nobody -c \"printf user-edit > '{path}/user-created'\"" )).await?;
                if owned.exit_code != 0 { return Err(format!("Non-root container cannot edit imported files: {}", owned.stderr)); }
            }
            let check = execute(&runtime, &env, &format!("test -d '{path}/nested/empty' && test \"$(wc -c < '{path}/nested/data.bin')\" = 300000 && test \"$(cat '{path}/.hidden')\" = host-original && printf guest-edit > '{path}/nested/data.bin' && rm '{path}/.hidden'" )).await?;
            if check.exit_code != 0 { return Err(format!("Guest copy verification failed: {}", check.stderr)); }
            if fs::read(source.join("nested/data.bin")).unwrap() != vec![0x42; 300_000] || fs::read(source.join(".hidden")).unwrap() != b"host-original" { return Err("Host originals were changed".into()); }
            let repeated_path = format!("{}/source folder ü/.hidden", duplicate.destination);
            let kept = execute(&runtime, &env, &format!("cat '{repeated_path}'")).await?;
            if kept.stdout != "host-original" { return Err("Independent guest copies affected each other".into()); }
            eprintln!("{}: nested copies, binary data, repeated drops and host preservation passed", env.id);
        }
        Ok(())
    }.await;
    runtime.shutdown_all().await;
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "creates 100,005 fixture files and imports them into a disposable container"]
async fn file_import_real_large_folder_exceeds_previous_item_limit() -> Result<(), String> {
    let data = tempfile::tempdir().unwrap();
    let source = data.path().join("large-project");
    fs::create_dir(&source).unwrap();
    const FILES: usize = 100_005;
    eprintln!("Creating {FILES} original fixture files...");
    for index in 0..FILES {
        fs::write(
            source.join(format!("file-{index:06}.txt")),
            format!("original-{index}"),
        )
        .unwrap();
    }
    fs::create_dir(source.join("empty")).unwrap();
    let sentinel = source.join("file-100004.txt");
    let original_time = fs::metadata(&sentinel).unwrap().modified().unwrap();
    let runtime = RuntimeManager::new(Path::new(env!("CARGO_MANIFEST_DIR")), data.path())?;
    let store = PlatformStore::load(data.path().join("state.json"))?;
    let env = environment("import-large-folder", EnvironmentKind::Container);
    let result = async {
        runtime.provision_container(&env.id, "quay.io/libpod/alpine:latest", "sleep 2147483647", &env.resource_policy, false, false).await?;
        runtime.container_action(&env.id, "start", false).await?;
        store.mutate(|state| { state.environments.push(env.clone()); Ok(()) })?;
        eprintln!("Copying {FILES} files through the desktop scanner, staged archive and guest receiver...");
        let source_path = source.to_string_lossy().into_owned();
        let copy = tokio::time::timeout(Duration::from_secs(600), copy_files(&env.id, vec![source_path], &store, &runtime, |_| {})).await.map_err(|_| "Large-folder fixture timed out")??;
        if copy.files != FILES { return Err(format!("Desktop reported {} copied files instead of {FILES}", copy.files)); }
        let path = format!("{}/large-project", copy.destination);
        let check = execute(&runtime, &env, &format!("test $(find '{path}' -type f | wc -l) = {FILES} && test -d '{path}/empty' && test \"$(cat '{path}/file-100004.txt')\" = original-100004 && printf guest-edit > '{path}/file-100004.txt'")).await?;
        if check.exit_code != 0 { return Err(format!("Large folder did not arrive intact: {}", check.stderr)); }
        if fs::read(&sentinel).unwrap() != b"original-100004" || fs::metadata(&sentinel).unwrap().modified().unwrap() != original_time { return Err("Original source file changed".into()); }
        if fs::read_dir(&source).unwrap().count() != FILES + 1 { return Err("Original source items were removed".into()); }
        if fs::read_dir(runtime.storage_root().join("file-imports")).unwrap().next().is_some() { return Err("Temporary archive or file list was not cleaned up".into()); }
        eprintln!("{FILES} files copied successfully; original contents, timestamps and item count preserved.");
        Ok(())
    }.await;
    runtime.shutdown_all().await;
    result
}

async fn pc_guest(
    runtime: &RuntimeManager,
    env: &Environment,
    disk: &Path,
) -> Result<(u16, String), String> {
    let control = available_port()?;
    let qmp = available_port()?;
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let root = runtime.data_root.join("environments").join(&env.id);
    let mut args = vec!["-name".into(), "Yougori import test".into(), "-machine".into(), "q35".into(), "-accel".into(), "tcg,thread=multi".into(), "-cpu".into(), "max".into(), "-m".into(), "512".into(), "-nodefaults".into(), "-display".into(), "none".into(), "-monitor".into(), "none".into(), "-serial".into(), "stdio".into(),
        "-kernel".into(), runtime.layout.appliance_kernel.to_string_lossy().into_owned(), "-initrd".into(), runtime.layout.appliance_initramfs.to_string_lossy().into_owned(), "-append".into(), format!("root=/dev/vda rw rootfstype=ext4 console=ttyS0 quiet modules=virtio_pci,virtio_blk,virtio_net,ext4 softlevel=microvm opendock.mode=microvm opendock.token={token}"),
        "-blockdev".into(), json!({"driver":"qcow2","node-name":"guest-disk","file":{"driver":"file","filename":disk}}).to_string(), "-device".into(), "virtio-blk-pci,drive=guest-disk".into(),
        "-netdev".into(), format!("user,id=net0,hostfwd=tcp:127.0.0.1:{control}-:7443"), "-device".into(), "virtio-net-pci,netdev=net0".into(),
        "-device".into(), "qemu-xhci,p2=15,p3=15".into(), "-qmp".into(), format!("tcp:127.0.0.1:{qmp},server=on,wait=off")];
    args.extend(import_drive::drive_arguments(&root)?);
    let mut command = tokio::process::Command::new(&runtime.layout.qemu_system);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            fs::File::create(root.join("import-test-serial.log")).unwrap(),
        ))
        .stderr(Stdio::from(
            fs::File::create(root.join("import-test-qemu.log")).unwrap(),
        ))
        .kill_on_drop(true);
    configure_background_process(&mut command);
    let child = command.spawn().map_err(|e| e.to_string())?;
    let process_id = child.id().unwrap();
    runtime.vms.lock().await.insert(
        env.id.clone(),
        VmProcess {
            child,
            _branch_block_server: None,
            _port_reservations: vm::VmPortReservations::new(),
            is_micro_vm: false,
            gpu_enabled: false,
            gpu: None,
            micro_endpoint: Some(AgentEndpoint {
                base_url: format!("http://127.0.0.1:{control}"),
                token: token.clone(),
            }),
            process_id,
            allocated_cpus: 1,
            qmp_port: qmp,
            websocket_port: 0,
            console_password: String::new(),
        },
    );
    let deadline = Instant::now() + Duration::from_secs(100);
    loop {
        if pc_exec(runtime, control, &token, "true").await.is_ok() {
            return Ok((control, token));
        }
        if Instant::now() >= deadline {
            return Err("Disposable Q35 guest did not boot".into());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

async fn pc_exec(
    runtime: &RuntimeManager,
    port: u16,
    token: &str,
    command: &str,
) -> Result<serde_json::Value, String> {
    runtime
        .client
        .post(format!("http://127.0.0.1:{port}/v1/system/exec"))
        .bearer_auth(token)
        .json(&json!({"command":command}))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "boots a disposable Q35 VM to test hot-plug, real guest file access and reconnect after restart"]
async fn file_import_real_vm_drive_hotplug_and_restart() -> Result<(), String> {
    let data = tempfile::tempdir().unwrap();
    let runtime = RuntimeManager::new(Path::new(env!("CARGO_MANIFEST_DIR")), data.path())?;
    let store = PlatformStore::load(data.path().join("state.json"))?;
    let env = environment("import-pc", EnvironmentKind::FullVm);
    let vm = runtime
        .provision_micro_vm(&env.id, "builtin:alpine")
        .await?;
    store.mutate(|state| {
        state.environments.push(env.clone());
        Ok(())
    })?;
    let source = data.path().join("project");
    fs::create_dir_all(source.join("nested")).unwrap();
    fs::write(source.join("nested/hello.txt"), b"host-original").unwrap();
    let result = async {
        let (port, token) = pc_guest(&runtime, &env, &vm.disk_path).await?;
        let initial_storage = runtime.vm_storage_usage(&vm.disk_path).await?;
        copy_files(&env.id, vec![source.to_string_lossy().into_owned()], &store, &runtime, |_| {}).await?;
        let imported_storage = runtime.vm_storage_usage(&vm.disk_path).await?;
        if imported_storage.logical_bytes < initial_storage.logical_bytes + 64 * 1024 * 1024 { return Err("VM storage omits the imported drive".into()); }
        let check = "modprobe vfat; modprobe usb-storage; for i in $(seq 1 40); do test -b /dev/sda && break; sleep 0.1; done; mkdir -p /mnt/import-check; mount /dev/sda /mnt/import-check && cat /mnt/import-check/project/nested/hello.txt";
        let first = pc_exec(&runtime, port, &token, check).await?;
        if first["exitCode"] != 0 || first["stdout"] != "host-original" { return Err(format!("VM import drive failed: {first}")); }
        let edit = pc_exec(&runtime, port, &token, "printf guest-edited > /mnt/import-check/project/nested/hello.txt; sync; umount /mnt/import-check").await?;
        if edit["exitCode"] != 0 { return Err(format!("VM import drive editing failed: {edit}")); }
        if fs::read(source.join("nested/hello.txt")).unwrap() != b"host-original" { return Err("VM editing changed original files".into()); }
        runtime.vm_action(&env.id, "stop").await?;
        let (port, token) = pc_guest(&runtime, &env, &vm.disk_path).await?;
        let second = pc_exec(&runtime, port, &token, check).await?;
        if second["exitCode"] != 0 || second["stdout"] != "guest-edited" { return Err(format!("VM import drive did not survive restart: {second}")); }
        let drives = runtime.imported_drives(&env)?;
        if runtime.set_import_drive_attached(&env, &drives[0].id, false).await.is_ok() { return Err("Allowed disconnect while VM was running".into()); }
        runtime.vm_action(&env.id, "stop").await?;
        let mut stopped = env.clone();
        stopped.status = EnvironmentStatus::Stopped;
        let detached = runtime.set_import_drive_attached(&stopped, &drives[0].id, false).await?;
        if runtime.vm_storage_usage(&vm.disk_path).await?.logical_bytes != imported_storage.logical_bytes { return Err("Disconnected drive disappeared from storage accounting".into()); }
        if detached[0].attached || !import_drive::drive_arguments(&runtime.data_root.join("environments").join(&env.id))?.is_empty() { return Err("Disconnected drive still appears at VM startup".into()); }
        runtime.set_import_drive_attached(&stopped, &drives[0].id, true).await?;
        let (port, token) = pc_guest(&runtime, &env, &vm.disk_path).await?;
        let reconnected = pc_exec(&runtime, port, &token, check).await?;
        if reconnected["exitCode"] != 0 || reconnected["stdout"] != "guest-edited" { return Err(format!("Disconnect/reconnect lost VM file edits: {reconnected}")); }
        eprintln!("Q35 VM: USB hot-plug, real file access, independent edits and reconnect after restart passed");
        Ok(())
    }.await;
    runtime.shutdown_all().await;
    result
}
