use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Cursor, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    DragDropEvent, LogicalPosition, LogicalSize, Manager, State, WebviewEvent,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

mod automatic_workspace;
mod clipboard_files;
mod expert_artifacts;
mod migration;
mod sidecar_environment;
mod sidecar_output;
mod skillhub;
mod skill_names;
mod network_policy;
mod desktop_update;
mod expert_diagnostics;
mod webview_environment;
#[cfg(target_os = "windows")]
mod windows_input;

const NATIVE_SKILLS_CHANGED_SCRIPT: &str = "window.dispatchEvent(new Event('dsh:skills-changed'));";
const NATIVE_FILE_DRAG_ENTER_SCRIPT: &str =
    "window.dispatchEvent(new Event('dsh:native-file-drag-enter'));";
const NATIVE_FILE_DRAG_LEAVE_SCRIPT: &str =
    "window.dispatchEvent(new Event('dsh:native-file-drag-leave'));";
const NATIVE_FILE_DROP_SCRIPT: &str = "window.dispatchEvent(new Event('dsh:native-file-drop'));";
const WORKSPACE_IMPORT_MAX_FILES: usize = 64;
const WORKSPACE_IMPORT_MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
const WORKSPACE_IMPORT_MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
// Shared local/SkillHub package bound; byte, depth and path checks remain separate.
const LOCAL_SKILL_MAX_ENTRIES: usize = 4096;
const NATIVE_BRIDGE_INITIALIZATION_SCRIPT: &str = r#"
(() => {
  const invoke = (command, argumentsValue) => {
    const nativeInvoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    if (typeof nativeInvoke !== 'function') {
      return Promise.reject(new Error('桌面端原生服务暂不可用，请稍后重试。'));
    }
    return nativeInvoke(command, argumentsValue);
  };
  Object.defineProperty(window, '__ZJUGIS_NATIVE_INVOKE__', {
    value: invoke,
    configurable: true,
  });
})();
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
    one_api_url: String,
    #[serde(default)]
    default_model: String,
    #[serde(default)]
    install_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceCatalog {
    skills: Vec<MarketplaceManifest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceManifest {
    id: String,
    slug: String,
    version: String,
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceSkillState {
    id: String,
    slug: String,
    version: String,
    installed_version: Option<String>,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomSkillFile {
    path: String,
    content: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceImportFile {
    name: String,
    bytes: Vec<u8>,
}

/// One operating-system drop that the renderer may consume exactly once.
struct PendingWorkspaceDrop(Mutex<Option<Vec<PathBuf>>>);

/// Window-content views emit window events; child views emit webview events.
/// Handle both routes, evaluating only in the trusted main renderer.
fn forward_workspace_drop(window: &WebviewWindow, event: &DragDropEvent) {
    let script = match event {
        DragDropEvent::Enter { .. } => NATIVE_FILE_DRAG_ENTER_SCRIPT,
        DragDropEvent::Drop { paths, .. } => {
            let state = window.app_handle().state::<PendingWorkspaceDrop>();
            if let Ok(mut pending) = state.0.lock() {
                *pending = Some(paths.clone());
            }
            NATIVE_FILE_DROP_SCRIPT
        }
        DragDropEvent::Leave => NATIVE_FILE_DRAG_LEAVE_SCRIPT,
        _ => return,
    };
    if let Err(error) = window.eval(script) {
        eprintln!("无法向主页面转发文件拖放事件：{error}");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomSkillState {
    slug: String,
    name: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<Vec<CustomSkillUploadFile>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomSkillUploadFile {
    path: String,
    content_base64: String,
}

/// Notify the live renderer after an installed skill directory changes.
///
/// The local skill provider observes the same directory; this event only drops
/// the renderer's per-session slash-menu cache so the following `/` request
/// reads the updated host catalog instead of requiring a page reload.
fn notify_skill_catalog_changed(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(NATIVE_SKILLS_CHANGED_SCRIPT);
    }
}

/// Give the watched local skill provider time to invalidate its catalog before
/// telling the current page to request it again.
fn wait_for_skill_catalog_observation() {
    std::thread::sleep(Duration::from_millis(400));
}

fn may_open_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn custom_skill_front_matter_value(text: &str, key: &str) -> Option<String> {
    text.lines()
        .take(32)
        .find_map(|line| line.trim().strip_prefix(&format!("{key}:")))
        .map(|value| value.trim().trim_matches(['\'', '"']).to_string())
        .filter(|value| !value.is_empty())
}

fn validate_skill_relative_path(value: &str) -> Result<PathBuf, String> {
    let normalized = value.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains(':')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("技能文件路径无效：{value}"));
    }
    Ok(normalized
        .split('/')
        .fold(PathBuf::new(), |parent, part| parent.join(part)))
}

/// Returns a same-volume staging directory outside the watched skills root.
fn skill_staging_root(skills_root: &Path) -> Result<PathBuf, String> {
    let home = skills_root
        .parent()
        .ok_or_else(|| format!("用户技能目录缺少上级目录 {}", skills_root.display()))?;
    fs::create_dir_all(home)
        .map_err(|error| format!("无法创建技能主目录 {}：{error}", home.display()))?;
    let staging_root = home.join(".dsh-skill-staging");
    if staging_root.exists()
        && fs::symlink_metadata(&staging_root)
            .map_err(|error| format!("无法读取技能暂存目录 {}：{error}", staging_root.display()))?
            .file_type()
            .is_symlink()
    {
        return Err(format!(
            "拒绝使用符号链接技能暂存目录 {}",
            staging_root.display()
        ));
    }
    fs::create_dir_all(&staging_root)
        .map_err(|error| format!("无法创建技能暂存目录 {}：{error}", staging_root.display()))?;
    Ok(staging_root)
}

fn install_custom_skill_at(
    skills_root: &Path,
    slug: &str,
    files: Vec<CustomSkillFile>,
) -> Result<String, String> {
    validate_marketplace_slug(slug)?;
    if files.is_empty() || files.len() > LOCAL_SKILL_MAX_ENTRIES {
        return Err(format!("自定义技能必须包含 1 至 {LOCAL_SKILL_MAX_ENTRIES} 个文件，实际 {} 个", files.len()));
    }
    let mut total = 0usize;
    let mut normalized = Vec::with_capacity(files.len());
    for file in files {
        total = total
            .checked_add(file.content.len())
            .ok_or_else(|| "自定义技能文件总大小无效".to_string())?;
        if total > 16 * 1024 * 1024 {
            return Err("自定义技能文件总大小不能超过 16 MB".to_string());
        }
        normalized.push((validate_skill_relative_path(&file.path)?, file.content));
    }
    let skill_source = normalized
        .iter()
        .find(|(path, _)| path == Path::new("SKILL.md"))
        .ok_or_else(|| "所选目录根部缺少 SKILL.md".to_string())?;
    let skill_text = std::str::from_utf8(&skill_source.1)
        .map_err(|_| "SKILL.md 必须使用 UTF-8 编码".to_string())?;
    if !skill_text
        .lines()
        .take(20)
        .any(|line| line.trim() == format!("name: {slug}"))
    {
        return Err(format!("SKILL.md 的 name 必须为 {slug}"));
    }

    fs::create_dir_all(skills_root)
        .map_err(|error| format!("无法创建用户技能目录 {}：{error}", skills_root.display()))?;
    let target = skills_root.join(slug);
    skill_names::ensure_available(skills_root, &target, &skill_names::from_text(skill_text), false)?;
    if target.exists() {
        return Err(format!("技能 {slug} 已存在，请先卸载后再添加"));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let staging = skill_staging_root(skills_root)?
        .join(format!(".{slug}.custom-{}-{nonce}", std::process::id()));
    let result = (|| {
        for (relative, content) in normalized {
            let destination = staging.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建技能子目录 {}：{error}", parent.display()))?;
            }
            fs::write(&destination, content)
                .map_err(|error| format!("无法写入技能文件 {}：{error}", destination.display()))?;
        }
        fs::write(staging.join(".dsh-custom-skill"), format!("slug={slug}\n"))
            .map_err(|error| format!("无法写入自定义技能标记：{error}"))?;
        fs::rename(&staging, &target)
            .map_err(|error| format!("无法启用自定义技能 {}：{error}", target.display()))?;
        Ok(target.join("SKILL.md").display().to_string())
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Validate and install a local skill directory chosen by the native host picker.
fn install_custom_skill_directory_at(
    skills_root: &Path,
    source: &Path,
) -> Result<CustomSkillState, String> {
    install_custom_skill_directory_named_at(skills_root, source, None)
}

fn install_custom_skill_directory_named_at(
    skills_root: &Path,
    source: &Path,
    display_name: Option<&str>,
) -> Result<CustomSkillState, String> {
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("无法读取个人技能目录 {}：{error}", source.display()))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(format!("个人技能目录无效 {}", source.display()));
    }
    let skill_md = source.join("SKILL.md");
    let skill_md_metadata = fs::symlink_metadata(&skill_md)
        .map_err(|error| format!("所选目录根部缺少 SKILL.md：{error}"))?;
    if skill_md_metadata.file_type().is_symlink() || !skill_md_metadata.is_file() {
        return Err("所选目录根部的 SKILL.md 必须是普通文件".to_string());
    }
    let skill_text =
        fs::read_to_string(&skill_md).map_err(|error| format!("无法读取 SKILL.md：{error}"))?;
    let slug = custom_skill_front_matter_value(&skill_text, "name")
        .ok_or_else(|| "SKILL.md 必须声明 name".to_string())?;
    validate_marketplace_slug(&slug)?;
    let mut file_count = 0usize;
    let mut total_size = 0u64;
    validate_custom_skill_directory_tree(source, 0, &mut file_count, &mut total_size)?;
    let mut upload_files = Vec::with_capacity(file_count);
    collect_custom_skill_upload_files(source, source, &mut upload_files)?;

    if skills_root.exists()
        && fs::symlink_metadata(skills_root)
            .map_err(|error| format!("无法读取用户技能目录 {}：{error}", skills_root.display()))?
            .file_type()
            .is_symlink()
    {
        return Err(format!(
            "拒绝使用符号链接技能根目录 {}",
            skills_root.display()
        ));
    }
    fs::create_dir_all(skills_root)
        .map_err(|error| format!("无法创建用户技能目录 {}：{error}", skills_root.display()))?;
    let target = skills_root.join(&slug);
    let friendly_name = display_name.map(str::to_string).unwrap_or_else(|| skill_names::from_text(&skill_text));
    // Import is an add operation, not an implicit overwrite of a personal skill.
    skill_names::ensure_available(skills_root, &target, &friendly_name, false)?;
    if target.exists() {
        return Err(format!("技能 {slug} 已存在，请使用已有技能，或修改名称和标识后再添加"));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let staging = skill_staging_root(skills_root)?.join(format!(
        ".{slug}.custom-directory-{}-{nonce}",
        std::process::id()
    ));
    let result = (|| {
        copy_marketplace_directory(source, &staging)?;
        skill_names::persist(&staging, &friendly_name)?;
        fs::write(staging.join(".dsh-custom-skill"), format!("slug={slug}\n"))
            .map_err(|error| format!("无法写入自定义技能标记：{error}"))?;
        if let Err(error) = fs::rename(&staging, &target) {
            return Err(format!("无法启用自定义技能 {}：{error}", target.display()));
        }
        Ok(CustomSkillState {
            slug,
            name: friendly_name,
            description: custom_skill_front_matter_value(&skill_text, "description")
                .unwrap_or_else(|| "本地添加的自定义技能。".to_string()),
            body: Some(skill_text),
            files: Some(upload_files),
        })
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Extract and install a ZIP containing one skill directory.
fn install_custom_skill_archive_at(
    skills_root: &Path,
    archive_bytes: Vec<u8>,
) -> Result<CustomSkillState, String> {
    install_custom_skill_archive_named_at(skills_root, archive_bytes, None)
}

fn install_custom_skill_archive_named_at(
    skills_root: &Path, archive_bytes: Vec<u8>, display_name: Option<&str>,
) -> Result<CustomSkillState, String> {
    if archive_bytes.is_empty() || archive_bytes.len() > 16 * 1024 * 1024 {
        return Err("个人技能 ZIP 大小必须在 1 字节到 16 MB 之间".to_string());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let extraction = skill_staging_root(skills_root)?
        .join(format!(".custom-archive-{}-{nonce}", std::process::id()));
    let result = (|| {
        fs::create_dir_all(&extraction)
            .map_err(|error| format!("无法创建 ZIP 解压目录 {}：{error}", extraction.display()))?;
        let mut archive = zip::ZipArchive::new(Cursor::new(archive_bytes))
            .map_err(|error| format!("个人技能 ZIP 无效：{error}"))?;
        if archive.len() > LOCAL_SKILL_MAX_ENTRIES {
            return Err(format!("个人技能 ZIP 最多包含 {LOCAL_SKILL_MAX_ENTRIES} 个条目，实际 {} 个（含文件和目录）", archive.len()));
        }
        let mut total_size = 0u64;
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|error| format!("无法读取个人技能 ZIP：{error}"))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("个人技能 ZIP 包含不安全路径：{}", entry.name()))?
                .to_path_buf();
            if relative.as_os_str().is_empty() {
                continue;
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(format!("个人技能 ZIP 不能包含符号链接：{}", entry.name()));
            }
            let destination = extraction.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&destination).map_err(|error| {
                    format!("无法创建 ZIP 子目录 {}：{error}", destination.display())
                })?;
                continue;
            }
            total_size = total_size
                .checked_add(entry.size())
                .ok_or_else(|| "个人技能 ZIP 解压大小无效".to_string())?;
            if total_size > 16 * 1024 * 1024 {
                return Err("个人技能 ZIP 解压后不能超过 16 MB".to_string());
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("无法创建 ZIP 子目录 {}：{error}", parent.display())
                })?;
            }
            let mut output = fs::File::create(&destination)
                .map_err(|error| format!("无法写入 ZIP 文件 {}：{error}", destination.display()))?;
            let declared_size = entry.size();
            let copied = std::io::copy(&mut entry.take(declared_size + 1), &mut output)
                .map_err(|error| format!("无法解压 ZIP 文件 {}：{error}", destination.display()))?;
            if copied != declared_size {
                return Err("ZIP 文件实际大小与声明不符".to_string());
            }
        }
        let source = if extraction.join("SKILL.md").is_file() {
            extraction.clone()
        } else {
            let directories = fs::read_dir(&extraction)
                .map_err(|error| format!("无法读取 ZIP 解压目录：{error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法读取 ZIP 解压条目：{error}"))?
                .into_iter()
                .filter(|entry| entry.path().is_dir())
                .collect::<Vec<_>>();
            if directories.len() != 1 || !directories[0].path().join("SKILL.md").is_file() {
                return Err("个人技能 ZIP 根目录或唯一的一级目录中必须包含 SKILL.md".to_string());
            }
            directories[0].path()
        };
        install_custom_skill_directory_named_at(skills_root, &source, display_name)
    })();
    if extraction.exists() {
        let _ = fs::remove_dir_all(&extraction);
    }
    result
}

fn collect_custom_skill_upload_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<CustomSkillUploadFile>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("无法枚举个人技能目录 {}：{error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取个人技能目录项：{error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = entry
            .file_type()
            .map_err(|error| format!("无法读取个人技能目录项类型 {}：{error}", path.display()))?;
        if metadata.is_dir() {
            collect_custom_skill_upload_files(root, &path, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "个人技能目录只能包含普通文件或目录 {}",
                path.display()
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("无法计算技能文件相对路径：{error}"))?
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read(&path)
            .map_err(|error| format!("无法读取个人技能文件 {}：{error}", path.display()))?;
        files.push(CustomSkillUploadFile {
            path: relative,
            content_base64: BASE64_STANDARD.encode(content),
        });
    }
    Ok(())
}

fn validate_custom_skill_directory_tree(
    directory: &Path,
    depth: usize,
    file_count: &mut usize,
    total_size: &mut u64,
) -> Result<(), String> {
    if depth > 16 {
        return Err("个人技能目录层级不能超过 16 层".to_string());
    }
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("无法枚举个人技能目录 {}：{error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取个人技能目录项：{error}"))?;
        let metadata = entry.file_type().map_err(|error| {
            format!(
                "无法读取个人技能目录项类型 {}：{error}",
                entry.path().display()
            )
        })?;
        if metadata.is_symlink() {
            return Err(format!(
                "个人技能目录不能包含符号链接 {}",
                entry.path().display()
            ));
        }
        if metadata.is_dir() {
            validate_custom_skill_directory_tree(&entry.path(), depth + 1, file_count, total_size)?;
        } else if metadata.is_file() {
            *file_count += 1;
            if *file_count > LOCAL_SKILL_MAX_ENTRIES {
                return Err(format!("自定义技能最多包含 {LOCAL_SKILL_MAX_ENTRIES} 个文件，实际至少 {} 个", *file_count));
            }
            let size = fs::metadata(entry.path())
                .map_err(|error| {
                    format!("无法读取个人技能文件 {}：{error}", entry.path().display())
                })?
                .len();
            *total_size = total_size
                .checked_add(size)
                .ok_or_else(|| "自定义技能文件总大小无效".to_string())?;
            if *total_size > 16 * 1024 * 1024 {
                return Err("自定义技能文件总大小不能超过 16 MB".to_string());
            }
        } else {
            return Err(format!(
                "个人技能目录只能包含普通文件或目录 {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
fn install_custom_skill(
    app: tauri::AppHandle,
    slug: String,
    files: Vec<CustomSkillFile>,
) -> Result<String, String> {
    let _guard = skill_names::INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    let installed = install_custom_skill_at(&user_skills_root(&app)?, &slug, files)?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(installed)
}

#[tauri::command]
fn install_custom_skill_directory(
    app: tauri::AppHandle,
    directory: String,
    display_name: Option<String>,
) -> Result<CustomSkillState, String> {
    let _guard = skill_names::INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    let installed =
        install_custom_skill_directory_named_at(&user_skills_root(&app)?, Path::new(&directory), display_name.as_deref())?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(installed)
}

#[tauri::command]
fn install_custom_skill_archive(
    app: tauri::AppHandle,
    archive: Vec<u8>,
    display_name: Option<String>,
) -> Result<CustomSkillState, String> {
    let _guard = skill_names::INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    let installed = install_custom_skill_archive_named_at(&user_skills_root(&app)?, archive, display_name.as_deref())?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(installed)
}

#[tauri::command]
fn list_custom_skills(app: tauri::AppHandle) -> Result<Vec<CustomSkillState>, String> {
    let root = user_skills_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut skills = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("无法读取用户技能目录 {}：{error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取用户技能：{error}"))?;
        if entry.path().join(".dsh-custom-skill").is_file() {
            if let Some(slug) = entry.file_name().to_str() {
                let skill_md = fs::read_to_string(entry.path().join("SKILL.md"))
                    .map_err(|error| format!("无法读取自定义技能 {slug} 的 SKILL.md：{error}"))?;
                skills.push(CustomSkillState {
                    slug: slug.to_string(),
                    name: skill_names::display_name(&entry.path())?,
                    description: custom_skill_front_matter_value(&skill_md, "description")
                        .unwrap_or_else(|| "本地添加的自定义技能。".to_string()),
                    body: None,
                    files: None,
                });
            }
        }
    }
    skills.sort_by(|left, right| left.slug.cmp(&right.slug));
    Ok(skills)
}

#[tauri::command]
fn uninstall_custom_skill(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    validate_marketplace_slug(&slug)?;
    let directory = user_skills_root(&app)?.join(&slug);
    if !directory.exists() {
        return Ok(());
    }
    let marker = directory.join(".dsh-custom-skill");
    if !marker.is_file() {
        return Err(format!("技能 {slug} 不是通过“添加技能”安装的，拒绝删除"));
    }
    fs::remove_dir_all(&directory)
        .map_err(|error| format!("无法移除自定义技能 {}：{error}", directory.display()))?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(())
}

/// Read a compact, skill-generated analysis view for the desktop conversation UI.
///
/// The command deliberately accepts only the timestamped analysis-view JSON files
/// created by the bundled GIS skills, including their Chinese production names.
#[tauri::command]
fn read_analysis_view(path: String) -> Result<String, String> {
    let candidate = PathBuf::from(&path);
    if !candidate.is_absolute() {
        return Err("分析结果路径必须是绝对路径".to_string());
    }
    let filename = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "分析结果文件名无效".to_string())?;
    if !(filename.contains("-analysis-view_")
        || filename.contains("分析视图_")
        || filename.contains("审查视图_"))
        || !filename.ends_with(".json")
    {
        return Err("只能读取本次分析生成的结果视图文件".to_string());
    }
    let metadata = fs::metadata(&candidate)
        .map_err(|error| format!("无法读取分析结果文件 {}：{error}", candidate.display()))?;
    if !metadata.is_file() {
        return Err("分析结果路径不是文件".to_string());
    }
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("分析结果文件过大，无法在对话中展示".to_string());
    }
    fs::read_to_string(&candidate)
        .map_err(|error| format!("无法读取分析结果文件 {}：{error}", candidate.display()))
}

struct Sidecar(Arc<Mutex<Option<Child>>>, Mutex<mpsc::Receiver<String>>);

impl Sidecar {
    /// Ask the owned runtime to veto busy work, dispose fully, and exit. Never kill here.
    fn prepare_update(&self) -> Result<(), String> {
        let replies = self.1.lock().map_err(|_| "无法读取后台状态")?;
        let mut guard = self.0.lock().map_err(|_| "无法读取后台进程")?;
        let child = guard.as_mut().ok_or("后台进程不存在，请重启桌面端")?;
        while replies.try_recv().is_ok() {}
        child.stdin.as_mut().ok_or("当前后台不支持安全更新，请手动安装")?
            .write_all(b"wanwei-update-shutdown\n").map_err(|error| error.to_string())?;
        match replies.recv_timeout(Duration::from_secs(30)).as_deref() {
            Ok("clean") => {},
            Ok("busy") => return Err("仍有会话、工具或自动化正在执行，请结束任务后再检查更新。下载已保留。".into()),
            _ => return Err("后台未能确认安全退出，本次不安装。请检查日志并重启桌面端。".into()),
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            match child.try_wait().map_err(|error| error.to_string())? {
                Some(status) if status.success() => { *guard = None; return Ok(()); },
                Some(_) => return Err("后台异常退出，本次不安装更新".into()),
                None if std::time::Instant::now() >= deadline => return Err("后台进程尚未退出，本次不安装更新".into()),
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    }
    /// Stop the Node runtime before terminating the native shell. This makes
    /// upgrades deterministic: `sharp` keeps libvips loaded while Node lives.
    fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

const NATIVE_AUTH_TITLE_PREFIX: &str = "__zjugis_native_auth:";

/// The application is rendered by a sidecar on an external URL. Its
/// JavaScript Tauri bridge is therefore optional; this native helper remains
/// the source of truth for the two shell window modes.
fn apply_auth_window_state(
    window: &tauri::WebviewWindow,
    authenticated: bool,
) -> Result<(), String> {
    window
        .set_resizable(authenticated)
        .map_err(|error| format!("Unable to set resize permission: {error}"))?;
    window
        .set_maximizable(authenticated)
        .map_err(|error| format!("Unable to set maximize permission: {error}"))?;

    if !authenticated {
        let _ = window.unmaximize();
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(1120.0, 720.0)))
            .map_err(|error| format!("Unable to restore login window size: {error}"))?;
        let _ = window.center();
    }
    Ok(())
}

#[tauri::command]
fn set_auth_window_state(app: tauri::AppHandle, authenticated: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window has not been created yet".to_string())?;
    apply_auth_window_state(&window, authenticated)
}

fn validate_marketplace_slug(slug: &str) -> Result<(), String> {
    let valid = !slug.is_empty()
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
        && slug.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if valid {
        Ok(())
    } else {
        Err("技能标识必须使用小写字母、数字和单个连字符".to_string())
    }
}

fn development_harness_home(app_data_dir: &Path) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        Some(app_data_dir.join("development").join("dsh-home"))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app_data_dir;
        None
    }
}

fn product_harness_home(app_data_dir: &Path) -> Result<PathBuf, String> {
    if let Some(home) = development_harness_home(app_data_dir) {
        return Ok(home);
    }
    Ok(isolated_harness_home(app_data_dir))
}

fn isolated_harness_home(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("dsh-home")
}

fn ensure_product_profile(home: &Path) -> Result<(), String> {
    let directory = home.join("profiles").join("wanwei-desktop");
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Unable to create product profile {}: {error}",
            directory.display()
        )
    })?;
    let manifest = directory.join("package.json");
    if !manifest.exists() {
        fs::write(
            &manifest,
            concat!(
                "{\n",
                "  \"name\": \"dsh-profile-wanwei-desktop\",\n",
                "  \"private\": true,\n",
                "  \"dependencies\": {},\n",
                "  \"dsh\": {\n",
                "    \"profile\": {\n",
                "      \"bundles\": [\n",
                "        \"@deepseek-ai/dsh-base\",\n",
                "        \"@deepseek-ai/dsh-web-app\",\n",
                "        \"@deepseek-ai/dsh-wanwei-desktop\"\n",
                "      ],\n",
                "      \"patchReload\": \"live\"\n",
                "    }\n",
                "  }\n",
                "}\n"
            ),
        )
        .map_err(|error| format!("Unable to create {}: {error}", manifest.display()))?;
    }
    let patch = directory.join("cordis.patch.yml");
    if !patch.exists() {
        fs::write(
            &patch,
            "# Product user overrides are applied after the desktop bundle.\n[]\n",
        )
        .map_err(|error| format!("Unable to create {}: {error}", patch.display()))?;
    }
    let workspace = directory.join("pnpm-workspace.yaml");
    if !workspace.exists() {
        fs::write(
            &workspace,
            "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
        )
        .map_err(|error| format!("Unable to create {}: {error}", workspace.display()))?;
    }
    Ok(())
}

fn user_skills_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位桌面应用数据目录：{error}"))?;
    Ok(product_harness_home(&app_data_dir)?.join("skills"))
}

fn user_downloads_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法定位当前用户目录".to_string())?;
    Ok(PathBuf::from(home).join("Downloads"))
}

fn save_session_log_archive_at(
    downloads_root: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name.len() > 180
        || !file_name.ends_with(".zip")
        || Path::new(file_name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(file_name)
        || !file_name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("导出文件名无效".to_string());
    }
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("Session 导出文件超过 512 MB 限制".to_string());
    }
    fs::create_dir_all(downloads_root)
        .map_err(|error| format!("无法创建下载目录 {}：{error}", downloads_root.display()))?;

    let stem = file_name.trim_end_matches(".zip");
    for suffix in 0..10_000 {
        let name = if suffix == 0 {
            file_name.to_string()
        } else {
            format!("{stem}-{suffix}.zip")
        };
        let destination = downloads_root.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .and_then(|()| file.sync_all())
                    .map_err(|error| {
                        let _ = fs::remove_file(&destination);
                        format!(
                            "无法写入 Session 导出文件 {}：{error}",
                            destination.display()
                        )
                    })?;
                return Ok(destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "无法创建 Session 导出文件 {}：{error}",
                    destination.display()
                ))
            }
        }
    }
    Err("下载目录中存在过多同名 Session 导出文件".to_string())
}

/// Persist a Host-exported Session archive through the desktop shell rather
/// than relying on WebView anchor-download support.
#[tauri::command]
fn save_session_log_archive(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let destination = save_session_log_archive_at(&user_downloads_root()?, &file_name, &bytes)?;
    Ok(destination.display().to_string())
}

/// Only the native save dialog, never a remote website, chooses the destination.
#[tauri::command]
async fn save_expert_artifact(
    webview: tauri::Webview,
    file_name: String,
    bytes_base64: String,
) -> Result<Option<String>, String> {
    if !webview.label().starts_with("expert-") {
        return Err("仅专家工作台可保存专家成果".into());
    }
    if bytes_base64.len() > (expert_artifacts::MAX_BYTES / 3 + 1) * 4 {
        return Err("成果文件超过 128 MB".into());
    }
    let root = user_downloads_root()?;
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = BASE64_STANDARD
            .decode(bytes_base64)
            .map_err(|_| "成果文件编码无效".to_string())?;
        expert_artifacts::validate(&file_name, &bytes)?;
        let extension = Path::new(&file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let selected = app
            .dialog()
            .file()
            .set_title("保存专家成果")
            .set_directory(root)
            .set_file_name(&file_name)
            .add_filter("成果文件", &[extension])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let destination = selected
            .into_path()
            .map_err(|_| "请选择本地文件路径".to_string())?;
        expert_artifacts::save_selected_at(&destination, &file_name, &bytes)
            .map(|path| Some(path.display().to_string()))
    })
    .await
    .map_err(|_| "成果文件保存任务中断".to_string())?
}

fn open_workspace_directory_at(workspace_path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(workspace_path)
        .map_err(|error| format!("无法访问工作区目录 {}：{error}", workspace_path.display()))?;
    if !metadata.is_dir() {
        return Err(format!(
            "工作区路径不是文件夹：{}",
            workspace_path.display()
        ));
    }

    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("当前系统不支持打开工作区目录".to_string());

    command
        .arg(workspace_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法打开工作区目录 {}：{error}", workspace_path.display()))?;
    Ok(())
}

/// Open a Workspace in the desktop file manager from the Tauri process.
#[tauri::command]
fn open_workspace_directory(workspace_path: String) -> Result<(), String> {
    open_workspace_directory_at(Path::new(&workspace_path))
}

/// Open an installed skill, resolving its slug inside the desktop-owned skills root.
#[tauri::command]
fn open_skill_directory(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    validate_marketplace_slug(&slug)?;
    let root = user_skills_root(&app)?.canonicalize()
        .map_err(|_| "技能安装目录不存在".to_string())?;
    let directory = root.join(&slug).canonicalize()
        .map_err(|_| "技能目录不存在，请刷新安装列表".to_string())?;
    if !directory.starts_with(&root) || !directory.is_dir() || !directory.join("SKILL.md").is_file() {
        return Err("无法打开有效的本地技能目录".to_string());
    }
    open_workspace_directory_at(&directory)
}

fn expert_webview_label(key: &str, ticket: &str) -> Result<String, String> {
    if key.len() < 3
        || key.len() > 80
        || !key.starts_with(|ch: char| ch.is_ascii_lowercase())
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("专家编号无效".to_string());
    }
    if ticket.len() != 64 || !ticket.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("专家票据无效".to_string());
    }
    Ok(format!("expert-{key}-{}", &ticket[..16]))
}

fn validate_expert_webview_label(label: &str) -> Result<(), String> {
    let Some((key, ticket_prefix)) = label
        .strip_prefix("expert-")
        .and_then(|value| value.rsplit_once('-'))
    else {
        return Err("专家视图标识无效".to_string());
    };
    if ticket_prefix.len() != 16 || !ticket_prefix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("专家视图标识无效".to_string());
    }
    expert_webview_label(key, &format!("{ticket_prefix}{}", "0".repeat(48)))?;
    Ok(())
}

fn expert_webview_url(raw: &str, ticket: &str) -> Result<(Url, Url), String> {
    let mut url = Url::parse(raw).map_err(|_| "专家网页地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || ticket.len() != 64
        || !ticket.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("专家网页地址或票据无效".to_string());
    }
    let allowed = url.clone();
    url.set_fragment(Some(&format!("ticket={ticket}")));
    Ok((url, allowed))
}

fn expert_ticket_bootstrap(url: &Url) -> String {
    let marker = format!("wanwei-expert-launch:{:x}", Sha256::digest(url.as_str().as_bytes()));
    let payload = serde_json::json!({
        "origin": url.origin().ascii_serialization(),
        "path": url.path(),
        "search": url.query().filter(|query| !query.is_empty()).map(|query| format!("?{query}")).unwrap_or_default(),
        "fragment": url.fragment().map(|fragment| format!("#{fragment}")).unwrap_or_default(),
        "marker": marker,
    });
    include_str!("expert_ticket_bootstrap.js").replace("__WANWEI_EXPERT_LAUNCH__", &payload.to_string())
}

#[tauri::command]
fn maximize_expert_window(window: Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口调整专家工作台".to_string());
    }
    if !window
        .is_maximized()
        .map_err(|error| format!("无法读取窗口状态：{error}"))?
    {
        window
            .maximize()
            .map_err(|error| format!("无法最大化窗口：{error}"))?;
    }
    Ok(())
}

fn log_expert_view(app: &tauri::AppHandle, event: &str) {
    if let Ok(directory) = app.path().app_local_data_dir() {
        append_log(&directory.join("logs").join("expert-webviews.log"), serde_json::json!({
            "timeMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            "processId":std::process::id(), "event":event,
        }).to_string());
    }
}

#[tauri::command]
async fn open_expert_webview(
    window: Window,
    key: String,
    url: String,
    ticket: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("只能从主窗口打开专家".to_string());
    }
    expert_diagnostics::activate(window.app_handle());
    let label = expert_webview_label(&key, &ticket)?;
    let started = std::time::Instant::now();
    expert_diagnostics::lifecycle(window.app_handle(), &label, "create-requested");
    let (launch_url, allowed_url) = expert_webview_url(&url, &ticket)?;
    if width < 200.0
        || height < 200.0
        || ![x, y, width, height].iter().all(|value| value.is_finite())
    {
        return Err("专家视图尺寸无效".to_string());
    }
    if window.app_handle().get_webview(&label).is_some() {
        return Err("专家视图已打开".to_string());
    }
    expert_diagnostics::layout(window.app_handle(), &label, "create", [x, y, width, height]);
    let origin = allowed_url.origin().ascii_serialization();
    let mut capability = tauri::ipc::CapabilityBuilder::new(format!("published-{label}"))
        .webview(&label)
        .remote(format!("{origin}/*"))
        .local(false);
    for permission in [
        "core:default",
        "allow-save-session-log-archive",
        "allow-save-expert-artifact",
        "allow-list-marketplace-skills",
        "allow-install-marketplace-skill",
        "allow-uninstall-marketplace-skill",
        "allow-install-custom-skill",
        "allow-install-custom-skill-directory",
        "allow-install-custom-skill-archive",
        "allow-uninstall-custom-skill",
        "allow-list-custom-skills",
        "allow-read-analysis-view",
        "allow-open-workspace-directory",
        "allow-open-skill-directory",
        "allow-reveal-downloaded-file",
        "allow-import-workspace-files",
    ] {
        capability = capability.permission(permission);
    }
    let permission = window
        .app_handle()
        .add_capability(capability)
        .map_err(|_| "专家权限初始化失败".to_string());
    // ACL 错误可能包含远程来源；不把该原始错误写入诊断。
    expert_diagnostics::native_result(window.app_handle(), &label, "capability-ready", started, &permission);
    permission?;
    let navigation_app = window.app_handle().clone();
    let loading_app = window.app_handle().clone();
    let navigation_label = label.clone();
    let loading_label = label.clone();
    let title_app = window.app_handle().clone();
    let title_label = label.clone();
    // 原生加载不携带 fragment，避免部分 Mac 将 #ticket 编成请求路径 %23ticket。
    let ticket_bootstrap = expert_ticket_bootstrap(&launch_url);
    let builder = webview_environment::expert_builder(&label, allowed_url.clone())
        .initialization_script(NATIVE_BRIDGE_INITIALIZATION_SCRIPT)
        .initialization_script(&ticket_bootstrap)
        .on_document_title_changed(move |_, _| {
            expert_diagnostics::lifecycle(&title_app, &title_label, "document-title-changed");
        })
        .on_navigation(move |target| {
            let allowed = target.origin() == allowed_url.origin();
            expert_diagnostics::lifecycle(&navigation_app, &navigation_label,
                if allowed { "navigation-allowed" } else { "navigation-blocked" });
            if !allowed {
                log_expert_view(&navigation_app, "navigation blocked: foreign origin");
            }
            allowed
        })
        .on_page_load(move |_, payload| {
            expert_diagnostics::lifecycle(&loading_app, &loading_label, match payload.event() {
                tauri::webview::PageLoadEvent::Started => "load-started",
                tauri::webview::PageLoadEvent::Finished => "load-finished",
            });
            log_expert_view(
                &loading_app,
                match payload.event() {
                    tauri::webview::PageLoadEvent::Started => "page loading started",
                    tauri::webview::PageLoadEvent::Finished => "page loading finished",
                },
            );
        });
    let created = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|error| format!("无法打开专家网页：{error}"));
    expert_diagnostics::native_result(window.app_handle(), &label, "create-dispatched", started, &created);
    let view = created?;
    // Keep a newly created child from covering HTML before the renderer has
    // committed its latest geometry and visibility decision.
    let confirmed = view.hide().map_err(|error| error.to_string())
        .and_then(|_| webview_environment::confirm(&view, false));
    expert_diagnostics::native_result(window.app_handle(), &label, "create-confirmed", started, &confirmed);
    if let Err(error) = confirmed {
        let rollback = view.close().map_err(|e| e.to_string());
        expert_diagnostics::native_result(window.app_handle(), &label, "create-rollback-close", started, &rollback);
        return Err(format!("无法初始化专家视图：{error}"));
    }
    log_expert_view(window.app_handle(), "created hidden");
    expert_diagnostics::snapshot(window.app_handle(), "created-hidden");
    Ok(label)
}

#[tauri::command]
async fn set_expert_webview_bounds(
    window: Window,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if window.label() != "main"
        || width < 200.0
        || height < 200.0
        || ![x, y, width, height].iter().all(|value| value.is_finite())
    {
        return Err("专家视图尺寸无效".to_string());
    }
    validate_expert_webview_label(&label)?;
    let started = std::time::Instant::now();
    expert_diagnostics::lifecycle(window.app_handle(), &label, "bounds-requested");
    expert_diagnostics::layout(window.app_handle(), &label, "bounds", [x, y, width, height]);
    let view = window
        .app_handle()
        .get_webview(&label)
        .ok_or_else(|| {
            expert_diagnostics::lifecycle(window.app_handle(), &label, "bounds-view-missing");
            "专家视图不存在"
        })?;
    let result = view
        .set_bounds(tauri::Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        })
        .map_err(|error| error.to_string())
        .and_then(|_| view.bounds().map(|_| ()).map_err(|error| error.to_string()));
    if result.is_err() {
        log_expert_view(window.app_handle(), "bounds failed");
    }
    expert_diagnostics::native_result(window.app_handle(), &label, "bounds-completed", started, &result);
    result
}

#[tauri::command]
async fn close_expert_webview(window: Window, label: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口关闭专家".to_string());
    }
    validate_expert_webview_label(&label)?;
    let started = std::time::Instant::now();
    expert_diagnostics::lifecycle(window.app_handle(), &label, "close-requested");
    if let Some(view) = window.app_handle().get_webview(&label) {
        // Remove hit testing before disposal; a failed close must not leave
        // a visible child over the main page.
        let hidden = view.hide().map_err(|e| e.to_string());
        expert_diagnostics::native_result(window.app_handle(), &label, "close-hide-dispatched", started, &hidden);
        let closed = view.close().map_err(|error| error.to_string());
        expert_diagnostics::native_result(window.app_handle(), &label, "close-dispatched", started, &closed);
        closed?;
        // 查询失败通常表示已移除，但保留真实结果，不把任意查询错误认定为关闭成功。
        let remaining = view.bounds().map_err(|error| error.to_string());
        expert_diagnostics::native_result(window.app_handle(), &label, "close-post-query", started, &remaining);
    } else {
        expert_diagnostics::lifecycle(window.app_handle(), &label, "close-view-already-missing");
    }
    if let Some(main) = window.app_handle().get_webview("main") {
        let focus = main.set_focus().map_err(|error| error.to_string());
        expert_diagnostics::native_result(window.app_handle(), &label, "close-main-focus-dispatched", started, &focus);
        focus?;
    }
    log_expert_view(window.app_handle(), "closed; main focus restored");
    expert_diagnostics::snapshot(window.app_handle(), "close-dispatched");
    expert_diagnostics::settled_snapshot(window.app_handle(), "close-settled-sample");
    Ok(())
}

#[tauri::command]
async fn set_expert_webview_visible(
    window: Window,
    label: String,
    visible: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口切换专家视图".to_string());
    }
    validate_expert_webview_label(&label)?;
    let started = std::time::Instant::now();
    expert_diagnostics::lifecycle(window.app_handle(), &label, if visible { "show-requested" } else { "hide-requested" });
    let view = window
        .app_handle()
        .get_webview(&label)
        .ok_or_else(|| {
            expert_diagnostics::lifecycle(window.app_handle(), &label, "visibility-view-missing");
            "专家视图不存在"
        })?;
    if visible {
        let result = view.show().map_err(|error| error.to_string())
            .and_then(|_| webview_environment::confirm(&view, true));
        expert_diagnostics::native_result(window.app_handle(), &label, "show-confirmed", started, &result);
        expert_diagnostics::settled_snapshot(window.app_handle(), "show-settled-sample");
        log_expert_view(
            window.app_handle(),
            if result.is_ok() {
                "show requested"
            } else {
                "show failed"
            },
        );
        result
    } else {
        let hidden = view.hide().map_err(|error| error.to_string())
            .and_then(|_| webview_environment::confirm(&view, false));
        expert_diagnostics::native_result(window.app_handle(), &label, "hide-confirmed", started, &hidden);
        hidden?;
        if let Some(main) = window.app_handle().get_webview("main") {
            let focus = main.set_focus().map_err(|error| error.to_string());
            expert_diagnostics::native_result(window.app_handle(), &label, "hide-main-focus-dispatched", started, &focus);
            focus?;
        }
        log_expert_view(window.app_handle(), "hide requested; main focus restored");
        expert_diagnostics::settled_snapshot(window.app_handle(), "hide-settled-sample");
        Ok(())
    }
}

/// Reveal a downloaded file in the desktop file manager.
#[tauri::command]
fn reveal_downloaded_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("无法访问下载文件 {}：{error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("下载路径不是文件：{}", path.display()));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(&path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let parent = path
            .parent()
            .ok_or_else(|| format!("无法定位下载文件目录：{}", path.display()))?;
        let mut command = Command::new("xdg-open");
        command.arg(parent);
        command
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("当前系统不支持打开下载文件位置".to_string());

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法打开下载文件位置 {}：{error}", path.display()))?;
    Ok(())
}

fn workspace_import_file_name(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    let file_name = path.file_name().and_then(|value| value.to_str());
    if name.is_empty()
        || name.contains(['/', '\\', ':'])
        || path.is_absolute()
        || file_name != Some(name)
        || matches!(name, "." | "..")
    {
        return Err(format!("工作区文件名无效：{name}"));
    }
    Ok(name)
}

fn workspace_import_destination(root: &Path, name: &str) -> Result<PathBuf, String> {
    let source = Path::new(name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("工作区文件名无效：{name}"))?;
    let extension = source.extension().and_then(|value| value.to_str());
    for suffix in 0..10_000 {
        let candidate = match (suffix, extension) {
            (0, _) => name.to_string(),
            (_, Some(extension)) => format!("{stem} ({suffix}).{extension}"),
            (_, None) => format!("{stem} ({suffix})"),
        };
        let destination = root.join(candidate);
        if !destination.exists() {
            return Ok(destination);
        }
    }
    Err(format!("工作区中同名文件过多：{name}"))
}

fn workspace_import_directory_destination(root: &Path, name: &str) -> Result<PathBuf, String> {
    for suffix in 0..10_000 {
        let candidate = if suffix == 0 {
            name.to_string()
        } else {
            format!("{name} ({suffix})")
        };
        let destination = root.join(candidate);
        if !destination.exists() {
            return Ok(destination);
        }
    }
    Err(format!("工作区中同名文件夹过多：{name}"))
}

fn imported_workspace_reference(destination: &Path, directory: bool) -> Result<String, String> {
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("导入后的名称无效：{}", destination.display()))?;
    Ok(if directory {
        format!("{name}/")
    } else {
        name.to_string()
    })
}

fn import_workspace_files_at(
    workspace_path: &Path,
    files: Vec<WorkspaceImportFile>,
) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Err("没有可导入的文件".to_string());
    }
    if files.len() > WORKSPACE_IMPORT_MAX_FILES {
        return Err(format!(
            "一次最多可导入 {WORKSPACE_IMPORT_MAX_FILES} 个文件"
        ));
    }
    let root = fs::canonicalize(workspace_path)
        .map_err(|error| format!("无法访问工作区 {}：{error}", workspace_path.display()))?;
    if !root.is_dir() {
        return Err(format!("工作区路径不是文件夹：{}", root.display()));
    }
    let mut total_bytes = 0usize;
    let mut imported = Vec::with_capacity(files.len());
    for file in files {
        let name = workspace_import_file_name(&file.name)?;
        if file.bytes.len() > WORKSPACE_IMPORT_MAX_FILE_BYTES {
            return Err(format!(
                "文件超过 {} MB 限制：{name}",
                WORKSPACE_IMPORT_MAX_FILE_BYTES / 1024 / 1024
            ));
        }
        total_bytes = total_bytes
            .checked_add(file.bytes.len())
            .ok_or_else(|| "导入文件总大小无效".to_string())?;
        if total_bytes > WORKSPACE_IMPORT_MAX_TOTAL_BYTES {
            return Err(format!(
                "导入文件总大小不能超过 {} MB",
                WORKSPACE_IMPORT_MAX_TOTAL_BYTES / 1024 / 1024
            ));
        }
        let destination = workspace_import_destination(&root, name)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("无法创建工作区文件 {}：{error}", destination.display()))?;
        if let Err(error) = output.write_all(&file.bytes) {
            drop(output);
            let _ = fs::remove_file(&destination);
            return Err(format!(
                "无法写入工作区文件 {}：{error}",
                destination.display()
            ));
        }
        imported.push(imported_workspace_reference(&destination, false)?);
    }
    Ok(imported)
}

fn workspace_import_root(
    app: &tauri::AppHandle,
    workspace_path: Option<String>,
) -> Result<PathBuf, String> {
    match workspace_path {
        Some(path) => Ok(PathBuf::from(path)),
        None => {
            let path = app
                .path()
                .app_local_data_dir()
                .map_err(|error| format!("无法定位默认导入目录：{error}"))?
                .join("imports");
            fs::create_dir_all(&path)
                .map_err(|error| format!("无法创建默认导入目录 {}：{error}", path.display()))?;
            Ok(path)
        }
    }
}

fn copy_imported_workspace_file(
    source: &Path,
    destination: &Path,
    file_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("无法读取拖入的文件 {}：{error}", source.display()))?;
    if metadata.len() > WORKSPACE_IMPORT_MAX_FILE_BYTES as u64 {
        return Err(format!(
            "文件超过 {} MB 限制：{}",
            WORKSPACE_IMPORT_MAX_FILE_BYTES / 1024 / 1024,
            source.display()
        ));
    }
    *file_count = file_count
        .checked_add(1)
        .ok_or_else(|| "导入文件数量无效".to_string())?;
    if *file_count > WORKSPACE_IMPORT_MAX_FILES {
        return Err(format!(
            "一次最多可导入 {WORKSPACE_IMPORT_MAX_FILES} 个文件"
        ));
    }
    *total_bytes = total_bytes
        .checked_add(metadata.len())
        .ok_or_else(|| "导入文件总大小无效".to_string())?;
    if *total_bytes > WORKSPACE_IMPORT_MAX_TOTAL_BYTES as u64 {
        return Err(format!(
            "导入文件总大小不能超过 {} MB",
            WORKSPACE_IMPORT_MAX_TOTAL_BYTES / 1024 / 1024
        ));
    }
    let mut input = fs::File::open(source)
        .map_err(|error| format!("无法读取拖入的文件 {}：{error}", source.display()))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("无法创建导入文件 {}：{error}", destination.display()))?;
    if let Err(error) = std::io::copy(&mut input, &mut output) {
        drop(output);
        let _ = fs::remove_file(destination);
        return Err(format!("无法复制拖入的文件 {}：{error}", source.display()));
    }
    Ok(())
}

fn copy_imported_workspace_directory(
    source: &Path,
    destination: &Path,
    file_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("无法创建工作区文件夹 {}：{error}", destination.display()))?;
    let copied = (|| -> Result<(), String> {
        let entries = fs::read_dir(source)
            .map_err(|error| format!("无法读取拖入的文件夹 {}：{error}", source.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("无法读取拖入的文件夹条目：{error}"))?;
            let entry_source = entry.path();
            let metadata = fs::symlink_metadata(&entry_source)
                .map_err(|error| format!("无法读取拖入路径 {}：{error}", entry_source.display()))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "不支持拖入包含符号链接的文件夹：{}",
                    entry_source.display()
                ));
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| format!("拖入路径包含无效名称：{}", entry_source.display()))?;
            workspace_import_file_name(&name)?;
            let entry_destination = destination.join(name);
            if metadata.is_dir() {
                copy_imported_workspace_directory(
                    &entry_source,
                    &entry_destination,
                    file_count,
                    total_bytes,
                )?;
            } else if metadata.is_file() {
                copy_imported_workspace_file(
                    &entry_source,
                    &entry_destination,
                    file_count,
                    total_bytes,
                )?;
            } else {
                return Err(format!("不支持拖入此类路径：{}", entry_source.display()));
            }
        }
        Ok(())
    })();
    if copied.is_err() {
        // Only this invocation's exclusively created directory may be removed.
        let _ = fs::remove_dir_all(destination);
    }
    copied
}

fn import_workspace_paths_at(
    workspace_path: &Path,
    paths: Vec<PathBuf>,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("没有可导入的文件".to_string());
    }
    if paths.len() > WORKSPACE_IMPORT_MAX_FILES {
        return Err(format!(
            "一次最多可导入 {WORKSPACE_IMPORT_MAX_FILES} 个文件"
        ));
    }
    let root = fs::canonicalize(workspace_path)
        .map_err(|error| format!("无法访问工作区 {}：{error}", workspace_path.display()))?;
    if !root.is_dir() {
        return Err(format!("工作区路径不是文件夹：{}", root.display()));
    }
    let mut total_bytes = 0u64;
    let mut file_count = 0usize;
    let mut imported = Vec::with_capacity(paths.len());
    for path in paths {
        let original_metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法读取拖入的文件 {}：{error}", path.display()))?;
        if original_metadata.file_type().is_symlink() {
            return Err(format!("不支持拖入符号链接：{}", path.display()));
        }
        let source = fs::canonicalize(&path)
            .map_err(|error| format!("无法访问拖入的文件 {}：{error}", path.display()))?;
        let metadata = fs::metadata(&source)
            .map_err(|error| format!("无法读取拖入的文件 {}：{error}", source.display()))?;
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("拖入的文件名无效：{}", source.display()))?;
        let name = workspace_import_file_name(name)?;
        if metadata.is_file() {
            let destination = workspace_import_destination(&root, name)?;
            copy_imported_workspace_file(&source, &destination, &mut file_count, &mut total_bytes)?;
            imported.push(imported_workspace_reference(&destination, false)?);
            continue;
        }
        if !metadata.is_dir() {
            return Err(format!("不支持拖入此类路径：{}", source.display()));
        }
        if root.starts_with(&source) {
            return Err(format!(
                "不能把包含当前工作区的文件夹拖入工作区：{}",
                source.display()
            ));
        }
        let destination = workspace_import_directory_destination(&root, name)?;
        copy_imported_workspace_directory(
            &source,
            &destination,
            &mut file_count,
            &mut total_bytes,
        )?;
        imported.push(imported_workspace_reference(&destination, true)?);
    }
    Ok(imported)
}

/// Copy browser-dropped files into the selected Workspace without exposing a
/// general filesystem-write command to the renderer.
#[tauri::command]
fn import_workspace_files(
    app: tauri::AppHandle,
    workspace_path: Option<String>,
    files: Vec<WorkspaceImportFile>,
) -> Result<Vec<String>, String> {
    let root = workspace_import_root(&app, workspace_path)?;
    import_workspace_files_at(&root, files)
}

/// Consume the latest operating-system drop and copy it into the active directory.
#[tauri::command]
fn import_dropped_workspace_files(
    app: tauri::AppHandle,
    pending: State<'_, PendingWorkspaceDrop>,
    workspace_path: Option<String>,
) -> Result<Vec<String>, String> {
    let paths = pending
        .0
        .lock()
        .map_err(|_| "拖入文件状态不可用，请重新拖入".to_string())?
        .take()
        .ok_or_else(|| "拖入的文件已失效，请重新拖入".to_string())?;
    let root = workspace_import_root(&app, workspace_path)?;
    import_workspace_paths_at(&root, paths)
}

/// Allocate one first-send workspace in the persistent product home.
#[tauri::command]
fn create_automatic_workspace(window: Window, name: String) -> Result<String, String> {
    if window.label() != "main" {
        return Err("只能从主窗口创建工作区".to_string());
    }
    let app_data = window.app_handle().path().app_local_data_dir().map_err(|error| error.to_string())?;
    let home = product_harness_home(&app_data)?;
    Ok(automatic_workspace::create(&home, &name)?.to_string_lossy().into_owned())
}

/// Copy an explicitly pasted OS file list through the existing bounded workspace importer.
#[tauri::command]
fn import_clipboard_workspace_files(
    window: Window,
    workspace_path: Option<String>,
) -> Result<Vec<String>, String> {
    if window.label() != "main" {
        return Err("只能从主窗口粘贴文件".to_string());
    }
    let paths = clipboard_files::read_paths()?;
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let root = workspace_import_root(window.app_handle(), workspace_path)?;
    import_workspace_paths_at(&root, paths)
}

fn marketplace_resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位安装包资源目录：{error}"))?;
    Ok(bundled_resource(&resource_dir, "skills"))
}

fn read_marketplace_catalog(root: &Path) -> Result<MarketplaceCatalog, String> {
    let path = root.join("catalog.json");
    let source = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取技能目录 {}：{error}", path.display()))?;
    serde_json::from_str(&source)
        .map_err(|error| format!("技能目录格式无效 {}：{error}", path.display()))
}

fn read_marketplace_manifest(directory: &Path) -> Result<MarketplaceManifest, String> {
    let path = directory.join("manifest.json");
    let source = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取技能清单 {}：{error}", path.display()))?;
    serde_json::from_str(&source)
        .map_err(|error| format!("技能清单格式无效 {}：{error}", path.display()))
}

fn manifest_for_slug(root: &Path, slug: &str) -> Result<MarketplaceManifest, String> {
    let catalog = read_marketplace_catalog(root)?;
    catalog
        .skills
        .into_iter()
        .find(|manifest| manifest.slug == slug)
        .ok_or_else(|| format!("安装包中不存在技能 {slug}"))
}

fn is_legacy_marketplace_skill(directory: &Path, slug: &str) -> bool {
    let Ok(source) = fs::read_to_string(directory.join("SKILL.md")) else {
        return false;
    };
    source
        .lines()
        .take(12)
        .any(|line| line.trim() == format!("name: {slug}"))
}

fn installed_manifest(directory: &Path, slug: &str) -> Result<Option<MarketplaceManifest>, String> {
    if directory.join(".wanwei-skillhub.json").exists() {
        return Err("SkillHub 技能不能由平台技能覆盖或删除".into());
    }
    let manifest_path = directory.join("manifest.json");
    if manifest_path.exists() {
        let manifest = read_marketplace_manifest(directory)?;
        if manifest.slug != slug {
            return Err(format!("技能目录 {} 的清单标识不匹配", directory.display()));
        }
        return Ok(Some(manifest));
    }
    if is_legacy_marketplace_skill(directory, slug) {
        return Ok(None);
    }
    Err(format!(
        "技能目录 {} 不是由技能市场管理，拒绝覆盖或删除",
        directory.display()
    ))
}

fn validate_marketplace_tree(
    directory: &Path,
    manifest: &MarketplaceManifest,
) -> Result<(), String> {
    for relative in &manifest.files {
        let normalized = relative.replace('\\', "/");
        if normalized.is_empty()
            || normalized.starts_with('/')
            || normalized
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(format!(
                "技能 {} 包含不安全的文件路径 {relative}",
                manifest.slug
            ));
        }
        let path = normalized
            .split('/')
            .fold(directory.to_path_buf(), |parent, part| parent.join(part));
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("技能文件缺失 {}：{error}", path.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("技能文件必须是普通文件 {}", path.display()));
        }
    }
    Ok(())
}

fn copy_marketplace_directory(source: &Path, target: &Path) -> Result<(), String> {
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("无法读取技能资源 {}：{error}", source.display()))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(format!("技能资源目录无效 {}", source.display()));
    }
    fs::create_dir_all(target)
        .map_err(|error| format!("无法创建技能目录 {}：{error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("无法枚举技能资源 {}：{error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取技能资源项：{error}"))?;
        let metadata = entry
            .file_type()
            .map_err(|error| format!("无法读取技能资源类型 {}：{error}", entry.path().display()))?;
        if metadata.is_symlink() {
            return Err(format!(
                "技能资源不能包含符号链接 {}",
                entry.path().display()
            ));
        }
        let destination = target.join(entry.file_name());
        if metadata.is_dir() {
            copy_marketplace_directory(&entry.path(), &destination)?;
        } else if metadata.is_file() {
            fs::copy(entry.path(), &destination)
                .map_err(|error| format!("无法复制技能文件 {}：{error}", entry.path().display()))?;
        } else {
            return Err(format!(
                "技能资源必须是普通文件或目录 {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn write_marketplace_files(target: &Path, files: Vec<CustomSkillFile>) -> Result<(), String> {
    if files.is_empty() || files.len() > 128 {
        return Err("服务器技能包必须包含 1 至 128 个文件".to_string());
    }
    let mut total_size = 0_usize;
    let mut written = std::collections::HashSet::with_capacity(files.len());
    for file in files {
        total_size = total_size
            .checked_add(file.content.len())
            .ok_or_else(|| "服务器技能包文件大小无效".to_string())?;
        if total_size > 16 * 1024 * 1024 {
            return Err("服务器技能包总大小不能超过 16 MB".to_string());
        }
        let relative = validate_skill_relative_path(&file.path)?;
        if !written.insert(relative.clone()) {
            return Err(format!(
                "服务器技能包包含重复文件路径 {}",
                relative.display()
            ));
        }
        let destination = target.join(relative);
        let parent = destination
            .parent()
            .ok_or_else(|| "服务器技能包文件路径无效".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建技能文件目录 {}：{error}", parent.display()))?;
        fs::write(&destination, file.content)
            .map_err(|error| format!("无法写入技能文件 {}：{error}", destination.display()))?;
    }
    Ok(())
}

fn install_marketplace_skill_at(
    resource_root: &Path,
    skills_root: &Path,
    slug: &str,
) -> Result<String, String> {
    install_marketplace_skill_named_at(resource_root, skills_root, slug, None)
}

fn install_marketplace_skill_named_at(
    resource_root: &Path, skills_root: &Path, slug: &str, display_name: Option<&str>,
) -> Result<String, String> {
    validate_marketplace_slug(slug)?;
    if skills_root.exists()
        && fs::symlink_metadata(skills_root)
            .map_err(|error| format!("无法读取用户技能目录 {}：{error}", skills_root.display()))?
            .file_type()
            .is_symlink()
    {
        return Err(format!(
            "拒绝使用符号链接技能根目录 {}",
            skills_root.display()
        ));
    }
    let manifest = manifest_for_slug(resource_root, slug)?;
    let source = resource_root.join(slug);
    validate_marketplace_tree(&source, &manifest)?;
    let friendly_name = display_name.map(str::to_string).unwrap_or(skill_names::display_name(&source)?);
    skill_names::ensure_available(skills_root, &skills_root.join(slug), &friendly_name, true)?;
    if skills_root.exists()
        && fs::symlink_metadata(skills_root)
            .map_err(|error| format!("无法读取用户技能目录 {}：{error}", skills_root.display()))?
            .file_type()
            .is_symlink()
    {
        return Err(format!(
            "拒绝使用符号链接技能根目录 {}",
            skills_root.display()
        ));
    }
    fs::create_dir_all(skills_root)
        .map_err(|error| format!("无法创建用户技能目录 {}：{error}", skills_root.display()))?;
    let directory = skills_root.join(slug);
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("无法读取技能目录 {}：{error}", directory.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!("拒绝覆盖非普通技能目录 {}", directory.display()));
        }
        let installed = installed_manifest(&directory, slug)?;
        if installed
            .as_ref()
            .is_some_and(|value| value.version == manifest.version)
        {
            skill_names::persist(&directory, &friendly_name)?;
            return Ok(directory.join("SKILL.md").display().to_string());
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let staging_root = skill_staging_root(skills_root)?;
    let staging = staging_root.join(format!(".{slug}.install-{}-{nonce}", std::process::id()));
    let backup = staging_root.join(format!(".{slug}.backup-{}-{nonce}", std::process::id()));
    if let Err(error) = copy_marketplace_directory(&source, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let staged_manifest = match read_marketplace_manifest(&staging) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if staged_manifest.slug != slug || staged_manifest.version != manifest.version {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("技能 {slug} 的暂存清单校验失败"));
    }
    if let Err(error) = validate_marketplace_tree(&staging, &staged_manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if let Err(error) = skill_names::persist(&staging, &friendly_name) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if directory.exists() {
        fs::rename(&directory, &backup)
            .map_err(|error| format!("无法暂存旧技能目录 {}：{error}", directory.display()))?;
    }
    if let Err(error) = fs::rename(&staging, &directory) {
        if backup.exists() {
            let _ = fs::rename(&backup, &directory);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("无法启用技能目录 {}：{error}", directory.display()));
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|error| {
            format!("技能已更新，但无法移除旧版本 {}：{error}", backup.display())
        })?;
    }
    Ok(directory.join("SKILL.md").display().to_string())
}

fn install_marketplace_skill_files_at(
    skills_root: &Path,
    slug: &str,
    files: Vec<CustomSkillFile>,
) -> Result<String, String> {
    install_marketplace_skill_files_named_at(skills_root, slug, files, None)
}

fn install_marketplace_skill_files_named_at(
    skills_root: &Path, slug: &str, files: Vec<CustomSkillFile>, display_name: Option<&str>,
) -> Result<String, String> {
    validate_marketplace_slug(slug)?;
    fs::create_dir_all(skills_root)
        .map_err(|error| format!("无法创建用户技能目录 {}：{error}", skills_root.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let directory = skills_root.join(slug);
    let staging_root = skill_staging_root(skills_root)?;
    let staging = staging_root.join(format!(".{slug}.download-{}-{nonce}", std::process::id()));
    let backup = staging_root.join(format!(".{slug}.backup-{}-{nonce}", std::process::id()));
    fs::create_dir_all(&staging)
        .map_err(|error| format!("无法创建技能暂存目录 {}：{error}", staging.display()))?;
    if let Err(error) = write_marketplace_files(&staging, files) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let manifest = match read_marketplace_manifest(&staging) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if manifest.slug != slug {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("下载的技能包标识与请求不一致：{slug}"));
    }
    if let Err(error) = validate_marketplace_tree(&staging, &manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let friendly_name = display_name.map(str::to_string).unwrap_or(skill_names::display_name(&staging)?);
    if let Err(error) = skill_names::ensure_available(skills_root, &directory, &friendly_name, true)
        .and_then(|()| skill_names::persist(&staging, &friendly_name)) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("无法读取技能目录 {}：{error}", directory.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("拒绝覆盖非普通技能目录 {}", directory.display()));
        }
        let installed = installed_manifest(&directory, slug)?;
        if installed
            .as_ref()
            .is_some_and(|value| value.version == manifest.version)
        {
            skill_names::persist(&directory, &friendly_name)?;
            let _ = fs::remove_dir_all(&staging);
            return Ok(directory.join("SKILL.md").display().to_string());
        }
        fs::rename(&directory, &backup)
            .map_err(|error| format!("无法暂存旧技能目录 {}：{error}", directory.display()))?;
    }
    if let Err(error) = fs::rename(&staging, &directory) {
        if backup.exists() {
            let _ = fs::rename(&backup, &directory);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("无法启用下载的技能 {}：{error}", slug));
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|error| {
            format!("技能已更新，但无法移除旧版本 {}：{error}", backup.display())
        })?;
    }
    Ok(directory.join("SKILL.md").display().to_string())
}

/// Matches the server's deterministic digest: sorted relative path, NUL, file
/// bytes, NUL. The archive transport itself is intentionally not trusted.
fn marketplace_package_sha256(files: &[CustomSkillFile]) -> String {
    let mut entries: Vec<_> = files.iter().collect();
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    let mut hash = Sha256::new();
    for file in entries {
        hash.update(file.path.as_bytes());
        hash.update([0]);
        hash.update(&file.content);
        hash.update([0]);
    }
    format!("{:x}", hash.finalize())
}

#[tauri::command]
fn list_marketplace_skills(app: tauri::AppHandle) -> Result<Vec<MarketplaceSkillState>, String> {
    let skills_root = user_skills_root(&app)?;
    if !skills_root.exists() {
        return Ok(Vec::new());
    }
    fs::read_dir(&skills_root)
        .map_err(|error| format!("无法枚举用户技能目录 {}：{error}", skills_root.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.file_type().ok()?;
            if metadata.is_symlink()
                || !metadata.is_dir()
                || entry.path().join(".dsh-custom-skill").is_file()
                || entry.path().join(".wanwei-skillhub.json").exists()
            {
                return None;
            }
            read_marketplace_manifest(&entry.path()).ok()
        })
        .into_iter()
        .map(|manifest| {
            let directory = skills_root.join(&manifest.slug);
            let (installed_version, state) = if !directory.exists() {
                (None, "notInstalled")
            } else if fs::symlink_metadata(&directory)
                .map(|metadata| metadata.file_type().is_symlink() || !metadata.is_dir())
                .unwrap_or(true)
            {
                (None, "conflict")
            } else {
                match installed_manifest(&directory, &manifest.slug) {
                    Ok(Some(installed)) if installed.version == manifest.version => {
                        (Some(installed.version), "installed")
                    }
                    Ok(Some(installed)) => (Some(installed.version), "updateAvailable"),
                    Ok(None) => (None, "updateAvailable"),
                    Err(_) => (None, "conflict"),
                }
            };
            Ok(MarketplaceSkillState {
                id: manifest.id,
                slug: manifest.slug,
                version: manifest.version,
                installed_version,
                state: state.to_string(),
            })
        })
        .collect()
}

#[tauri::command]
fn install_marketplace_skill(
    app: tauri::AppHandle,
    slug: String,
    files: Option<Vec<CustomSkillFile>>,
    sha256: Option<String>,
    display_name: Option<String>,
) -> Result<String, String> {
    let _guard = skill_names::INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    let installed = if let Some(files) = files {
        if let Some(expected) = sha256.filter(|value| !value.is_empty()) {
            if marketplace_package_sha256(&files) != expected.to_ascii_lowercase() {
                return Err("服务器技能包摘要校验失败，未写入本机目录".to_string());
            }
        }
        install_marketplace_skill_files_named_at(&user_skills_root(&app)?, &slug, files, display_name.as_deref())?
    } else {
        let resource_root = marketplace_resource_root(&app)?;
        let skills_root = user_skills_root(&app)?;
        install_marketplace_skill_named_at(&resource_root, &skills_root, &slug, display_name.as_deref())?
    };
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(installed)
}

fn uninstall_marketplace_skill_at(skills_root: &Path, slug: &str) -> Result<(), String> {
    validate_marketplace_slug(slug)?;
    let directory = skills_root.join(slug);
    if !directory.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|error| format!("无法读取技能目录 {}：{error}", directory.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("拒绝移除非普通技能目录 {}", directory.display()));
    }
    installed_manifest(&directory, slug)?;
    fs::remove_dir_all(&directory)
        .map_err(|error| format!("无法移除技能目录 {}：{error}", directory.display()))?;
    Ok(())
}

#[tauri::command]
fn uninstall_marketplace_skill(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    uninstall_marketplace_skill_at(&user_skills_root(&app)?, &slug)?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(())
}

fn append_log(path: &Path, message: impl AsRef<str>) {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

fn bundled_resource(resource_dir: &Path, name: &str) -> PathBuf {
    let direct = resource_dir.join(name);
    if direct.exists() {
        direct
    } else {
        resource_dir.join("resources").join(name)
    }
}

fn server_config(resource_dir: &Path) -> Result<ServerConfig, String> {
    let path = bundled_resource(resource_dir, "server.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let config: ServerConfig =
        serde_json::from_str(&raw).map_err(|error| format!("server.json 无效：{error}"))?;
    let url =
        Url::parse(&config.one_api_url).map_err(|error| format!("OneAPI 地址无效：{error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("OneAPI 地址必须使用 http 或 https".into());
    }
    Ok(config)
}

const DESKTOP_RUNTIME_DIR: &str = env!("DSH_DESKTOP_RUNTIME_DIR");

fn production_runtime(resource_dir: &Path) -> PathBuf {
    bundled_resource(resource_dir, DESKTOP_RUNTIME_DIR)
}

fn production_command(resource_dir: &Path) -> (PathBuf, PathBuf, Vec<String>) {
    let runtime = production_runtime(resource_dir);
    let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let app = runtime.join("app");
    (
        node,
        app.clone(),
        vec![app
            .join("node_modules/@deepseek-ai/dsh/lib/bin.js")
            .display()
            .to_string()],
    )
}

fn development_command() -> (PathBuf, PathBuf, Vec<String>) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    // Keep local Tauri development on the same Node runtime as the staged
    // production sidecar. This avoids silently resolving an older system
    // `node.exe` that cannot load the current TypeScript/ESM runtime.
    let node = std::env::var_os("DSH_NODE_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    (
        node,
        root.clone(),
        vec![
            "--import".into(),
            "tsx/esm".into(),
            root.join("apps/cli/src/bin.ts").display().to_string(),
        ],
    )
}

fn development_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("无法分配本地开发端口：{error}"))
}

/// Copy packaged connector skills into `$DSH_HOME/skills` before the sidecar starts.
/// The connectors page otherwise stays on「尚未写入」and a later RPC can surface as a failed fetch.
fn install_packaged_connector_skills(app_root: &Path, dsh_home: &Path) -> Result<(), String> {
    let skills_root = dsh_home.join("skills");
    let dws = app_root.join("assets").join("dws-cli");
    if dws.join("SKILL.md").is_file() {
        let dest = skills_root.join("dws-cli");
        if !dest.join("SKILL.md").is_file() {
            if dest.exists() {
                fs::remove_dir_all(&dest).map_err(|error| {
                    format!("无法清理旧的 dws-cli 技能 {}：{error}", dest.display())
                })?;
            }
            copy_connector_skill_dir(&dws, &dest)?;
        }
    }
    Ok(())
}

fn copy_connector_skill_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("无法创建技能目录 {}：{error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("无法枚举技能资源 {}：{error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取技能资源项：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取技能资源类型 {}：{error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_connector_skill_dir(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &destination)
                .map_err(|error| format!("无法复制技能文件 {}：{error}", entry.path().display()))?;
        }
    }
    Ok(())
}

fn spawn_sidecar(
    resource_dir: &Path,
    config: &ServerConfig,
    log_path: &Path,
    app_data_dir: &Path,
) -> Result<(Child, Url, mpsc::Receiver<String>), String> {
    let dsh_home = product_harness_home(app_data_dir)?;
    if !cfg!(debug_assertions) {
        if migration::migrate_desktop_data(app_data_dir, &dsh_home)? {
            append_log(log_path, "historical desktop data imported; originals and migration report retained");
        }
    }
    ensure_product_profile(&dsh_home)?;
    let (program, cwd, mut args) = if cfg!(debug_assertions) {
        development_command()
    } else {
        production_command(resource_dir)
    };
    let document_tool = if cfg!(debug_assertions) {
        cwd.join("products")
            .join("wanwei-desktop")
            .join("scripts")
            .join("document-tool.mjs")
    } else {
        production_runtime(resource_dir)
            .join("app")
            .join("document-tool.mjs")
    };
    if !document_tool.exists() {
        return Err(format!(
            "Bundled document helper is missing: {}",
            document_tool.display()
        ));
    }
    // Keep optional Python packages and pip's download cache outside the active
    // workspace.  This makes one desktop user's specialised dependencies
    // reusable across all Workspaces and prevents temporary pip files from
    // polluting customer project folders.
    let python_root = app_data_dir.join("python");
    let python_userbase = python_root.join("userbase");
    let pip_cache = python_root.join("pip-cache");
    let python_temp = python_root.join("tmp");
    for directory in [&python_userbase, &pip_cache, &python_temp] {
        fs::create_dir_all(directory).map_err(|error| {
            format!(
                "Unable to create shared Python directory {}: {error}",
                directory.display()
            )
        })?;
    }
    let dev_port = if cfg!(debug_assertions) {
        Some(development_port()?)
    } else {
        None
    };
    args.extend(["--profile".into(), "wanwei-desktop".into()]);
    args.extend([
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        // A development shell can be closed from the debugger before its
        // Sidecar observes shutdown. Choose a free loopback port on every
        // launch instead of failing against that stale process.
        dev_port.map_or_else(|| "0".to_string(), |port| port.to_string()),
        // Tauri owns the visible WebView. The DSH web launcher otherwise
        // hands the loopback URL to the system browser as well, which creates
        // a duplicate browser tab/window for every desktop launch.
        "--no-open".into(),
    ]);
    let rendered_args = args.join(" ");
    // Packaged Host resolves connector skills from `app/assets/*` via these paths
    // (not only `DSH_NODE_BINARY` → sibling `app/`), so intranet installs never
    // fall through to a connect-time GitHub `fetch`.
    let app_root = if cfg!(debug_assertions) {
        cwd.join("products").join("wanwei-desktop")
    } else {
        cwd.clone()
    };
    if let Err(error) = install_packaged_connector_skills(&app_root, &dsh_home) {
        append_log(
            log_path,
            format!("connector skill staging skipped: {error}"),
        );
    }
    let mut command = Command::new(&program);
    command
        .args(args)
        .current_dir(&cwd)
        .env("DSH_ONEAPI_URL", &config.one_api_url)
        .env("DSH_DESKTOP_PARENT_CONTROL", "1")
        .env("DSH_NODE_BINARY", &program)
        .env("DSH_APP_ROOT", &app_root)
        .env("DSH_DOCUMENT_TOOL", &document_tool)
        .env("DSH_HOME", &dsh_home)
        .env("PYTHONUSERBASE", &python_userbase)
        .env("PIP_CACHE_DIR", &pip_cache)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .stdout(Stdio::piped())
        .stdin(Stdio::piped())
        .stderr(Stdio::piped());
    {
        let dws_skill = app_root.join("assets").join("dws-cli");
        if dws_skill.join("SKILL.md").exists() {
            command.env("DSH_DWS_SKILL_DIR", &dws_skill);
        }
    }
    if !cfg!(target_os = "macos") {
        command
            .env("TEMP", &python_temp)
            .env("TMP", &python_temp)
            .env("TMPDIR", &python_temp)
            .env("DSH_DEPENDENCY_INSTALL_APPROVALS", "session-once");
    }
    sidecar_environment::configure(&mut command, &program, app_data_dir)?;
    if cfg!(debug_assertions) {
        command.env(
            "DSH_BUNDLE_ANCHORS",
            cwd.join("products")
                .join("wanwei-desktop")
                .join("package.json"),
        );
    }
    append_log(
        log_path,
        format!("configured product DSH_HOME: {}", dsh_home.display()),
    );
    if cfg!(debug_assertions) && std::env::var_os("DSH_DESKTOP_REAL_AUTH").is_none() {
        command.env("DSH_DESKTOP_DEVELOPMENT", "1");
    }
    if !config.default_model.is_empty() {
        command.env("DSH_DEFAULT_MODEL", &config.default_model);
    }
    if !config.install_id.is_empty() {
        command.env("DSH_INSTALL_ID", &config.install_id);
    }
    append_log(
        log_path,
        format!("starting sidecar: {} {rendered_args}", program.display()),
    );
    // The release desktop app hides the sidecar console. During `tauri dev`,
    // keep the child attached so its readiness line can be captured reliably
    // by the development shell on Windows.
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动本地 DSH Sidecar（{}）：{error}", program.display()))?;

    let (update_sender, update_receiver) = mpsc::channel();
    let ready = (|| -> Result<Url, String> {
        let stdout = child.stdout.take().ok_or("无法读取 DSH Sidecar 输出")?;
        let stderr = child.stderr.take().ok_or("无法读取 DSH Sidecar 错误输出")?;
        let (sender, receiver) = mpsc::channel();
        let stdout_log = log_path.to_path_buf();
        std::thread::spawn(move || {
            sidecar_output::drain(BufReader::new(stdout), sender, |line| {
                if let Some(reply) = line.strip_prefix("wanwei-update: ") {
                    let _ = update_sender.send(reply.to_owned());
                }
                append_log(&stdout_log, format!("[stdout] {line}"));
                eprintln!("[dsh] {line}");
            });
        });
        let stderr_log = log_path.to_path_buf();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                append_log(&stderr_log, format!("[stderr] {line}"));
                eprintln!("[dsh:error] {line}");
            }
        });
        let url = if let Some(port) = dev_port {
            // In local Windows development stdout can be delayed while the
            // Node/tsx loader is warming up. Probe the fixed loopback port as a
            // reliable readiness signal, then use the normal printed URL if it
            // arrives first.
            let deadline = std::time::Instant::now() + Duration::from_secs(120);
            loop {
                if let Ok(url) = receiver.try_recv() {
                    break url;
                }
                if let Ok(mut stream) = TcpStream::connect_timeout(
                    &format!("127.0.0.1:{port}")
                        .parse()
                        .map_err(|_| "本地端口无效")?,
                    Duration::from_millis(250),
                ) {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                    let ready_request = format!(
                        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                    );
                    let mut response = [0u8; 256];
                    if stream.write_all(ready_request.as_bytes()).is_ok()
                        && stream.read(&mut response).is_ok()
                        && response.starts_with(b"HTTP/1.1 200")
                    {
                        break Url::parse(&format!("http://127.0.0.1:{port}"))
                            .map_err(|e| e.to_string())?;
                    }
                }
                if std::time::Instant::now() >= deadline {
                    return Err(
                        "DSH Sidecar 在 120 秒内未就绪，请检查日志和 server.json".to_string()
                    );
                }
                std::thread::sleep(Duration::from_millis(150));
            }
        } else {
            receiver
                .recv_timeout(Duration::from_secs(120))
                .map_err(|_| {
                    "DSH Sidecar 在 120 秒内未就绪，请检查日志和 server.json".to_string()
                })?
        };
        Ok(url)
    })();
    let url = sidecar_output::finish_startup(&mut child, ready)?;
    Ok((child, url, update_receiver))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // A second launch only restores the existing window. Most
        // importantly, it never starts another Node sidecar that could keep
        // bundled runtime DLLs locked during the next installer upgrade.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let app_data_dir = app.path().app_local_data_dir()?;
            let log_path = app_data_dir.join("logs").join("startup.log");
            let _ = fs::remove_file(&log_path);
            append_log(&log_path, "万维Buddy startup");
            let config = server_config(&resource_dir).map_err(|message| {
                append_log(&log_path, format!("[fatal] {message}"));
                std::io::Error::new(std::io::ErrorKind::InvalidData, message)
            })?;
            let (child, url, update_receiver) = spawn_sidecar(&resource_dir, &config, &log_path, &app_data_dir)
                .map_err(|message| {
                    append_log(&log_path, format!("[fatal] {message}"));
                    std::io::Error::other(message)
                })?;
            app.manage(Sidecar(Arc::new(Mutex::new(Some(child))), Mutex::new(update_receiver)));
            desktop_update::setup(app.handle(), &config.one_api_url)?;
            app.manage(PendingWorkspaceDrop(Mutex::new(None)));
            app.manage(network_policy::NetworkPolicy::default());

            // Keep the sidecar alive when the user closes the window. The
            // application is controlled from the system tray and only exits
            // through the tray's explicit quit action.
            let show_item = MenuItem::with_id(app, "show", "显示 万维Buddy", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 万维Buddy", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().ok_or("缺少应用图标")?.clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            // A native minimize leaves the window minimized even
                            // after `show()`, which makes the first tray double
                            // click only reveal a taskbar button. Restore the
                            // native state before showing and focusing it.
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(sidecar) = app.try_state::<Sidecar>() {
                            sidecar.stop();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let browser_opener = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("万维Buddy")
                .inner_size(1120.0, 720.0)
                .min_inner_size(900.0, 580.0)
                .resizable(false)
                .maximizable(false)
                .center()
                .on_new_window(move |target, _features| {
                    if may_open_in_browser(&target) && network_policy::may_open(&browser_opener, &target) {
                        if let Err(error) = browser_opener
                            .opener()
                            .open_url(target.as_str(), None::<&str>)
                        {
                            eprintln!("无法在系统浏览器打开外部链接：{error}");
                        }
                    } else if may_open_in_browser(&target) {
                        if let Some(main) = browser_opener.get_webview_window("main") {
                            let _ = main.eval("window.dispatchEvent(new Event('wanwei:network-blocked'));");
                        }
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                // External pages may replace their document during login or
                // navigation. Reinstall the small bridge on each document so
                // client features do not fall back to WebView browser downloads.
                .initialization_script(NATIVE_BRIDGE_INITIALIZATION_SCRIPT)
                .initialization_script(expert_diagnostics::SCRIPT)
                // Keep wry's default feature disables, and turn off native occlusion.
                // When the system browser covers this window, WebView2 otherwise
                // suspends the page and aborts every localhost call, including
                // connector writes and session/prompt.
                .additional_browser_args(webview_environment::BROWSER_ARGS)
                // The external sidecar can lose window.__TAURI__ after a
                // navigation. AuthGate emits this marker through
                // document.title, which this native callback always sees.
                .on_document_title_changed(|window, title| {
                    let authenticated = match title.strip_prefix(NATIVE_AUTH_TITLE_PREFIX) {
                        Some("authenticated") => true,
                        Some("login") => false,
                        _ => return,
                    };
                    if !authenticated {
                        for (label, view) in window.app_handle().webviews() {
                            if label.starts_with("expert-") {
                                let _ = view.close();
                            }
                        }
                    }
                    let _ = apply_auth_window_state(&window, authenticated);
                    let _ = window.set_title("万维Buddy");
                })
                .build()?;
            let window_for_events = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
                WindowEvent::DragDrop(event) => forward_workspace_drop(&window_for_events, event),
                WindowEvent::Resized(_) => expert_diagnostics::snapshot(window_for_events.app_handle(), "window-resized"),
                WindowEvent::Focused(_) => expert_diagnostics::snapshot(window_for_events.app_handle(), "window-focus"),
                _ => {}
            });
            let window_for_webview_events = window.clone();
            window.on_webview_event(move |event| match event {
                WebviewEvent::DragDrop(event) => {
                    forward_workspace_drop(&window_for_webview_events, event);
                }
                _ => {}
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            expert_diagnostics::expert_input_diagnostic,
            desktop_update::desktop_update_status,
            desktop_update::desktop_update_check,
            desktop_update::desktop_update_automatic,
            network_policy::set_network_environment,
            set_auth_window_state,
            save_session_log_archive,
            save_expert_artifact,
            list_marketplace_skills,
            install_marketplace_skill,
            uninstall_marketplace_skill,
            install_custom_skill,
            install_custom_skill_directory,
            install_custom_skill_archive,
            skillhub::install_skillhub_skill,
            skillhub::list_skillhub_skills,
            skillhub::uninstall_skillhub_skill,
            uninstall_custom_skill,
            list_custom_skills,
            read_analysis_view,
            open_workspace_directory,
            open_skill_directory,
            reveal_downloaded_file,
            import_workspace_files,
            import_dropped_workspace_files,
            import_clipboard_workspace_files,
            create_automatic_workspace,
            maximize_expert_window,
            open_expert_webview,
            set_expert_webview_bounds,
            close_expert_webview,
            set_expert_webview_visible,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DSH Desktop")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(sidecar) = app.try_state::<Sidecar>() {
                    sidecar.stop();
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod expert_web_tests {
    use super::{expert_ticket_bootstrap, expert_webview_label, expert_webview_url, validate_expert_webview_label};

    #[test]
    fn ticket_bootstrap_keeps_native_url_clean_and_checks_exact_entry() {
        let ticket = "a".repeat(64);
        let (launch, native) = expert_webview_url(
            "http://ac.zjugis.com:3300/experts/meeting-minutes/?mode=test", &ticket,
        ).unwrap();
        assert_eq!(native.fragment(), None);
        assert!(!native.as_str().contains(&ticket));
        let script = expert_ticket_bootstrap(&launch);
        assert!(!script.contains("__WANWEI_EXPERT_LAUNCH__"));
        let json = script.split("const launch = ").nth(1).unwrap().split(';').next().unwrap();
        let payload: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(payload["origin"], "http://ac.zjugis.com:3300");
        assert_eq!(payload["path"], "/experts/meeting-minutes/");
        assert_eq!(payload["search"], "?mode=test");
        assert_eq!(payload["fragment"], format!("#ticket={ticket}"));
        assert!(!payload["marker"].as_str().unwrap().contains(&ticket));
    }

    #[test]
    fn launch_url_is_https_and_ticket_stays_in_fragment() {
        let ticket = "a".repeat(64);
        let (url, allowed) =
            expert_webview_url("https://expert.example.com/workbench", &ticket).unwrap();
        assert_eq!(url.fragment(), Some(format!("ticket={ticket}").as_str()));
        assert_eq!(url.origin(), allowed.origin());
        assert_eq!(allowed.fragment(), None);
        assert_ne!(
            allowed.origin(),
            url::Url::parse("https://other.example.com/")
                .unwrap()
                .origin()
        );
    }

    #[test]
    fn rejects_untrusted_launch_inputs() {
        let ticket = "a".repeat(64);
        for address in [
            "file:///expert.html",
            "https://user:pass@expert.example.com",
            "https://expert.example.com/#old",
        ] {
            assert!(expert_webview_url(address, &ticket).is_err());
        }
        assert!(expert_webview_url("https://expert.example.com", "short").is_err());
        assert!(expert_webview_label("Geology", &ticket).is_err());
        let label = expert_webview_label("geology-analysis", &ticket).unwrap();
        assert_eq!(label, "expert-geology-analysis-aaaaaaaaaaaaaaaa");
        assert!(validate_expert_webview_label(&label).is_ok());
        assert!(validate_expert_webview_label("main").is_err());
    }

    #[test]
    fn http_launch_keeps_the_registered_port_and_scheme() {
        let (launch, allowed) =
            expert_webview_url("http://ac.zjugis.com:3301/", &"a".repeat(64)).unwrap();
        assert_eq!(launch.scheme(), "http");
        assert_eq!(launch.port(), Some(3301));
        assert_eq!(launch.origin(), allowed.origin());
        assert_ne!(
            allowed.origin(),
            url::Url::parse("http://ac.zjugis.com:3300/")
                .unwrap()
                .origin()
        );
    }
}

#[cfg(test)]
mod external_link_tests {
    use super::may_open_in_browser;
    use url::Url;

    #[test]
    fn opens_only_web_links_in_the_system_browser() {
        for address in [
            "https://docs.qq.com/scenario/open-claw.html?authType=1",
            "http://example.com/",
        ] {
            assert!(may_open_in_browser(&Url::parse(address).unwrap()));
        }
        for address in [
            "file:///private.txt",
            "javascript:alert(1)",
            "mailto:test@example.com",
        ] {
            assert!(!may_open_in_browser(&Url::parse(address).unwrap()));
        }
    }
}

#[cfg(test)]
mod marketplace_tests {
    use super::{
        copy_imported_workspace_directory, copy_imported_workspace_file, import_workspace_files_at,
        import_workspace_paths_at, install_custom_skill_directory_at, install_marketplace_skill_at,
        install_marketplace_skill_files_at, isolated_harness_home, marketplace_package_sha256,
        read_analysis_view, save_session_log_archive_at, uninstall_marketplace_skill_at,
        CustomSkillFile, WorkspaceImportFile,
    };
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDirectory(PathBuf);

    #[test]
    fn release_home_stays_inside_the_preview_app_data_directory() {
        let app_data_dir = PathBuf::from("preview-app-data");
        assert_eq!(
            isolated_harness_home(&app_data_dir),
            app_data_dir.join("dsh-home")
        );
        assert_ne!(
            isolated_harness_home(&app_data_dir),
            PathBuf::from("user-home/.dsh")
        );
    }

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "dsh-marketplace-test-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_package(root: &PathBuf, version: &str, body: &str) {
        let slug = "market-test-skill";
        let directory = root.join(slug);
        fs::create_dir_all(directory.join("references")).expect("create package");
        fs::write(
            directory.join("SKILL.md"),
            format!("---\nname: {slug}\ndescription: Test skill\n---\n\n{body}\n"),
        )
        .expect("write skill");
        fs::write(directory.join("references/api.md"), "# API\n").expect("write reference");
        let manifest = format!(
            r#"{{"id":"test-skill","slug":"{slug}","version":"{version}","files":["manifest.json","SKILL.md","references/api.md"]}}"#
        );
        fs::write(directory.join("manifest.json"), &manifest).expect("write manifest");
        fs::write(
            root.join("catalog.json"),
            format!(r#"{{"skills":[{manifest}]}}"#),
        )
        .expect("write catalog");
    }

    #[test]
    fn installs_updates_and_uninstalls_a_complete_package() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        let skills = user.0.join("skills");
        write_package(&resources.0, "1.0.0", "First");

        let installed = install_marketplace_skill_at(&resources.0, &skills, "market-test-skill")
            .expect("install");
        assert!(PathBuf::from(installed).exists());
        assert_eq!(
            fs::read_to_string(skills.join("market-test-skill/references/api.md"))
                .expect("reference"),
            "# API\n"
        );

        write_package(&resources.0, "1.1.0", "Second");
        install_marketplace_skill_at(&resources.0, &skills, "market-test-skill").expect("update");
        assert!(
            fs::read_to_string(skills.join("market-test-skill/SKILL.md"))
                .expect("updated skill")
                .contains("Second")
        );

        uninstall_marketplace_skill_at(&skills, "market-test-skill").expect("uninstall");
        assert!(!skills.join("market-test-skill").exists());
        assert!(user.0.join(".dsh-skill-staging").is_dir());
        assert!(fs::read_dir(user.0.join(".dsh-skill-staging"))
            .expect("read staging")
            .next()
            .is_none());
    }

    #[test]
    fn personal_import_cannot_reuse_a_platform_display_name() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        let source = TestDirectory::new();
        let skills = user.0.join("skills");
        write_package(&resources.0, "1.0.0", "Original instructions");
        super::install_marketplace_skill_named_at(
            &resources.0, &skills, "market-test-skill", Some("会议纪要"),
        ).expect("platform installation");
        fs::write(source.0.join("SKILL.md"), "---\nname: personal-meeting\ndescription: Test\n---\nDifferent instructions\n").unwrap();
        let error = super::install_custom_skill_directory_named_at(
            &skills, &source.0, Some("会议纪要"),
        ).expect_err("same display name must be refused");
        assert!(error.contains("已存在同名技能"));
        assert!(!skills.join("personal-meeting").exists());
        assert!(fs::read_to_string(skills.join("market-test-skill/SKILL.md")).unwrap().contains("Original instructions"));
        write_package(&resources.0, "1.1.0", "Updated instructions");
        super::install_marketplace_skill_named_at(
            &resources.0, &skills, "market-test-skill", Some("会议纪要"),
        ).expect("same identity may update");
    }

    #[test]
    fn installs_a_validated_downloaded_package() {
        let user = TestDirectory::new();
        let skills = user.0.join("skills");
        let files = vec![
            CustomSkillFile {
                path: "manifest.json".to_string(),
                content: br#"{"id":"test-skill","slug":"market-test-skill","version":"2.0.0","files":["manifest.json","SKILL.md","scripts/invoke.ps1"]}"#.to_vec(),
            },
            CustomSkillFile {
                path: "SKILL.md".to_string(),
                content: b"---\nname: market-test-skill\n---\n\n# Downloaded\n".to_vec(),
            },
            CustomSkillFile {
                path: "scripts/invoke.ps1".to_string(),
                content: b"Write-Output downloaded\n".to_vec(),
            },
        ];
        install_marketplace_skill_files_at(&skills, "market-test-skill", files)
            .expect("install downloaded package");
        assert_eq!(
            fs::read_to_string(skills.join("market-test-skill/scripts/invoke.ps1"))
                .expect("downloaded script"),
            "Write-Output downloaded\n"
        );
    }

    #[test]
    fn imports_a_complete_custom_skill_directory() {
        let source = TestDirectory::new();
        let user = TestDirectory::new();
        fs::create_dir_all(source.0.join("scripts")).expect("create scripts");
        fs::write(
            source.0.join("SKILL.md"),
            "---\nname: personal-meeting-notes\ndescription: Organize meeting notes\n---\n",
        )
        .expect("write skill");
        fs::write(source.0.join("scripts/invoke.ps1"), "Write-Output notes\n")
            .expect("write script");

        let installed = install_custom_skill_directory_at(&user.0.join("skills"), &source.0)
            .expect("import custom directory");
        assert_eq!(installed.slug, "personal-meeting-notes");
        assert_eq!(installed.description, "Organize meeting notes");
        assert!(installed
            .body
            .as_deref()
            .unwrap_or_default()
            .contains("personal-meeting-notes"));
        let uploaded = installed.files.as_ref().expect("upload files");
        assert_eq!(uploaded.len(), 2);
        assert!(uploaded.iter().any(|file| file.path == "SKILL.md"));
        assert_eq!(
            fs::read_to_string(
                user.0
                    .join("skills/personal-meeting-notes/scripts/invoke.ps1")
            )
            .expect("copied script"),
            "Write-Output notes\n"
        );
        assert!(user
            .0
            .join("skills/personal-meeting-notes/.dsh-custom-skill")
            .is_file());

        fs::write(
            source.0.join("scripts/invoke.ps1"),
            "Write-Output updated\n",
        )
        .expect("update script");
        install_custom_skill_directory_at(&user.0.join("skills"), &source.0)
            .expect_err("duplicate imports must not overwrite an installed skill");
        assert_eq!(
            fs::read_to_string(
                user.0
                    .join("skills/personal-meeting-notes/scripts/invoke.ps1")
            )
            .expect("updated script"),
            "Write-Output notes\n"
        );
    }

    #[test]
    fn hashes_downloaded_files_independently_of_transport_order() {
        let first = vec![
            CustomSkillFile {
                path: "SKILL.md".to_string(),
                content: b"skill".to_vec(),
            },
            CustomSkillFile {
                path: "manifest.json".to_string(),
                content: b"manifest".to_vec(),
            },
        ];
        let second = vec![
            CustomSkillFile {
                path: "manifest.json".to_string(),
                content: b"manifest".to_vec(),
            },
            CustomSkillFile {
                path: "SKILL.md".to_string(),
                content: b"skill".to_vec(),
            },
        ];
        assert_eq!(
            marketplace_package_sha256(&first),
            marketplace_package_sha256(&second)
        );
    }

    #[test]
    fn refuses_to_replace_an_unmanaged_directory() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        let skills = user.0.join("skills");
        write_package(&resources.0, "1.0.0", "First");
        let target = skills.join("market-test-skill");
        fs::create_dir_all(&target).expect("create unmanaged directory");
        fs::write(target.join("SKILL.md"), "---\nname: personal-skill\n---\n")
            .expect("write unmanaged skill");

        let error = install_marketplace_skill_at(&resources.0, &skills, "market-test-skill")
            .expect_err("must reject unmanaged directory");
        assert!(error.contains("不是由技能市场管理"));
        assert!(target.exists());
    }

    #[test]
    fn recognizes_a_legacy_marketplace_skill_for_upgrade() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        let skills = user.0.join("skills");
        write_package(&resources.0, "1.0.0", "Packaged");
        let target = skills.join("market-test-skill");
        fs::create_dir_all(&target).expect("create legacy directory");
        fs::write(
            target.join("SKILL.md"),
            "---\nname: market-test-skill\ndescription: Legacy\n---\n",
        )
        .expect("write legacy skill");

        install_marketplace_skill_at(&resources.0, &skills, "market-test-skill")
            .expect("upgrade legacy skill");
        assert!(target.join("manifest.json").exists());
    }

    #[test]
    fn saves_session_exports_without_overwriting_a_prior_download() {
        let downloads = TestDirectory::new();
        let first = save_session_log_archive_at(&downloads.0, "dsh-session-root.zip", b"first")
            .expect("first export");
        let second = save_session_log_archive_at(&downloads.0, "dsh-session-root.zip", b"second")
            .expect("second export");

        assert_eq!(
            first.file_name().and_then(|value| value.to_str()),
            Some("dsh-session-root.zip")
        );
        assert_eq!(
            second.file_name().and_then(|value| value.to_str()),
            Some("dsh-session-root-1.zip")
        );
        assert_eq!(fs::read(first).expect("first bytes"), b"first");
        assert_eq!(fs::read(second).expect("second bytes"), b"second");
        assert!(save_session_log_archive_at(&downloads.0, "../escape.zip", b"bad").is_err());
    }

    #[test]
    fn imports_workspace_files_without_overwriting_existing_files() {
        let workspace = TestDirectory::new();
        fs::write(workspace.0.join("地图.png"), b"existing").expect("existing file");
        let imported = import_workspace_files_at(
            &workspace.0,
            vec![
                WorkspaceImportFile {
                    name: "地图.png".to_string(),
                    bytes: b"new image".to_vec(),
                },
                WorkspaceImportFile {
                    name: "说明.pdf".to_string(),
                    bytes: b"pdf".to_vec(),
                },
            ],
        )
        .expect("import files");
        assert_eq!(imported, vec!["地图 (1).png", "说明.pdf"]);
        assert_eq!(
            fs::read(workspace.0.join("地图.png")).expect("existing"),
            b"existing"
        );
        assert_eq!(
            fs::read(workspace.0.join("地图 (1).png")).expect("renamed"),
            b"new image"
        );
        assert_eq!(fs::read(workspace.0.join("说明.pdf")).expect("pdf"), b"pdf");
    }

    #[test]
    fn copies_native_drop_files_and_directories_without_overwriting_existing_files() {
        let source = TestDirectory::new();
        let workspace = TestDirectory::new();
        let source_file = source.0.join("记录.wav");
        let source_directory = source.0.join("材料");
        fs::create_dir(&source_directory).expect("source directory");
        fs::create_dir(source_directory.join("附件")).expect("nested directory");
        fs::write(source_directory.join("说明.txt"), b"summary").expect("directory file");
        fs::write(source_directory.join("附件").join("数据.csv"), b"data").expect("nested file");
        fs::write(&source_file, b"audio").expect("source file");
        fs::write(workspace.0.join("记录.wav"), b"existing").expect("existing file");

        let imported = import_workspace_paths_at(&workspace.0, vec![source_file, source_directory])
            .expect("copy native drop");

        assert_eq!(imported, vec!["记录 (1).wav", "材料/"]);
        assert_eq!(
            fs::read(workspace.0.join("记录.wav")).expect("existing"),
            b"existing"
        );
        assert_eq!(
            fs::read(workspace.0.join("记录 (1).wav")).expect("copy"),
            b"audio"
        );
        assert_eq!(
            fs::read(workspace.0.join("材料").join("附件").join("数据.csv")).expect("nested copy"),
            b"data"
        );
    }

    #[test]
    fn rejects_workspace_import_paths_outside_the_workspace_root() {
        let workspace = TestDirectory::new();
        let error = import_workspace_files_at(
            &workspace.0,
            vec![WorkspaceImportFile {
                name: "../outside.txt".to_string(),
                bytes: b"bad".to_vec(),
            }],
        )
        .expect_err("reject traversal");
        assert!(error.contains("文件名无效"));
        assert!(!workspace.0.join("outside.txt").exists());
    }

    #[test]
    fn native_copy_refuses_a_destination_created_after_name_selection() {
        let source = TestDirectory::new();
        let workspace = TestDirectory::new();
        let source_file = source.0.join("中文 空格.txt");
        let destination = workspace.0.join("中文 空格.txt");
        fs::write(&source_file, b"incoming").unwrap();
        fs::write(&destination, b"keep existing").unwrap();
        assert!(copy_imported_workspace_file(&source_file, &destination, &mut 0, &mut 0).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"keep existing");

        let folder = workspace.0.join("已有目录");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("保留.txt"), b"keep directory").unwrap();
        assert!(copy_imported_workspace_directory(&source.0, &folder, &mut 0, &mut 0).is_err());
        assert_eq!(
            fs::read(folder.join("保留.txt")).unwrap(),
            b"keep directory"
        );
    }

    #[test]
    fn failed_native_directory_copy_removes_only_its_own_partial_directory() {
        let workspace = TestDirectory::new();
        let destination = workspace.0.join("partial");
        assert!(copy_imported_workspace_directory(
            &workspace.0.join("missing source"),
            &destination,
            &mut 0,
            &mut 0,
        )
        .is_err());
        assert!(!destination.exists());
        assert!(workspace.0.is_dir());
    }

    #[test]
    fn reads_only_timestamped_analysis_view_json() {
        let workspace = TestDirectory::new();
        let view = workspace
            .0
            .join("third-survey-analysis-view_20260905_120000_000.json");
        fs::write(&view, r#"{"schema_version":1,"tables":[]}"#).expect("write view");

        assert!(read_analysis_view(view.display().to_string())
            .expect("read analysis view")
            .contains("schema_version"));
        let chinese_view = workspace
            .0
            .join("地块1_三调土地利用现状分析视图_20260905_120000_000.json");
        fs::write(&chinese_view, r#"{"schema_version":1,"tables":[]}"#)
            .expect("write Chinese view");
        assert!(read_analysis_view(chinese_view.display().to_string()).is_ok());
        let review_view = workspace
            .0
            .join("地块1_土地利用规划审查视图_20260905_120000_000.json");
        fs::write(&review_view, r#"{"schema_version":1,"tables":[]}"#).expect("write review view");
        assert!(read_analysis_view(review_view.display().to_string()).is_ok());
        assert!(read_analysis_view(workspace.0.join("other.json").display().to_string()).is_err());
        assert!(read_analysis_view("relative-analysis-view_1.json".to_string()).is_err());
    }
}
