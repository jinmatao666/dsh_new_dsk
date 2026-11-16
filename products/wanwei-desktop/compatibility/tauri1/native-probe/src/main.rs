use gtk::prelude::*;
use javascriptcore::ValueExt;
use std::{cell::Cell, rc::Rc};
use std::sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc};
use tauri::Manager;
use webkit2gtk::traits::*;

struct MainIpc(AtomicBool);

#[tauri::command]
fn probe_echo(value: String) -> String { format!("native:{value}") }

#[tauri::command]
fn probe_report(value: String, state: tauri::State<MainIpc>) {
    let passed = value == "native:shared-command-contract";
    state.0.store(passed, Ordering::SeqCst);
    println!("PROBE_MAIN_IPC passed={passed}");
}

fn main() {
    tauri::Builder::default()
        .manage(MainIpc(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![probe_echo, probe_report])
        .setup(|app| {
            let main = app.get_window("main").expect("main window");
            let handle = app.handle();
            main.with_webview(move |platform| {
                let main_view = platform.inner();
                let parent = main_view.parent().expect("main GTK parent")
                    .downcast::<gtk::Container>().expect("GTK container");
                let overlay = gtk::Overlay::new();
                parent.remove(main_view.as_ref());
                overlay.add(main_view.as_ref());
                parent.add(&overlay);
                let fixed = gtk::Fixed::new();
                fixed.set_hexpand(true);
                fixed.set_vexpand(true);
                overlay.add_overlay(&fixed);
                let finished = Arc::new(AtomicU32::new(0));
                let failed = Arc::new(AtomicBool::new(false));
                for index in 0..2 {
                    let expert = webkit2gtk::WebView::new();
                    expert.set_size_request(360, 400);
                    fixed.put(&expert, 30 + index * 400, 150);
                    let bounds = Rc::new(Cell::new((30 + index * 400, 150, 360, 400)));
                    let bounds_allocate = bounds.clone();
                    let expert_allocate = expert.clone();
                    fixed.connect_size_allocate(move |_, _| {
                        let (x, y, width, height) = bounds_allocate.get();
                        expert_allocate.size_allocate(&gtk::Allocation::new(x, y, width, height));
                    });
                    let loaded = Rc::new(Cell::new(false));
                    let loaded_event = loaded.clone();
                    expert.connect_load_changed(move |view, event| {
                        if event == webkit2gtk::LoadEvent::Finished && !loaded_event.replace(true) {
                            view.run_javascript("window.probeCounter = 41;", None::<&gio::Cancellable>, |_| {});
                        }
                    });
                    expert.load_html(&format!("<html><body><h2>Expert {index}</h2><p>Persistent native WebView</p></body></html>"), Some("http://127.0.0.1/"));
                    let expert_tick = expert.clone();
                    let fixed_tick = fixed.clone();
                    let main_tick = main_view.clone();
                    let finished_tick = finished.clone();
                    let failed_tick = failed.clone();
                    let handle_tick = handle.clone();
                    let ticks = Cell::new(0u32);
                    let moved = Cell::new(false);
                    let hidden_ok = Cell::new(false);
                    glib::timeout_add_local(std::time::Duration::from_millis(300), move || {
                        let tick = ticks.get() + 1;
                        ticks.set(tick);
                        if tick > 80 {
                            eprintln!("PROBE_FAIL expert={index} load timeout");
                            handle_tick.exit(1);
                            return glib::Continue(false);
                        }
                        if !loaded.get() || tick < 5 { return glib::Continue(true); }
                        if !moved.replace(true) {
                            expert_tick.hide();
                            hidden_ok.set(!expert_tick.is_visible());
                            fixed_tick.move_(&expert_tick, 40 + index * 400, 170);
                            bounds.set((40 + index * 400, 170, 340, 380));
                            expert_tick.set_size_request(340, 380);
                            expert_tick.show();
                            fixed_tick.queue_resize();
                            return glib::Continue(true);
                        }
                        let hidden = hidden_ok.get();
                        let embedded = expert_tick.toplevel() == main_tick.toplevel();
                        let parented = expert_tick.parent().map(|p| p == fixed_tick.clone().upcast::<gtk::Widget>()).unwrap_or(false);
                        let rect = expert_tick.allocation();
                        let allocated = rect.width() == 340 && rect.height() == 380
                            && rect.x() == 40 + index * 400 && rect.y() == 170;
                        println!("PROBE_GEOMETRY index={index} x={} y={} width={} height={}", rect.x(), rect.y(), rect.width(), rect.height());
                        if !(hidden && embedded && parented && allocated && expert_tick.is_visible()) {
                            failed_tick.store(true, Ordering::SeqCst);
                        }
                        let finished_js = finished_tick.clone();
                        let failed_js = failed_tick.clone();
                        let handle_js = handle_tick.clone();
                        expert_tick.run_javascript("window.probeCounter + 1", None::<&gio::Cancellable>, move |result| {
                            let value = result.ok().and_then(|r| r.js_value()).map(|v| v.to_double());
                            if value != Some(42.0) { failed_js.store(true, Ordering::SeqCst); }
                            println!("PROBE_EXPERT index={index} same_toplevel={embedded} parented={parented} allocated={allocated} hide_show={hidden} preserved_counter={value:?}");
                            let count = finished_js.fetch_add(1, Ordering::SeqCst) + 1;
                            if count == 2 {
                                if !handle_js.state::<MainIpc>().0.load(Ordering::SeqCst) {
                                    failed_js.store(true, Ordering::SeqCst);
                                }
                                println!("PROBE_RESULT experts=2 passed={} scope=tauri1-gtk-local-html", !failed_js.load(Ordering::SeqCst));
                                handle_js.exit(if failed_js.load(Ordering::SeqCst) { 1 } else { 0 });
                            }
                        });
                        glib::Continue(false)
                    });
                }
                overlay.show_all();
            })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run isolated Tauri 1 probe");
}
