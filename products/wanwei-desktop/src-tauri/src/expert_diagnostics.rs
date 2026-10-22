//! Bounded, content-free diagnostics for native expert input failures.
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{Manager, Webview};

static ACTIVE: AtomicBool = AtomicBool::new(false);
static RECORDS: AtomicUsize = AtomicUsize::new(0);
const MAX_RECORDS: usize = 2000;
pub const SCRIPT: &str = include_str!("expert_diagnostics.js");

fn record(app: &tauri::AppHandle, value: serde_json::Value) {
    if !ACTIVE.load(Ordering::Relaxed) || RECORDS.fetch_add(1, Ordering::Relaxed) >= MAX_RECORDS {
        return;
    }
    if let Ok(directory) = app.path().app_local_data_dir() {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        super::append_log(
            &directory.join("logs/expert-input-diagnostics.jsonl"),
            json!({"timeMs": ms, "processId": std::process::id(), "data": value}).to_string(),
        );
    }
}

/// Start one process-bounded trace when the expert library is opened.
pub fn activate(app: &tauri::AppHandle) {
    if !ACTIVE.swap(true, Ordering::Relaxed) {
        record(
            app,
            json!({"kind": "trace-start", "version": app.package_info().version.to_string()}),
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
            record(
                &app,
                json!({"kind": "native-view", "phase": phase, "role": role,
                "bounds": view.bounds().ok().map(|b| format!("{:?}", b))}),
            );
            #[cfg(target_os = "windows")]
            {
                let callback_app = app.clone();
                let _ = view.with_webview(move |platform| {
                    let controller = platform.controller();
                    let mut visible = Default::default();
                    let mut bounds = Default::default();
                    // COM queries run on the owning WebView thread; no window state is changed.
                    let visibility = unsafe { controller.IsVisible(&mut visible) }
                        .ok()
                        .map(|_| visible.as_bool());
                    let geometry = unsafe { controller.Bounds(&mut bounds) }
                        .ok()
                        .map(|_| [bounds.left, bounds.top, bounds.right, bounds.bottom]);
                    record(
                        &callback_app,
                        json!({"kind": "webview2", "phase": phase,
                        "role": role, "visible": visibility, "bounds": geometry}),
                    );
                });
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
        "focused": event.focused, "interactive": event.interactive, "blocked": event.blocked}),
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
        let mut with_content = raw;
        with_content["text"] = json!("must not be logged");
        assert!(serde_json::from_value::<InputEvent>(with_content).is_err());
    }
}
