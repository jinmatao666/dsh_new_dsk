//! Signed desktop updates. No installer runs until the owned Node process exits cleanly.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const MAX_PACKAGE: u64 = 2 * 1024 * 1024 * 1024;
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    configured: bool,
    automatic: bool,
    current_version: String,
    phase: String,
    received: u64,
    total: u64,
    message: String,
}
struct Inner {
    snapshot: Snapshot,
    busy: bool,
    cached: Option<(String, Vec<u8>)>,
}
pub struct DesktopUpdate {
    inner: Mutex<Inner>,
    endpoint: Url,
    public_key: String,
    preference: PathBuf,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    schema: u32,
    product: String,
    version: String,
    platform: String,
    file: String,
    size: u64,
    sha256: String,
    signature: String,
}

fn decode_text(value: &str) -> Result<String, String> {
    String::from_utf8(
        STANDARD
            .decode(value.trim())
            .map_err(|_| "更新签名编码无效")?,
    )
    .map_err(|_| "更新签名文本无效".into())
}

fn verify_manifest(
    raw: &serde_json::Value,
    key: &str,
    version: &str,
    signature: &str,
    platform: &str,
) -> Result<Manifest, String> {
    let text = raw["manifest"]
        .as_str()
        .filter(|text| text.len() <= 16384)
        .ok_or("更新缺少签名清单")?;
    let sig = raw["manifest_signature"]
        .as_str()
        .filter(|text| text.len() <= 4096)
        .ok_or("更新缺少清单签名")?;
    let key = PublicKey::decode(&decode_text(key)?).map_err(|_| "更新公钥无效")?;
    let sig = Signature::decode(&decode_text(sig)?).map_err(|_| "更新清单签名无效")?;
    key.verify(text.as_bytes(), &sig, false)
        .map_err(|_| "更新清单验签失败")?;
    let manifest: Manifest = serde_json::from_str(text).map_err(|_| "更新清单无效")?;
    if manifest.schema != 1
        || manifest.product != "com.wanwei.harness"
        || manifest.version != version
        || manifest.signature != signature
        || manifest.platform != platform
        || manifest.size == 0
        || manifest.size > MAX_PACKAGE
        || manifest.file.contains(['/', '\\'])
        || manifest.file.is_empty()
        || manifest.sha256.len() != 64
        || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("更新清单与当前版本或平台不匹配".into());
    }
    Ok(manifest)
}

fn platform() -> String {
    format!(
        "{}-{}",
        if cfg!(target_os = "macos") {
            "darwin"
        } else {
            std::env::consts::OS
        },
        std::env::consts::ARCH
    )
}

fn update_state(app: &tauri::AppHandle, phase: &str, message: &str) {
    if let Ok(mut inner) = app.state::<DesktopUpdate>().inner.lock() {
        inner.snapshot.phase = phase.into();
        inner.snapshot.message = message.into();
    }
}

async fn confirm(app: &tauri::AppHandle, text: String) -> Result<bool, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(text)
            .title("万维Buddy 更新")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "继续".into(),
                "稍后".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|error| error.to_string())
}

pub fn setup(app: &tauri::AppHandle, base_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value["pubkey"].as_str())
        .unwrap_or("")
        .to_owned();
    let preference = app
        .path()
        .app_local_data_dir()?
        .join("automatic-updates.json");
    let (automatic, preference_message) = match fs::read(&preference) {
        Ok(data) => match serde_json::from_slice::<bool>(&data) {
            Ok(value) => (value, String::new()),
            Err(_) => (
                false,
                "自动检查设置损坏，已暂停自动检查。请重新设置开关。".into(),
            ),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (true, String::new()),
        Err(error) => return Err(error.into()),
    };
    let endpoint = Url::parse(&format!(
        "{}/desktop-updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}",
        base_url.trim_end_matches('/')
    ))?;
    app.manage(DesktopUpdate {
        inner: Mutex::new(Inner {
            snapshot: Snapshot {
                configured: !key.is_empty(),
                automatic,
                current_version: app.package_info().version.to_string(),
                phase: "idle".into(),
                received: 0,
                total: 0,
                message: preference_message,
            },
            busy: false,
            cached: None,
        }),
        endpoint,
        public_key: key,
        preference,
    });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        let mut last = Instant::now()
            .checked_sub(CHECK_INTERVAL)
            .unwrap_or_else(Instant::now);
        loop {
            let enabled = app
                .state::<DesktopUpdate>()
                .inner
                .lock()
                .map(|inner| inner.snapshot.automatic && inner.snapshot.configured && !inner.busy)
                .unwrap_or(false);
            if enabled && last.elapsed() >= CHECK_INTERVAL {
                last = Instant::now();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = run(handle, false).await;
                });
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn desktop_update_status(
    window: WebviewWindow,
    state: State<'_, DesktopUpdate>,
) -> Result<Snapshot, String> {
    if window.label() != "main" {
        return Err("仅主窗口可以检查更新".into());
    }
    Ok(state
        .inner
        .lock()
        .map_err(|_| "更新状态不可用")?
        .snapshot
        .clone())
}

#[tauri::command]
pub fn desktop_update_automatic(
    window: WebviewWindow,
    enabled: bool,
    state: State<'_, DesktopUpdate>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可以设置更新".into());
    }
    // Persist before publishing the new preference; a failed write leaves the old value active.
    let mut inner = state.inner.lock().map_err(|_| "更新状态不可用")?;
    save_preference(&state.preference, enabled)?;
    inner.snapshot.automatic = enabled;
    Ok(())
}

fn save_preference(path: &Path, enabled: bool) -> Result<(), String> {
    let temporary = path.with_extension(format!(
        "{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(if enabled { b"true" } else { b"false" })?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn desktop_update_check(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可以检查更新".into());
    }
    run(app, true).await
}

async fn run(app: tauri::AppHandle, manual: bool) -> Result<(), String> {
    {
        let state = app.state::<DesktopUpdate>();
        let mut inner = state.inner.lock().map_err(|_| "更新状态不可用")?;
        if !inner.snapshot.configured {
            return Err("此安装包未配置更新公钥，请联系管理员发布启用更新的安装包".into());
        }
        if inner.busy {
            return Err("正在检查或下载更新，请稍后重试".into());
        }
        inner.busy = true;
    }
    let result = perform(&app, manual).await;
    if let Err(error) = &result {
        update_state(&app, "error", error);
    }
    if let Ok(mut inner) = app.state::<DesktopUpdate>().inner.lock() {
        inner.busy = false;
    }
    result
}

async fn perform(app: &tauri::AppHandle, manual: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if app.env().appimage.is_none() {
        return Err("Linux 自动更新仅支持 AppImage。此安装版请从管理员提供的安装包手动升级；当前任务不会停止。".into());
    }
    update_state(app, "checking", "正在检查更新");
    let state = app.state::<DesktopUpdate>();
    let update = app
        .updater_builder()
        .endpoints(vec![state.endpoint.clone()])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;
    let Some(update) = update else {
        state.inner.lock().map_err(|_| "更新状态不可用")?.cached = None;
        update_state(
            app,
            "idle",
            if manual {
                "当前已是最新版本（或该平台尚无发布版本）"
            } else {
                ""
            },
        );
        return Ok(());
    };
    let manifest = verify_manifest(
        &update.raw_json,
        &state.public_key,
        &update.version,
        &update.signature,
        &platform(),
    )?;
    // No off-server redirects or foreign origins, even when metadata arrives over HTTP.
    if update.download_url.origin() != state.endpoint.origin()
        || update.download_url.username() != ""
        || update.download_url.password().is_some()
    {
        return Err("更新下载地址不属于配置的服务器".into());
    }
    let cached = state
        .inner
        .lock()
        .map_err(|_| "更新状态不可用")?
        .cached
        .take();
    let bytes = match cached {
        Some((hash, bytes)) if hash == manifest.sha256 => bytes,
        _ => {
            update_state(app, "available", &format!("发现新版本 {}", update.version));
            if !confirm(
                app,
                format!(
                    "发现新版本 {}，大小 {:.1} MB。是否下载？\n下载不会停止当前任务。",
                    update.version,
                    manifest.size as f64 / 1048576.0
                ),
            )
            .await?
            {
                return Ok(());
            }
            download(app, &update, &manifest).await?
        }
    };
    update_state(
        app,
        "ready",
        &format!("{} 已下载，等待安装", update.version),
    );
    if !confirm(app, format!("{} 已下载并通过校验。是否关闭桌面端并安装？\n正在执行会话、工具或自动化时会拒绝安装，请任务结束后再检查更新。", update.version)).await? {
        state.inner.lock().map_err(|_| "更新状态不可用")?.cached = Some((manifest.sha256, bytes));
        return Ok(());
    }
    let handle = app.clone();
    let stopped = tauri::async_runtime::spawn_blocking(move || {
        handle.state::<crate::Sidecar>().prepare_update()
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = stopped {
        state.inner.lock().map_err(|_| "更新状态不可用")?.cached = Some((manifest.sha256, bytes));
        return Err(error);
    }
    update_state(app, "installing", "正在安装更新");
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = update.install(bytes) {
            // The sidecar has already exited. Relaunch the current app rather than leave a broken UI.
            handle
                .dialog()
                .message(format!("安装失败：{error}\n将重新启动当前版本。"))
                .blocking_show();
        }
        handle.restart();
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn download(
    app: &tauri::AppHandle,
    update: &Update,
    manifest: &Manifest,
) -> Result<Vec<u8>, String> {
    update_state(app, "downloading", "正在下载更新");
    let mut response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?
        .get(update.download_url.clone())
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len() as u64 + chunk.len() as u64 > manifest.size {
            return Err("下载超过签名清单指定的大小".into());
        }
        bytes.extend_from_slice(&chunk);
        if let Ok(mut inner) = app.state::<DesktopUpdate>().inner.lock() {
            inner.snapshot.received = bytes.len() as u64;
            inner.snapshot.total = manifest.size;
        }
    }
    if bytes.len() as u64 != manifest.size
        || format!("{:x}", Sha256::digest(&bytes)) != manifest.sha256
    {
        return Err("下载内容校验失败，请重新下载".into());
    }
    verify_package(&bytes, manifest, &app.state::<DesktopUpdate>().public_key)?;
    Ok(bytes)
}

fn verify_package(bytes: &[u8], manifest: &Manifest, public_key: &str) -> Result<(), String> {
    if bytes.len() as u64 != manifest.size
        || format!("{:x}", Sha256::digest(bytes)) != manifest.sha256
    {
        return Err("下载内容校验失败".into());
    }
    let key = PublicKey::decode(&decode_text(public_key)?).map_err(|_| "更新公钥无效")?;
    let sig =
        Signature::decode(&decode_text(&manifest.signature)?).map_err(|_| "更新文件签名无效")?;
    key.verify(bytes, &sig, false)
        .map_err(|_| "更新文件验签失败".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn preference_replaces_existing_value_without_leaving_temporary_files() {
        let root = std::env::temp_dir().join(format!(
            "wanwei-update-pref-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let file = root.join("preference.json");
        save_preference(&file, true).unwrap();
        save_preference(&file, false).unwrap();
        assert!(!serde_json::from_slice::<bool>(&fs::read(&file).unwrap()).unwrap());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_file(file).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn update_commands_are_main_window_only_and_do_not_expose_raw_updater_permissions() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/desktop.json")).unwrap();
        assert_eq!(capability["webviews"], serde_json::json!(["main"]));
        let permissions = capability["permissions"].as_array().unwrap();
        assert!(permissions
            .iter()
            .any(|entry| entry == "allow-desktop-update"));
        assert!(!permissions
            .iter()
            .any(|entry| entry.as_str().unwrap_or("").starts_with("updater:")));
    }

    #[test]
    fn manifest_interop() {
        let Ok(path) = std::env::var("DSH_UPDATE_TEST_ZIP") else {
            return;
        };
        let public_key = std::env::var("DSH_UPDATE_TEST_PUBLIC_KEY").unwrap();
        let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
        let mut text = String::new();
        archive
            .by_name("release.json")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        let mut signature = String::new();
        archive
            .by_name("release.json.sig")
            .unwrap()
            .read_to_string(&mut signature)
            .unwrap();
        let manifest_json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let artifact_signature = manifest_json["signature"].as_str().unwrap();
        let raw = serde_json::json!({"manifest": text, "manifest_signature": signature});
        let verified = verify_manifest(
            &raw,
            &public_key,
            "1.2.0",
            artifact_signature,
            "windows-x86_64",
        )
        .unwrap();
        let mut bytes = Vec::new();
        archive
            .by_name(&verified.file)
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        verify_package(&bytes, &verified, &public_key).unwrap();
        assert!(verify_manifest(
            &raw,
            &public_key,
            "9.9.9",
            artifact_signature,
            "windows-x86_64"
        )
        .is_err());
        assert!(verify_manifest(
            &raw,
            &public_key,
            "1.2.0",
            artifact_signature,
            "darwin-aarch64"
        )
        .is_err());
        let mut tampered = raw.clone();
        tampered["manifest"] = serde_json::json!(text.replace("1.2.0", "9.9.9"));
        assert!(verify_manifest(
            &tampered,
            &public_key,
            "9.9.9",
            artifact_signature,
            "windows-x86_64"
        )
        .is_err());
        bytes[0] ^= 1;
        assert!(verify_package(&bytes, &verified, &public_key).is_err());
    }
}
