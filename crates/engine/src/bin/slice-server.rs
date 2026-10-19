#[tokio::main]
async fn main() {
    let config = slice_engine::EngineConfig::default();
    println!("Slice Server initialized on port {}", config.port);
}
