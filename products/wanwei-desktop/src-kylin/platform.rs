//! Linux-only GTK shell. Business commands compile from the Tauri 2 source tree.
use super::*;
use gtk::prelude::*;
use javascriptcore::ValueExt;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap};
use tauri::{CustomMenuItem, SystemTray, SystemTrayEvent, SystemTrayMenu, WindowBuilder, WindowUrl};
use webkit2gtk::traits::*;

pub trait KylinAppExt {
    fn path(&self) -> Paths;
    fn get_webview_window(&self, label: &str) -> Option<Window>;
}
pub struct Paths(tauri::AppHandle);
impl Paths {
    pub fn app_local_data_dir(&self) -> Result<PathBuf, String> {
        self.0.path_resolver().app_local_data_dir().ok_or_else(|| "无法定位应用数据目录".into())
    }
    pub fn resource_dir(&self) -> Result<PathBuf, String> {
        self.0.path_resolver().resource_dir().ok_or_else(|| "无法定位应用资源目录".into())
    }
}
impl KylinAppExt for tauri::AppHandle {
    fn path(&self) -> Paths { Paths(self.clone()) }
    fn get_webview_window(&self, label: &str) -> Option<Window> { self.get_window(label) }
}

struct Expert {
    view: webkit2gtk::WebView,
    bounds: [i32; 4],
}
struct Host {
    main: webkit2gtk::WebView,
    fixed: gtk::Fixed,
    experts: HashMap<String, Expert>,
}
thread_local! { static HOST: RefCell<Option<Host>> = const { RefCell::new(None) }; }

fn ui<T: Send + 'static>(app: &tauri::AppHandle, task: impl FnOnce(&mut Host) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = HOST.with(|host| match host.borrow_mut().as_mut() {
            Some(host) => task(host),
            None => Err("麒麟视图尚未就绪".into()),
        });
        let _ = sender.send(result);
    }).map_err(|e| e.to_string())?;
    receiver.recv_timeout(Duration::from_secs(30)).map_err(|_| "麒麟视图操作超时".to_string())?
}

fn bounds(args: &Value) -> Result<[i32; 4], String> {
    let values: [f64; 4] = [arg(args, "x")?, arg(args, "y")?, arg(args, "width")?, arg(args, "height")?];
    if !values.iter().all(|n| n.is_finite() && n.abs() <= 100_000.0) || values[2] < 200.0 || values[3] < 200.0 {
        return Err("专家视图尺寸无效".into());
    }
    Ok(values.map(|n| n.round() as i32))
}
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("原生命令参数无效：{name}"))
}
fn value<T: Serialize>(result: Result<T, String>) -> Result<Value, String> {
    serde_json::to_value(result?).map_err(|e| e.to_string())
}

// Match the existing expert capabilities; window, update and network control remain main-only.
fn expert_command(command: &str) -> bool {
    matches!(command, "save_session_log_archive" | "save_expert_artifact"
        | "list_marketplace_skills" | "install_marketplace_skill" | "uninstall_marketplace_skill"
        | "install_custom_skill" | "install_custom_skill_directory" | "install_custom_skill_archive"
        | "uninstall_custom_skill" | "list_custom_skills" | "read_analysis_view"
        | "open_workspace_directory" | "open_skill_directory" | "reveal_downloaded_file" | "import_workspace_files")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request { nonce: String, document_id: String, id: u32, command: String, args: Value }

fn nonce() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn bridge(view: &webkit2gtk::WebView, app: &tauri::AppHandle, label: &str, origin: &str) -> Result<(), String> {
    let token = nonce()?;
    let script = include_str!("native-bridge.js")
        .replace("__WANWEI_ORIGIN__", &json!(origin).to_string())
        .replace("__WANWEI_NONCE__", &json!(token).to_string());
    let manager = view.user_content_manager().ok_or("WebKit 原生通道不可用")?;
    if !manager.register_script_message_handler("wanwei") { return Err("WebKit 原生通道注册失败".into()); }
    let compatibility = include_str!("browser-compat.js")
        .replace("__WANWEI_ORIGIN__", &json!(origin).to_string())
        .replace("__WANWEI_MAIN_VIEW__", if label == "main" { "true" } else { "false" });
    manager.add_script(&webkit2gtk::UserScript::new(&compatibility,
        webkit2gtk::UserContentInjectedFrames::TopFrame, webkit2gtk::UserScriptInjectionTime::Start, &[], &[]));
    manager.add_script(&webkit2gtk::UserScript::new(&script,
        webkit2gtk::UserContentInjectedFrames::TopFrame, webkit2gtk::UserScriptInjectionTime::Start, &[], &[]));
    let weak = view.downgrade();
    let origin = origin.to_owned();
    let caller = label.to_owned();
    let app = app.clone();
    manager.connect_script_message_received(Some("wanwei"), move |_, message| {
        let Some(view) = weak.upgrade() else { return };
        let current = view.uri().and_then(|uri| Url::parse(&uri).ok());
        if current.as_ref().map(|url| url.origin().ascii_serialization()).as_deref() != Some(origin.as_str()) { return; }
        let Some(raw) = message.js_value().map(|value| value.to_string()) else { return };
        if raw.len() > 192 * 1024 * 1024 { return; }
        let Ok(request) = serde_json::from_str::<Request>(&raw) else { return };
        if request.nonce != token || request.document_id.len() > 128 { return; }
        let handle = app.clone();
        let label = caller.clone();
        let allowed = caller == "main" || expert_command(&request.command);
        tauri::async_runtime::spawn_blocking(move || {
            let result = if allowed { dispatch(&handle, &label, &request.command, request.args) }
                else { Err("此页面无权调用该原生命令".into()) };
            let reply = match result {
                Ok(value) => json!({"documentId":request.document_id, "id":request.id, "ok":true, "value":value}),
                Err(error) => json!({"documentId":request.document_id, "id":request.id, "ok":false, "error":error}),
            };
            let _ = ui(&handle, move |host| {
                let view = if label == "main" { Some(&host.main) } else { host.experts.get(&label).map(|e| &e.view) };
                if let Some(view) = view {
                    view.run_javascript(&format!("window.__WANWEI_NATIVE_REPLY__?.({reply});"), None::<&gio::Cancellable>, |_| {});
                }
                Ok(())
            });
        });
    });
    Ok(())
}

fn navigation(view: &webkit2gtk::WebView, app: &tauri::AppHandle, origin: &str, main: bool) {
    let origin = origin.to_owned();
    let app = app.clone();
    view.connect_decide_policy(move |_, decision, kind| {
        if !matches!(kind, webkit2gtk::PolicyDecisionType::NavigationAction | webkit2gtk::PolicyDecisionType::NewWindowAction) { return false; }
        let Some(decision) = decision.downcast_ref::<webkit2gtk::NavigationPolicyDecision>() else { return false };
        let target = decision.navigation_action().and_then(|action| action.request()).and_then(|request| request.uri())
            .and_then(|uri| Url::parse(&uri).ok());
        let popup = kind == webkit2gtk::PolicyDecisionType::NewWindowAction;
        if !popup && target.as_ref().is_some_and(|url| url.origin().ascii_serialization() == origin) { return false; }
        decision.ignore();
        if main {
            if let Some(url) = target.filter(|url| may_open_in_browser(url)) {
                if network_policy::may_open(&app, &url) {
                    let _ = tauri::api::shell::open(&app.shell_scope(), url.as_str(), None);
                } else if let Some(window) = app.get_window("main") {
                    let _ = window.eval("window.dispatchEvent(new Event('wanwei:network-blocked'));");
                }
            }
        }
        true
    });
    // No unmanaged popup WebViews; navigation policy handles browser links.
    view.connect_create(|_, _| None);
}

fn open_expert(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let label = expert_webview_label(&arg::<String>(args, "key")?, &arg::<String>(args, "ticket")?)?;
    let (launch, native) = expert_webview_url(&arg::<String>(args, "url")?, &arg::<String>(args, "ticket")?)?;
    let rect = bounds(args)?;
    let bootstrap = expert_ticket_bootstrap(&launch, &native);
    let handle = app.clone();
    let created = label.clone();
    ui(app, move |host| {
        if host.experts.contains_key(&created) { return Err("专家视图已打开".into()); }
        let context = host.main.context().ok_or("WebKit 上下文不可用")?;
        let manager = webkit2gtk::UserContentManager::new();
        let view: webkit2gtk::WebView = glib::Object::new(&[("web-context", &context), ("user-content-manager", &manager)])
            .map_err(|e| e.to_string())?;
        bridge(&view, &handle, &created, &native.origin().ascii_serialization())?;
        manager.add_script(&webkit2gtk::UserScript::new(&bootstrap,
            webkit2gtk::UserContentInjectedFrames::TopFrame, webkit2gtk::UserScriptInjectionTime::Start, &[], &[]));
        navigation(&view, &handle, &native.origin().ascii_serialization(), false);
        view.set_size_request(rect[2], rect[3]);
        view.set_no_show_all(true);
        host.fixed.put(&view, rect[0], rect[1]);
        view.hide();
        view.load_uri(native.as_str());
        host.experts.insert(created, Expert { view, bounds: rect });
        host.fixed.queue_resize();
        Ok(())
    })?;
    log_expert_view(app, "kylin: created hidden");
    Ok(json!(label))
}

fn expert_operation(app: &tauri::AppHandle, command: &str, args: &Value) -> Result<Value, String> {
    let label: String = arg(args, "label")?;
    validate_expert_webview_label(&label)?;
    let rect = if command == "set_expert_webview_bounds" { Some(bounds(args)?) } else { None };
    let visible = if command == "set_expert_webview_visible" { arg(args, "visible")? } else { false };
    let close = command == "close_expert_webview";
    ui(app, move |host| {
        if close {
            if let Some(expert) = host.experts.remove(&label) {
                expert.view.hide();
                expert.view.stop_loading();
                host.fixed.remove(&expert.view);
            }
            host.main.grab_focus();
            return Ok(Value::Null);
        }
        let expert = host.experts.get_mut(&label).ok_or("专家视图不存在")?;
        if let Some(rect) = rect {
            expert.bounds = rect;
            host.fixed.move_(&expert.view, rect[0], rect[1]);
            expert.view.set_size_request(rect[2], rect[3]);
            host.fixed.queue_resize();
        } else if visible { expert.view.show(); expert.view.grab_focus(); }
        else { expert.view.hide(); host.main.grab_focus(); }
        Ok(Value::Null)
    })
}

fn save_artifact(args: &Value) -> Result<Value, String> {
    let file_name: String = arg(args, "fileName")?;
    let encoded: String = arg(args, "bytesBase64")?;
    if encoded.len() > (expert_artifacts::MAX_BYTES / 3 + 1) * 4 { return Err("成果文件超过 128 MB".into()); }
    let bytes = BASE64_STANDARD.decode(encoded).map_err(|_| "成果文件编码无效".to_string())?;
    expert_artifacts::validate(&file_name, &bytes)?;
    let extension = Path::new(&file_name).extension().and_then(|s| s.to_str()).unwrap_or("");
    let selected = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_title("保存专家成果").set_directory(user_downloads_root()?).set_file_name(&file_name)
        .add_filter("成果文件", &[extension]).save_file();
    match selected {
        Some(path) => value(expert_artifacts::save_selected_at(&path, &file_name, &bytes).map(|p| p.display().to_string())),
        None => Ok(Value::Null),
    }
}

fn dispatch(app: &tauri::AppHandle, caller: &str, command: &str, args: Value) -> Result<Value, String> {
    let main = || app.get_window("main").ok_or_else(|| "主窗口不存在".to_string());
    match command {
        "set_auth_window_state" => {
            let authenticated: bool = arg(&args, "authenticated")?;
            if !authenticated { ui(app, |host| { clear_experts(host); Ok(()) })?; }
            value(super::set_auth_window_state(app.clone(), authenticated))
        }
        "save_session_log_archive" => value(super::save_session_log_archive(arg(&args, "fileName")?, arg(&args, "bytes")?)),
        "save_knowledge_download" if caller == "main" => {
            let file_name: String = arg(&args, "fileName")?;
            let encoded: String = arg(&args, "bytesBase64")?;
            let downloads = tauri::api::path::download_dir()
                .ok_or_else(|| "无法定位下载文件夹".to_string())?;
            value(super::save_encoded_knowledge_download_at(&downloads, &file_name, &encoded))
        }
        "save_expert_artifact" if caller != "main" => save_artifact(&args),
        "list_marketplace_skills" => value(super::list_marketplace_skills(app.clone())),
        "install_marketplace_skill" => value(super::install_marketplace_skill(app.clone(), arg(&args, "slug")?, arg(&args, "files")?, arg(&args, "sha256")?, arg(&args, "displayName")?)),
        "uninstall_marketplace_skill" => value(super::uninstall_marketplace_skill(app.clone(), arg(&args, "slug")?)),
        "install_custom_skill" => value(super::install_custom_skill(app.clone(), arg(&args, "slug")?, arg(&args, "files")?)),
        "install_custom_skill_directory" => value(super::install_custom_skill_directory(app.clone(), arg(&args, "directory")?, arg(&args, "displayName")?)),
        "install_custom_skill_archive" => value(super::install_custom_skill_archive(app.clone(), arg(&args, "archive")?, arg(&args, "displayName")?)),
        "uninstall_custom_skill" => value(super::uninstall_custom_skill(app.clone(), arg(&args, "slug")?)),
        "list_custom_skills" => value(super::list_custom_skills(app.clone())),
        "read_analysis_view" => value(super::read_analysis_view(arg(&args, "path")?)),
        "open_workspace_directory" => value(super::open_workspace_directory(arg(&args, "workspacePath")?)),
        "open_skill_directory" => value(super::open_skill_directory(app.clone(), arg(&args, "slug")?)),
        "reveal_downloaded_file" => value(super::reveal_downloaded_file(arg(&args, "filePath")?)),
        "import_workspace_files" => value(super::import_workspace_files(app.clone(), arg(&args, "workspacePath")?, arg(&args, "files")?)),
        "import_dropped_workspace_files" => value(super::import_dropped_workspace_files(app.clone(), app.state::<PendingWorkspaceDrop>(), arg(&args, "workspacePath")?)),
        "import_clipboard_workspace_files" => value(super::import_clipboard_workspace_files(main()?, arg(&args, "workspacePath")?)),
        "create_automatic_workspace" => value(super::create_automatic_workspace(main()?, arg(&args, "name")?)),
        "maximize_expert_window" => value(super::maximize_expert_window(main()?)),
        "open_expert_webview" => open_expert(app, &args),
        "set_expert_webview_bounds" | "set_expert_webview_visible" | "close_expert_webview" => expert_operation(app, command, &args),
        "set_network_environment" => value(network_policy::set_network_environment(arg(&args, "mode")?, arg(&args, "internalOrigins")?, app.state::<network_policy::NetworkPolicy>())),
        "open_external_link" => value(network_policy::open_external_link(app.clone(), arg(&args, "address")?)),
        "install_skillhub_skill" => value(tauri::async_runtime::block_on(skillhub::install_skillhub_skill(app.clone(), arg(&args, "archive")?, arg(&args, "record")?))),
        "list_skillhub_skills" => value(skillhub::list_skillhub_skills(app.clone())),
        "uninstall_skillhub_skill" => value(skillhub::uninstall_skillhub_skill(app.clone(), arg(&args, "slug")?, arg(&args, "localSlug")?)),
        "desktop_update_status" => Ok(json!({"configured":false, "automatic":false, "currentVersion":app.package_info().version.to_string(),
            "currentOfficial":env!("DSH_RELEASE_OFFICIAL") == "true", "phase":"idle", "received":0, "total":0,
            "message":"麒麟兼容版请通过安装包更新", "completed":null})),
        "desktop_update_check" | "desktop_update_automatic" => Err("麒麟兼容版暂不支持自动更新，请安装新版安装包".into()),
        "desktop_update_dismiss" => Ok(Value::Null),
        "kylin_smoke_snapshot" if cfg!(debug_assertions) && std::env::var_os("WANWEI_KYLIN_SMOKE_URL").is_some() => {
          let (mut snapshot, replies) = ui(app, |host| {
            let mut experts = Vec::new();
            let mut replies = Vec::new();
            for (label, expert) in &host.experts {
                let rect = expert.view.allocation();
                experts.push(json!({"label":label,"visible":expert.view.is_visible(),
                    "sameWindow":expert.view.toplevel() == host.main.toplevel(),
                    "bounds":[rect.x(),rect.y(),rect.width(),rect.height()]}));
                let (sender, receiver) = mpsc::channel();
                expert.view.run_javascript("window.probeCounter", None::<&gio::Cancellable>, move |result| {
                    let counter = result.ok().and_then(|r| r.js_value()).map(|v| v.to_double());
                    let _ = sender.send(counter);
                });
                replies.push(receiver);
            }
            Ok((json!({"experts":experts}), replies))
          })?;
          for (index, reply) in replies.into_iter().enumerate() {
              snapshot["experts"][index]["counter"] = json!(reply.recv_timeout(Duration::from_secs(5)).ok().flatten());
          }
          Ok(snapshot)
        }
        "kylin_smoke_exit" if cfg!(debug_assertions) && std::env::var_os("WANWEI_KYLIN_SMOKE_URL").is_some() => {
            let passed: bool = arg(&args, "passed")?;
            println!("KYLIN_SHELL_SMOKE passed={passed}");
            app.exit(if passed { 0 } else { 1 });
            Ok(Value::Null)
        }
        "expert_input_diagnostic" => {
            // The GTK diagnostics sample native views without copying page content.
            ui(app, |host| {
                eprintln!("KYLIN_DIAGNOSTIC embedded_experts={}", host.experts.len());
                Ok(Value::Null)
            })
        }
        _ => Err("此页面不支持该原生命令".into()),
    }
}

fn clear_experts(host: &mut Host) {
    for (_, expert) in host.experts.drain() {
        expert.view.hide();
        expert.view.stop_loading();
        host.fixed.remove(&expert.view);
    }
    host.main.grab_focus();
}

fn attach(window: &Window, app: tauri::AppHandle, url: Url) -> tauri::Result<()> {
    let native_window = window.clone();
    window.with_webview(move |platform| {
        let main = platform.inner().as_ref().clone();
        let result = (|| -> Result<(), String> {
            let parent = main.parent().ok_or("主视图没有 GTK 父容器")?.downcast::<gtk::Container>().map_err(|_| "主视图父容器无效")?;
            let top = parent.parent().ok_or("主视图没有 GTK 窗口")?.downcast::<gtk::Window>().map_err(|_| "主视图窗口层级无效")?;
            if !parent.children().iter().all(|child| child == main.upcast_ref::<gtk::Widget>()
                || child.downcast_ref::<gtk::MenuBar>().is_some_and(|menu| menu.children().is_empty())) {
                return Err("主视图容器含有未适配的控件".into());
            }
            let overlay = gtk::Overlay::new();
            parent.remove(&main);
            top.remove(&parent);
            overlay.add(&main);
            // Wry's mouse/touch handlers require the main view's grandparent to be GtkWindow.
            top.add(&overlay);
            let fixed = gtk::Fixed::new();
            fixed.set_hexpand(true);
            fixed.set_vexpand(true);
            overlay.add_overlay(&fixed);
            // Empty overlay space must reach the main view; expert child windows keep input.
            overlay.set_overlay_pass_through(&fixed, true);
            fixed.connect_size_allocate(|_, _| HOST.with(|host| {
                if let Some(host) = host.borrow().as_ref() {
                    for expert in host.experts.values() {
                        let [x, y, width, height] = expert.bounds;
                        expert.view.size_allocate(&gtk::Allocation::new(x, y, width, height));
                    }
                }
            }));
            bridge(&main, &app, "main", &url.origin().ascii_serialization())?;
            navigation(&main, &app, &url.origin().ascii_serialization(), true);
            let auth_window = native_window.clone();
            main.connect_title_notify(move |view| {
                let Some(title) = view.title() else { return };
                let authenticated = match title.strip_prefix(NATIVE_AUTH_TITLE_PREFIX) {
                    Some("authenticated") => true, Some("login") => false, _ => return,
                };
                if !authenticated { HOST.with(|host| { if let Some(host) = host.borrow_mut().as_mut() { clear_experts(host); } }); }
                let _ = apply_auth_window_state(&auth_window, authenticated);
                let _ = auth_window.set_title("万维Buddy");
            });
            HOST.with(|host| *host.borrow_mut() = Some(Host { main: main.clone(), fixed, experts: HashMap::new() }));
            overlay.show_all();
            // Loopback cookies are port-independent. Remove obsolete auth cookies before
            // the first request, preserving expert sessions on other origins.
            glib::MainContext::default().spawn_local(async move {
                if let Some(manager) = main.context().and_then(|context| context.cookie_manager()) {
                    match manager.cookies_future(url.as_str()).await {
                        Ok(cookies) => for mut cookie in cookies {
                            if cookie.name().is_some_and(|name| name.starts_with("dsh-auth-")) {
                                if let Err(error) = manager.delete_cookie_future(&mut cookie).await {
                                    eprintln!("Kylin auth cookie cleanup: {error}");
                                }
                            }
                        },
                        Err(error) => eprintln!("Kylin auth cookie enumeration: {error}"),
                    }
                }
                main.load_uri(url.as_str());
                let _ = native_window.show();
            });
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("KYLIN_FATAL {error}");
            app.exit(1);
        }
    })
}

fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
    }
}

pub fn run() {
    // Set before GTK/WebKit initialization; deployment overrides remain available.
    for name in ["WEBKIT_DISABLE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE"] {
        if std::env::var_os(name).is_none() { std::env::set_var(name, "1"); }
    }
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "显示 万维Buddy"))
        .add_item(CustomMenuItem::new("quit", "退出 万维Buddy"));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| restore(app)))
        .system_tray(SystemTray::new().with_menu(menu))
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } if id == "quit" => {
                if let Some(sidecar) = app.try_state::<Sidecar>() { sidecar.stop(); }
                app.exit(0);
            }
            SystemTrayEvent::MenuItemClick { id, .. } if id == "show" => restore(app),
            SystemTrayEvent::DoubleClick { .. } => restore(app),
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle();
            let resources = handle.path().resource_dir()?;
            let data = handle.path().app_local_data_dir()?;
            let log = data.join("logs/startup.log");
            let _ = fs::remove_file(&log);
            append_log(&log, "万维Buddy Kylin Tauri 1 startup");
            let smoke = if cfg!(debug_assertions) { std::env::var("WANWEI_KYLIN_SMOKE_URL").ok() } else { None };
            let url = if let Some(smoke) = smoke {
                let url = Url::parse(&smoke)?;
                if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") { return Err("Smoke URL must be loopback HTTP".into()); }
                url
            } else {
                let config = server_config(&resources)?;
                let (child, url, receiver) = spawn_sidecar(&resources, &config, &log, &data)?;
                app.manage(Sidecar(Arc::new(Mutex::new(Some(child))), Mutex::new(receiver)));
                url
            };
            app.manage(PendingWorkspaceDrop(Mutex::new(None)));
            app.manage(network_policy::NetworkPolicy::default());
            let window = WindowBuilder::new(app, "main", WindowUrl::External(Url::parse("data:text/html,%3Chtml%3E%3C/html%3E")?))
                .title("万维Buddy").inner_size(1120.0, 720.0).min_inner_size(900.0, 580.0)
                .resizable(false).center().visible(false).build()?;
            attach(&window, handle, url)?;
            let event_window = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); let _ = event_window.hide(); }
                tauri::WindowEvent::FileDrop(tauri::FileDropEvent::Dropped(paths)) => {
                    let handle = event_window.app_handle();
                    if let Ok(mut pending) = handle.state::<PendingWorkspaceDrop>().0.lock() { *pending = Some(paths.clone()); }
                    let _ = event_window.eval(NATIVE_FILE_DROP_SCRIPT);
                }
                tauri::WindowEvent::FileDrop(tauri::FileDropEvent::Hovered(_)) => { let _ = event_window.eval(NATIVE_FILE_DRAG_ENTER_SCRIPT); }
                tauri::WindowEvent::FileDrop(tauri::FileDropEvent::Cancelled) => { let _ = event_window.eval(NATIVE_FILE_DRAG_LEAVE_SCRIPT); }
                _ => {}
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build Wanwei Kylin shell")
        .run(|app, event| if matches!(event, tauri::RunEvent::Exit) {
            if let Some(sidecar) = app.try_state::<Sidecar>() { sidecar.stop(); }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expert_pages_cannot_control_shell_or_network() {
        for command in ["open_expert_webview", "set_auth_window_state", "desktop_update_check", "set_network_environment", "open_external_link", "unknown"] {
            assert!(!expert_command(command));
        }
        assert!(expert_command("save_expert_artifact"));
        assert!(!expert_command("save_knowledge_download"));
    }
    #[test]
    fn rejects_nonfinite_or_out_of_range_native_geometry() {
        assert!(bounds(&json!({"x":0,"y":0,"width":340,"height":380})).is_ok());
        assert!(bounds(&json!({"x":0,"y":0,"width":199,"height":380})).is_err());
        assert!(bounds(&json!({"x":1e20,"y":0,"width":340,"height":380})).is_err());
    }
}
