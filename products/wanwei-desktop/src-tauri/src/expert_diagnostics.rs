//! Bounded, content-free diagnostics for native expert input failures.
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{Manager, Webview};

static ACTIVE: AtomicBool = AtomicBool::new(false);
static RECORDS: AtomicUsize = AtomicUsize::new(0);
static WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());
const MAX_RECORDS: usize = 2000;
pub const SCRIPT: &str = include_str!("expert_diagnostics.js");

// 原始视图标签含票据片段；仅保存不可逆摘要供同一实例关联。
fn view_id(label: &str) -> String {
    format!("{:x}", Sha256::digest(label.as_bytes()))[..16].to_owned()
}

/// 仅用于原生命令的错误，禁止传入网址、票据或页面错误内容。
pub fn native_result<T>(
    app: &tauri::AppHandle,
    label: &str,
    phase: &'static str,
    started: std::time::Instant,
    result: &Result<T, String>,
) {
    record(
        app,
        json!({"kind":"native-operation", "viewId":view_id(label),
        "phase":phase, "elapsedMs":started.elapsed().as_millis(), "ok":result.is_ok(),
        "error":result.as_ref().err().map(|error| error.chars().take(512).collect::<String>())}),
    );
}

/// 固定阶段名；不接受页面内容或导航地址。
pub fn lifecycle(app: &tauri::AppHandle, label: &str, phase: &'static str) {
    record(
        app,
        json!({"kind":"native-lifecycle", "viewId":view_id(label), "phase":phase}),
    );
}

/// 请求布局仅包含几何数值，不记录启动地址。
pub fn layout(app: &tauri::AppHandle, label: &str, phase: &'static str, rect: [f64; 4]) {
    record(
        app,
        json!({"kind":"requested-layout", "viewId":view_id(label), "phase":phase, "rect":rect}),
    );
}

fn record(app: &tauri::AppHandle, value: serde_json::Value) {
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let sequence = RECORDS.fetch_add(1, Ordering::Relaxed);
    if sequence >= MAX_RECORDS {
        return;
    }
    let value = if sequence == MAX_RECORDS - 1 {
        json!({"kind":"trace-limit", "limit":MAX_RECORDS})
    } else {
        value
    };
    if let Ok(directory) = app.path().app_local_data_dir() {
        // 一条 JSON 与其换行必须一起写入，避免并发快照交错。
        let _writer = WRITER.lock().unwrap_or_else(|error| error.into_inner());
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        super::append_log(
            &directory.join("logs/expert-input-diagnostics.jsonl"),
            json!({"timeMs": ms, "processId": std::process::id(), "sequence": sequence, "data": value}).to_string(),
        );
    }
}

/// Start one process-bounded trace when the expert library is opened.
pub fn activate(app: &tauri::AppHandle) {
    if !ACTIVE.swap(true, Ordering::Relaxed) {
        record(
            app,
            json!({"kind": "trace-start", "version": app.package_info().version.to_string(),
                "diagnosticRevision":2,
                "os":std::env::consts::OS, "arch":std::env::consts::ARCH,
                "browserArgsHash":view_id(super::webview_environment::BROWSER_ARGS)}),
        );
    }
    if let Some(main) = app.get_webview("main") {
        let _ = main.eval("window.dispatchEvent(new Event('wanwei:expert-diagnostics-start'))");
    }
    snapshot(app, "open-requested");
}

/// Sample again after queued native visibility/disposal operations have had time to run.
pub fn settled_snapshot(app: &tauri::AppHandle, phase: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        snapshot(&app, phase);
    });
}

/// Read live native geometry on a worker, and WebView2 state on its UI thread.
pub fn snapshot(app: &tauri::AppHandle, phase: &'static str) {
    if !ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let views = app.webviews();
        let experts = views
            .keys()
            .filter(|label| label.starts_with("expert-"))
            .count();
        let window = app.get_window("main");
        #[cfg(target_os = "windows")]
        if let Some(window) = &window {
            if let Ok(hwnd) = window.hwnd() {
                let mut input = super::windows_input::snapshot(hwnd);
                input["phase"] = json!(phase);
                record(&app, input);
            }
        }
        record(
            &app,
            json!({"kind": "native-window", "phase": phase, "experts": experts,
            "size": window.as_ref().and_then(|w| w.inner_size().ok()).map(|s| [s.width, s.height]),
            "scale": window.as_ref().and_then(|w| w.scale_factor().ok()),
            "focused": window.as_ref().and_then(|w| w.is_focused().ok())}),
        );
        for (label, view) in views {
            let role = if label == "main" {
                "main"
            } else if label.starts_with("expert-") {
                "expert"
            } else {
                continue;
            };
            let bounds = view.bounds();
            record(
                &app,
                json!({"kind": "native-view", "phase": phase, "role": role, "viewId":view_id(&label),
                "bounds": bounds.as_ref().ok().map(|b| format!("{:?}", b)),
                "boundsError": bounds.as_ref().err().map(ToString::to_string)}),
            );
            #[cfg(target_os = "windows")]
            {
                let callback_app = app.clone();
                let id = view_id(&label);
                let (completed, completion) = std::sync::mpsc::channel();
                let dispatched = view.with_webview(move |platform| {
                    let controller = platform.controller();
                    let mut visible = Default::default();
                    let mut bounds = Default::default();
                    let mut parent = Default::default();
                    let parent_result = unsafe { controller.ParentWindow(&mut parent) };
                    // COM queries run on the owning WebView thread; no window state is changed.
                    let visibility = unsafe { controller.IsVisible(&mut visible) };
                    let geometry = unsafe { controller.Bounds(&mut bounds) };
                    record(
                        &callback_app,
                        json!({"kind": "webview2", "phase": phase,
                        "role": role, "viewId":id,
                        "nativeParent":parent_result.as_ref().ok().map(|_| format!("{:p}",parent.0)),
                        "parentError":parent_result.err().map(|e| e.to_string()),
                        "visible": visibility.as_ref().ok().map(|_| visible.as_bool()),
                        "visibilityError":visibility.err().map(|e| e.to_string()),
                        "bounds": geometry.as_ref().ok().map(|_| [bounds.left, bounds.top, bounds.right, bounds.bottom]),
                        "boundsError":geometry.err().map(|e| e.to_string())}),
                    );
                    let _ = completed.send(());
                });
                let callback_result = dispatched.map_err(|e| e.to_string()).and_then(|_| {
                    completion
                        .recv_timeout(std::time::Duration::from_secs(3))
                        .map_err(|e| e.to_string())
                });
                if let Err(error) = callback_result {
                    record(
                        &app,
                        json!({"kind":"webview2-query-failed", "phase":phase,
                        "role":role, "viewId":view_id(&label), "error":error}),
                    );
                }
            }
        }
    });
}

/// Only numeric and allowlisted structural DOM facts can reach the trace.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputEvent {
    event: String,
    tag: String,
    hit_tag: String,
    #[serde(default)]
    control: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    focused: bool,
    interactive: bool,
    blocked: bool,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    hit_matches: bool,
    #[serde(default)]
    dialogs: u32,
}

fn permitted(event: &InputEvent) -> bool {
    const TAGS: &[&str] = &[
        "button", "input", "textarea", "select", "a", "div", "span", "svg", "path", "other", "none",
    ];
    [
        "start",
        "pointerdown",
        "pointerup",
        "click",
        "bubble-click",
        "pointercancel",
        "visibilitychange",
        "settled-click",
        "resize",
        "focus",
        "blur",
        "feature-open",
        "library-open",
        "detail-open",
        "cancel-handler",
        "start-handler",
        "start-enter",
        "start-ignored",
        "request-start",
        "request-success",
        "prepare-start",
        "prepare-done",
        "launch-mounted",
        "launch-error",
    ]
    .contains(&event.event.as_str())
        && TAGS.contains(&event.tag.as_str())
        && TAGS.contains(&event.hit_tag.as_str())
        && ["", "none", "cancel", "start"].contains(&event.control.as_str())
        && event.x.abs_diff(0) <= 100_000
        && event.y.abs_diff(0) <= 100_000
        && event.width <= 100_000
        && event.height <= 100_000
        && event.dialogs <= 10_000
}

#[tauri::command]
pub async fn expert_input_diagnostic(webview: Webview, event: InputEvent) -> Result<(), String> {
    if webview.label() != "main" || webview.window().label() != "main" {
        return Err("诊断仅允许主页面调用".into());
    }
    if !permitted(&event) {
        return Err("诊断事件无效".into());
    }
    if event.event == "library-open" {
        activate(webview.app_handle());
    }
    if !ACTIVE.load(Ordering::Relaxed) {
        return Ok(());
    }
    let app = webview.app_handle();
    record(
        app,
        json!({"kind": "dom-input", "event": event.event, "tag": event.tag,
        "hitTag": event.hit_tag, "control": event.control, "x": event.x, "y": event.y, "size": [event.width, event.height],
        "focused": event.focused, "interactive": event.interactive, "blocked": event.blocked,
        "disabled":event.disabled, "hitMatches":event.hit_matches, "dialogs":event.dialogs}),
    );
    if matches!(
        event.event.as_str(),
        "settled-click"
            | "resize"
            | "feature-open"
            | "library-open"
            | "detail-open"
            | "cancel-handler"
            | "start-handler"
    ) {
        snapshot(app, "dom-checkpoint");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn view_identifiers_do_not_expose_ticket_fragments() {
        let first = view_id("expert-private-name-ticket-fragment");
        assert_eq!(first.len(), 16);
        assert!(first.chars().all(|value| value.is_ascii_hexdigit()));
        assert_eq!(first, view_id("expert-private-name-ticket-fragment"));
        assert_ne!(first, view_id("expert-private-name-other-fragment"));
    }
    #[test]
    fn only_content_free_bounded_events_are_accepted() {
        let raw = json!({"event":"click","tag":"button","hitTag":"span","x":1,"y":2,
            "width":1120,"height":720,"focused":true,"interactive":true,"blocked":false});
        let mut event: InputEvent = serde_json::from_value(raw.clone()).unwrap();
        assert!(permitted(&event));
        event.tag = "private-input-content".into();
        assert!(!permitted(&event));
        event.tag = "button".into();
        event.x = i32::MIN;
        assert!(!permitted(&event));
        event.x = 1;
        event.event = "bubble-click".to_owned();
        event.dialogs = 2;
        assert!(permitted(&event));
        event.dialogs = 10_001;
        assert!(!permitted(&event));
        let mut with_content = raw;
        with_content["text"] = json!("must not be logged");
        assert!(serde_json::from_value::<InputEvent>(with_content).is_err());
    }
}
