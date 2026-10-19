#[tokio::main]
async fn main() {
    if let (Ok(cwd), Ok(exe)) = (std::env::current_dir(), std::env::current_exe())
        && let Some(target_dir) = slice_engine::app_window::maybe_chdir_to_exe_dir(&cwd, &exe)
    {
        let _ = std::env::set_current_dir(target_dir);
    }
    let config = slice_engine::EngineConfig::default();
    if std::env::args().any(|arg| arg == "--reanalyze-waveforms") {
        match slice_engine::reanalyze_library_waveforms(&config).await {
            Ok(count) => {
                println!("[Server] Reanalyzed waveforms for {count} tracks.");
                return;
            }
            Err(err) => {
                eprintln!("[Server] Waveform reanalysis failed: {err}");
                std::process::exit(1);
            }
        }
    }
    if let Err(err) = slice_engine::run_cli(config).await {
        eprintln!("[Server] Fatal error: {err}");
        std::process::exit(1);
    }
}
