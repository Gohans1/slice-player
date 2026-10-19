pub mod app_window;
pub mod audio_analysis;
pub mod audio_source;
pub mod backup;
pub mod db;
pub mod events;
pub mod http;
pub mod ingest;
pub mod metadata;
pub mod models;
pub mod server;
pub mod thumbnails;

pub use server::{reanalyze_library_waveforms, run_cli, start_server, RunningServer};

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub db_path: PathBuf,
    pub data_dir: PathBuf,
    pub dist_dir: PathBuf,
    pub port: u16,
    pub is_production: bool,
    pub is_test: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .filter(|&p| p > 0)
            .unwrap_or(3000);
        let node_env = std::env::var("NODE_ENV").unwrap_or_default();
        Self {
            db_path: PathBuf::from("./data/music.db"),
            data_dir: PathBuf::from("./data"),
            dist_dir: PathBuf::from("./dist"),
            port,
            is_production: node_env == "production",
            is_test: node_env == "test",
        }
    }
}
