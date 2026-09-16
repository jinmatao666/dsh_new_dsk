use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const PRODUCT_PROFILE: &str = "wanwei-desktop";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
    #[serde(default)]
    one_api_url: String,
    #[serde(default)]
    default_model: String,
    #[serde(default)]
    install_id: String,
}

/// Owns the child so normal Tauri shutdown also terminates the local DSH host.
struct Sidecar(Mutex<Child>);

impl Drop for Sidecar {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn append_log(path: &Path, message: impl AsRef<str>) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message.as_ref());
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

fn read_server_config(resource_dir: &Path) -> Result<ServerConfig, String> {
    let path = bundled_resource(resource_dir, "server.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let config: ServerConfig =
        serde_json::from_str(&raw).map_err(|error| format!("server.json 无效：{error}"))?;
    if config.one_api_url.is_empty() {
        if cfg!(not(debug_assertions)) {
            return Err("server.json 必须配置 OneAPI 地址".into());
        }
        return Ok(config);
    }
    let url =
        Url::parse(&config.one_api_url).map_err(|error| format!("OneAPI 地址无效：{error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("OneAPI 地址必须使用 http 或 https".into());
    }
    Ok(config)
}

fn development_command() -> (PathBuf, PathBuf, Vec<String>) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
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

fn production_command(resource_dir: &Path) -> (PathBuf, PathBuf, Vec<String>) {
    let runtime = bundled_resource(resource_dir, "runtime");
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

fn spawn_sidecar(
    resource_dir: &Path,
    app_data_dir: &Path,
    config: &ServerConfig,
    log_path: &Path,
) -> Result<(Child, Url), String> {
    let (program, cwd, mut args) = if cfg!(debug_assertions) {
        development_command()
    } else {
        production_command(resource_dir)
    };
    let dsh_home = app_data_dir.join("dsh-home");
    fs::create_dir_all(&dsh_home)
        .map_err(|error| format!("无法创建预览版 DSH_HOME {}：{error}", dsh_home.display()))?;

    args.extend([
        "--profile".into(),
        PRODUCT_PROFILE.into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        "0".into(),
        "--no-open".into(),
    ]);
    append_log(
        log_path,
        format!("starting sidecar: {} {}", program.display(), args.join(" ")),
    );

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .env("DSH_HOME", &dsh_home)
        .env("DSH_NODE_BINARY", &program)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !config.one_api_url.is_empty() {
        command.env("DSH_ONEAPI_URL", &config.one_api_url);
    }
    // Source development normally bypasses login so UI work never depends on
    // a live service. An explicit real-auth launch keeps the debug identity
    // and isolated DSH_HOME while exercising the production login path.
    if cfg!(debug_assertions) && std::env::var_os("DSH_DESKTOP_REAL_AUTH").is_none() {
        command.env("DSH_DESKTOP_DEVELOPMENT", "1");
    }
    if !config.default_model.is_empty() {
        command.env("DSH_DEFAULT_MODEL", &config.default_model);
    }
    if !config.install_id.is_empty() {
        command.env("DSH_INSTALL_ID", &config.install_id);
    }
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 DSH Sidecar（{}）：{error}", program.display()))?;
    let stdout = child.stdout.take().ok_or("无法读取 DSH Sidecar 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 DSH Sidecar 错误输出")?;
    let (sender, receiver) = mpsc::channel();

    let stdout_log = log_path.to_path_buf();
    std::thread::spawn(move || {
        let mut ready_sender = Some(sender);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            append_log(&stdout_log, format!("[stdout] {line}"));
            if let Some(raw) = line.strip_prefix("dsh web: ") {
                let candidate = raw.split_whitespace().next().unwrap_or(raw);
                if let Ok(url) = Url::parse(candidate) {
                    if let Some(sender) = ready_sender.take() {
                        let _ = sender.send(url);
                    }
                }
            }
        }
    });
    let stderr_log = log_path.to_path_buf();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            append_log(&stderr_log, format!("[stderr] {line}"));
        }
    });

    match receiver.recv_timeout(Duration::from_secs(90)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "DSH Sidecar 在 90 秒内未就绪，请检查 {}",
                log_path.display()
            ))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let app_data_dir = app.path().app_local_data_dir()?;
            let log_path = app_data_dir.join("logs").join("startup.log");
            let _ = fs::remove_file(&log_path);
            append_log(&log_path, "Wanwei Buddy preview startup");
            let config = read_server_config(&resource_dir).map_err(|message| {
                append_log(&log_path, format!("[fatal] {message}"));
                message
            })?;
            let (child, url) = spawn_sidecar(&resource_dir, &app_data_dir, &config, &log_path)
                .map_err(|message| {
                    append_log(&log_path, format!("[fatal] {message}"));
                    message
                })?;
            app.manage(Sidecar(Mutex::new(child)));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("万维 Buddy 预览版")
                .inner_size(1180.0, 760.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Wanwei Buddy preview shell");
}
