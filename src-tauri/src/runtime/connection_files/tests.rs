use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
pub(crate) fn environment(id: &str, kind: EnvironmentKind) -> Environment {
    serde_json::from_value(json!({"id":id,"name":id,"kind":kind,"status":"running","runtime":"test","description":"","createdAt":"test","cpuUsage":0,"memoryUsageGb":0,"storageDeltaGb":0,"networkRxMbps":0,"resourcePolicy":{"cpu":{"min":1,"preferred":1,"max":1,"current":1},"memoryGb":{"min":1,"preferred":1,"max":1,"current":1},"priority":"normal","dynamic":true}})).unwrap()
}
async fn request(files: &SharedFiles, env: &str, body: Value) -> (u16, Value) {
    let body = serde_json::to_vec(&body).unwrap();
    let mut request=format!("POST /api HTTP/1.1\r\nHost: 10.192.0.1:7444\r\nX-OpenDock-Files: 1\r\nContent-Length: {}\r\n\r\n",body.len()).into_bytes();
    request.extend(body);
    let reply = files.http(env, &request).await;
    let split = reply.windows(4).position(|b| b == b"\r\n\r\n").unwrap();
    (
        std::str::from_utf8(&reply[9..12]).unwrap().parse().unwrap(),
        serde_json::from_slice(&reply[split + 4..]).unwrap(),
    )
}
#[tokio::test]
async fn shared_file_permissions_work_for_all_sixteen_local_and_cloud_pairings() {
    for a in [
        EnvironmentKind::Container,
        EnvironmentKind::MicroVm,
        EnvironmentKind::FullVm,
        EnvironmentKind::Cloud,
    ] {
        for b in [
            EnvironmentKind::Container,
            EnvironmentKind::MicroVm,
            EnvironmentKind::FullVm,
            EnvironmentKind::Cloud,
        ] {
            let root = tempfile::tempdir().unwrap();
            let files = SharedFiles::default();
            for both in [false, true] {
                let share = Arc::new(Share {
                    environments: [environment("a", a.clone()), environment("b", b.clone())],
                    source: "a".into(),
                    target: "b".into(),
                    label: "test".into(),
                    both,
                    source_server: HostFolderServer::start(root.path().into(), false)
                        .await
                        .unwrap(),
                    target_server: HostFolderServer::start(root.path().into(), !both)
                        .await
                        .unwrap(),
                });
                files.0.lock().unwrap().insert("conn-test".into(), share);
                let name = if both { "both.txt" } else { "one.txt" };
                assert_eq!(
                    request(
                        &files,
                        "a",
                        json!({"connectionId":"conn-test","operation":"create","path":name})
                    )
                    .await
                    .0,
                    200
                );
                assert_eq!(request(&files,"a",json!({"connectionId":"conn-test","operation":"write","path":name,"data":STANDARD.encode("hello")})).await.0,200);
                let read = request(
                    &files,
                    "b",
                    json!({"connectionId":"conn-test","operation":"read","path":name,"length":5}),
                )
                .await;
                assert_eq!(read.0, 200);
                assert_eq!(read.1["data"], STANDARD.encode("hello"));
                assert_eq!(request(&files,"b",json!({"connectionId":"conn-test","operation":"write","path":name,"data":STANDARD.encode("world")})).await.0,if both {200} else {403});
                assert_eq!(
                    request(
                        &files,
                        "other",
                        json!({"connectionId":"conn-test","operation":"list"})
                    )
                    .await
                    .0,
                    403
                );
                assert_eq!(request(&files,"a",json!({"connectionId":"conn-test","operation":"read","path":"../secret","length":1})).await.0,403);
                files.remove("conn-test");
                assert_eq!(
                    request(
                        &files,
                        "a",
                        json!({"connectionId":"conn-test","operation":"list"})
                    )
                    .await
                    .0,
                    403
                );
                assert!(
                    root.path().join(name).exists(),
                    "disconnect must preserve data"
                );
            }
        }
    }
}
#[tokio::test]
async fn shared_file_service_rejects_browser_cross_origin_and_rebinding() {
    let files = SharedFiles::default();
    for request in ["POST /api HTTP/1.1\r\nHost: 10.192.0.1:7444\r\n\r\n{}", "GET /connections HTTP/1.1\r\nHost: malicious.test\r\n\r\n", "POST /api HTTP/1.1\r\nHost: 10.192.0.1:7444\r\nOrigin: https://evil.test\r\nX-OpenDock-Files: 1\r\n\r\n{}"] {
        assert!(files.http("a",request.as_bytes()).await.starts_with(b"HTTP/1.1 403"));
    }
    let response = String::from_utf8(
        files
            .http("a", b"GET / HTTP/1.1\r\nHost: 10.192.0.1:7444\r\n\r\n")
            .await,
    )
    .unwrap();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("frame-ancestors 'none'"));
    assert!(!response.contains("Access-Control-Allow-Origin"));
}
#[tokio::test]
async fn disconnect_closes_mount_servers_even_with_inflight_share_references() {
    let root = tempfile::tempdir().unwrap();
    let files = SharedFiles::default();
    let share = Arc::new(Share {
        environments: [
            environment("a", EnvironmentKind::Container),
            environment("b", EnvironmentKind::FullVm),
        ],
        source: "a".into(),
        target: "b".into(),
        label: "test".into(),
        both: true,
        source_server: HostFolderServer::start(root.path().into(), false)
            .await
            .unwrap(),
        target_server: HostFolderServer::start(root.path().into(), false)
            .await
            .unwrap(),
    });
    files
        .0
        .lock()
        .unwrap()
        .insert("conn-test".into(), share.clone());
    files.remove_environment("a");
    tokio::task::yield_now().await;
    assert!(reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/", share.source_server.port))
        .send()
        .await
        .is_err());
}
