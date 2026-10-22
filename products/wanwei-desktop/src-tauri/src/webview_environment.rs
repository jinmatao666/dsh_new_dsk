//! 主视图与专家视图共享浏览器环境；确认函数只能从非 UI 线程调用。

// 共享数据目录的 WebView2 必须使用完全相同的环境参数。
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion";

/// 专家子视图与主视图共享环境参数，但不接管文件拖放。
pub fn expert_builder(label: &str, url: url::Url) -> tauri::WebviewBuilder<tauri::Wry> {
    tauri::WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
        .additional_browser_args(BROWSER_ARGS)
        .disable_drag_drop_handler()
}

/// 等待原生操作真正执行；不能把派发成功当作窗口创建或可见性变更成功。
pub fn confirm(view: &tauri::Webview, visible: bool) -> Result<(), String> {
    view.bounds()
        .map_err(|error| format!("专家原生视图未就绪：{error}"))?;
    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        view.with_webview(move |platform| {
            let mut actual = Default::default();
            let result = unsafe { platform.controller().IsVisible(&mut actual) }
                .map_err(|error| format!("无法读取专家视图可见性：{error}"))
                .and_then(|_| {
                    if actual.as_bool() == visible {
                        Ok(())
                    } else {
                        Err("专家视图可见性未生效".to_owned())
                    }
                });
            let _ = sender.send(result);
        })
        .map_err(|error| format!("无法查询专家视图：{error}"))?;
        receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("专家视图状态确认失败：{error}"))??;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = visible;
    Ok(())
}
