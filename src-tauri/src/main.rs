#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use slice_engine::app_window::maybe_chdir_to_exe_dir;
use slice_engine::{start_server, EngineConfig, RunningServer};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

fn main() {
    if let (Ok(cwd), Ok(exe)) = (std::env::current_dir(), std::env::current_exe())
        && let Some(target_dir) = maybe_chdir_to_exe_dir(&cwd, &exe)
    {
        let _ = std::env::set_current_dir(target_dir);
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime for Slice engine");

    let config = EngineConfig::default();
    let running: RunningServer = rt
        .block_on(start_server(config))
        .expect("Failed to start embedded Slice engine on 127.0.0.1");
    let app_url: url::Url = running
        .app_url()
        .parse()
        .unwrap_or_else(|_| "http://127.0.0.1:3000".parse().unwrap());
    let server_slot: Mutex<Option<RunningServer>> = Mutex::new(Some(running));

    let app = tauri::Builder::default()
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.navigate(app_url);
            } else {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(app_url))
                    .title("Slice")
                    .inner_size(1400.0, 900.0)
                    .resizable(true)
                    .build()?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to build Tauri application");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event
            && let Some(server) = server_slot.lock().ok().and_then(|mut s| s.take())
        {
            rt.block_on(server.shutdown());
        }
    });
}
