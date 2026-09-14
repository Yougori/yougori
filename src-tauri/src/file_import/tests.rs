use super::*;
use std::io::{Read, Seek, SeekFrom};

fn fixture() -> (tempfile::TempDir, PathBuf, Vec<u8>) {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("Project ü ' $()");
    fs::create_dir_all(folder.join("nested/empty")).unwrap();
    let bytes: Vec<_> = (0..300_000).map(|i| (i % 251) as u8).collect();
    fs::write(folder.join("nested/data.bin"), &bytes).unwrap();
    fs::write(folder.join(".hidden"), b"keep me").unwrap();
    fs::write(folder.join("zero"), []).unwrap();
    (root, folder, bytes)
}

#[test]
fn file_import_copies_nested_binary_and_hidden_files_without_touching_sources() {
    let (_root, folder, bytes) = fixture();
    let before = fs::metadata(folder.join("nested/data.bin"))
        .unwrap()
        .modified()
        .unwrap();
    let plan = plan_copy(&[folder.to_string_lossy().into_owned()]).unwrap();
    assert_eq!(plan.files, 3);
    let stage = tempfile::tempdir().unwrap();
    let archive = stage.path().join("copy.tar");
    write_archive(&plan, &archive, |_| {}).unwrap();
    let copy = stage.path().join("unpacked");
    fs::create_dir(&copy).unwrap();
    tar::Archive::new(fs::File::open(&archive).unwrap())
        .unpack(&copy)
        .unwrap();
    let copied = copy.join(folder.file_name().unwrap());
    assert_eq!(fs::read(copied.join("nested/data.bin")).unwrap(), bytes);
    assert!(copied.join("nested/empty").is_dir());
    assert!(copied.join(".hidden").is_file());
    fs::write(copied.join("nested/data.bin"), b"guest edits").unwrap();
    fs::remove_file(copied.join(".hidden")).unwrap();
    assert_eq!(fs::read(folder.join("nested/data.bin")).unwrap(), bytes);
    assert_eq!(
        fs::metadata(folder.join("nested/data.bin"))
            .unwrap()
            .modified()
            .unwrap(),
        before
    );
    assert_eq!(fs::read(folder.join(".hidden")).unwrap(), b"keep me");
    assert!(write_archive(&plan, &archive, |_| {}).is_err());
}

#[test]
fn file_import_drive_is_independent_and_contains_real_nested_files() {
    let (_root, folder, bytes) = fixture();
    let plan = plan_copy(&[folder.to_string_lossy().into_owned()]).unwrap();
    let stage = tempfile::tempdir().unwrap();
    let path = stage.path().join("copy.img");
    drive::write_drive(&plan, &path, |_| {}).unwrap();
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    let disk = fatfs::FileSystem::new(file, fatfs::FsOptions::new()).unwrap();
    let root = disk.root_dir();
    let mut copied = root
        .open_file(&format!(
            "{}/nested/data.bin",
            folder.file_name().unwrap().to_string_lossy()
        ))
        .unwrap();
    let mut contents = Vec::new();
    copied.read_to_end(&mut contents).unwrap();
    assert_eq!(contents, bytes);
    copied.seek(SeekFrom::Start(0)).unwrap();
    std::io::Write::write_all(&mut copied, b"guest edit").unwrap();
    assert_eq!(fs::read(folder.join("nested/data.bin")).unwrap(), bytes);
}

#[test]
fn file_import_rejects_duplicate_roots_and_sources_changed_during_copy() {
    let (_root, folder, _) = fixture();
    let selection = folder.to_string_lossy().into_owned();
    assert!(plan_copy(&[selection.clone(), selection.clone()]).is_err());
    assert!(plan_copy(&["relative/path".into()]).is_err());
    let plan = plan_copy(&[selection]).unwrap();
    fs::write(folder.join("nested/data.bin"), b"saved new data").unwrap();
    let stage = tempfile::tempdir().unwrap();
    assert!(write_archive(&plan, &stage.path().join("copy.tar"), |_| {})
        .unwrap_err()
        .contains("changed"));
    assert_eq!(
        fs::read(folder.join("nested/data.bin")).unwrap(),
        b"saved new data"
    );
}

#[test]
fn file_import_skips_linked_folders_without_reading_their_contents() {
    let (_root, folder, _) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("private.txt"), b"outside selection").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), folder.join("linked")).unwrap();
    #[cfg(windows)]
    {
        // Junctions work without developer mode or administrator privileges.
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(folder.join("linked"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    let plan = plan_copy(&[folder.to_string_lossy().into_owned()]).unwrap();
    assert_eq!(plan.skipped_links, 1);
    assert!(!plan
        .entries()
        .unwrap()
        .any(|e| e.unwrap().source.ends_with("private.txt")));
    assert_eq!(
        fs::read(outside.path().join("private.txt")).unwrap(),
        b"outside selection"
    );
}

#[test]
fn file_import_rejects_a_parent_replaced_by_a_link_after_selection() {
    let (_root, folder, _) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("data.bin"), b"outside selection").unwrap();
    let plan = plan_copy(&[folder.to_string_lossy().into_owned()]).unwrap();
    let entry = plan
        .entries()
        .unwrap()
        .map(Result::unwrap)
        .find(|e| e.source.ends_with("data.bin"))
        .unwrap();
    fs::rename(folder.join("nested"), folder.join("original-nested")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), folder.join("nested")).unwrap();
    #[cfg(windows)]
    assert!(std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(folder.join("nested"))
        .arg(outside.path())
        .output()
        .unwrap()
        .status
        .success());
    assert!(open_source(&entry).is_err());
    assert_eq!(
        fs::read(outside.path().join("data.bin")).unwrap(),
        b"outside selection"
    );
}
