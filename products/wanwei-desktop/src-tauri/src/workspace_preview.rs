use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
pub(crate) struct Entry {
    name: String,
    directory: bool,
    version: String,
}

fn resolve(root: &str, parts: &[String]) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut path = root.clone();
    for part in parts {
        let component = Path::new(part);
        if !matches!(
            component.components().next(),
            Some(std::path::Component::Normal(_))
        ) || component.components().count() != 1
            || part.contains(['/', '\\', ':'])
        {
            return Err("文件路径无效".into());
        }
        path.push(component);
    }
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.starts_with(root) {
        return Err("文件不在工作区内".into());
    }
    Ok(path)
}

#[tauri::command]
pub(crate) async fn open_workspace_preview(
    app: tauri::AppHandle,
    root: String,
    parts: Vec<String>,
    action: Option<String>,
) -> Result<(), String> {
    let path = resolve(&root, &parts)?;
    if !path.is_file() {
        return Err("文件不存在或不是普通文件".into());
    }
    #[cfg(target_os = "windows")]
    if action.as_deref() == Some("choose-app") {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(&path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    let _ = action;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("系统无法打开此文件，请检查文件关联或选择打开方式：{error}"))
}

#[tauri::command]
pub(crate) async fn list_workspace_preview(
    root: String,
    parts: Vec<String>,
) -> Result<Vec<Entry>, String> {
    let path = resolve(&root, &parts)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if !(kind.is_file() || kind.is_dir()) {
            continue;
        }
        if let Ok(name) = entry.file_name().into_string() {
            if name.starts_with("~$") || name == ".buddy-trash" {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|time| time.as_nanos())
                .unwrap_or(0);
            entries.push(Entry {
                name,
                directory: kind.is_dir(),
                version: format!("{}:{}", metadata.len(), modified),
            });
        }
        if entries.len() > 5_000 {
            return Err("当前文件夹超过 5000 项，请缩小工作区范围".into());
        }
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn mutate_workspace_preview(
    root: String,
    parts: Vec<String>,
    action: String,
    name: Option<String>,
) -> Result<(), String> {
    let valid_name = |name: &str| {
        !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains(['/', '\\', ':', '\0'])
            && !name.ends_with(['.', ' '])
    };
    match action.as_str() {
        "create-file" | "create-directory" => {
            let parent = resolve(&root, &parts)?;
            let name = name.filter(|value| valid_name(value)).ok_or("名称无效")?;
            let target = parent.join(name);
            if action == "create-directory" {
                fs::create_dir(target).map_err(|e| e.to_string())?;
            } else {
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target)
                    .map_err(|e| e.to_string())?;
            }
        }
        "rename" => {
            if parts.is_empty() {
                return Err("不能重命名工作区根目录".into());
            }
            let source = resolve(&root, &parts)?;
            let name = name.filter(|value| valid_name(value)).ok_or("名称无效")?;
            let target = source.parent().ok_or("路径无效")?.join(name);
            if target.exists() {
                return Err("该名称已存在".into());
            }
            fs::rename(source, target).map_err(|e| e.to_string())?;
        }
        "delete" => {
            if parts.is_empty() {
                return Err("不能删除工作区根目录".into());
            }
            let source = resolve(&root, &parts)?;
            let trash = fs::canonicalize(&root)
                .map_err(|e| e.to_string())?
                .join(".buddy-trash");
            if !trash.exists() {
                fs::create_dir(&trash).map_err(|e| e.to_string())?;
            }
            let trash_parts = vec![".buddy-trash".to_string()];
            let trash = resolve(&root, &trash_parts)?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos();
            let target = trash.join(format!(
                "{}-{}",
                stamp,
                source.file_name().ok_or("路径无效")?.to_string_lossy()
            ));
            fs::rename(source, target).map_err(|e| e.to_string())?;
        }
        _ => return Err("不支持的文件操作".into()),
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn read_workspace_preview(
    root: String,
    parts: Vec<String>,
) -> Result<String, String> {
    let path = resolve(&root, &parts)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("只能预览普通文件".into());
    }
    const LIMIT: u64 = 24 * 1024 * 1024;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("文件超过 24 MB，无法预览".into());
    }
    Ok(STANDARD.encode(bytes))
}

const FILE_LIMIT: u64 = 24 * 1024 * 1024;

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("只能读取普通文件".into());
    }
    let mut bytes = Vec::new();
    file.take(FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("文件超过 24 MB".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub(crate) async fn save_workspace_preview(
    root: String,
    parts: Vec<String>,
    expected: String,
    content: String,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::{io::Write, sync::Mutex};
    static SAVE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = SAVE_LOCK.lock().map_err(|_| "无法锁定文件保存")?;
    let path = resolve(&root, &parts)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "txt" | "md" | "markdown" | "htm" | "html" | "docx"
    ) {
        return Err("此格式不支持保存".into());
    }
    if content.len() as u64 > FILE_LIMIT.div_ceil(3) * 4 {
        return Err("文件超过 24 MB".into());
    }
    let bytes = STANDARD.decode(content).map_err(|_| "保存内容无效")?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("文件超过 24 MB".into());
    }
    let parent = path.parent().ok_or("文件目录无效")?;
    let mut draft = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    draft.write_all(&bytes).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    draft
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(|e| e.to_string())?;
    draft.as_file().sync_all().map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(read_bounded(&path)?)) != expected {
        return Err("文件已在其他地方修改，请保留草稿并重新加载后再保存".into());
    }
    draft
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn convert_workspace_preview(
    root: String,
    parts: Vec<String>,
) -> Result<String, String> {
    let path = resolve(&root, &parts)?;
    tauri::async_runtime::spawn_blocking(move || convert_office(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn convert_office(path: &Path) -> Result<String, String> {
    use std::{
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let output = match extension.as_str() {
        "doc" => "docx",
        "xls" => "xlsx",
        "ppt" | "pptx" => "pdf",
        _ => return Err("此格式不支持转换".into()),
    };
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input = directory.path().join(format!("preview.{extension}"));
    fs::write(&input, read_bounded(path)?).map_err(|e| e.to_string())?;
    let profile = url::Url::from_directory_path(directory.path().join("profile"))
        .map_err(|_| "无法初始化文档转换")?;
    let mut candidates: Vec<PathBuf> = std::env::var_os("SOFFICE_PATH")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    if cfg!(windows) {
        candidates.extend(
            [
                "C:/Program Files/LibreOffice/program/soffice.exe",
                "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
            ]
            .map(PathBuf::from),
        );
    } else if cfg!(target_os = "macos") {
        candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
    }
    candidates.push("soffice".into());
    let mut child = None;
    for executable in candidates {
        let mut command = Command::new(executable);
        command
            .arg(format!("-env:UserInstallation={profile}"))
            .args([
                "--headless",
                "--norestore",
                "--convert-to",
                output,
                "--outdir",
            ])
            .arg(directory.path())
            .arg(&input)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(process) => {
                child = Some(process);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    let mut child = child.ok_or("预览此格式需要本机安装 LibreOffice")?;
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err("文档转换失败".into());
            }
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("文档转换超时".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let target = directory.path().join(format!("preview.{output}"));
    if !target.is_file() {
        return Err("转换未生成预览文件，请检查文档是否损坏或加密".into());
    }
    Ok(STANDARD.encode(read_bounded(&target)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn file_operations_preserve_existing_files_and_keep_deleted_content_recoverable() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().to_str().unwrap().to_string();
            mutate_workspace_preview(
                root.clone(),
                vec![],
                "create-file".into(),
                Some("one.txt".into()),
            )
            .await
            .unwrap();
            fs::write(dir.path().join("one.txt"), "keep me").unwrap();
            assert!(mutate_workspace_preview(
                root.clone(),
                vec![],
                "create-file".into(),
                Some("one.txt".into())
            )
            .await
            .is_err());
            assert!(mutate_workspace_preview(
                root.clone(),
                vec![],
                "create-file".into(),
                Some("../outside.txt".into())
            )
            .await
            .is_err());
            assert!(
                mutate_workspace_preview(root.clone(), vec![], "delete".into(), None)
                    .await
                    .is_err()
            );
            mutate_workspace_preview(
                root.clone(),
                vec!["one.txt".into()],
                "rename".into(),
                Some("two.txt".into()),
            )
            .await
            .unwrap();
            mutate_workspace_preview(root.clone(), vec!["two.txt".into()], "delete".into(), None)
                .await
                .unwrap();
            assert!(!dir.path().join("two.txt").exists());
            let recovered = fs::read_dir(dir.path().join(".buddy-trash"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            assert_eq!(fs::read_to_string(recovered).unwrap(), "keep me");
            assert!(list_workspace_preview(root, vec![])
                .await
                .unwrap()
                .is_empty());
        });
    }

    #[test]
    fn rejects_paths_outside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("valid.txt"), "ok").unwrap();
        let root = dir.path().to_str().unwrap();
        assert!(resolve(root, &["..".into()]).is_err());
        assert!(resolve(root, &["a/b".into()]).is_err());
        assert!(resolve(root, &["C:bad".into()]).is_err());
        assert!(resolve(root, &["valid.txt".into()]).is_ok());
    }

    #[test]
    fn saves_atomically_and_rejects_stale_content() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("test.txt");
            fs::write(&path, "original").unwrap();
            let root = dir.path().to_str().unwrap().to_string();
            let expected = format!("{:x}", Sha256::digest(b"original"));
            save_workspace_preview(
                root.clone(),
                vec!["test.txt".into()],
                expected.clone(),
                STANDARD.encode("updated"),
            )
            .await
            .unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), "updated");
            let failure = save_workspace_preview(
                root,
                vec!["test.txt".into()],
                expected,
                STANDARD.encode("stale"),
            )
            .await
            .unwrap_err();
            assert!(failure.contains("修改"));
            assert_eq!(fs::read_to_string(&path).unwrap(), "updated");
        });
    }
}
