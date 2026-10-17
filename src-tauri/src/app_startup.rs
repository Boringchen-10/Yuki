use crate::{db::AppState, explore, personal_sync, reading_network};
use std::sync::Once;

// Android invokes this only after the first-run agreement and source setup.
// Repeated mounts must not create duplicate sync loops or update requests.
pub fn start(app: tauri::AppHandle, pool: sqlx::SqlitePool) {
    static START: Once = Once::new();
    START.call_once(|| {
        personal_sync::start(app, pool.clone());
        tauri::async_runtime::spawn(reading_network::auto_update(pool.clone()));
        tauri::async_runtime::spawn(async move {
            if let Err(error) = explore::check_bangumi_data_update(&pool).await {
                eprintln!("{error}");
            }
        });
    });
}

#[tauri::command]
pub fn start_android_background_services(app: tauri::AppHandle, state: tauri::State<'_, AppState>) {
    start(app, state.pool.clone());
}
