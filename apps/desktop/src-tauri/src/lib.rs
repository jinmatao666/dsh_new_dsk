use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
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

struct Sidecar(Arc<Mutex<Option<Child>>>);

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
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
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
    (
        PathBuf::from("node"),
        root.clone(),
        vec![
            "--import".into(),
            "tsx/esm".into(),
            root.join("apps/cli/src/bin.ts").display().to_string(),
        ],
    )
}

fn spawn_sidecar(
    resource_dir: &Path,
    config: &ServerConfig,
    log_path: &Path,
) -> Result<(Child, Url), String> {
    let (program, cwd, mut args) = if cfg!(debug_assertions) {
        development_command()
    } else {
        production_command(resource_dir)
    };
    args.extend([
        "--profile".into(),
        "desktop".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        "0".into(),
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
    #[cfg(windows)]
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
    let url = receiver
        .recv_timeout(Duration::from_secs(45))
        .map_err(|_| "DSH Sidecar 在 45 秒内未就绪，请检查日志和 server.json".to_string())?;
    Ok((child, url))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let log_path = app
                .path()
                .app_local_data_dir()?
                .join("logs")
                .join("startup.log");
            let _ = fs::remove_file(&log_path);
            append_log(&log_path, "Wanwei Harness startup");
            let config = server_config(&resource_dir).map_err(|message| {
                append_log(&log_path, format!("[fatal] {message}"));
                std::io::Error::new(std::io::ErrorKind::InvalidData, message)
            })?;
            let (child, url) =
                spawn_sidecar(&resource_dir, &config, &log_path).map_err(|message| {
                    append_log(&log_path, format!("[fatal] {message}"));
                    std::io::Error::other(message)
                })?;
            app.manage(Sidecar(Arc::new(Mutex::new(Some(child)))));

            // Keep the sidecar alive when the user closes the window. The
            // application is controlled from the system tray and only exits
            // through the tray's explicit quit action.
            let show_item = MenuItem::with_id(app, "show", "显示 Wanwei Harness", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Wanwei Harness", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().ok_or("缺少应用图标")?.clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Wanwei Harness")
                .inner_size(1120.0, 720.0)
                .min_inner_size(900.0, 580.0)
                .center()
                .build()?;
            let window_for_events = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
                // Windows reports a native minimize as a zero-sized resize
                // before it is removed from the taskbar. Treat it like
                // closing the window so both controls go to tray.
                if let WindowEvent::Resized(size) = event {
                    if size.width == 0 || size.height == 0 {
                        let _ = window_for_events.hide();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DSH Desktop");
}
