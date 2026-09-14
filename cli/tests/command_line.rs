//! Real standalone process tests. These must never dispatch a mutation or use
//! the developer's personal skills directory, even if a desktop engine is open.
use serde_json::Value;
use std::process::{Command, Output};

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_yougori-cli"))
        .args(args)
        .output()
        .unwrap()
}
fn response(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn offline_help_and_catalog_expose_all_features() {
    let help = cli(&["env", "create", "--help"]);
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("Yougori CLI"));
    assert!(!String::from_utf8_lossy(&help.stdout).contains("OpenDock"));
    assert!(String::from_utf8_lossy(&help.stdout).contains("--startup image"));
    let version = cli(&["--version"]);
    assert!(version.status.success());
    assert!(String::from_utf8_lossy(&version.stdout).starts_with("yougori-cli "));
    assert_eq!(yougori_cli::SKILL.lines().nth(1), Some("name: yougori"));
    let schema = cli(&["schema"]);
    assert!(schema.status.success());
    let parsed = response(&schema);
    assert_eq!(
        parsed["methods"].as_array().unwrap().len(),
        yougori_cli::catalog::methods().len()
    );
    for method in [
        "create_environment",
        "attach_host_folder",
        "publish_environment_service",
        "verify_environment_cuda",
    ] {
        assert!(parsed["methods"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["name"] == method));
    }
}

#[test]
fn missing_confirmation_fails_before_connecting() {
    let output = cli(&["env", "delete", "test-id-never-dispatched"]);
    assert!(!output.status.success());
    let parsed = response(&output);
    assert_eq!(parsed["ok"], false);
    assert!(parsed["error"].as_str().unwrap().contains("--yes"));
}

#[test]
fn file_and_stdin_json_accept_bom_and_reject_oversized_input() {
    use std::io::Write;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("request.json");
    let bytes = b"\xef\xbb\xbf{\"environmentId\":\"test-id-never-dispatched\"}";
    std::fs::write(&path, bytes).unwrap();
    let output = cli(&[
        "call",
        "delete_environment",
        "--file",
        path.to_str().unwrap(),
    ]);
    assert!(!output.status.success());
    assert!(response(&output)["error"]
        .as_str()
        .unwrap()
        .contains("--yes"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_yougori-cli"))
        .args(["call", "delete_environment", "--file", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(bytes).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert!(response(&output)["error"]
        .as_str()
        .unwrap()
        .contains("--yes"));
    std::fs::write(&path, vec![b' '; yougori_cli::wire::MAX_REQUEST + 1]).unwrap();
    let output = cli(&[
        "call",
        "delete_environment",
        "--file",
        path.to_str().unwrap(),
    ]);
    assert!(!output.status.success());
    assert!(response(&output)["error"]
        .as_str()
        .unwrap()
        .contains("exceeds"));
}

#[test]
fn skill_install_is_complete_and_never_overwrites_an_existing_skill() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("opendock");
    let output = cli(&["skills", "install", "--path", path.to_str().unwrap()]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let skill = std::fs::read_to_string(path.join("SKILL.md")).unwrap();
    assert!(skill.starts_with(yougori_cli::SKILL));
    assert!(skill.contains(env!("CARGO_BIN_EXE_yougori-cli")));
    assert_eq!(
        std::fs::read_to_string(path.join("references/cli.md")).unwrap(),
        yougori_cli::GUIDE
    );
    let again = cli(&["skills", "install", "--path", path.to_str().unwrap()]);
    assert!(!again.status.success());
    assert_eq!(
        std::fs::read_to_string(path.join("SKILL.md")).unwrap(),
        skill
    );
}
