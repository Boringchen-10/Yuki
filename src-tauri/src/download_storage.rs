use crate::{db::AppState, error::{AppError, AppResult}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location { id: String, label: String, path: PathBuf, free_bytes: u64 }
#[derive(Clone, Serialize, Deserialize)]
pub struct Storage { selected: String, available: bool, locations: Vec<Location>, #[serde(default)] wifi_only: bool }
fn registry() -> &'static Mutex<HashMap<PathBuf, Storage>> { static VALUES: OnceLock<Mutex<HashMap<PathBuf, Storage>>> = OnceLock::new(); VALUES.get_or_init(Default::default) }
pub fn roots(base: &Path) -> Vec<PathBuf> {
    let mut roots = vec![base.to_path_buf()];
    if let Some(storage) = registry().lock().unwrap().get(base) {
        for item in &storage.locations { if !roots.contains(&item.path) { roots.push(item.path.clone()); } }
    }
    roots
}
pub fn existing_root(base: &Path, relative: &[PathBuf]) -> Option<PathBuf> {
    roots(base).into_iter().find(|root| relative.iter().any(|path| std::fs::symlink_metadata(root.join(path)).is_ok()))
}
pub fn write_root(base: &Path) -> AppResult<PathBuf> {
    match registry().lock().unwrap().get(base) {
        Some(storage) => storage.locations.iter().find(|item| item.id == storage.selected).map(|item| item.path.clone())
            .ok_or_else(|| AppError::Validation("下载目录不可用，请插入 SD 卡或重新选择目录".into())),
        None => Ok(base.to_path_buf()),
    }
}
fn register(base: &Path, storage: Storage) -> AppResult<Storage> {
    let internal = storage.locations.iter().find(|item| item.id == "internal").ok_or_else(|| AppError::Validation("下载目录信息无效".into()))?;
    if std::fs::canonicalize(&internal.path)? != std::fs::canonicalize(base)? { return Err(AppError::Validation("下载目录归属不符".into())); }
    registry().lock().unwrap().insert(base.to_path_buf(), storage.clone()); Ok(storage)
}
pub async fn refresh(state: &AppState) -> AppResult<()> {
    #[cfg(target_os = "android")]
    { register(&state.data_directory, serde_json::from_value(crate::android_bridge::call("getDownloadStorage", serde_json::json!({})).await?)?)?; }
    #[cfg(not(target_os = "android"))]
    let _ = state;
    Ok(())
}
#[tauri::command]
pub async fn get_download_storage(state: State<'_, AppState>) -> AppResult<Storage> {
    refresh(&state).await?;
    registry().lock().unwrap().get(&state.data_directory).cloned().ok_or_else(|| AppError::Validation("下载目录选择需要在安卓应用中使用".into()))
}
#[tauri::command]
pub async fn set_download_storage(id: String, wifi_only: Option<bool>, state: State<'_, AppState>) -> AppResult<Storage> {
    let storage = serde_json::from_value(crate::android_bridge::call("setDownloadStorage", serde_json::json!({"id":id,"wifiOnly":wifi_only})).await?)?;
    register(&state.data_directory, storage)
}
#[cfg(test)]
pub(crate) fn test_select(base: &Path, selected: &Path, extra: &[PathBuf]) {
    let mut paths = vec![base.to_path_buf()]; paths.extend_from_slice(extra);
    let storage = Storage { selected:selected.to_string_lossy().into(),wifi_only:false,available:paths.iter().any(|path|path==selected),locations:paths.into_iter().map(|path| Location {
        id:if path==base {"internal".into()} else {path.to_string_lossy().into()},label:"fixture".into(),path,free_bytes:100 }).collect() };
    let mut storage=storage; if selected==base {storage.selected="internal".into();}
    register(base,storage).unwrap();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_downloads_use_selected_storage_without_moving_existing_files() {
        let base=tempfile::tempdir().unwrap(); let external=tempfile::tempdir().unwrap();
        std::fs::create_dir(base.path().join("remote-cache")).unwrap();
        std::fs::write(base.path().join("remote-cache/old.part"),b"partial").unwrap();
        test_select(base.path(),external.path(),&[external.path().into()]);
        assert_eq!(write_root(base.path()).unwrap(),external.path());
        assert_eq!(existing_root(base.path(),&["remote-cache/old.part".into()]).unwrap(),base.path());
        assert_eq!(std::fs::read(base.path().join("remote-cache/old.part")).unwrap(),b"partial");
        test_select(base.path(),base.path(),&[external.path().into()]);
        assert_eq!(roots(base.path()).len(),2);
    }
    #[test]
    fn disconnected_selected_volume_does_not_silently_redirect_new_downloads() {
        let base=tempfile::tempdir().unwrap(); let external=tempfile::tempdir().unwrap();
        test_select(base.path(),external.path(),&[]);
        assert!(write_root(base.path()).is_err()); assert_eq!(roots(base.path()),vec![base.path().to_path_buf()]);
    }
}
