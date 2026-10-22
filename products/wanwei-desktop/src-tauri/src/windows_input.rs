//! 只读 Win32 命中与子窗口几何；不读取窗口标题、文本或其他应用的窗口树。
use serde_json::{json, Value};
use windows::core::BOOL;
use windows::Win32::{
    Foundation::{HWND, LPARAM, POINT, RECT},
    UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, GetCursorPos, GetGUIThreadInfo, GetWindowRect,
        GetWindowThreadProcessId, IsChild, IsWindowVisible, WindowFromPoint, GUITHREADINFO,
    },
};

fn handle(window: HWND) -> String {
    format!("{:p}", window.0)
}

fn window_facts(window: HWND) -> Value {
    let mut class = [0u16; 128];
    let mut rect = RECT::default();
    let length = unsafe { GetClassNameW(window, &mut class) };
    let class = String::from_utf16_lossy(&class[..length.max(0) as usize]);
    let kind = if class == "WRY_WEBVIEW" {
        "wry-container"
    } else if class.starts_with("Chrome_") {
        "webview2"
    } else {
        "other"
    };
    let geometry = unsafe { GetWindowRect(window, &mut rect) };
    json!({"handle":handle(window), "class":kind,
        "visible":unsafe { IsWindowVisible(window).as_bool() },
        "enabled":unsafe { windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled(window).as_bool() },
        "rect":geometry.as_ref().ok().map(|_| [rect.left, rect.top, rect.right, rect.bottom]),
        "geometryError":geometry.err().map(|e| e.to_string())})
}

unsafe extern "system" fn child(window: HWND, state: LPARAM) -> BOOL {
    // EnumChildWindows 同步调用；state 仅在 snapshot 的栈内有效。
    let rows = unsafe { &mut *(state.0 as *mut Vec<Value>) };
    if rows.len() >= 64 {
        return BOOL(0);
    }
    rows.push(window_facts(window));
    BOOL(1)
}

/// 仅枚举指定主窗口的后代；外部命中仅报告不属于客户端。
pub fn snapshot(main: HWND) -> Value {
    let mut point = POINT::default();
    let cursor = unsafe { GetCursorPos(&mut point) };
    let hit = cursor
        .as_ref()
        .ok()
        .map(|_| unsafe { WindowFromPoint(point) });
    let in_app = hit.map(|hit| hit == main || unsafe { IsChild(main, hit).as_bool() });
    let mut rows = Vec::<Value>::new();
    let _ = unsafe {
        EnumChildWindows(
            Some(main),
            Some(child),
            LPARAM(&mut rows as *mut _ as isize),
        )
    };
    let thread = unsafe { GetWindowThreadProcessId(main, None) };
    let mut gui = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    let gui_result = unsafe { GetGUIThreadInfo(thread, &mut gui) };
    let owned = |window| {
        if window == main || unsafe { IsChild(main, window).as_bool() } {
            Some(handle(window))
        } else {
            None
        }
    };
    json!({"kind":"windows-input", "main":handle(main),
        "cursor":cursor.as_ref().ok().map(|_| [point.x,point.y]),
        "cursorError":cursor.err().map(|e| e.to_string()),
        "hitInApp":in_app, "hit":hit.filter(|_| in_app == Some(true)).map(window_facts),
        "focus":gui_result.as_ref().ok().and_then(|_| owned(gui.hwndFocus)),
        "capture":gui_result.as_ref().ok().and_then(|_| owned(gui.hwndCapture)),
        "guiError":gui_result.err().map(|e| e.to_string()), "children":rows})
}
