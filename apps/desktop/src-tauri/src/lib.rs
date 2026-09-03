use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

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

struct Sidecar(Arc<Mutex<Option<Child>>>);

impl Sidecar {
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

fn user_skills_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位桌面应用数据目录：{error}"))?;
    if let Some(home) = development_harness_home(&app_data_dir) {
        return Ok(home.join("skills"));
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法定位当前用户目录".to_string())?;
    Ok(PathBuf::from(home).join(".dsh").join("skills"))
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
                file.write_all(bytes).map_err(|error| {
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
        "技能目录 {} 不是由技能广场管理，拒绝覆盖或删除",
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

fn install_marketplace_skill_at(
    resource_root: &Path,
    skills_root: &Path,
    slug: &str,
) -> Result<String, String> {
    validate_marketplace_slug(slug)?;
    let manifest = manifest_for_slug(resource_root, slug)?;
    let source = resource_root.join(slug);
    validate_marketplace_tree(&source, &manifest)?;
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
            return Ok(directory.join("SKILL.md").display().to_string());
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let staging = skills_root.join(format!(".{slug}.install-{}-{nonce}", std::process::id()));
    let backup = skills_root.join(format!(".{slug}.backup-{}-{nonce}", std::process::id()));
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

#[tauri::command]
fn list_marketplace_skills(app: tauri::AppHandle) -> Result<Vec<MarketplaceSkillState>, String> {
    let resource_root = marketplace_resource_root(&app)?;
    let skills_root = user_skills_root(&app)?;
    let catalog = read_marketplace_catalog(&resource_root)?;
    catalog
        .skills
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
fn install_marketplace_skill(app: tauri::AppHandle, slug: String) -> Result<String, String> {
    let resource_root = marketplace_resource_root(&app)?;
    let skills_root = user_skills_root(&app)?;
    install_marketplace_skill_at(&resource_root, &skills_root, &slug)
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
    manifest_for_slug(&marketplace_resource_root(&app)?, &slug)?;
    uninstall_marketplace_skill_at(&user_skills_root(&app)?, &slug)
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

/// Early desktop builds used a third-party agent-plane vision tool. It shares
/// the `recognize_image` name with the bundled ZJUGIS implementation but
/// expects a different host service (`vision`), so an old user-level preset
/// can shadow the bundled tool after an installer upgrade. Disable only that
/// exact obsolete entry and retain a one-time backup of the user's preset.
fn disable_legacy_vision_tool(log_path: &Path) {
    let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) else {
        return;
    };
    let path = PathBuf::from(home)
        .join(".dsh")
        .join(".agent-presets")
        .join("vision")
        .join("agent.cordis.yml");
    let Ok(raw) = fs::read_to_string(&path) else {
        return;
    };
    if !raw.contains("@linenxi-ctrl/dsh-vision/lib/tool.js") {
        return;
    }

    let mut changed = false;
    let mut lines = raw.lines().peekable();
    let mut updated = String::new();
    while let Some(line) = lines.next() {
        if line.trim() == "- id: tool-vision"
            && lines
                .peek()
                .is_some_and(|next| next.contains("@linenxi-ctrl/dsh-vision/lib/tool.js"))
        {
            let _ = lines.next();
            changed = true;
            continue;
        }
        updated.push_str(line);
        updated.push('\n');
    }
    if !changed {
        return;
    }

    let backup = path.with_extension("yml.zjugis-vision-backup");
    if !backup.exists() {
        let _ = fs::write(&backup, &raw);
    }
    match fs::write(&path, updated) {
        Ok(()) => append_log(
            log_path,
            "disabled obsolete @linenxi-ctrl/dsh-vision tool; bundled dsh-vision is now authoritative",
        ),
        Err(error) => append_log(log_path, format!("could not disable obsolete vision tool: {error}")),
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

fn production_command(resource_dir: &Path) -> (PathBuf, PathBuf, Vec<String>) {
    let runtime = bundled_resource(resource_dir, "runtime");
    let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let app = runtime.join("app");
    (
        node,
        app.clone(),
        vec![app.join("lib/bin.js").display().to_string()],
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

fn spawn_sidecar(
    resource_dir: &Path,
    config: &ServerConfig,
    log_path: &Path,
    app_data_dir: &Path,
) -> Result<(Child, Url), String> {
    let (program, cwd, mut args) = if cfg!(debug_assertions) {
        development_command()
    } else {
        production_command(resource_dir)
    };
    let document_tool = if cfg!(debug_assertions) {
        cwd.join("apps")
            .join("desktop")
            .join("scripts")
            .join("document-tool.mjs")
    } else {
        bundled_resource(resource_dir, "runtime")
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
    args.extend(["--profile".into(), "desktop".into()]);
    if cfg!(debug_assertions) {
        let development_patch = cwd
            .join("apps")
            .join("desktop")
            .join("dev")
            .join("cordis.patch.yml");
        if !development_patch.is_file() {
            return Err(format!(
                "Desktop development patch is missing: {}",
                development_patch.display()
            ));
        }
        args.extend(["--patch".into(), development_patch.display().to_string()]);
    }
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
    let mut command = Command::new(&program);
    command
        .args(args)
        .current_dir(cwd)
        .env("DSH_ONEAPI_URL", &config.one_api_url)
        .env("DSH_NODE_BINARY", &program)
        .env("DSH_DOCUMENT_TOOL", &document_tool)
        .env("PYTHONUSERBASE", &python_userbase)
        .env("PIP_CACHE_DIR", &pip_cache)
        .env("TEMP", &python_temp)
        .env("TMP", &python_temp)
        .env("TMPDIR", &python_temp)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        // Workspace Write users approve the first package-manager download in
        // a session. Later dependency installs reuse that explicit session grant.
        .env("DSH_DEPENDENCY_INSTALL_APPROVALS", "session-once")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = development_harness_home(app_data_dir) {
        fs::create_dir_all(&home).map_err(|error| {
            format!(
                "Unable to create desktop development home {}: {error}",
                home.display()
            )
        })?;
        command.env("DSH_HOME", &home);
        command.env("DSH_DESKTOP_DEVELOPMENT", "1");
        append_log(
            log_path,
            format!("development Harness home: {}", home.display()),
        );
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

    let stdout = child.stdout.take().ok_or("无法读取 DSH Sidecar 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 DSH Sidecar 错误输出")?;
    let (sender, receiver) = mpsc::channel();
    let stdout_log = log_path.to_path_buf();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            append_log(&stdout_log, format!("[stdout] {line}"));
            eprintln!("[dsh] {line}");
            if let Some(raw) = line.strip_prefix("dsh web: ") {
                let candidate = raw.split_whitespace().next().unwrap_or(raw);
                if let Ok(url) = Url::parse(candidate) {
                    let _ = sender.send(url);
                    break;
                }
            }
        }
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
        let deadline = std::time::Instant::now() + Duration::from_secs(45);
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
                return Err("DSH Sidecar 在 45 秒内未就绪，请检查日志和 server.json".to_string());
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    } else {
        receiver
            .recv_timeout(Duration::from_secs(45))
            .map_err(|_| "DSH Sidecar 在 45 秒内未就绪，请检查日志和 server.json".to_string())?
    };
    Ok((child, url))
}

pub fn run() {
    tauri::Builder::default()
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
            append_log(&log_path, "ZJUGIS Harness startup");
            disable_legacy_vision_tool(&log_path);
            let config = server_config(&resource_dir).map_err(|message| {
                append_log(&log_path, format!("[fatal] {message}"));
                std::io::Error::new(std::io::ErrorKind::InvalidData, message)
            })?;
            let (child, url) = spawn_sidecar(&resource_dir, &config, &log_path, &app_data_dir)
                .map_err(|message| {
                    append_log(&log_path, format!("[fatal] {message}"));
                    std::io::Error::other(message)
                })?;
            app.manage(Sidecar(Arc::new(Mutex::new(Some(child)))));

            // Keep the sidecar alive when the user closes the window. The
            // application is controlled from the system tray and only exits
            // through the tray's explicit quit action.
            let show_item =
                MenuItem::with_id(app, "show", "显示 ZJUGIS Harness", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "退出 ZJUGIS Harness", true, None::<&str>)?;
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

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("ZJUGIS Harness")
                .inner_size(1120.0, 720.0)
                .min_inner_size(900.0, 580.0)
                .resizable(false)
                .maximizable(false)
                .center()
                // The external sidecar can lose window.__TAURI__ after a
                // navigation. AuthGate emits this marker through
                // document.title, which this native callback always sees.
                .on_document_title_changed(|window, title| {
                    let authenticated = match title.strip_prefix(NATIVE_AUTH_TITLE_PREFIX) {
                        Some("authenticated") => true,
                        Some("login") => false,
                        _ => return,
                    };
                    let _ = apply_auth_window_state(&window, authenticated);
                    let _ = window.set_title("ZJUGIS Harness");
                })
                .build()?;
            let window_for_events = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_auth_window_state,
            save_session_log_archive,
            list_marketplace_skills,
            install_marketplace_skill,
            uninstall_marketplace_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DSH Desktop");
}

#[cfg(test)]
mod marketplace_tests {
    use super::{
        install_marketplace_skill_at, save_session_log_archive_at, uninstall_marketplace_skill_at,
    };
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDirectory(PathBuf);

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
        write_package(&resources.0, "1.0.0", "First");

        let installed = install_marketplace_skill_at(&resources.0, &user.0, "market-test-skill")
            .expect("install");
        assert!(PathBuf::from(installed).exists());
        assert_eq!(
            fs::read_to_string(user.0.join("market-test-skill/references/api.md"))
                .expect("reference"),
            "# API\n"
        );

        write_package(&resources.0, "1.1.0", "Second");
        install_marketplace_skill_at(&resources.0, &user.0, "market-test-skill").expect("update");
        assert!(
            fs::read_to_string(user.0.join("market-test-skill/SKILL.md"))
                .expect("updated skill")
                .contains("Second")
        );

        uninstall_marketplace_skill_at(&user.0, "market-test-skill").expect("uninstall");
        assert!(!user.0.join("market-test-skill").exists());
    }

    #[test]
    fn refuses_to_replace_an_unmanaged_directory() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        write_package(&resources.0, "1.0.0", "First");
        let target = user.0.join("market-test-skill");
        fs::create_dir_all(&target).expect("create unmanaged directory");
        fs::write(target.join("SKILL.md"), "---\nname: personal-skill\n---\n")
            .expect("write unmanaged skill");

        let error = install_marketplace_skill_at(&resources.0, &user.0, "market-test-skill")
            .expect_err("must reject unmanaged directory");
        assert!(error.contains("不是由技能广场管理"));
        assert!(target.exists());
    }

    #[test]
    fn recognizes_a_legacy_marketplace_skill_for_upgrade() {
        let resources = TestDirectory::new();
        let user = TestDirectory::new();
        write_package(&resources.0, "1.0.0", "Packaged");
        let target = user.0.join("market-test-skill");
        fs::create_dir_all(&target).expect("create legacy directory");
        fs::write(
            target.join("SKILL.md"),
            "---\nname: market-test-skill\ndescription: Legacy\n---\n",
        )
        .expect("write legacy skill");

        install_marketplace_skill_at(&resources.0, &user.0, "market-test-skill")
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
}
