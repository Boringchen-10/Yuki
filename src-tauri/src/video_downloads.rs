//! Stable rule recipes are persisted here; resolved URLs and credentials go only to Android's encrypted store.
use crate::{
    android_bridge,
    db::{self, AppState},
    error::{AppError, AppResult},
    rule_sources,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recipe {
    plugin_id: String,
    source: String,
    road_index: usize,
    episode_index: usize,
    expected_episode_key: String,
    media_file_id: Option<String>,
    work_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleDownloadInput {
    plugin_id: String,
    source: String,
    title: String,
    road_index: usize,
    episode_indexes: Vec<usize>,
    work_id: Option<String>,
}
#[derive(Clone, FromRow)]
struct Job {
    id: String,
    recipe: String,
    title: String,
    episode_title: String,
    state: String,
    error: Option<String>,
    created_at: String,
    updated_at: String,
    generation: i64,
}
fn handoff_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}
static RUNNING: AtomicBool = AtomicBool::new(false);
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn native_result(value: Value) -> AppResult<Value> {
    if let Some(error) = value.get("errorCode").filter(|error| !error.is_null()) {
        let code = error.as_str().unwrap_or("");
        let safe = if code.starts_with("offline_")
            && code.len() <= 96
            && code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        {
            code
        } else {
            "offline_download_prepare_failed"
        };
        return Err(AppError::Validation(safe.into()));
    }
    Ok(value)
}
pub(crate) async fn initialize(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("UPDATE rule_video_downloads SET state='interrupted',generation=generation+1,updated_at=? WHERE state IN ('queued','downloading')")
        .bind(now()).execute(pool).await?;
    Ok(())
}
fn identity(recipe: &Recipe) -> String {
    format!(
        "rule_{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                &recipe.plugin_id,
                &recipe.source,
                &recipe.expected_episode_key
            ))
            .unwrap()
        )
    )
}
fn dto(job: &Job) -> Value {
    let recipe: Value = serde_json::from_str(&job.recipe).unwrap_or(Value::Null);
    json!({"id":job.id,"kind":"video","title":job.title,"episodeTitle":job.episode_title,
        "state":if job.state=="handed_off" {"failed"} else {&job.state},"bytesDownloaded":0,
        "createdAt":job.created_at,"updatedAt":job.updated_at,"error":if job.state=="handed_off" {Some("offline_download_missing")} else {job.error.as_deref()},
        "mediaFileId":recipe["mediaFileId"],"workId":recipe["workId"]})
}
async fn job(pool: &SqlitePool, id: &str) -> AppResult<Job> {
    sqlx::query_as("SELECT * FROM rule_video_downloads WHERE id=?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("下载任务不存在".into()))
}
#[tauri::command]
pub async fn list_video_downloads(state: State<'_, AppState>) -> AppResult<Value> {
    let native = android_bridge::call("listOfflineVideos", json!({})).await?;
    let jobs: Vec<Job> =
        sqlx::query_as("SELECT * FROM rule_video_downloads ORDER BY created_at DESC")
            .fetch_all(&state.pool)
            .await?;
    Ok(merge_downloads(native, jobs))
}
fn merge_downloads(native: Value, jobs: Vec<Job>) -> Value {
    let mut downloads = native["downloads"].as_array().cloned().unwrap_or_default();
    for value in &mut downloads {
        value.as_object_mut().map(|value| value.remove("recipe"));
    }
    for task in jobs {
        if let Some(existing) = downloads.iter_mut().find(|value| value["id"] == task.id) {
            if task.state != "handed_off" {
                *existing = dto(&task);
            }
        } else {
            downloads.push(dto(&task));
        }
    }
    json!({"downloads":downloads})
}
async fn enqueue(
    state: &AppState,
    recipes: Vec<(Recipe, String, String)>,
) -> AppResult<Vec<Value>> {
    let (_permit, mut tx) = db::begin_write(&state.pool).await?;
    let mut result = Vec::new();
    for (recipe, title, episode) in recipes {
        let id = identity(&recipe);
        let timestamp = now();
        sqlx::query("INSERT INTO rule_video_downloads(id,recipe,title,episode_title,state,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?) ON CONFLICT(id) DO UPDATE SET recipe=excluded.recipe,title=excluded.title,episode_title=excluded.episode_title")
            .bind(&id).bind(serde_json::to_string(&recipe)?).bind(title).bind(episode).bind(&timestamp).bind(&timestamp).execute(&mut *tx).await?;
        let task: Job = sqlx::query_as("SELECT * FROM rule_video_downloads WHERE id=?")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        result.push(dto(&task));
    }
    tx.commit().await?;
    start_worker(state.clone());
    Ok(result)
}
#[tauri::command]
pub async fn enqueue_rule_downloads(
    input: RuleDownloadInput,
    state: State<'_, AppState>,
) -> AppResult<Vec<Value>> {
    if input.episode_indexes.is_empty()
        || input.episode_indexes.len() > 500
        || input.title.len() > 1000
        || input.source.len() > 8192
    {
        return Err(AppError::Validation("请选择 1–500 集下载".into()));
    }
    if let Some(work) = &input.work_id {
        if !sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM works WHERE id=?)")
            .bind(work)
            .fetch_one(&state.pool)
            .await?
        {
            return Err(AppError::NotFound("作品不存在".into()));
        }
    }
    let rule = rule_sources::definition(&state.pool, &input.plugin_id).await?;
    let chapters =
        rule_sources::chapters(&state.pool, &input.plugin_id, &input.source, false).await?;
    let road = chapters
        .roads
        .get(input.road_index)
        .ok_or_else(|| AppError::Validation("播放线路已变化".into()))?;
    let mut recipes = Vec::new();
    let mut indexes = input.episode_indexes.clone();
    indexes.sort_unstable();
    indexes.dedup();
    for index in indexes {
        let episode = road
            .episodes
            .get(index)
            .ok_or_else(|| AppError::Validation("来源剧集已变化".into()))?;
        let key = rule_sources::episode_key(&rule, &input.source, road, index)?;
        let media: Option<String> = sqlx::query_scalar("SELECT e.media_file_id FROM rule_episodes e JOIN media_files m ON m.id=e.media_file_id WHERE e.plugin_id=? AND e.source_key=? AND e.page_url IN (?,?) AND m.work_id=? LIMIT 1")
            .bind(&input.plugin_id).bind(&input.source).bind(&key).bind(&episode.url).bind(&input.work_id).fetch_optional(&state.pool).await?;
        recipes.push((
            Recipe {
                plugin_id: input.plugin_id.clone(),
                source: input.source.clone(),
                road_index: input.road_index,
                episode_index: index,
                expected_episode_key: key,
                media_file_id: media,
                work_id: input.work_id.clone(),
            },
            input.title.clone(),
            episode.name.clone(),
        ));
    }
    enqueue(&state, recipes).await
}
#[tauri::command]
pub async fn enqueue_rule_media_download(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Value>> {
    let (plugin, source, key, work, title): (String,String,String,Option<String>,String) = sqlx::query_as("SELECT e.plugin_id,e.source_key,e.page_url,m.work_id,COALESCE(w.title,m.file_name) FROM rule_episodes e JOIN media_files m ON m.id=e.media_file_id LEFT JOIN works w ON w.id=m.work_id WHERE e.media_file_id=?")
        .bind(&media_file_id).fetch_optional(&state.pool).await?.ok_or_else(||AppError::NotFound("规则剧集不存在".into()))?;
    let rule = rule_sources::definition(&state.pool, &plugin).await?;
    let chapters = rule_sources::chapters(&state.pool, &plugin, &source, false).await?;
    for (road_index, road) in chapters.roads.iter().enumerate() {
        for (index, episode) in road.episodes.iter().enumerate() {
            let expected = rule_sources::episode_key(&rule, &source, road, index)?;
            if expected == key || episode.url == key {
                return enqueue(
                    &state,
                    vec![(
                        Recipe {
                            plugin_id: plugin,
                            source,
                            road_index,
                            episode_index: index,
                            expected_episode_key: expected,
                            media_file_id: Some(media_file_id),
                            work_id: work,
                        },
                        title,
                        episode.name.clone(),
                    )],
                )
                .await;
            }
        }
    }
    Err(AppError::Validation(
        "来源选集已变化，请重新核对剧集".into(),
    ))
}
async fn descriptor(state: &AppState, recipe: &Recipe) -> AppResult<Value> {
    let rule = rule_sources::definition(&state.pool, &recipe.plugin_id).await?;
    let chapters =
        rule_sources::chapters(&state.pool, &recipe.plugin_id, &recipe.source, true).await?;
    // Re-find the stable identity rather than trusting an index after the source has changed.
    for road in &chapters.roads {
        for (index, episode) in road.episodes.iter().enumerate() {
            if rule_sources::episode_key(&rule, &recipe.source, road, index)?
                == recipe.expected_episode_key
            {
                return crate::rule_stream::download_descriptor(&rule, &episode.url).await;
            }
        }
    }
    Err(AppError::Validation("来源剧集已变化，请重新核对".into()))
}
async fn current(pool: &SqlitePool, task: &Job) -> AppResult<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rule_video_downloads WHERE id=? AND generation=? AND state='downloading')")
        .bind(&task.id).bind(task.generation).fetch_one(pool).await?)
}
fn start_worker(state: AppState) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let next = sqlx::query_as::<_, Job>("SELECT * FROM rule_video_downloads WHERE state='queued' ORDER BY created_at,id LIMIT 1").fetch_optional(&state.pool).await;
            let mut task = match next {
                Ok(Some(task)) => task,
                Ok(None) => {
                    RUNNING.store(false, Ordering::SeqCst);
                    if sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS(SELECT 1 FROM rule_video_downloads WHERE state='queued')",
                    )
                    .fetch_one(&state.pool)
                    .await
                    .unwrap_or(false)
                        && !RUNNING.swap(true, Ordering::SeqCst)
                    {
                        continue;
                    }
                    break;
                }
                Err(_) => {
                    let _=sqlx::query("UPDATE rule_video_downloads SET state='interrupted',generation=generation+1,updated_at=? WHERE state IN ('queued','downloading')").bind(now()).execute(&state.pool).await;
                    RUNNING.store(false, Ordering::SeqCst);
                    break;
                }
            };
            if !crate::download_center::network_allowed().await.unwrap_or(false) {
                if task.error.as_deref() != Some("offline_waiting_wifi") {
                    let _ = sqlx::query("UPDATE rule_video_downloads SET error='offline_waiting_wifi' WHERE id=? AND generation=? AND state='queued'")
                        .bind(&task.id).bind(task.generation).execute(&state.pool).await;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
            let claimed = sqlx::query("UPDATE rule_video_downloads SET state='downloading',error=NULL,updated_at=? WHERE id=? AND generation=? AND state='queued'")
                .bind(now()).bind(&task.id).bind(task.generation).execute(&state.pool).await;
            match claimed {
                Ok(result) if result.rows_affected() == 1 => {}
                Ok(_) => continue,
                Err(_) => {
                    let _=sqlx::query("UPDATE rule_video_downloads SET state='interrupted',generation=generation+1,updated_at=? WHERE state IN ('queued','downloading')").bind(now()).execute(&state.pool).await;
                    RUNNING.store(false, Ordering::SeqCst);
                    break;
                }
            }
            task.state = "downloading".into();
            let result = async {
                let recipe: Recipe = serde_json::from_str(&task.recipe)?;
                let mut payload = tokio::time::timeout(std::time::Duration::from_secs(60), descriptor(&state,&recipe)).await
                    .map_err(|_| AppError::Network("下载地址解析超时".into()))??;
                if !current(&state.pool,&task).await? { return Ok(()); }
                payload["id"]=json!(task.id);payload["title"]=json!(task.title);payload["episodeTitle"]=json!(task.episode_title);
                payload["mediaFileId"]=json!(recipe.media_file_id);payload["workId"]=json!(recipe.work_id);payload["recipe"]=serde_json::to_value(recipe)?;
                payload["forceRefresh"]=json!(true);
                let prepared=native_result(tokio::time::timeout(std::time::Duration::from_secs(120),android_bridge::call("prepareOfflineVideo",payload)).await
                    .map_err(|_|AppError::Network("下载准备超时".into()))??)?;
                let ticket=prepared["ticket"].as_str().ok_or_else(||AppError::Validation("offline_download_prepare_failed".into()))?;
                let _handoff = handoff_lock().lock().await;
                if !current(&state.pool,&task).await? {
                    let _=android_bridge::call("discardOfflineVideoPrepare",json!({"ticket":ticket})).await;
                    return Ok(());
                }
                native_result(android_bridge::call("commitOfflineVideo",json!({"ticket":ticket})).await?)?;
                sqlx::query("UPDATE rule_video_downloads SET state='handed_off',error=NULL,updated_at=? WHERE id=? AND generation=? AND state='downloading'")
                    .bind(now()).bind(&task.id).bind(task.generation).execute(&state.pool).await?;
                Ok::<_,AppError>(())
            }.await;
            if let Err(error) = result {
                let code = if !crate::download_center::network_allowed().await.unwrap_or(false) { "offline_waiting_wifi" } else { match &error {
                    AppError::Validation(code) if code.starts_with("offline_") => code.as_str(),
                    _ => "offline_download_resolve_failed",
                } };
                let next_state = if code == "offline_waiting_wifi" { "queued" } else { "failed" };
                let _ = sqlx::query("UPDATE rule_video_downloads SET state=?,error=?,generation=generation+1,updated_at=? WHERE id=? AND generation=? AND state='downloading'")
                    .bind(next_state).bind(code).bind(now()).bind(&task.id).bind(task.generation).execute(&state.pool).await;
            }
        }
    });
}
#[tauri::command]
pub async fn control_video_download(
    id: String,
    action: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if !matches!(action.as_str(), "pause" | "resume" | "retry" | "remove") {
        return Err(AppError::Validation("未知下载操作".into()));
    }
    let _handoff = handoff_lock().lock().await;
    if action == "remove" && crate::android_player::offline_download_active(&id) {
        return Err(AppError::Validation(
            "该下载正在播放，请关闭播放器后再清理".into(),
        ));
    }
    let native = android_bridge::call("listOfflineVideos", json!({})).await?;
    let download = native["downloads"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == id));
    let task = match job(&state.pool, &id).await {
        Ok(task) => task,
        Err(AppError::NotFound(_)) if download.is_some() && action != "retry" => {
            android_bridge::call("controlOfflineVideo", json!({"id":id,"action":action})).await?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    if action == "remove" || action == "pause" {
        if action == "pause" && (download.is_none() || task.state != "handed_off") {
            sqlx::query("UPDATE rule_video_downloads SET state='paused',error=CASE WHEN error='offline_waiting_wifi' THEN NULL ELSE error END,generation=generation+1,updated_at=? WHERE id=?").bind(now()).bind(&id).execute(&state.pool).await?;
        }
        // Service intents may not yet be visible in the index; stop/remove must
        // still be ordered after a just-dispatched add.
        android_bridge::call("controlOfflineVideo", json!({"id":id,"action":action})).await?;
        if action == "remove" {
            sqlx::query("DELETE FROM rule_video_downloads WHERE id=?")
                .bind(id)
                .execute(&state.pool)
                .await?;
        }
        return Ok(());
    }
    if action == "resume"
        && task.state == "handed_off"
        && download.is_some_and(|value| value["state"] != "failed")
    {
        android_bridge::call("controlOfflineVideo", json!({"id":id,"action":"resume"})).await?;
    } else {
        if task.state == "queued" || task.state == "downloading" {
            start_worker(state.inner().clone());
            return Ok(());
        }
        sqlx::query("UPDATE rule_video_downloads SET state='queued',error=NULL,generation=generation+1,updated_at=? WHERE id=?").bind(now()).bind(id).execute(&state.pool).await?;
        start_worker(state.inner().clone());
    }
    Ok(())
}
#[tauri::command]
pub async fn open_downloaded_video(id: String, state: State<'_, AppState>) -> AppResult<Value> {
    let _handoff = handoff_lock().lock().await;
    let mut locator = android_bridge::call("offlineVideoLocator", json!({"id":id})).await?;
    locator["downloadId"] = json!(id);
    if let Ok(task) = job(&state.pool, &id).await {
        let recipe: Recipe = serde_json::from_str(&task.recipe)?;
        locator["mediaFileId"] = json!(recipe.media_file_id);
        locator["title"] = json!(task.title);
        locator["episodeTitle"] = json!(task.episode_title);
    }
    crate::android_player::open_cached_locator(&state, locator, None).await
}
#[tauri::command]
pub async fn open_downloaded_file(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let _handoff = handoff_lock().lock().await;
    let lease = crate::remote_transfer::lease_offline(&media_file_id)?;
    let path = crate::remote_transfer::cached_path(&state, &media_file_id)
        .await?
        .ok_or_else(|| AppError::NotFound("离线文件已清理，请重新下载".into()))?;
    let title: String = sqlx::query_scalar("SELECT COALESCE(w.title,m.file_name) FROM media_files m LEFT JOIN works w ON w.id=m.work_id WHERE m.id=? AND m.media_type='video'")
        .bind(&media_file_id).fetch_optional(&state.pool).await?.ok_or_else(||AppError::Validation("仅支持离线视频播放".into()))?;
    let locator = android_bridge::call(
        "offlineFileLocator",
        json!({"path":path.to_string_lossy(),"mediaFileId":media_file_id,"title":title}),
    )
    .await?;
    crate::android_player::open_cached_locator(&state, locator, Some(lease)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0034_rule_video_downloads.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }
    async fn seed(pool: &SqlitePool, id: &str, state: &str) -> Job {
        sqlx::query("INSERT INTO rule_video_downloads(id,recipe,title,episode_title,state,created_at,updated_at) VALUES(?,'{}','title','episode',?,'before','before')")
            .bind(id).bind(state).execute(pool).await.unwrap();
        job(pool, id).await.unwrap()
    }
    fn task(id: &str, state: &str) -> Job {
        Job {id:id.into(),recipe:json!({"pluginId":"fixture","source":"public-work-page","mediaFileId":"media","workId":"work"}).to_string(),
            title:"title".into(),episode_title:"episode".into(),state:state.into(),error:None,created_at:"before".into(),updated_at:"after".into(),generation:3}
    }
    #[test]
    fn native_errors_are_bounded_codes_and_never_echo_unsafe_values() {
        for code in [
            "offline_download_failed",
            "offline_live_unsupported",
            "offline_drm_unsupported",
        ] {
            let result = native_result(json!({"errorCode":code}));
            assert!(matches!(result,Err(AppError::Validation(ref value)) if value==code));
        }
        for error in [
            json!("https://private.invalid/?token=SECRET"),
            json!("offline_failed\nCookie: SECRET"),
            json!("offline_FAILED"),
            json!("offline_error1"),
            json!(format!("offline_{}", "x".repeat(100))),
            json!(42),
            json!({"url":"SECRET"}),
            json!(["SECRET"]),
            json!(true),
        ] {
            let result =
                native_result(json!({"errorCode":error,"uri":"https://private.invalid/SECRET"}));
            assert!(
                matches!(result,Err(AppError::Validation(ref value)) if value=="offline_download_prepare_failed")
            );
        }
        assert_eq!(
            native_result(json!({"ticket":"opaque"})).unwrap(),
            json!({"ticket":"opaque"})
        );
        assert!(native_result(json!({"ticket":"opaque","errorCode":null})).is_ok());
    }
    #[test]
    fn public_download_merge_strips_all_recipes_and_pending_sql_wins_over_old_native_failures() {
        let mut downloads = vec![
            json!({"id":"orphan","state":"completed","bytesDownloaded":70,"recipe":{"uri":"SECRET"}}),
        ];
        let mut jobs = vec![];
        for state in ["queued", "downloading", "paused", "interrupted", "failed"] {
            downloads.push(json!({"id":state,"state":"failed","bytesDownloaded":123,"error":"offline_old_failure","recipe":{"uri":"SECRET"}}));
            jobs.push(task(state, state));
        }
        downloads.push(json!({"id":"native","state":"downloading","bytesDownloaded":40,"totalBytes":100,"percent":40,"recipe":{"uri":"SECRET"}}));
        jobs.push(task("native", "handed_off"));
        jobs.push(task("missing", "handed_off"));
        let merged = merge_downloads(json!({"downloads":downloads}), jobs);
        let items = merged["downloads"].as_array().unwrap();
        assert!(items.iter().all(|item| item.get("recipe").is_none()));
        assert!(!merged.to_string().contains("SECRET"));
        assert!(!merged.to_string().contains("public-work-page"));
        for state in ["queued", "downloading", "paused", "interrupted", "failed"] {
            let item = items.iter().find(|item| item["id"] == state).unwrap();
            assert_eq!(item["state"], state);
            assert_eq!(item["bytesDownloaded"], 0);
            assert_eq!(item["mediaFileId"], "media");
            assert_eq!(item["workId"], "work");
            assert!(item["error"].is_null());
        }
        let native = items.iter().find(|item| item["id"] == "native").unwrap();
        assert_eq!(native["state"], "downloading");
        assert_eq!(native["percent"], 40);
        assert_eq!(native["bytesDownloaded"], 40);
        let missing = items.iter().find(|item| item["id"] == "missing").unwrap();
        assert_eq!(missing["state"], "failed");
        assert_eq!(missing["error"], "offline_download_missing");
        assert_eq!(merge_downloads(json!({}), vec![]), json!({"downloads":[]}));
    }
    #[tokio::test]
    async fn pause_remove_and_retry_generation_prevent_late_prepare_from_becoming_current() {
        let pool = pool().await;
        let task = seed(&pool, "late", "downloading").await;
        assert!(current(&pool, &task).await.unwrap());
        sqlx::query("UPDATE rule_video_downloads SET state='paused',generation=generation+1 WHERE id='late'").execute(&pool).await.unwrap();
        assert!(!current(&pool, &task).await.unwrap());
        sqlx::query("UPDATE rule_video_downloads SET state='downloading' WHERE id='late'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!current(&pool, &task).await.unwrap());
        let resumed = job(&pool, "late").await.unwrap();
        assert!(current(&pool, &resumed).await.unwrap());
        sqlx::query("DELETE FROM rule_video_downloads WHERE id='late'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!current(&pool, &resumed).await.unwrap());
        let queued = seed(&pool, "late", "queued").await;
        assert!(!current(&pool, &queued).await.unwrap());
        assert!(!current(&pool, &resumed).await.unwrap());
    }
    #[tokio::test]
    async fn worker_exits_on_select_or_claim_database_error_instead_of_hot_looping_or_contacting_native(
    ) {
        async fn stopped() {
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                while RUNNING.load(Ordering::SeqCst) {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("database errors must stop the worker without automatic retry");
        }
        let directory = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool().await,
            database_path: directory.path().join("test.db"),
            data_directory: directory.path().into(),
            cover_cache_path: directory.path().join("covers"),
            thumbnail_cache_path: directory.path().join("thumbnails"),
        };
        seed(&state.pool, "malformed", "queued").await;
        sqlx::query(
            "UPDATE rule_video_downloads SET generation='not-an-integer' WHERE id='malformed'",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        start_worker(state.clone());
        stopped().await;
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT state FROM rule_video_downloads WHERE id='malformed'"
            )
            .fetch_one(&state.pool)
            .await
            .unwrap(),
            "interrupted"
        );
        sqlx::query("DELETE FROM rule_video_downloads")
            .execute(&state.pool)
            .await
            .unwrap();
        seed(&state.pool, "claim", "queued").await;
        sqlx::raw_sql("CREATE TABLE claim_attempts(id INTEGER); CREATE TRIGGER fail_claim BEFORE UPDATE OF state ON rule_video_downloads WHEN NEW.state='downloading' BEGIN INSERT INTO claim_attempts VALUES(1); SELECT RAISE(FAIL,'fixture claim error'); END;")
            .execute(&state.pool).await.unwrap();
        start_worker(state.clone());
        stopped().await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM claim_attempts")
                .fetch_one(&state.pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT state FROM rule_video_downloads WHERE id='claim'"
            )
            .fetch_one(&state.pool)
            .await
            .unwrap(),
            "interrupted"
        );
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM claim_attempts")
                .fetch_one(&state.pool)
                .await
                .unwrap(),
            1
        );
        assert!(!directory.path().join("remote-cache").exists());
    }
    #[test]
    fn task_identity_survives_reordered_indexes_and_rejects_unknown_recipe_fields() {
        let mut recipe = Recipe {
            plugin_id: "p".into(),
            source: "work-1".into(),
            road_index: 0,
            episode_index: 0,
            expected_episode_key: "catalog:stable".into(),
            media_file_id: None,
            work_id: None,
        };
        let id = identity(&recipe);
        recipe.road_index = 5;
        recipe.episode_index = 99;
        assert_eq!(id, identity(&recipe));
        recipe.expected_episode_key = "catalog:other".into();
        assert_ne!(id, identity(&recipe));
        let mut json = serde_json::to_value(recipe).unwrap();
        json["uri"] = json!("https://secret.invalid/token");
        assert!(serde_json::from_value::<Recipe>(json).is_err());
    }
    #[tokio::test]
    async fn restart_preserves_recipes_and_completed_handoffs_without_resuming() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0034_rule_video_downloads.sql"))
            .execute(&pool)
            .await
            .unwrap();
        for (id, state) in [
            ("a", "queued"),
            ("b", "downloading"),
            ("c", "paused"),
            ("d", "handed_off"),
        ] {
            sqlx::query("INSERT INTO rule_video_downloads(id,recipe,title,episode_title,state,created_at,updated_at) VALUES(?,'{}','title','episode',?,'before','before')").bind(id).bind(state).execute(&pool).await.unwrap();
        }
        initialize(&pool).await.unwrap();
        let rows: Vec<(String, String, i64)> =
            sqlx::query_as("SELECT id,state,generation FROM rule_video_downloads ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![
                ("a".into(), "interrupted".into(), 1),
                ("b".into(), "interrupted".into(), 1),
                ("c".into(), "paused".into(), 0),
                ("d".into(), "handed_off".into(), 0)
            ]
        );
    }
}
