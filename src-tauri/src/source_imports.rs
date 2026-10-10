//! Android directory imports outlive React routes. SQLite keeps resumable progress;
//! scans and recognition reuse the existing transactional media model.
use crate::{db::AppState, error::{AppError, AppResult}, grouping, metadata, scanner};
use chrono::Utc;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use serde_json::json;
use sqlx::SqlitePool;
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::State;

const PREFIX: &str = "android.source_import.task.";
const QUEUE_PREFIX: &str = "android.source_import.queue.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTask {
    pub id: String,
    pub source_ids: Vec<String>,
    pub stage: String,
    pub scan: bool,
    pub scan_task_id: Option<String>,
    pub current_directory: String,
    pub current_title: String,
    pub total: usize,
    pub done: usize,
    pub matched: usize,
    pub pending: usize,
    pub errors: usize,
    pub message: Option<String>,
    pub updated_at: String,
}
impl ImportTask {
    fn active(&self) -> bool { matches!(self.stage.as_str(), "queued" | "scanning" | "recognizing" | "enriching") }
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry { id: String, directory: String, title: String }
struct Running { task: Mutex<ImportTask>, cancelled: AtomicBool }
fn registry() -> &'static Mutex<HashMap<String, Arc<Running>>> {
    static TASKS: OnceLock<Mutex<HashMap<String, Arc<Running>>>> = OnceLock::new();
    TASKS.get_or_init(Default::default)
}
pub(crate) fn source_active(id: &str) -> bool {
    registry().lock().unwrap().values().any(|running| {
        let task = running.task.lock().unwrap(); task.active() && task.source_ids.iter().any(|root| root == id)
    })
}
fn snapshot(running: &Running) -> ImportTask { running.task.lock().unwrap().clone() }
async fn setting(pool: &SqlitePool, key: &str, value: String) -> AppResult<()> {
    let (_guard, mut tx) = crate::db::begin_write(pool).await?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(key).bind(value).bind(Utc::now().to_rfc3339()).execute(&mut *tx).await?;
    tx.commit().await?; Ok(())
}
async fn publish(pool: &SqlitePool, running: &Running) -> AppResult<()> {
    let task = { let mut task = running.task.lock().unwrap(); task.updated_at = Utc::now().to_rfc3339(); task.clone() };
    setting(pool, &format!("{PREFIX}{}", task.id), serde_json::to_string(&task)?).await?;
    crate::android_events::source_import(&task);
    service_update().await;
    Ok(())
}
// Native calls are serialized so one completed import cannot stop another's notification.
async fn service_update() {
    #[cfg(target_os = "android")]
    {
        static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let _guard = LOCK.lock().await;
        let active: Vec<_> = registry().lock().unwrap().values().map(|job| snapshot(job)).filter(ImportTask::active).collect();
        if let Some(task) = active.first() {
            let text = if task.stage == "scanning" { "正在扫描目录".to_string() }
                else { format!("已处理 {}/{} · 已归档 {} · 待核对 {}", task.done, task.total, task.matched, task.pending) };
            let _ = crate::android_bridge::call("updateSourceImportService", json!({"text":text})).await;
        } else { let _ = crate::android_bridge::call("stopSourceImportService", json!({})).await; }
    }
}

pub(crate) fn display_directory(path: &str) -> String {
    let path = path.replace('\\', "/");
    if let Some((_, tail)) = path.split_once("://") { tail.split_once('/').map(|(_, relative)| relative).unwrap_or("/").to_string() }
    else { path }
}
fn eligible(group: &crate::models::UnassignedMediaGroup) -> bool {
    if group.media_type != "video" || group.missing_count == group.file_count { return false; }
    // Explicit live-action/movie collections must not be sent to the anime matcher.
    let folder = group.folder_path.as_deref().unwrap_or("");
    !display_directory(folder).split('/').any(|part| matches!(part.to_ascii_lowercase().as_str(), "电影" | "电视剧" | "美剧" | "韩剧" | "movies" | "movie" | "drama" | "tv shows"))
}
async fn queue(pool: &SqlitePool, sources: &[String], selected: Option<&[String]>) -> AppResult<Vec<Entry>> {
    Ok(grouping::list_unassigned_groups(pool).await?.into_iter().filter(|group| {
        eligible(group) && group.representative.library_root_id.as_ref().is_some_and(|id| sources.contains(id))
            && selected.is_none_or(|ids| ids.contains(&group.representative.id))
    }).map(|group| Entry { id: group.representative.id, directory: display_directory(group.folder_path.as_deref().unwrap_or("/")), title: group.title }).collect())
}
async fn validate_sources(pool: &SqlitePool, ids: &[String]) -> AppResult<()> {
    if ids.is_empty() { return Err(AppError::Validation("请选择视频来源".into())); }
    for id in ids {
        let enabled: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM library_roots r LEFT JOIN remote_sources w ON w.id=r.id WHERE r.id=? AND r.enabled=1 AND r.destination='media' AND (r.path LIKE 'saf://%' OR (w.id IS NOT NULL AND w.removed_at IS NULL)))")
            .bind(id).fetch_one(pool).await?;
        if !enabled || crate::scan_tasks::source_active(id) { return Err(AppError::Validation("来源未启用或正在扫描，请稍后重试".into())); }
    } Ok(())
}
async fn launch(state: &AppState, task: ImportTask, entries: Vec<Entry>) -> AppResult<ImportTask> {
    validate_sources(&state.pool, &task.source_ids).await?;
    let running = Arc::new(Running { task: Mutex::new(task.clone()), cancelled: AtomicBool::new(false) });
    {
        let mut tasks = registry().lock().unwrap();
        if tasks.values().any(|job| { let old = job.task.lock().unwrap(); old.active() && old.source_ids.iter().any(|id| task.source_ids.contains(id)) }) {
            return Err(AppError::Validation("此来源已有后台整理任务，请查看任务进度".into()));
        }
        tasks.retain(|_, job| snapshot(job).active()); tasks.insert(task.id.clone(), running.clone());
    }
    #[cfg(target_os = "android")]
    if crate::android_bridge::call("startSourceImportService", json!({})).await.is_err() {
        { let mut task = running.task.lock().unwrap(); task.stage = "failed".into(); task.message = Some("无法启动后台整理，请回到应用前台后点击继续整理。".into()); }
        let _ = publish(&state.pool, &running).await;
        registry().lock().unwrap().remove(&task.id);
        return Err(AppError::System("无法启动后台整理，请回到应用前台后重试".into()));
    }
    if let Err(error) = publish(&state.pool, &running).await {
        registry().lock().unwrap().remove(&task.id); service_update().await; return Err(error);
    }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        static SLOTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
        let _slot = SLOTS.get_or_init(|| tokio::sync::Semaphore::new(2)).acquire().await.unwrap();
        let result = run(&state, &running, entries).await;
        {
            let mut task = running.task.lock().unwrap();
            task.stage = if running.cancelled.load(Ordering::Relaxed) { "cancelled" } else if result.is_err() { "failed" } else { "completed" }.into();
            // Never persist network addresses or credential-bearing raw errors.
            if result.is_err() && task.stage == "failed" { task.message = Some("整理中断，已有归档和索引已保留。请检查来源或网络后继续。".into()); }
        }
        let _ = publish(&state.pool, &running).await;
        if snapshot(&running).stage == "completed" {
            let _ = sqlx::query("DELETE FROM app_settings WHERE key=?")
                .bind(format!("{QUEUE_PREFIX}{}", snapshot(&running).id)).execute(&state.pool).await;
        }
        crate::android_events::recognition(vec![], vec![]);
    });
    Ok(task)
}
async fn cancelled(running: &Running) -> bool {
    #[cfg(target_os = "android")]
    if let Ok(value) = crate::android_bridge::call("sourceImportServiceState", json!({})).await {
        if value["stopped"].as_bool() == Some(true) { running.cancelled.store(true, Ordering::Relaxed); }
    }
    running.cancelled.load(Ordering::Relaxed)
}
async fn run(state: &AppState, running: &Running, mut entries: Vec<Entry>) -> AppResult<()> {
    if snapshot(running).scan {
        for id in snapshot(running).source_ids {
            if cancelled(running).await { return Ok(()); }
            let prepared = scanner::prepare_scan(&state.pool, &id, None).await?;
            let scan_id = prepared.id().to_owned();
            { let mut task = running.task.lock().unwrap(); task.stage = "scanning".into(); task.scan_task_id = Some(scan_id.clone()); }
            publish(&state.pool, running).await?;
            let scan = scanner::run_prepared(&state.pool, prepared); tokio::pin!(scan);
            loop {
                tokio::select! {
                    result = &mut scan => { result?; break; }
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {
                        if cancelled(running).await { let _ = crate::scan_tasks::cancel(&state.pool, &scan_id).await; }
                        if let Some(scan) = crate::scan_tasks::list(&state.pool).await?.into_iter().find(|scan| scan.id == scan_id) {
                            running.task.lock().unwrap().current_directory = display_directory(&scan.current_directory);
                            publish(&state.pool, running).await?;
                        }
                    }
                }
            }
            let _ = crate::android_sources::notify(&state.pool, &id).await;
        }
        if cancelled(running).await { return Ok(()); }
        entries = queue(&state.pool, &snapshot(running).source_ids, None).await?;
        setting(&state.pool, &format!("{QUEUE_PREFIX}{}", snapshot(running).id), serde_json::to_string(&entries)?).await?;
        { let mut task = running.task.lock().unwrap(); task.scan = false; task.scan_task_id = None; task.total = entries.len(); }
    }
    let enrichment_prefix = format!("android.source_import.enrich.{}.", snapshot(running).id);
    for entry in entries.into_iter().skip(snapshot(running).done) {
        if cancelled(running).await { return Ok(()); }
        { let mut task = running.task.lock().unwrap(); task.stage = "recognizing".into(); task.current_directory = entry.directory; task.current_title = entry.title; }
        publish(&state.pool, running).await?;
        let unassigned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files m JOIN library_roots r ON r.id=m.library_root_id WHERE m.id=? AND m.work_id IS NULL AND m.missing=0 AND r.enabled=1)").bind(&entry.id).fetch_one(&state.pool).await?;
        let result = if unassigned { Some(metadata::recognize_media_fast(state, &entry.id).await) } else { None };
        let mut enrichment = None;
        { let mut task = running.task.lock().unwrap();
            match result {
                Some(Ok((result, pending))) => {
                    match result.status.as_str() { "matched" => task.matched += 1, "error" => task.errors += 1, _ => task.pending += 1 }
                    enrichment = pending;
                }
                Some(Err(_)) => task.errors += 1,
                None => task.pending += 1,
            }
            task.done += 1;
        }
        if let Some(pending) = enrichment {
            setting(&state.pool, &format!("{enrichment_prefix}{}", pending.0), serde_json::to_string(&pending)?).await?;
        }
        publish(&state.pool, running).await?;
    }
    let enrichments: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM app_settings WHERE key LIKE ? ORDER BY key")
        .bind(format!("{enrichment_prefix}%")).fetch_all(&state.pool).await?;
    if !enrichments.is_empty() {
        running.task.lock().unwrap().stage = "enriching".into(); publish(&state.pool, running).await?;
        crate::android_events::recognition(vec![], vec![]);
        for (key, json) in enrichments {
            if cancelled(running).await { return Ok(()); }
            let (work, metadata): metadata::PendingEnrichment = serde_json::from_str(&json)?;
            if metadata::enrich_confirmed_work(state, &work, metadata).await.is_err() {
                running.task.lock().unwrap().message = Some("部分补充资料暂不可用，已归档作品仍可浏览；可在详情重试刷新。".into());
            }
            sqlx::query("DELETE FROM app_settings WHERE key=?").bind(key).execute(&state.pool).await?;
        }
    }
    Ok(())
}

pub(crate) async fn start(state: &AppState, source_ids: Vec<String>, selected: Option<Vec<String>>, scan: bool) -> AppResult<ImportTask> {
    let entries = if scan { vec![] } else { queue(&state.pool, &source_ids, selected.as_deref()).await? };
    let task = ImportTask { id: uuid::Uuid::new_v4().to_string(), source_ids, stage: "queued".into(), scan, scan_task_id: None, current_directory: String::new(), current_title: String::new(), total: entries.len(), done: 0, matched: 0, pending: 0, errors: 0, message: None, updated_at: Utc::now().to_rfc3339() };
    setting(&state.pool, &format!("{QUEUE_PREFIX}{}", task.id), serde_json::to_string(&entries)?).await?;
    launch(state, task, entries).await
}
#[tauri::command]
pub async fn start_source_import(source_ids: Vec<String>, media_ids: Option<Vec<String>>, scan: bool, state: State<'_, AppState>) -> AppResult<ImportTask> {
    start(&state, source_ids, media_ids, scan).await
}
#[tauri::command]
pub async fn list_source_imports(state: State<'_, AppState>) -> AppResult<Vec<ImportTask>> { list(&state.pool).await }
pub(crate) async fn list(pool: &SqlitePool) -> AppResult<Vec<ImportTask>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key LIKE 'android.source_import.task.%' ORDER BY updated_at DESC LIMIT 30").fetch_all(pool).await?;
    let mut tasks = Vec::new();
    for row in rows {
        let mut task: ImportTask = serde_json::from_str(&row)?;
        if let Some(live) = registry().lock().unwrap().get(&task.id) { task = snapshot(live); }
        else if task.active() { task.stage = "interrupted".into(); task.message = Some("应用运行已中断，点击继续整理；已完成的归档会保留。".into()); }
        tasks.push(task);
    } Ok(tasks)
}
#[tauri::command]
pub async fn cancel_source_import(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let running = registry().lock().unwrap().get(&id).cloned().ok_or_else(|| AppError::NotFound("任务已结束".into()))?;
    running.cancelled.store(true, Ordering::Relaxed);
    let scan = snapshot(&running).scan_task_id;
    if let Some(scan) = scan { let _ = crate::scan_tasks::cancel(&state.pool, &scan).await; }
    Ok(())
}
#[tauri::command]
pub async fn resume_source_import(id: String, state: State<'_, AppState>) -> AppResult<ImportTask> {
    let mut task = list(&state.pool).await?.into_iter().find(|task| task.id == id)
        .filter(|task| matches!(task.stage.as_str(), "interrupted" | "failed" | "cancelled"))
        .ok_or_else(|| AppError::Validation("此任务无需继续".into()))?;
    let json: String = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(format!("{QUEUE_PREFIX}{id}")).fetch_one(&state.pool).await?;
    let entries: Vec<Entry> = serde_json::from_str(&json)?;
    task.stage = "queued".into(); task.message = None;
    launch(&state, task, entries).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(root: &str) -> ImportTask {
        ImportTask { id: uuid::Uuid::new_v4().to_string(), source_ids: vec![root.into()], stage: "recognizing".into(), scan: false, scan_task_id: None,
            current_directory: "动漫/作品/第一季".into(), current_title: "作品".into(), total: 2, done: 1, matched: 1, pending: 0, errors: 0, message: None, updated_at: "now".into() }
    }
    #[tokio::test]
    async fn interrupted_progress_is_recoverable_and_queue_remains_private() {
        let pool = crate::db::test_pool().await.unwrap();
        let job = task("root");
        let entries = vec![Entry { id: "first".into(), directory: "动漫/作品".into(), title: "作品".into() }];
        setting(&pool, &format!("{PREFIX}{}", job.id), serde_json::to_string(&job).unwrap()).await.unwrap();
        setting(&pool, &format!("{QUEUE_PREFIX}{}", job.id), serde_json::to_string(&entries).unwrap()).await.unwrap();
        let jobs = list(&pool).await.unwrap();
        assert_eq!(jobs[0].stage, "interrupted"); assert_eq!(jobs[0].done, 1); assert_eq!(jobs[0].matched, 1);
        assert!(!serde_json::to_string(&jobs).unwrap().contains("first"));
        assert_eq!(jobs[0].current_directory, "动漫/作品/第一季");
    }
    #[tokio::test]
    async fn resume_skips_finished_cursor_and_pre_cancel_preserves_index() {
        let pool = crate::db::test_pool().await.unwrap(); let dir = tempfile::tempdir().unwrap();
        let state = AppState { pool: pool.clone(), database_path: dir.path().join("test.db"), data_directory: dir.path().into(), cover_cache_path: dir.path().into(), thumbnail_cache_path: dir.path().into() };
        let running = Running { task: Mutex::new(task("root")), cancelled: AtomicBool::new(false) };
        let entries = vec![Entry { id: "finished-never-search".into(), directory: "done".into(), title: "done".into() }, Entry { id: "manually-attached-or-removed".into(), directory: "next".into(), title: "next".into() }];
        run(&state, &running, entries.clone()).await.unwrap();
        assert_eq!(snapshot(&running).done, 2); assert_eq!(snapshot(&running).matched, 1);
        assert_eq!(snapshot(&running).current_directory, "next");
        running.cancelled.store(true, Ordering::Relaxed); running.task.lock().unwrap().done = 1;
        run(&state, &running, entries).await.unwrap(); assert_eq!(snapshot(&running).done, 1);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM media_files").fetch_one(&pool).await.unwrap(); assert_eq!(count, 0);
    }
    #[tokio::test]
    async fn queue_uses_real_directories_and_respects_selection_and_source() {
        let pool = crate::db::test_pool().await.unwrap();
        for root in ["one", "two"] {
            sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at) VALUES(?,?,'video',1,'now','now')").bind(root).bind(format!("webdav://{root}")).execute(&pool).await.unwrap();
            for (id, folder) in [("anime", "动漫/葬送的芙莉莲/第一季"), ("movie", "电影/作品甲")] {
                sqlx::query("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,created_at,updated_at) VALUES(?,?,?,'01.mkv','mkv','video','now','now')")
                    .bind(format!("{root}-{id}")).bind(root).bind(format!("webdav://{root}/{folder}/01.mkv")).execute(&pool).await.unwrap();
            }
        }
        let queued = queue(&pool, &["one".into()], None).await.unwrap();
        assert_eq!(queued.len(), 1); assert_eq!(queued[0].id, "one-anime"); assert_eq!(queued[0].directory, "动漫/葬送的芙莉莲");
        assert!(queue(&pool, &["one".into()], Some(&["two-anime".into()])).await.unwrap().is_empty());
    }
}
