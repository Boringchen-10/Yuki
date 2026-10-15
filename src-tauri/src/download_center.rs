use crate::{book_content::{self, CacheControl, CacheProgress}, db::{self, AppState}, error::{AppError, AppResult}, remote_transfer};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, State};
use tokio::sync::watch;

#[derive(Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub item_title: String,
    pub state: String,
    pub bytes_downloaded: i64,
    pub total_bytes: Option<i64>,
    pub completed_units: i64,
    pub total_units: Option<i64>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub path_word: Option<String>,
    #[sqlx(rename = "group_id")]
    pub group: Option<String>,
    pub entry_id: Option<String>,
    pub media_file_id: Option<String>,
    pub work_id: Option<String>,
    #[serde(skip)]
    generation: i64,
}

#[derive(Deserialize)]
pub struct BookDownloadEntry { id: String, title: String }
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadAction { Pause, Resume, Retry, Remove }

#[derive(Clone)]
struct Active { id: String, generation: i64, cancel: watch::Sender<bool>, done: watch::Receiver<bool> }
#[derive(Default)]
struct Runtime {
    controls: tokio::sync::Mutex<()>,
    active: Mutex<Option<Active>>,
    worker: AtomicBool,
    imported: AtomicBool,
    importing: tokio::sync::Mutex<()>,
}
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn runtime(state: &AppState) -> Arc<Runtime> {
    static RUNTIMES: OnceLock<Mutex<HashMap<PathBuf, Arc<Runtime>>>> = OnceLock::new();
    RUNTIMES.get_or_init(Default::default).lock().unwrap().entry(state.database_path.clone()).or_default().clone()
}
fn invalid(message: &str) -> AppError { AppError::Validation(message.into()) }
fn identity(kind: &str, book: &str, group: &str, entry: &str) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(&(kind, book, group, entry)).unwrap()))
}
fn text_valid(value: &str) -> bool { !value.trim().is_empty() && value.chars().count() <= 500 && !value.contains('\0') }
fn safe_error(error: &AppError) -> String {
    match error {
        AppError::DatabaseBusy => "数据库繁忙，请稍后重试。",
        AppError::Io(_) => "无法写入本机缓存，请检查可用空间后重试。",
        AppError::NotFound(_) => "下载来源或文件已不可用，请检查来源后重试。",
        AppError::Network(_) => "连接或传输失败，请检查网络与来源后重试；已完成的下载保留。",
        _ => "下载未完成，请检查来源、可用空间或访问权限后重试。",
    }.into()
}
async fn rows(pool: &SqlitePool) -> AppResult<Vec<DownloadJob>> {
    Ok(sqlx::query_as("SELECT * FROM download_jobs ORDER BY created_at DESC,id").fetch_all(pool).await?)
}
async fn row(pool: &SqlitePool, id: &str) -> AppResult<DownloadJob> {
    sqlx::query_as("SELECT * FROM download_jobs WHERE id=?").bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("下载任务不存在".into()))
}
async fn emit(pool: &SqlitePool) {
    if let Some(app) = APP.get() { if let Ok(jobs) = rows(pool).await { let _ = app.emit("download-jobs-updated", jobs); } }
}
async fn service(pool: &SqlitePool) -> AppResult<()> {
    #[cfg(target_os = "android")]
    {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM download_jobs WHERE state IN ('queued','downloading')").fetch_one(pool).await?;
        crate::android_bridge::call("setBookDownloadActivity", serde_json::json!({"running":count > 0,"count":count})).await?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = pool;
    Ok(())
}
async fn service_stopped() -> AppResult<bool> {
    #[cfg(target_os = "android")]
    { return Ok(crate::android_bridge::call("bookDownloadActivityState", serde_json::json!({})).await?["stopped"].as_bool().unwrap_or(false)); }
    #[cfg(not(target_os = "android"))]
    Ok(false)
}

pub(crate) async fn initialize(state: &AppState, app: &tauri::AppHandle) -> AppResult<()> {
    let _ = APP.set(app.clone());
    interrupt(&state.pool).await
}
async fn interrupt(pool: &SqlitePool) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    sqlx::query("UPDATE download_jobs SET state='interrupted',generation=generation+1,bytes_downloaded=CASE WHEN kind='file' THEN bytes_downloaded ELSE 0 END,completed_units=0,error='下载已中断，点击继续后重新连接来源。',updated_at=? WHERE state IN ('queued','downloading')")
        .bind(Utc::now().to_rfc3339()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

async fn enqueue_books(pool: &SqlitePool, kind: &str, book: &str, group: &str, title: &str, entries: &[BookDownloadEntry]) -> AppResult<Vec<DownloadJob>> {
    if !matches!(kind, "comic" | "novel") || !crate::comic_explore::valid_id(book)
        || (!group.is_empty() && !crate::comic_explore::valid_id(group)) || (kind == "novel" && !group.is_empty())
        || !text_valid(title) || entries.is_empty() || entries.len() > 500 { return Err(invalid("下载选择无效，请选择 1–500 个章节或卷册")); }
    let mut selected = HashSet::new();
    if entries.iter().any(|entry| !crate::comic_explore::valid_id(&entry.id) || !text_valid(&entry.title) || !selected.insert(&entry.id)) {
        return Err(invalid("章节标识或名称无效，或包含重复章节"));
    }
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let work: Option<String> = sqlx::query_scalar("SELECT w.id FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE w.type=? AND e.provider=? AND e.external_id=?")
        .bind(kind).bind(if kind == "comic" { "copymanga" } else { "copynovel" }).bind(book).fetch_optional(&mut *tx).await?;
    let mut jobs = vec![];
    let now = Utc::now().to_rfc3339();
    for entry in entries {
        let key = identity(kind, book, group, &entry.id);
        sqlx::query("INSERT INTO download_jobs(id,identity,kind,title,item_title,state,created_at,updated_at,path_word,group_id,entry_id,work_id) VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?) ON CONFLICT(identity) DO NOTHING")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&key).bind(kind).bind(title).bind(&entry.title).bind(&now).bind(&now).bind(book).bind(group).bind(&entry.id).bind(&work).execute(&mut *tx).await?;
        jobs.push(sqlx::query_as("SELECT * FROM download_jobs WHERE identity=?").bind(key).fetch_one(&mut *tx).await?);
    }
    tx.commit().await?;
    Ok(jobs)
}

async fn enqueue_file(pool: &SqlitePool, id: &str) -> AppResult<DownloadJob> {
    uuid::Uuid::parse_str(id).map_err(|_| invalid("文件标识无效"))?;
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let source: Option<(String, String, Option<String>, i64)> = sqlx::query_as("SELECT COALESCE(w.title,m.file_name),m.file_name,m.work_id,m.size FROM media_files m JOIN remote_files r ON r.media_file_id=m.id JOIN remote_sources s ON s.id=r.source_id JOIN library_roots l ON l.id=s.id LEFT JOIN works w ON w.id=m.work_id WHERE m.id=? AND m.missing=0 AND l.enabled=1 AND s.removed_at IS NULL")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (title, name, work, size) = source.ok_or_else(|| invalid("远程文件或来源当前不可用"))?;
    let now = Utc::now().to_rfc3339();
    let key = identity("file", "", "", id);
    sqlx::query("INSERT INTO download_jobs(id,identity,kind,title,item_title,state,total_bytes,total_units,created_at,updated_at,media_file_id,work_id) VALUES(?,?,'file',?,?,'queued',?,1,?,?,?,?) ON CONFLICT(identity) DO NOTHING")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&key).bind(title).bind(name).bind((size > 0).then_some(size)).bind(&now).bind(&now).bind(id).bind(work).execute(&mut *tx).await?;
    let job = sqlx::query_as("SELECT * FROM download_jobs WHERE identity=?").bind(key).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(job)
}
async fn requeue_missing(state: &AppState, jobs: &mut [DownloadJob]) -> AppResult<()> {
    for job in jobs {
        if job.state != "completed" { continue; }
        let exists = if job.kind == "file" {
            remote_transfer::cached_path(state, job.media_file_id.as_deref().ok_or_else(|| invalid("任务文件标识缺失"))?).await?.is_some()
        } else {
            let root = state.data_directory.clone(); let kind = job.kind.clone();
            let book = job.path_word.clone().ok_or_else(|| invalid("任务作品标识缺失"))?;
            let entry = job.entry_id.clone().ok_or_else(|| invalid("任务章节标识缺失"))?;
            tokio::task::spawn_blocking(move || book_content::reader_archive(&root, &kind, &book, &entry)).await
                .map_err(|_| invalid("无法检查下载缓存"))??.is_some()
        };
        if exists { continue; }
        let (_guard, mut tx) = db::begin_write(&state.pool).await?;
        sqlx::query("UPDATE download_jobs SET state='queued',generation=generation+1,bytes_downloaded=0,total_bytes=NULL,completed_units=0,total_units=NULL,error=NULL,updated_at=? WHERE id=? AND generation=? AND state='completed'")
            .bind(Utc::now().to_rfc3339()).bind(&job.id).bind(job.generation).execute(&mut *tx).await?;
        *job = sqlx::query_as("SELECT * FROM download_jobs WHERE id=?").bind(&job.id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn enqueue_book_downloads(kind: String, path_word: String, group: String, title: String, entries: Vec<BookDownloadEntry>, state: State<'_, AppState>) -> AppResult<Vec<DownloadJob>> {
    let runtime = runtime(&state); let _control = runtime.controls.lock().await;
    let mut jobs = enqueue_books(&state.pool, &kind, &path_word, &group, &title, &entries).await?;
    requeue_missing(&state, &mut jobs).await?;
    start_worker(state.inner().clone(), runtime.clone());
    emit(&state.pool).await;
    Ok(jobs)
}
#[tauri::command]
pub async fn enqueue_file_download(media_file_id: String, state: State<'_, AppState>) -> AppResult<DownloadJob> {
    let runtime = runtime(&state); let _control = runtime.controls.lock().await;
    let mut job = enqueue_file(&state.pool, &media_file_id).await?;
    requeue_missing(&state, std::slice::from_mut(&mut job)).await?;
    start_worker(state.inner().clone(), runtime.clone());
    emit(&state.pool).await;
    Ok(job)
}

fn start_worker(state: AppState, runtime: Arc<Runtime>) {
    if runtime.worker.swap(true, Ordering::AcqRel) { return; }
    tauri::async_runtime::spawn(async move {
        loop {
            let claimed = {
                let _control = runtime.controls.lock().await;
                claim(&state.pool).await
            };
            let job = match claimed {
                Ok(Some(job)) => job,
                Ok(None) => {
                    let _control = runtime.controls.lock().await;
                    // An enqueue can arrive between the empty query and this lock.
                    if let Ok(Some(_)) = sqlx::query_scalar::<_, String>("SELECT id FROM download_jobs WHERE state='queued' LIMIT 1").fetch_optional(&state.pool).await { continue; }
                    runtime.worker.store(false, Ordering::Release);
                    let _ = service(&state.pool).await;
                    break;
                }
                Err(_) => {
                    runtime.worker.store(false, Ordering::Release);
                    let _ = interrupt(&state.pool).await;
                    emit(&state.pool).await;
                    let _ = service(&state.pool).await;
                    break;
                }
            };
            let (cancel, _) = watch::channel(false);
            let (done, finished) = watch::channel(false);
            {
                let _control = runtime.controls.lock().await;
                // A pause/remove can win immediately after the database claim.
                if !row(&state.pool, &job.id).await.is_ok_and(|value| value.state == "downloading" && value.generation == job.generation) { continue; }
                *runtime.active.lock().unwrap() = Some(Active { id: job.id.clone(), generation: job.generation, cancel: cancel.clone(), done: finished });
            }
            emit(&state.pool).await;
            let result = match service(&state.pool).await { Ok(()) => perform(&state, &job, cancel).await, Err(error) => Err(error) };
            done.send_replace(true);
            let _control = runtime.controls.lock().await;
            let _ = finish(&state.pool, &job, result).await;
            { let mut active = runtime.active.lock().unwrap(); if active.as_ref().is_some_and(|value| value.id == job.id && value.generation == job.generation) { active.take(); } }
            emit(&state.pool).await;
            let _ = service(&state.pool).await;
        }
    });
}

async fn claim(pool: &SqlitePool) -> AppResult<Option<DownloadJob>> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let selected: Option<DownloadJob> = sqlx::query_as("SELECT * FROM download_jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1").fetch_optional(&mut *tx).await?;
    let Some(mut job) = selected else { return Ok(None) };
    job.state = "downloading".into(); job.error = None; job.updated_at = Utc::now().to_rfc3339();
    if job.kind != "file" { job.bytes_downloaded = 0; job.completed_units = 0; job.total_units = None; job.total_bytes = None; }
    sqlx::query("UPDATE download_jobs SET state='downloading',error=NULL,bytes_downloaded=?,total_bytes=?,completed_units=?,total_units=?,updated_at=? WHERE id=? AND generation=?")
        .bind(job.bytes_downloaded).bind(job.total_bytes).bind(job.completed_units).bind(job.total_units).bind(&job.updated_at).bind(&job.id).bind(job.generation).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(job))
}

struct Completed { bytes: i64, units: Option<i64> }
async fn perform(state: &AppState, job: &DownloadJob, cancel: watch::Sender<bool>) -> AppResult<Completed> {
    let mut ticks = tokio::time::interval(Duration::from_millis(500));
    if job.kind == "file" {
        let id = job.media_file_id.as_deref().ok_or_else(|| invalid("任务文件标识缺失"))?;
        let enabled: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM remote_files r JOIN media_files m ON m.id=r.media_file_id JOIN library_roots l ON l.id=r.source_id JOIN remote_sources s ON s.id=r.source_id WHERE m.id=? AND m.missing=0 AND l.enabled=1 AND s.removed_at IS NULL)")
            .bind(id).fetch_one(&state.pool).await?;
        if !enabled { return Err(AppError::NotFound("下载来源或文件已不可用".into())); }
        let download = remote_transfer::download_controlled(state, id, true, cancel.subscribe());
        tokio::pin!(download);
        let mut previous = job.bytes_downloaded;
        loop {
            tokio::select! {
                result = &mut download => return Ok(Completed { bytes: tokio::fs::metadata(result?).await?.len() as i64, units: Some(1) }),
                _ = ticks.tick() => {
                    let cancelling = *cancel.borrow();
                    if !cancelling && service_stopped().await.unwrap_or(true) { interrupt(&state.pool).await?; cancel.send_replace(true); }
                    let size: Option<i64> = sqlx::query_scalar("SELECT size FROM remote_cache WHERE media_file_id=?").bind(id).fetch_optional(&state.pool).await?;
                    if let Some(size) = size { if size != previous { persist_progress(&state.pool, job, size, job.total_bytes, 0, Some(1)).await?; previous = size; } }
                }
            }
        }
    }
    let (progress, current) = watch::channel(CacheProgress::default());
    let download = book_content::cache_content(state, &job.kind, job.path_word.as_deref().ok_or_else(|| invalid("任务作品标识缺失"))?,
        job.entry_id.as_deref().ok_or_else(|| invalid("任务章节标识缺失"))?, job.group.as_deref().unwrap_or(""), false, Some(CacheControl { cancel: cancel.subscribe(), progress }));
    tokio::pin!(download);
    let mut previous = (0, 0, None);
    loop {
        tokio::select! {
            result = &mut download => return Ok(Completed { bytes: result?.bytes as i64, units: current.borrow().total_units.map(|value| value as i64) }),
            _ = ticks.tick() => {
                let cancelling = *cancel.borrow();
                if !cancelling && service_stopped().await.unwrap_or(true) { interrupt(&state.pool).await?; cancel.send_replace(true); }
                let value = current.borrow().clone();
                let snapshot = (value.bytes_downloaded, value.completed_units, value.total_units);
                if snapshot != previous { persist_progress(&state.pool, job, value.bytes_downloaded as i64, None, value.completed_units as i64, value.total_units.map(|value| value as i64)).await?; previous = snapshot; }
            }
        }
    }
}
async fn persist_progress(pool: &SqlitePool, job: &DownloadJob, bytes: i64, total_bytes: Option<i64>, units: i64, total_units: Option<i64>) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    sqlx::query("UPDATE download_jobs SET bytes_downloaded=?,total_bytes=?,completed_units=?,total_units=?,updated_at=? WHERE id=? AND generation=? AND state='downloading'")
        .bind(bytes).bind(total_bytes).bind(units).bind(total_units).bind(Utc::now().to_rfc3339()).bind(&job.id).bind(job.generation).execute(&mut *tx).await?;
    tx.commit().await?;
    emit(pool).await;
    Ok(())
}
async fn finish(pool: &SqlitePool, job: &DownloadJob, result: AppResult<Completed>) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    match result {
        Ok(result) => {
            sqlx::query("UPDATE download_jobs SET state='completed',bytes_downloaded=?,total_bytes=?,completed_units=COALESCE(?,0),total_units=?,error=NULL,updated_at=? WHERE id=? AND generation=? AND state='downloading'")
                .bind(result.bytes).bind(result.bytes).bind(result.units).bind(result.units).bind(Utc::now().to_rfc3339()).bind(&job.id).bind(job.generation).execute(&mut *tx).await?;
        }
        Err(error) => {
            sqlx::query("UPDATE download_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND generation=? AND state='downloading'")
                .bind(safe_error(&error)).bind(Utc::now().to_rfc3339()).bind(&job.id).bind(job.generation).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

async fn wait_stopped(mut done: watch::Receiver<bool>) {
    while !*done.borrow_and_update() { if done.changed().await.is_err() { break; } }
}
async fn control(state: &AppState, id: &str, action: DownloadAction) -> AppResult<()> {
    uuid::Uuid::parse_str(id).map_err(|_| invalid("任务标识无效"))?;
    let runtime = runtime(state); let _control = runtime.controls.lock().await;
    let job = row(&state.pool, id).await?;
    match action {
        DownloadAction::Pause | DownloadAction::Remove => {
            if matches!(action, DownloadAction::Pause) && !matches!(job.state.as_str(), "queued" | "downloading") { return Ok(()); }
            let (_guard, mut tx) = db::begin_write(&state.pool).await?;
            sqlx::query("UPDATE download_jobs SET state=CASE WHEN state='completed' THEN state ELSE 'paused' END,generation=generation+1,updated_at=? WHERE id=?")
                .bind(Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await?;
            tx.commit().await?; drop(_guard);
            let active = runtime.active.lock().unwrap().as_ref().filter(|active| active.id == id).cloned();
            if let Some(active) = active { active.cancel.send_replace(true); wait_stopped(active.done).await; }
            if job.kind != "file" && job.state != "completed" {
                let (_guard, mut tx) = db::begin_write(&state.pool).await?;
                sqlx::query("UPDATE download_jobs SET bytes_downloaded=0,completed_units=0 WHERE id=?").bind(id).execute(&mut *tx).await?;
                tx.commit().await?;
            }
            if matches!(action, DownloadAction::Remove) {
                let removed = if job.kind == "file" { remote_transfer::remove_download(state, job.media_file_id.as_deref().ok_or_else(|| invalid("任务文件标识缺失"))?).await }
                    else { book_content::clear_content(state, &job.kind, job.path_word.as_deref().ok_or_else(|| invalid("任务作品标识缺失"))?, job.entry_id.as_deref().ok_or_else(|| invalid("任务章节标识缺失"))?).await };
                if let Err(error) = removed {
                    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
                    sqlx::query("UPDATE download_jobs SET error=? WHERE id=?").bind(safe_error(&error)).bind(id).execute(&mut *tx).await?; tx.commit().await?;
                    emit(&state.pool).await;
                    return Err(invalid("缓存暂时无法清理，请关闭使用它的播放器或阅读器后重试"));
                }
                let (_guard, mut tx) = db::begin_write(&state.pool).await?;
                sqlx::query("DELETE FROM download_jobs WHERE id=?").bind(id).execute(&mut *tx).await?;
                tx.commit().await?;
            }
        }
        DownloadAction::Resume | DownloadAction::Retry => {
            if matches!(job.state.as_str(), "queued" | "downloading") { return Ok(()); }
            if job.state == "completed" {
                let mut completed = job.clone();
                requeue_missing(state, std::slice::from_mut(&mut completed)).await?;
                if completed.state == "completed" { return Ok(()); }
            }
            let (_guard, mut tx) = db::begin_write(&state.pool).await?;
            sqlx::query("UPDATE download_jobs SET state='queued',generation=generation+1,error=NULL,updated_at=? WHERE id=?")
                .bind(Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await?;
            tx.commit().await?;
            start_worker(state.clone(), runtime.clone());
        }
    }
    emit(&state.pool).await;
    let _ = service(&state.pool).await;
    Ok(())
}
#[tauri::command]
pub async fn control_download_job(id: String, action: DownloadAction, state: State<'_, AppState>) -> AppResult<()> { control(&state, &id, action).await }

async fn import_existing(state: &AppState) -> AppResult<()> {
    let runtime = runtime(state);
    if runtime.imported.load(Ordering::Acquire) { return Ok(()); }
    let _import = runtime.importing.lock().await;
    if runtime.imported.load(Ordering::Acquire) { return Ok(()); }
    let root = state.data_directory.clone();
    let books = tokio::task::spawn_blocking(move || book_content::cached_downloads(&root)).await.map_err(|_| invalid("无法读取已有下载"))??;
    for book in books {
        let provider = if book.kind == "comic" { "copymanga" } else { "copynovel" };
        let work: Option<(String, String)> = sqlx::query_as("SELECT w.id,w.title FROM works w JOIN work_external_ids e ON e.work_id=w.id WHERE w.type=? AND e.provider=? AND e.external_id=?")
            .bind(&book.kind).bind(provider).bind(&book.book_id).fetch_optional(&state.pool).await?;
        let group: Option<String> = sqlx::query_scalar("SELECT group_id FROM android_reading_progress WHERE kind=? AND book_id=? AND entry_id=? ORDER BY updated_at DESC LIMIT 1")
            .bind(&book.kind).bind(&book.book_id).bind(&book.content.entry_id).fetch_optional(&state.pool).await?;
        let group = group.unwrap_or_else(|| if book.kind == "comic" { "default" } else { "" }.into());
        let (_guard, mut tx) = db::begin_write(&state.pool).await?;
        sqlx::query("INSERT INTO download_jobs(id,identity,kind,title,item_title,state,bytes_downloaded,total_bytes,completed_units,total_units,created_at,updated_at,path_word,group_id,entry_id,work_id) VALUES(?,?,?,?,?,'completed',?,?,0,NULL,?,?,?,?,?,?) ON CONFLICT(identity) DO NOTHING")
            .bind(uuid::Uuid::new_v4().to_string()).bind(identity(&book.kind, &book.book_id, &group, &book.content.entry_id)).bind(&book.kind)
            .bind(work.as_ref().map(|(_, title)| title.as_str()).unwrap_or(&book.book_id)).bind(&book.content.title).bind(book.content.bytes as i64).bind(book.content.bytes as i64)
            .bind(&book.content.cached_at).bind(&book.content.cached_at).bind(&book.book_id).bind(group).bind(&book.content.entry_id).bind(work.as_ref().map(|(id, _)| id)).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    let cached: Vec<(String, String, String, Option<String>, i64, bool, String, i64)> = sqlx::query_as("SELECT c.media_file_id,COALESCE(w.title,m.file_name),m.file_name,m.work_id,c.size,c.completed,c.accessed_at,m.size FROM remote_cache c JOIN media_files m ON m.id=c.media_file_id LEFT JOIN works w ON w.id=m.work_id")
        .fetch_all(&state.pool).await?;
    for (id, title, name, work, size, completed, time, total) in cached {
        let valid = completed && remote_transfer::cached_path(state, &id).await?.is_some();
        let (_guard, mut tx) = db::begin_write(&state.pool).await?;
        sqlx::query("INSERT INTO download_jobs(id,identity,kind,title,item_title,state,bytes_downloaded,total_bytes,completed_units,total_units,created_at,updated_at,media_file_id,work_id) VALUES(?,?,'file',?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(identity) DO NOTHING")
            .bind(uuid::Uuid::new_v4().to_string()).bind(identity("file", "", "", &id)).bind(title).bind(name).bind(if valid { "completed" } else { "interrupted" }).bind(size)
            .bind((total > 0).then_some(total)).bind(if valid { 1i64 } else { 0i64 }).bind(&time).bind(&time).bind(id).bind(work).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    runtime.imported.store(true, Ordering::Release);
    Ok(())
}
#[tauri::command]
pub async fn list_download_jobs(state: State<'_, AppState>) -> AppResult<Vec<DownloadJob>> {
    import_existing(&state).await?;
    rows(&state.pool).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    async fn state() -> (tempfile::TempDir, AppState) {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState { pool: crate::db::test_pool().await.unwrap(), database_path: directory.path().join("test.db"),
            data_directory: directory.path().into(), cover_cache_path: directory.path().join("covers"), thumbnail_cache_path: directory.path().join("thumbnails") };
        (directory, state)
    }
    fn entry(id: &str) -> BookDownloadEntry { BookDownloadEntry { id: id.into(), title: format!("章节 {id}") } }
    fn cache_book(state: &AppState, book: &str, entry: &str) -> PathBuf {
        let hash = format!("{:x}", Sha256::digest(format!("comic\n{book}\n{entry}")));
        let directory = state.data_directory.join("reading-cache/v1").join(hash).join("complete-test");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("chapter.cbz"), b"generated fixture").unwrap();
        let manifest = serde_json::json!({"version":1,"kind":"comic","bookId":book,"entryId":entry,"title":"已下载章节","openFile":"chapter.cbz",
            "files":[{"name":"chapter.cbz","sha256":format!("{:x}",Sha256::digest(b"generated fixture")),"bytes":17}],"cachedAt":"2026-10-14T08:00:00Z"});
        fs::write(directory.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        directory.parent().unwrap().into()
    }
    async fn seed_remote(state: &AppState, id: &str) -> PathBuf {
        sqlx::raw_sql("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES('remote','webdav://remote','video',1,'old','old','webdav'); INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES('remote','fixture','http://127.0.0.1:1/','','unused-fixture');")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES(?,?,'video.mp4','mp4','video',17,'old','old')")
            .bind(id).bind(format!("webdav://remote/{id}")).execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO remote_files(media_file_id,source_id,href,etag) VALUES(?,'remote','/video.mp4','\"v1\"')").bind(id).execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO remote_cache(media_file_id,revision,size,completed,pinned,accessed_at) VALUES(?,'\"v1\"|17|',17,1,1,'old')")
            .bind(id).execute(&state.pool).await.unwrap();
        let directory = state.data_directory.join("remote-cache"); fs::create_dir_all(&directory).unwrap();
        let path = directory.join(format!("{id}.mp4")); fs::write(&path, b"generated fixture").unwrap(); path
    }
    async fn wait_idle(state: &AppState) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while runtime(state).worker.load(Ordering::Acquire) { tokio::time::sleep(Duration::from_millis(10)).await; }
        }).await.unwrap();
    }

    #[tokio::test]
    async fn upgrade_preserves_existing_library_resume_and_migration_checksums_and_startup_does_not_download() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = std::borrow::Cow::Owned(old.migrations.into_owned().into_iter().filter(|migration| migration.version <= 32).collect());
        old.run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('book','原作品','comic','原笔记','old','old'); INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":7}','old'); INSERT INTO android_reading_bookmarks VALUES('mark','comic','book','default','one','{\"pageIndex\":7}','原书签','old');")
            .execute(&pool).await.unwrap();
        let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let jobs = enqueue_books(&pool,"comic","book","default","原作品", &[entry("one"),entry("two")]).await.unwrap();
        let claimed = claim(&pool).await.unwrap().unwrap();
        interrupt(&pool).await.unwrap();
        finish(&pool,&claimed,Ok(Completed { bytes:99,units:Some(1) })).await.unwrap();
        assert!(rows(&pool).await.unwrap().iter().all(|job| job.state == "interrupted" && job.generation == 1));
        assert_eq!(jobs.len(),2);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT location_json FROM android_reading_progress").fetch_one(&pool).await.unwrap(),"{\"pageIndex\":7}");
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT label FROM android_reading_bookmarks").fetch_one(&pool).await.unwrap(),"原书签");
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT notes FROM works").fetch_one(&pool).await.unwrap(),"原笔记");
        assert_eq!(sqlx::query_as::<_,(i64,Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=32 ORDER BY version").fetch_all(&pool).await.unwrap(),checksums);
        crate::migration_compat::run(&pool).await.unwrap();
    }

    #[tokio::test]
    async fn enqueue_deduplicates_validates_whole_batch_and_never_stores_content_urls_or_credentials() {
        let (_directory,state) = state().await;
        let first = enqueue_books(&state.pool,"comic","book","default","作品", &[entry("one"),entry("two")]).await.unwrap();
        let second = enqueue_books(&state.pool,"comic","book","default","作品", &[entry("one")]).await.unwrap();
        assert_eq!(first[0].id,second[0].id);
        for (kind,book,group,entries) in [("video","book","default",vec![entry("one")]),("comic","../book","default",vec![entry("one")]),
            ("novel","book","default",vec![entry("one")]),("comic","book","default",vec![entry("three"),entry("three")]),
            ("comic","book","default",vec![entry("three"),entry("https://signed.invalid/?token=private")])] {
            assert!(enqueue_books(&state.pool,kind,book,group,"作品",&entries).await.is_err());
        }
        assert_eq!(rows(&state.pool).await.unwrap().len(),2);
        let dto = serde_json::to_string(&first).unwrap();
        assert!(!dto.contains("identity")); assert!(!dto.contains("generation")); assert!(!dto.contains("https://"));
        assert!(!dto.contains("cookie")); assert!(!dto.contains("authorization"));
    }

    #[tokio::test]
    async fn pause_waits_for_active_writer_and_late_progress_or_completion_cannot_rewrite_it() {
        let (_directory,state) = state().await;
        let job = enqueue_books(&state.pool,"comic","book","default","作品", &[entry("one")]).await.unwrap().remove(0);
        let old = claim(&state.pool).await.unwrap().unwrap();
        persist_progress(&state.pool,&old,7,Some(17),1,Some(2)).await.unwrap();
        let runtime = runtime(&state);
        let (cancel,mut signal) = watch::channel(false); let (done,finished) = watch::channel(false);
        *runtime.active.lock().unwrap() = Some(Active {id:old.id.clone(),generation:old.generation,cancel,done:finished});
        let pool = state.pool.clone();
        let writer = tokio::spawn(async move {
            signal.changed().await.unwrap(); assert!(*signal.borrow());
            persist_progress(&pool,&old,999,Some(999),9,Some(9)).await.unwrap();
            finish(&pool,&old,Ok(Completed {bytes:999,units:Some(9)})).await.unwrap();
            done.send_replace(true);
        });
        control(&state,&job.id,DownloadAction::Pause).await.unwrap(); writer.await.unwrap();
        let paused = row(&state.pool,&job.id).await.unwrap();
        assert_eq!(paused.state,"paused"); assert_eq!(paused.bytes_downloaded,0); assert_eq!(paused.generation,1);
        runtime.active.lock().unwrap().take();
        cache_book(&state,"book","one");
        control(&state,&job.id,DownloadAction::Resume).await.unwrap(); wait_idle(&state).await;
        let completed = row(&state.pool,&job.id).await.unwrap();
        assert_eq!(completed.state,"completed"); assert_eq!(completed.total_units,None);
        assert!(state.data_directory.join("remote-cache").read_dir().is_err());
    }

    #[tokio::test]
    async fn import_only_verified_generated_caches_and_remove_preserves_original_media_resume_and_bookmarks() {
        let (_directory,state) = state().await;
        let generated = cache_book(&state,"book","one");
        cache_book(&state,"broken","one");
        let corrupt = book_content::cached_downloads(&state.data_directory).unwrap().into_iter().find(|book| book.book_id == "broken").unwrap();
        let corrupt_hash = format!("{:x}", Sha256::digest(format!("comic\n{}\none",corrupt.book_id)));
        fs::write(state.data_directory.join("reading-cache/v1").join(corrupt_hash).join("complete-test/chapter.cbz"),b"corrupt").unwrap();
        let original = state.data_directory.join("user-original.cbz"); fs::write(&original,b"original media").unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('work','作品','comic','原笔记','old','old'); INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('work','copymanga','book','old','old'); INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":3}','old'); INSERT INTO android_reading_bookmarks VALUES('mark','comic','book','default','one','{\"pageIndex\":3}','书签','old');")
            .execute(&state.pool).await.unwrap();
        import_existing(&state).await.unwrap(); import_existing(&state).await.unwrap();
        let jobs = rows(&state.pool).await.unwrap(); assert_eq!(jobs.len(),1); assert_eq!(jobs[0].state,"completed");
        assert_eq!(jobs[0].total_units,None);
        assert_eq!(jobs[0].work_id.as_deref(),Some("work"));
        control(&state,&jobs[0].id,DownloadAction::Remove).await.unwrap();
        assert!(!generated.exists()); assert!(rows(&state.pool).await.unwrap().is_empty());
        assert_eq!(fs::read(original).unwrap(),b"original media");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&state.pool).await.unwrap(),1);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_bookmarks").fetch_one(&state.pool).await.unwrap(),1);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT notes FROM works").fetch_one(&state.pool).await.unwrap(),"原笔记");
    }

    #[tokio::test]
    async fn missing_completed_cache_can_be_queued_again_without_losing_identity() {
        let (_directory,state) = state().await;
        let generated = cache_book(&state,"book","one");
        import_existing(&state).await.unwrap();
        let mut job = rows(&state.pool).await.unwrap().remove(0); let id = job.id.clone();
        requeue_missing(&state,std::slice::from_mut(&mut job)).await.unwrap(); assert_eq!(job.state,"completed");
        fs::remove_dir_all(generated).unwrap();
        requeue_missing(&state,std::slice::from_mut(&mut job)).await.unwrap();
        assert_eq!(job.state,"queued"); assert_eq!(job.id,id); assert_eq!(job.generation,1); assert_eq!(job.bytes_downloaded,0);
    }

    #[tokio::test]
    async fn webdav_completed_and_interrupted_cache_import_and_remove_never_touch_original_files() {
        let (_directory,state) = state().await;
        let id = uuid::Uuid::new_v4().to_string(); let generated = seed_remote(&state,&id).await;
        let original = state.data_directory.join("original.mp4"); fs::write(&original,b"original").unwrap();
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES(?,123,999,'old')").bind(&id).execute(&state.pool).await.unwrap();
        import_existing(&state).await.unwrap(); let jobs = rows(&state.pool).await.unwrap();
        assert_eq!(jobs.len(),1); assert_eq!(jobs[0].state,"completed");
        assert_eq!(enqueue_file(&state.pool,&id).await.unwrap().id,jobs[0].id);
        control(&state,&jobs[0].id,DownloadAction::Remove).await.unwrap();
        assert!(!generated.exists()); assert!(rows(&state.pool).await.unwrap().is_empty());
        assert_eq!(fs::read(original).unwrap(),b"original");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT position_ms FROM playback_progress WHERE media_file_id=?").bind(&id).fetch_one(&state.pool).await.unwrap(),123);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM media_files").fetch_one(&state.pool).await.unwrap(),1);
        sqlx::query("UPDATE library_roots SET enabled=0").execute(&state.pool).await.unwrap();
        assert!(enqueue_file(&state.pool,&id).await.is_err());
        assert!(enqueue_file(&state.pool,"../original.mp4").await.is_err());
    }

    #[tokio::test]
    async fn stale_removed_task_callbacks_cannot_recreate_task_or_cache_and_errors_hide_private_addresses() {
        let (_directory,state) = state().await;
        let job = enqueue_books(&state.pool,"comic","book","default","作品", &[entry("one")]).await.unwrap().remove(0);
        let claimed = claim(&state.pool).await.unwrap().unwrap();
        control(&state,&job.id,DownloadAction::Remove).await.unwrap();
        persist_progress(&state.pool,&claimed,10,None,1,Some(1)).await.unwrap();
        finish(&state.pool,&claimed,Err(AppError::Network("https://private.invalid/?token=SECRET Cookie=private".into()))).await.unwrap();
        assert!(rows(&state.pool).await.unwrap().is_empty());
        let message = safe_error(&AppError::Network("https://private.invalid/?token=SECRET".into()));
        assert!(!message.contains("SECRET")); assert!(!message.contains("https://"));
        assert!(!state.data_directory.join("reading-cache").exists());
    }
}
