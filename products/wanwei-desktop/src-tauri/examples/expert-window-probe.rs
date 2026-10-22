//! 用真实 WebView2 验证共享数据目录下的专家子视图，不启动业务服务或安装程序。
use std::io::{Read, Write};
use tauri::{LogicalPosition, LogicalSize, WebviewBuilder, WebviewUrl, WebviewWindowBuilder};

#[path = "../src/webview_environment.rs"]
mod webview_environment;
#[cfg(target_os = "windows")]
#[path = "../src/windows_input.rs"]
mod windows_input;

fn main() {
    let mismatched = std::env::args().any(|arg| arg == "--reproduce-mismatch");
    let directory =
        std::env::temp_dir().join(format!("wanwei-expert-probe-{}", std::process::id()));
    let server = std::net::TcpListener::bind("127.0.0.1:0").expect("fixture listener");
    let url: url::Url = format!("http://{}/", server.local_addr().unwrap())
        .parse()
        .unwrap();
    std::thread::spawn(move || {
        for mut stream in server.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            let body = "<!doctype html><title>probe</title><button onclick=\"document.title='probe-clicked'\">fixture</button>";
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        }
    });
    tauri::Builder::default()
        .setup(move |app| {
            let (main_sender, main_receiver) = std::sync::mpsc::channel();
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .visible(false)
                .data_directory(directory.clone())
                .additional_browser_args(webview_environment::BROWSER_ARGS)
                .on_document_title_changed(move |_, title| { if title == "probe-clicked" { let _ = main_sender.send(()); } })
                .build()?;
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    for cycle in 0..5 {
                        let (loaded_sender, loaded_receiver) = std::sync::mpsc::channel();
                        let label = format!("expert-probe-{cycle}");
                        let builder = if mismatched {
                            WebviewBuilder::new(&label, WebviewUrl::External(url.clone())).disable_drag_drop_handler()
                        } else { webview_environment::expert_builder(&label, url.clone()) };
                        let builder = builder
                            .data_directory(directory.clone())
                            .on_page_load(move |_, event| {
                                if event.event() == tauri::webview::PageLoadEvent::Finished { let _ = loaded_sender.send(()); }
                            });
                        let view = main.as_ref().window().add_child(builder, LogicalPosition::new(20.0, 80.0), LogicalSize::new(600.0, 400.0))
                            .map_err(|e| e.to_string())?;
                        view.hide().map_err(|e| e.to_string())?;
                        if mismatched {
                            let confirmation = webview_environment::confirm(&view, false);
                            println!("mismatch confirmation={confirmation:?}");
                            return if confirmation.is_err() { Ok(()) } else { Err("未复现参数冲突".into()) };
                        }
                        webview_environment::confirm(&view, false)?;
                        loaded_receiver.recv_timeout(std::time::Duration::from_secs(10)).map_err(|e| format!("专家页面未加载：{e}"))?;
                        let peer = main.as_ref().window().add_child(
                            webview_environment::expert_builder(&format!("expert-peer-{cycle}"), url.clone()).data_directory(directory.clone()),
                            LogicalPosition::new(20.0, 80.0), LogicalSize::new(600.0, 400.0),
                        ).map_err(|e| e.to_string())?;
                        peer.hide().map_err(|e| e.to_string())?;
                        webview_environment::confirm(&peer, false)?;
                        #[cfg(target_os = "windows")]
                        {
                            let input = windows_input::snapshot(main.hwnd().map_err(|e| e.to_string())?);
                            if input["children"].as_array().map_or(true, |rows| rows.len() < 2) {
                                return Err("原生子窗口诊断未枚举到视图".into());
                            }
                            if input.to_string().contains("probe-clicked") { return Err("原生诊断泄露页面标题".into()); }
                        }
                        for _ in 0..3 {
                            view.show().map_err(|e| e.to_string())?;
                            webview_environment::confirm(&view, true)?;
                            view.set_bounds(tauri::Rect { position: LogicalPosition::new(30.0, 90.0).into(), size: LogicalSize::new(650.0, 420.0).into() }).map_err(|e| e.to_string())?;
                            webview_environment::confirm(&view, true)?;
                            view.hide().map_err(|e| e.to_string())?;
                            webview_environment::confirm(&view, false)?;
                            peer.show().map_err(|e| e.to_string())?;
                            webview_environment::confirm(&peer, true)?;
                            peer.hide().map_err(|e| e.to_string())?;
                            webview_environment::confirm(&peer, false)?;
                        }
                        view.close().map_err(|e| e.to_string())?;
                        if view.bounds().is_ok() { return Err("关闭后原生视图仍存在".into()); }
                        peer.close().map_err(|e| e.to_string())?;
                        if peer.bounds().is_ok() { return Err("第二个专家关闭后仍存在".into()); }
                        main.set_size(LogicalSize::new(1000.0 + 20.0 * f64::from(cycle), 700.0)).map_err(|e| e.to_string())?;
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        let bounds = main.as_ref().bounds().map_err(|e| e.to_string())?;
                        let size = main.inner_size().map_err(|e| e.to_string())?;
                        let actual = bounds.size.to_physical::<u32>(main.scale_factor().map_err(|e| e.to_string())?);
                        if actual != size { return Err(format!("关闭专家后主视图未随窗口缩放：{actual:?} != {size:?}")); }
                        main.eval("document.title='probe';document.querySelector('button').click()").map_err(|e| e.to_string())?;
                        main_receiver.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| format!("主页面事件处理未返回：{e}"))?;
                        println!("cycle={cycle} load/show/bounds/tab-switch/hide/close/main-resize/DOM-handler passed");
                    }
                    Ok(())
                })();
                println!("probe result={result:?}");
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("probe failed");
}
