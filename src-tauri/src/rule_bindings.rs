use crate::{
    db::{self, AppState},
    error::{AppError, AppResult},
    rule_format::*,
    rule_sources,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingInput {
    pub work_id: String,
    pub plugin_id: String,
    pub source: String,
    pub title: String,
    pub road_index: usize,
    pub episode_indexes: Vec<usize>,
    pub episode_offset: i64,
    #[serde(default)]
    pub replace_existing: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingRow {
    pub index: usize,
    pub name: String,
    pub original_episode: Option<i64>,
    pub official_episode: Option<i64>,
    pub official_title: Option<String>,
    pub existing: bool,
    pub conflict: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingPreview {
    pub token: String,
    pub title: String,
    pub road: String,
    pub rows: Vec<BindingRow>,
}
async fn context(state: &AppState, input: &BindingInput) -> AppResult<(Value, Vec<Road>)> {
    if input.episode_indexes.is_empty()
        || input.episode_indexes.len() > 500
        || input
            .episode_indexes
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.episode_indexes.len()
        || !(-9999..=9999).contains(&input.episode_offset)
        || input.title.chars().count() > 300
    {
        return Err(AppError::Validation(
            "请选择 1–500 个不重复的剧集，并核对编号对应".into(),
        ));
    }
    let rule = rule_sources::definition(&state.pool, &input.plugin_id).await?;
    if rule_sources::direct_media(&input.source) {
        return Err(AppError::Validation(
            "规则搜索结果需提供稳定的作品页面或作品编号".into(),
        ));
    }
    let data = rule_sources::chapters(&state.pool, &input.plugin_id, &input.source, false).await?;
    if data.verification_required {
        return Err(AppError::Validation(
            "来源需要网页验证，请先完成验证并更新选集".into(),
        ));
    }
    Ok((rule, data.roads))
}
type Official = (String, String, Option<i64>, Option<i64>, String);
struct Target {
    key: String,
    id: Option<String>,
    official: Option<(String, String)>,
    preserve: bool,
}
fn number(name: &str) -> Option<i64> {
    let parsed = crate::anime_parser::parse_file_name(&format!("{name}.mp4"));
    if parsed.special_type.is_some()
        || parsed.invalid_episode_range
        || parsed
            .episode_end
            .is_some_and(|end| Some(end) != parsed.episode_start)
    {
        return None;
    }
    parsed.episode_start.map(i64::from)
}
async fn prepare(
    tx: &mut Transaction<'_, Sqlite>,
    rule: &Value,
    roads: &[Road],
    input: &BindingInput,
) -> AppResult<(BindingPreview, Vec<Target>)> {
    let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id=? AND type='video'")
        .bind(&input.work_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("目标视频作品不存在".into()))?;
    let anchors: Vec<(String, String)> = sqlx::query_as(
        "SELECT provider,external_id FROM work_external_ids WHERE work_id=? ORDER BY provider",
    )
    .bind(&input.work_id)
    .fetch_all(&mut **tx)
    .await?;
    let provider = if anchors.iter().any(|a| a.0 == "bangumi") {
        "bangumi"
    } else {
        "tmdb"
    };
    let official:Vec<Official>=sqlx::query_as("SELECT provider,external_id,episode_number,episode_type,title FROM anime_episodes WHERE work_id=? AND provider=? ORDER BY external_id")
        .bind(&input.work_id).bind(provider).fetch_all(&mut **tx).await?;
    let road = roads
        .get(input.road_index)
        .ok_or_else(|| AppError::Validation("播放线路已变化，请重新选择".into()))?;
    let mut indexes = input.episode_indexes.clone();
    indexes.sort_unstable();
    let mut rows = Vec::new();
    let mut existing = Vec::new();
    let mut targets = Vec::new();
    for index in indexes {
        let episode = road
            .episodes
            .get(index)
            .ok_or_else(|| AppError::Validation("来源剧集已变化，请更新选集".into()))?;
        let key = rule_sources::episode_key(rule, &input.source, road, index)?;
        let old:Option<(String,Option<String>)>=sqlx::query_as("SELECT m.id,m.work_id FROM rule_episodes e JOIN media_files m ON m.id=e.media_file_id WHERE e.plugin_id=? AND e.page_url=?")
            .bind(&input.plugin_id).bind(&key).fetch_optional(&mut **tx).await?;
        let old_links: Vec<(String, String, String)> = if let Some((id, _)) = &old {
            sqlx::query_as("SELECT provider,episode_external_id,match_method FROM media_episode_links WHERE media_file_id=? ORDER BY provider,episode_external_id").bind(id).fetch_all(&mut **tx).await?
        } else {
            vec![]
        };
        let old_override: Option<(Option<i64>, i64)> = if let Some((id, _)) = &old {
            sqlx::query_as(
                "SELECT episode,episode_type FROM media_episode_overrides WHERE media_file_id=?",
            )
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
        } else {
            None
        };
        let preserve = old
            .as_ref()
            .is_some_and(|(_, owner)| owner.as_deref() == Some(&input.work_id))
            && !input.replace_existing;
        let original = number(&episode.name);
        let mapped = original
            .map(|n| n - input.episode_offset)
            .filter(|n| (0..=9999).contains(n));
        let matches: Vec<_> = official
            .iter()
            .filter(|e| {
                if preserve {
                    old_links.iter().any(|l| l.0 == e.0 && l.1 == e.1)
                } else {
                    e.2 == mapped && mapped.is_some() && e.3.unwrap_or(0) == 0
                }
            })
            .collect();
        let matched = (matches.len() == 1).then(|| matches[0]);
        rows.push(BindingRow {
            index,
            name: episode.name.clone(),
            original_episode: original,
            official_episode: matched.and_then(|e| e.2),
            official_title: matched.map(|e| e.4.clone()),
            existing: old.is_some(),
            conflict: old
                .as_ref()
                .is_some_and(|(_, owner)| owner.as_ref().is_some_and(|id| id != &input.work_id)),
        });
        existing.push((key.clone(), old.clone(), old_links, old_override));
        targets.push(Target {
            key,
            id: old.map(|o| o.0),
            official: matched.map(|e| (e.0.clone(), e.1.clone())),
            preserve,
        });
    }
    let identity: Vec<_> = road
        .episodes
        .iter()
        .enumerate()
        .map(|(index, episode)| {
            Ok((
                episode.name.clone(),
                rule_sources::episode_key(rule, &input.source, road, index)?,
            ))
        })
        .collect::<AppResult<_>>()?;
    let token = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            input, rule, &title, &anchors, &official, &road.name, &identity, &existing
        ))?)
    );
    Ok((
        BindingPreview {
            token,
            title,
            road: road.name.clone(),
            rows,
        },
        targets,
    ))
}
#[tauri::command]
pub async fn preview_rule_binding(
    input: BindingInput,
    state: State<'_, AppState>,
) -> AppResult<BindingPreview> {
    let (rule, roads) = context(&state, &input).await?;
    let mut tx = state.pool.begin().await?;
    let value = prepare(&mut tx, &rule, &roads, &input).await?.0;
    tx.rollback().await?;
    Ok(value)
}
#[tauri::command]
pub async fn bind_rule_episodes(
    input: BindingInput,
    token: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    bind(&state, input, &token).await
}
#[tauri::command]
pub async fn play_rule_episode(
    input: BindingInput,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    if input.episode_indexes.len() != 1 {
        return Err(AppError::Validation("请选择一集播放".into()));
    }
    let (loading, opening) = crate::android_player::start_rule_loading(&state, None).await?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            crate::android_player::rule_loading_phase(&loading, "正在获取剧集信息…", false).await?;
            let (rule, roads) = context(&state, &input).await?;
            crate::android_player::rule_loading_phase(&loading, "正在准备播放来源…", false).await?;
            let mut tx = state.pool.begin().await?;
            let token = prepare(&mut tx, &rule, &roads, &input).await?.0.token;
            tx.rollback().await?;
            let ids = bind(&state, input, &token).await?;
            crate::android_player::open_rule_player(ids[0].clone(), &state, &loading).await
        }
        .await;
        if let Err(error) = result {
            crate::android_player::rule_loading_failed(&loading, &error).await;
        }
    });
    Ok(opening)
}
async fn bind(state: &AppState, input: BindingInput, token: &str) -> AppResult<Vec<String>> {
    let (rule, roads) = context(&state, &input).await?;
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    let live:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rule_plugins p JOIN library_roots r ON r.id=p.id WHERE p.id=? AND p.removed_at IS NULL AND r.enabled=1 AND p.definition_json=?)")
        .bind(&input.plugin_id).bind(serde_json::to_string(&rule)?).fetch_one(&mut *tx).await?;
    if !live {
        return Err(AppError::Validation("规则已更新或停用，请重新预览".into()));
    }
    let (preview, targets) = prepare(&mut tx, &rule, &roads, &input).await?;
    if preview.token != token {
        return Err(AppError::Validation(
            "预览已过期，请重新核对来源与官方分集".into(),
        ));
    }
    if preview.rows.iter().any(|r| r.conflict) {
        return Err(AppError::Validation(
            "部分来源剧集已关联其他作品，请取消勾选后再预览".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let mut ids = Vec::new();
    for (row, target) in preview.rows.iter().zip(&targets) {
        let id = target
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if target.id.is_none() {
            sqlx::query("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,size,missing,created_at,updated_at,parsed_episode,parsed_episode_start,parsed_episode_end) VALUES(?,?,?,?,'stream','video',0,0,?,?,?,?,?)")
            .bind(&id).bind(&input.plugin_id).bind(format!("rule://{}/{}",input.plugin_id,id)).bind(format!("{} · {} · {}",field(&rule,"name"),preview.road,row.name)).bind(&now).bind(&now).bind(row.original_episode.map(|n|n.to_string())).bind(row.original_episode).bind(row.original_episode).execute(&mut *tx).await?;
        }
        ids.push(id);
    }
    let undo = crate::recognition_history::begin(&mut tx, &input.work_id, &ids).await?;
    let source_key = if field(&rule, "chapterMode") == "api" {
        input.source.clone()
    } else {
        rule_sources::page_key(&field(&rule, "baseURL"), &input.source)?
    };
    sqlx::query("INSERT INTO rule_work_sources(work_id,plugin_id,source_key,title,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(work_id,plugin_id,source_key) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at")
        .bind(&input.work_id).bind(&input.plugin_id).bind(&source_key).bind(&input.title).bind(&now).execute(&mut *tx).await?;
    for ((row, target), id) in preview.rows.iter().zip(targets).zip(&ids) {
        sqlx::query("UPDATE media_files SET work_id=?,missing=0,recognition_status='matched',recognition_error=NULL,updated_at=? WHERE id=?").bind(&input.work_id).bind(&now).bind(id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO rule_episodes(media_file_id,plugin_id,source_key,page_url,road_name,episode_name,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET source_key=excluded.source_key,page_url=excluded.page_url,road_name=excluded.road_name,episode_name=excluded.episode_name,updated_at=excluded.updated_at")
            .bind(id).bind(&input.plugin_id).bind(&source_key).bind(target.key).bind(&preview.road).bind(&row.name).bind(&now).execute(&mut *tx).await?;
        if target.preserve {
            continue;
        }
        sqlx::query("DELETE FROM media_episode_links WHERE media_file_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO media_episode_overrides(media_file_id,work_id,season,episode,episode_type,updated_at) VALUES(?,?,NULL,?,0,?) ON CONFLICT(media_file_id) DO UPDATE SET work_id=excluded.work_id,episode=excluded.episode,episode_type=0,updated_at=excluded.updated_at")
            .bind(id).bind(&input.work_id).bind(row.official_episode).bind(&now).execute(&mut *tx).await?;
        if let Some((provider, external)) = target.official {
            sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES(?,?,?,?,'manual',1,?)")
            .bind(id).bind(&input.work_id).bind(provider).bind(external).bind(&now).execute(&mut *tx).await?;
        }
    }
    crate::recognition_history::finish(&mut tx, undo, &input.work_id, &preview.title).await?;
    tx.commit().await?;
    crate::android_events::recognition(ids.clone(), vec![input.work_id]);
    Ok(ids)
}
#[tauri::command]
pub async fn list_work_rule_sources(
    work_id: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let rows:Vec<(String,String,String,String)>=sqlx::query_as("SELECT DISTINCT e.plugin_id,p.name,e.source_key,COALESCE((SELECT s.title FROM rule_work_sources s WHERE s.plugin_id=e.plugin_id AND s.source_key=e.source_key ORDER BY s.updated_at DESC LIMIT 1),w.title) title FROM rule_episodes e JOIN media_files m ON m.id=e.media_file_id JOIN works w ON w.id=m.work_id JOIN rule_plugins p ON p.id=e.plugin_id WHERE m.work_id=? AND p.removed_at IS NULL ORDER BY p.name,title")
        .bind(work_id).fetch_all(&state.pool).await?;
    Ok(json!(rows.into_iter().map(|(plugin_id,name,source,title)|json!({"pluginId":plugin_id,"name":name,"source":source,"title":title})).collect::<Vec<_>>()))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture() -> (AppState, tempfile::TempDir, Value, Vec<Road>, BindingInput) {
        let pool = db::test_pool().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(),
            database_path: dir.path().join("qa.db"),
            data_directory: dir.path().into(),
            cover_cache_path: dir.path().into(),
            thumbnail_cache_path: dir.path().into(),
        };
        let rule = json!({"api":"8","name":"QA","version":"1","baseURL":"https://qa.example.org/","searchMode":"api","chapterMode":"api","searchApiConfig":{"request":{"url":"https://qa.example.org/search"}},"chapterApiConfig":{"request":{"url":"https://qa.example.org/chapters/@source"}}});
        let plugin = rule_sources::install(&pool, rule.clone(), None)
            .await
            .unwrap();
        sqlx::query("INSERT INTO works(id,title,type,favorite,rating,notes,created_at,updated_at) VALUES('w','测试动画','video',1,9,'保留笔记','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('w','bangumi','42','now','now')").execute(&pool).await.unwrap();
        for n in 1..=2 {
            sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,episode_type,sort_number,title,fetched_at) VALUES('w','bangumi',?,?,0,?,?,'now')").bind(format!("ep{n}")).bind(n).bind(n).bind(format!("第{n}集")).execute(&pool).await.unwrap();
        }
        let roads = vec![Road {
            name: "高清".into(),
            episodes: vec![
                Episode {
                    name: "第13集".into(),
                    url: "https://qa.example.org/play/13".into(),
                },
                Episode {
                    name: "第14集".into(),
                    url: "https://qa.example.org/play/14".into(),
                },
            ],
        }];
        let key = format!("chapters:{plugin}:{}:42", rule_sources::rule_key(&rule));
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('kazumi',?,?,'now','2999-01-01')").bind(key).bind(serde_json::to_string(&roads).unwrap()).execute(&pool).await.unwrap();
        let input = BindingInput {
            work_id: "w".into(),
            plugin_id: plugin,
            source: "42".into(),
            title: "源站作品".into(),
            road_index: 0,
            episode_indexes: vec![0, 1],
            episode_offset: 12,
            replace_existing: false,
        };
        (state, dir, rule, roads, input)
    }
    async fn preview(
        state: &AppState,
        rule: &Value,
        roads: &[Road],
        input: &BindingInput,
    ) -> BindingPreview {
        let mut tx = state.pool.begin().await.unwrap();
        let p = prepare(&mut tx, rule, roads, input).await.unwrap().0;
        tx.rollback().await.unwrap();
        p
    }
    #[tokio::test]
    async fn binding_reuses_media_and_preserves_existing_mapping_and_progress_by_default() {
        let (state, _dir, rule, roads, input) = fixture().await;
        let p = preview(&state, &rule, &roads, &input).await;
        assert_eq!(p.rows[0].original_episode, Some(13));
        assert_eq!(p.rows[0].official_episode, Some(1));
        let ids = bind(&state, input.clone(), &p.token).await.unwrap();
        assert_eq!(ids.len(), 2);
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES(?,12345,40000,'now')").bind(&ids[0]).execute(&state.pool).await.unwrap();
        let mut again = input.clone();
        again.episode_offset = 0;
        let p = preview(&state, &rule, &roads, &again).await;
        assert_eq!(p.rows[0].official_episode, Some(1));
        assert!(p.rows[0].existing);
        assert_eq!(bind(&state, again, &p.token).await.unwrap(), ids);
        assert_eq!(
            crate::playback::resume_position(&state.pool, &ids[0], false)
                .await
                .unwrap(),
            Some(12345)
        );
        let links:Vec<String>=sqlx::query_scalar("SELECT episode_external_id FROM media_episode_links WHERE work_id='w' ORDER BY episode_external_id").fetch_all(&state.pool).await.unwrap();
        assert_eq!(links, vec!["ep1", "ep2"]);
        let personal: (bool, f64, String) =
            sqlx::query_as("SELECT favorite,rating,notes FROM works WHERE id='w'")
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(personal, (true, 9.0, "保留笔记".into()));
    }
    #[tokio::test]
    async fn stale_official_changes_and_ownership_conflicts_never_partially_apply() {
        let (state, _dir, rule, roads, input) = fixture().await;
        let p = preview(&state, &rule, &roads, &input).await;
        sqlx::query(
            "UPDATE anime_episodes SET title='新标题' WHERE work_id='w' AND external_id='ep1'",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        assert!(bind(&state, input.clone(), &p.token).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM rule_episodes")
                .fetch_one(&state.pool)
                .await
                .unwrap(),
            0
        );
        let p = preview(&state, &rule, &roads, &input).await;
        let ids = bind(&state, input.clone(), &p.token).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('other','另一个作品','video','now','now')").execute(&state.pool).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id='other' WHERE id=?")
            .bind(&ids[0])
            .execute(&state.pool)
            .await
            .unwrap();
        let p = preview(&state, &rule, &roads, &input).await;
        assert!(p.rows[0].conflict);
        assert!(bind(&state, input, &p.token).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT work_id FROM media_files WHERE id=?")
                .bind(&ids[0])
                .fetch_one(&state.pool)
                .await
                .unwrap(),
            "other"
        );
    }
    #[tokio::test]
    async fn direct_signed_urls_have_stable_private_locators_and_do_not_invalidate_binding_identity(
    ) {
        let (state, _dir, rule, mut roads, input) = fixture().await;
        roads[0].episodes[0].url = "https://cdn.example.org/video.m3u8?token=first".into();
        let p = preview(&state, &rule, &roads, &input).await;
        let key = rule_sources::episode_key(&rule, "42", &roads[0], 0).unwrap();
        assert!(key.starts_with("catalog:"));
        assert!(!key.contains("token"));
        roads[0].episodes[0].url = "https://new-cdn.example.org/video.m3u8?token=renewed".into();
        let next = preview(&state, &rule, &roads, &input).await;
        assert_eq!(next.token, p.token);
        assert_eq!(
            rule_sources::episode_key(&rule, "42", &roads[0], 0).unwrap(),
            key
        );
    }
}
