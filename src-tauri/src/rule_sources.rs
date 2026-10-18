//! User-managed Kazumi rules. Page locators are durable; resolved media URLs
//! and site cookies live only in the current playback session.
use crate::{
    db::{self, AppState},
    error::{AppError, AppResult},
    rule_format::{self as format, *},
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use std::time::Duration as Wait;
use tauri::State;
use uuid::Uuid;
pub const REPOSITORY: &str = "https://raw.githubusercontent.com/Predidit/KazumiRules/main/";
static RESOLVE_OPERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(crate) fn begin_resolve() -> u64 {
    RESOLVE_OPERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}
pub(crate) fn check_resolve(operation: u64) -> AppResult<()> {
    if RESOLVE_OPERATION.load(std::sync::atomic::Ordering::SeqCst) != operation {
        return Err(AppError::Validation("播放解析已取消".into()));
    }
    Ok(())
}
pub(crate) fn cancel_resolve_if_current(operation: u64) {
    let _ = RESOLVE_OPERATION.compare_exchange(
        operation,
        operation + 1,
        std::sync::atomic::Ordering::SeqCst,
        std::sync::atomic::Ordering::SeqCst,
    );
}
type VolatileChapters = std::collections::HashMap<String, (std::time::Instant, Vec<Road>)>;
fn volatile_chapters() -> &'static std::sync::Mutex<VolatileChapters> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<VolatileChapters>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}
pub(crate) fn direct_media(url: &str) -> bool {
    http_url(url).is_ok_and(|url| {
        regex::Regex::new(r"(?i)\.(m3u8|mp4|mpd|flv|mkv|webm|mov|m4v)$")
            .unwrap()
            .is_match(url.path())
    })
}
fn transient_episode(rule: &Value, url: &str) -> bool {
    direct_media(url)
        || rule["useWebview"] == false
        || (field(rule, "chapterMode") == "api"
            && !rule["chapterApiConfig"]["episodePage"].is_object())
}
pub(crate) fn episode_key(
    rule: &Value,
    source: &str,
    road: &Road,
    index: usize,
) -> AppResult<String> {
    let episode = road
        .episodes
        .get(index)
        .ok_or_else(|| AppError::Validation("来源剧集已变化".into()))?;
    if transient_episode(rule, &episode.url) {
        let source = if field(rule, "chapterMode") == "api" {
            source.to_string()
        } else {
            page_key(&field(rule, "baseURL"), source)?
        };
        let unique = road
            .episodes
            .iter()
            .filter(|e| e.name == episode.name)
            .count()
            == 1;
        Ok(format!(
            "catalog:{:x}",
            Sha256::digest(serde_json::to_vec(&(
                source,
                &road.name,
                &episode.name,
                if unique { None } else { Some(index) }
            ))?)
        ))
    } else {
        page_key(&field(rule, "baseURL"), &episode.url)
    }
}

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub origin: Option<String>,
    pub updated_at: String,
}
pub(crate) async fn definition(pool: &SqlitePool, id: &str) -> AppResult<Value> {
    let data:Option<String>=sqlx::query_scalar("SELECT p.definition_json FROM rule_plugins p JOIN library_roots r ON r.id=p.id WHERE p.id=? AND p.removed_at IS NULL AND r.enabled=1")
        .bind(id).fetch_optional(pool).await?;
    let rule: Value = serde_json::from_str(
        &data.ok_or_else(|| AppError::Validation("规则已停用或移除，请在来源中启用".into()))?,
    )?;
    format::validate(&rule)?;
    Ok(rule)
}
#[tauri::command]
pub async fn list_rule_plugins(state: State<'_, AppState>) -> AppResult<Vec<Plugin>> {
    Ok(sqlx::query_as("SELECT p.id,p.name,p.version,r.enabled,p.origin,p.updated_at FROM rule_plugins p JOIN library_roots r ON r.id=p.id WHERE p.removed_at IS NULL ORDER BY p.name_key").fetch_all(&state.pool).await?)
}
#[tauri::command]
pub async fn get_rule_definition(id: String, state: State<'_, AppState>) -> AppResult<Value> {
    let definition: String = sqlx::query_scalar(
        "SELECT definition_json FROM rule_plugins WHERE id=? AND removed_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("规则不存在".into()))?;
    Ok(serde_json::from_str(&definition)?)
}
async fn cache_get(pool: &SqlitePool, key: &str) -> AppResult<Option<(Value, bool)>> {
    let row:Option<(String,String)>=sqlx::query_as("SELECT response_json,expires_at FROM metadata_cache WHERE provider='kazumi' AND cache_key=?").bind(key).fetch_optional(pool).await?;
    row.map(|(v, t)| Ok((serde_json::from_str(&v)?, t > Utc::now().to_rfc3339())))
        .transpose()
}
async fn cache_put(pool: &SqlitePool, key: &str, value: &Value, minutes: i64) -> AppResult<()> {
    let now = Utc::now();
    sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('kazumi',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
        .bind(key).bind(serde_json::to_string(value)?).bind(now.to_rfc3339()).bind((now+Duration::minutes(minutes)).to_rfc3339()).execute(pool).await?;
    Ok(())
}
pub(crate) fn client() -> AppResult<reqwest::Client> {
    static CLIENT: std::sync::Mutex<Option<reqwest::Client>> = std::sync::Mutex::new(None);
    let mut stored = CLIENT
        .lock()
        .map_err(|_| AppError::Network("规则连接池不可用".into()))?;
    if let Some(client) = stored.as_ref() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Wait::from_secs(5))
        .timeout(Wait::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Genzo rule reader")
        .build()
        .map_err(|_| AppError::Network("无法初始化规则网络".into()))?;
    *stored = Some(client.clone());
    Ok(client)
}
pub(crate) async fn body(mut response: reqwest::Response) -> AppResult<String> {
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "来源返回 HTTP {}",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|v| v > 2 * 1024 * 1024)
    {
        return Err(AppError::Validation("来源响应超过 2 MiB".into()));
    }
    let charset = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::Network("来源响应读取失败，请重试".into()))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::Validation("来源响应过大".into()));
        }
        bytes.extend(chunk);
    }
    let encoding = if charset.contains("gbk") || charset.contains("gb2312") {
        encoding_rs::GBK
    } else {
        encoding_rs::UTF_8
    };
    Ok(encoding.decode(&bytes).0.into_owned())
}
pub(crate) async fn environment(url: &str) -> AppResult<Value> {
    #[cfg(target_os = "android")]
    {
        crate::android_bridge::call("ruleEnvironment", json!({"url":url})).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = url;
        Ok(json!({"userAgent":"Mozilla/5.0 Genzo","cookie":""}))
    }
}
fn network_error() -> AppError {
    AppError::Network("规则来源连接失败或超时，请重试或切换来源".into())
}
async fn catalog_revision(pool: &SqlitePool) -> AppResult<String> {
    Ok(sqlx::query_scalar::<_, String>("SELECT updated_at FROM app_settings WHERE key=?").bind(crate::rules_network::KEY).fetch_optional(pool).await?.unwrap_or_default())
}
async fn cache_catalog(pool: &SqlitePool, data: &Value, revision: &str) -> AppResult<()> {
    let now = Utc::now();
    // The condition and write share one SQL statement: a response from before
    // a mode change must not overwrite or revalidate the new mode's cache.
    sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) SELECT 'kazumi','catalog',?,?,? WHERE COALESCE((SELECT updated_at FROM app_settings WHERE key=?),'')=? ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
        .bind(serde_json::to_string(data)?).bind(now.to_rfc3339()).bind((now + Duration::minutes(60)).to_rfc3339()).bind(crate::rules_network::KEY).bind(revision).execute(pool).await?;
    Ok(())
}
#[tauri::command]
pub async fn get_rule_catalog(fresh: bool, state: State<'_, AppState>) -> AppResult<Value> {
    catalog(&state.pool, fresh).await
}
async fn catalog(pool: &SqlitePool, fresh: bool) -> AppResult<Value> {
    let old = cache_get(pool, "catalog").await?;
    if !fresh {
        if let Some((data, true)) = &old {
            return Ok(json!({"items":data,"stale":false,"source":"cache"}));
        }
    }
    let result = async {
        let revision = catalog_revision(pool).await?;
        let result = crate::rules_network::fetch(pool, &format!("{REPOSITORY}index.json"), crate::rules_network::Document::Catalog).await?;
        cache_catalog(pool, &result.data, &revision).await?;
        Ok::<_, AppError>(result)
    }
    .await;
    match result {
        Ok(result) => Ok(json!({"items":result.data,"stale":false,"source":result.source,"warning":if result.fallback { Some("镜像暂不可用，已从官方仓库获取。") } else { None }})),
        Err(error) => match old {
            Some((data, _)) => Ok(json!({"items":data,"stale":true,"source":"cache","warning":format!("仓库连接失败，正在使用本地缓存。{error}")})),
            None => Err(error),
        },
    }
}
pub(crate) async fn install(
    pool: &SqlitePool,
    rule: Value,
    origin: Option<String>,
) -> AppResult<String> {
    format::validate(&rule)?;
    let name = field(&rule, "name");
    let version = field(&rule, "version");
    let key = name.to_lowercase();
    let now = Utc::now().to_rfc3339();
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let previous:Option<(String,Option<String>,bool,Option<String>)>=sqlx::query_as("SELECT p.id,p.removed_at,r.enabled,p.origin FROM rule_plugins p JOIN library_roots r ON r.id=p.id WHERE p.name_key=?").bind(&key).fetch_optional(&mut *tx).await?;
    let origin = origin.or_else(|| {
        previous
            .as_ref()
            .and_then(|(_, _, _, origin)| origin.clone())
    });
    let enabled = previous
        .as_ref()
        .filter(|(_, removed, _, _)| removed.is_none())
        .map(|(_, _, enabled, _)| *enabled)
        .unwrap_or(true);
    let id = previous
        .map(|(id, _, _, _)| id)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type,availability,destination) VALUES(?,?,'video',?,?,?,'local','unknown','media') ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,availability='unknown',updated_at=excluded.updated_at")
        .bind(&id).bind(format!("rule://{id}")).bind(enabled).bind(&now).bind(&now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO rule_plugins(id,name_key,name,version,definition_json,origin,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,definition_json=excluded.definition_json,origin=excluded.origin,removed_at=NULL,updated_at=excluded.updated_at")
        .bind(&id).bind(key).bind(name).bind(version).bind(serde_json::to_string(&rule)?).bind(origin).bind(&now).execute(&mut *tx).await?;
    sqlx::query("UPDATE media_files SET missing=0 WHERE library_root_id=?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let _ = crate::android_sources::notify(pool, &id).await;
    Ok(id)
}
#[tauri::command]
pub async fn import_rule_plugin(
    definition: Value,
    origin: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    install(&state.pool, definition, origin).await
}
#[tauri::command]
pub async fn import_rule_url(url: String, state: State<'_, AppState>) -> AppResult<String> {
    http_url(&url)?;
    let result = crate::rules_network::fetch(&state.pool, &url, crate::rules_network::Document::Rule).await?;
    install(&state.pool, result.data, Some(crate::rules_network::canonical_origin(&url).unwrap_or(url))).await
}
#[tauri::command]
pub async fn install_catalog_rule(name: String, state: State<'_, AppState>) -> AppResult<String> {
    if name.is_empty()
        || name.len() > 80
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(AppError::Validation("规则仓库条目名称无效".into()));
    }
    let url = format!("{REPOSITORY}{name}.json");
    let result = crate::rules_network::fetch(&state.pool, &url, crate::rules_network::Document::Rule).await?;
    install(&state.pool, result.data, Some(url)).await
}
#[tauri::command]
pub async fn update_rule_plugin(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let origin: Option<String> =
        sqlx::query_scalar("SELECT origin FROM rule_plugins WHERE id=? AND removed_at IS NULL")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();
    let origin = origin
        .ok_or_else(|| AppError::Validation("此规则没有更新地址，可重新导入 JSON 更新".into()))?;
    http_url(&origin)?;
    let result = crate::rules_network::fetch(&state.pool, &origin, crate::rules_network::Document::Rule).await?;
    let rule = result.data;
    let key: String = sqlx::query_scalar("SELECT name_key FROM rule_plugins WHERE id=?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;
    if field(&rule, "name").to_lowercase() != key {
        return Err(AppError::Validation(
            "更新地址返回了另一条规则，原规则已保留".into(),
        ));
    }
    install(&state.pool, rule, Some(origin)).await
}
#[tauri::command]
pub async fn set_rule_plugin_enabled(
    id: String,
    enabled: bool,
    remove: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(&state.pool).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rule_plugins WHERE id=? AND removed_at IS NULL)",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(AppError::NotFound("规则不存在或已移除".into()));
    }
    sqlx::query("UPDATE library_roots SET enabled=?,updated_at=? WHERE id=?")
        .bind(enabled && !remove)
        .bind(Utc::now().to_rfc3339())
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if remove {
        sqlx::query("UPDATE rule_plugins SET removed_at=? WHERE id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE media_files SET missing=1 WHERE library_root_id=?")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    crate::android_events::recognition(vec![], vec![]);
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub items: Vec<SearchItem>,
    pub stale: bool,
    pub warning: Option<String>,
    pub verification_required: bool,
    pub verification_url: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterResult {
    pub roads: Vec<Road>,
    pub stale: bool,
    pub warning: Option<String>,
    pub verification_required: bool,
    pub verification_url: Option<String>,
}
pub(crate) fn rule_key(rule: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(rule).unwrap_or_default())
    )
}
pub(crate) async fn request(
    rule: &Value,
    operation: &str,
    source: &str,
) -> AppResult<(String, String)> {
    let vars = Variables::from([(
        if operation == "search" {
            "keyword".into()
        } else {
            "source".into()
        },
        json!(source),
    )]);
    let config = &rule[if operation == "search" {
        "searchApiConfig"
    } else {
        "chapterApiConfig"
    }];
    let api = field(
        rule,
        if operation == "search" {
            "searchMode"
        } else {
            "chapterMode"
        },
    ) == "api";
    let (method, url, query, headers, body_type, data) = if api {
        let r = &config["request"];
        (
            field(r, "method").to_uppercase(),
            render(&field(r, "url"), &vars, true)?,
            render_value(&r["query"], &vars)?,
            render_value(&r["headers"], &vars)?,
            field(r, "bodyType"),
            render_value(&r["body"], &vars)?,
        )
    } else if operation == "search" {
        let url = field(rule, "searchURL").replace(
            "@keyword",
            &percent_encoding::utf8_percent_encode(source, percent_encoding::NON_ALPHANUMERIC)
                .to_string(),
        );
        if flag(rule, "usePost") {
            let mut u = http_url(&url)?;
            let form: Value = Value::Object(
                u.query_pairs()
                    .map(|(k, v)| (k.to_string(), json!(v)))
                    .collect(),
            );
            u.set_query(None);
            (
                "POST".into(),
                u.to_string(),
                Value::Null,
                Value::Null,
                "form".into(),
                form,
            )
        } else {
            (
                "GET".into(),
                url,
                Value::Null,
                Value::Null,
                String::new(),
                Value::Null,
            )
        }
    } else {
        (
            "GET".into(),
            absolute(&field(rule, "baseURL"), source)?,
            Value::Null,
            Value::Null,
            String::new(),
            Value::Null,
        )
    };
    let mut parsed = http_url(&url)?;
    merge_query(&mut parsed, &query);
    let env = environment(parsed.as_str()).await?;
    let mut req = if method == "POST" {
        client()?.post(parsed.clone())
    } else {
        client()?.get(parsed.clone())
    };
    req = req.header(reqwest::header::USER_AGENT, field(&env, "userAgent"));
    req = req.header(
        reqwest::header::REFERER,
        format!("{}/", field(rule, "baseURL").trim_end_matches('/')),
    );
    let cookie = field(&env, "cookie");
    if !cookie.is_empty() {
        req = req.header(reqwest::header::COOKIE, cookie);
    }
    if let Some(headers) = headers.as_object() {
        let mut custom = reqwest::header::HeaderMap::new();
        for (k, v) in headers {
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| AppError::Validation("规则请求头名称无效".into()))?;
            let value = reqwest::header::HeaderValue::from_str(&string(v))
                .map_err(|_| AppError::Validation("规则请求头内容无效".into()))?;
            custom.insert(name, value);
        }
        req = req.headers(custom);
    }
    if method == "POST" {
        if body_type == "json" {
            req = req.json(&data);
        } else if body_type == "form" {
            let form: Vec<(String, String)> = data
                .as_object()
                .map(|v| v.iter().map(|(k, v)| (k.clone(), string(v))).collect())
                .unwrap_or_default();
            req = req.form(&form);
        }
    }
    let response = req.send().await.map_err(|_| network_error())?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403 | 429) && rule["antiCrawlerConfig"]["enabled"] == true {
        return Ok(("__GENZO_VERIFICATION__".into(), parsed.to_string()));
    }
    let final_url = response.url().to_string();
    Ok((body(response).await?, final_url))
}
async fn parse_html(rule: &Value, raw: &str, operation: &str) -> AppResult<Value> {
    let anti = &rule["antiCrawlerConfig"];
    if anti["enabled"] == true && anti["captchaDetectType"] == 3 {
        let expression = field(anti, "captchaDetectValue");
        if !expression.is_empty()
            && expression.len() <= 2048
            && regex::RegexBuilder::new(&expression)
                .case_insensitive(true)
                .dot_matches_new_line(true)
                .build()
                .is_ok_and(|r| r.is_match(raw))
        {
            return Ok(json!({"verificationRequired":true}));
        }
    }
    let value = crate::android_bridge::call(
        "parseRuleHtml",
        json!({"html":raw,"rule":serde_json::to_string(rule)?,"operation":operation}),
    )
    .await?;
    if let Some(error) = value["error"].as_str() {
        return Err(AppError::Validation(error.into()));
    }
    Ok(value)
}
#[tauri::command]
pub async fn search_rule_source(
    plugin_id: String,
    keyword: String,
    fresh: bool,
    state: State<'_, AppState>,
) -> AppResult<SearchResult> {
    let rule = definition(&state.pool, &plugin_id).await?;
    let query = keyword.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(AppError::Validation("请输入不超过 200 字的搜索词".into()));
    }
    let key = format!("search:{plugin_id}:{}:{query}", rule_key(&rule));
    let old = cache_get(&state.pool, &key).await?;
    if !fresh {
        if let Some((v, true)) = &old {
            return Ok(SearchResult {
                items: serde_json::from_value(v.clone())?,
                stale: false,
                warning: None,
                verification_required: false,
                verification_url: None,
            });
        }
    }
    let result = async {
        let (raw, url) = request(&rule, "search", query).await?;
        if raw == "__GENZO_VERIFICATION__" {
            return Ok((vec![], Some(url)));
        }
        let mut items = if field(&rule, "searchMode") == "api" {
            api_search(&serde_json::from_str(&raw)?, &rule["searchApiConfig"])?
        } else {
            let v = parse_html(&rule, &raw, "search").await?;
            if v["verificationRequired"] == true {
                return Ok((vec![], Some(url)));
            }
            serde_json::from_value(v["items"].clone())?
        };
        if field(&rule, "searchMode") != "api" {
            items = items
                .into_iter()
                .filter_map(|mut item| {
                    item.source = absolute(&field(&rule, "baseURL"), &item.source).ok()?;
                    Some(item)
                })
                .collect();
        }
        if items.iter().all(|item| !direct_media(&item.source)) {
            cache_put(&state.pool, &key, &serde_json::to_value(&items)?, 5).await?;
        }
        Ok::<_, AppError>((items, None))
    }
    .await;
    match result {
        Ok((items, verification_url)) => Ok(SearchResult {
            items,
            stale: false,
            warning: None,
            verification_required: verification_url.is_some(),
            verification_url,
        }),
        Err(error) => match old {
            Some((v, _)) => Ok(SearchResult {
                items: serde_json::from_value(v)?,
                stale: true,
                warning: Some(error.to_string()),
                verification_required: false,
                verification_url: None,
            }),
            None => Err(error),
        },
    }
}
pub(crate) async fn chapters(
    pool: &SqlitePool,
    plugin_id: &str,
    source: &str,
    fresh: bool,
) -> AppResult<ChapterResult> {
    let rule = definition(pool, plugin_id).await?;
    if source.is_empty() || source.len() > 16384 {
        return Err(AppError::Validation("规则作品入口无效".into()));
    }
    let key = format!("chapters:{plugin_id}:{}:{source}", rule_key(&rule));
    let volatile = volatile_chapters().lock().unwrap().get(&key).cloned();
    let old = if let Some((time, roads)) = &volatile {
        Some((
            serde_json::to_value(roads)?,
            time.elapsed() < Wait::from_secs(300),
        ))
    } else {
        cache_get(pool, &key).await?
    };
    if !fresh {
        if let Some((v, true)) = &old {
            return Ok(ChapterResult {
                roads: serde_json::from_value(v.clone())?,
                stale: false,
                warning: None,
                verification_required: false,
                verification_url: None,
            });
        }
    }
    let result = async {
        let (raw, url) = request(&rule, "chapters", source).await?;
        if raw == "__GENZO_VERIFICATION__" {
            return Ok((vec![], Some(url)));
        }
        let mut roads = if field(&rule, "chapterMode") == "api" {
            api_roads(&serde_json::from_str(&raw)?, &rule, source)?
        } else {
            let v = parse_html(&rule, &raw, "chapters").await?;
            if v["verificationRequired"] == true {
                return Ok((vec![], Some(url)));
            }
            serde_json::from_value::<Vec<Road>>(v["roads"].clone())?
        };
        for road in &mut roads {
            road.episodes = std::mem::take(&mut road.episodes)
                .into_iter()
                .filter_map(|mut episode| {
                    episode.url = absolute(&field(&rule, "baseURL"), &episode.url).ok()?;
                    Some(episode)
                })
                .collect();
        }
        roads.retain(|road| !road.episodes.is_empty());
        if roads.is_empty()
            && old
                .as_ref()
                .is_some_and(|(v, _)| v.as_array().is_some_and(|a| !a.is_empty()))
        {
            return Err(AppError::Network(
                "来源暂未返回剧集，正在保留已有选集".into(),
            ));
        }
        if roads
            .iter()
            .flat_map(|road| &road.episodes)
            .any(|episode| transient_episode(&rule, &episode.url))
        {
            let mut memory = volatile_chapters().lock().unwrap();
            memory.retain(|_, (time, _)| time.elapsed() < Wait::from_secs(600));
            if memory.len() >= 64 {
                if let Some(key) = memory.keys().next().cloned() {
                    memory.remove(&key);
                }
            }
            memory.insert(key.clone(), (std::time::Instant::now(), roads.clone()));
        } else {
            cache_put(pool, &key, &serde_json::to_value(&roads)?, 30).await?;
        }
        Ok::<_, AppError>((roads, None))
    }
    .await;
    match result {
        Ok((roads, verification_url)) => Ok(ChapterResult {
            roads,
            stale: false,
            warning: None,
            verification_required: verification_url.is_some(),
            verification_url,
        }),
        Err(error) => match old {
            Some((v, _)) => Ok(ChapterResult {
                roads: serde_json::from_value(v)?,
                stale: true,
                warning: Some(error.to_string()),
                verification_required: false,
                verification_url: None,
            }),
            None => Err(error),
        },
    }
}
#[tauri::command]
pub async fn get_rule_chapters(
    plugin_id: String,
    source: String,
    fresh: bool,
    state: State<'_, AppState>,
) -> AppResult<ChapterResult> {
    chapters(&state.pool, &plugin_id, &source, fresh).await
}
#[tauri::command]
pub async fn verify_rule_source(
    plugin_id: String,
    keyword: String,
    url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let rule = definition(&state.pool, &plugin_id).await?;
    let search_url = field(&rule, "searchURL").replace(
        "@keyword",
        &percent_encoding::utf8_percent_encode(&keyword, percent_encoding::NON_ALPHANUMERIC)
            .to_string(),
    );
    let search_url = if search_url.is_empty() {
        field(&rule, "baseURL")
    } else {
        search_url
    };
    let search_url = http_url(&search_url)?;
    let mut url = match url {
        Some(url) => http_url(&absolute(&field(&rule, "baseURL"), &url)?)?,
        None => search_url.clone(),
    };
    let post = flag(&rule, "usePost")
        && url.origin() == search_url.origin()
        && url.path() == search_url.path();
    let body = if post {
        search_url.query().unwrap_or_default().to_string()
    } else {
        String::new()
    };
    if post {
        url.set_query(None);
    }
    crate::android_bridge::call("verifyRuleSource",json!({"url":url.as_str(),"rule":rule["antiCrawlerConfig"].to_string(),"method":if post{"POST"}else{"GET"},"body":body})).await?;
    Ok(())
}
#[tauri::command]
pub async fn cancel_rule_resolve() -> AppResult<()> {
    let operation = begin_resolve();
    crate::android_bridge::call("cancelRuleVideo", json!({"resolveOperation":operation})).await?;
    Ok(())
}

#[tauri::command]
pub async fn preview_rule_episode(
    plugin_id: String,
    source: String,
    road_index: usize,
    episode_index: usize,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    preview_selection(state.inner().clone(), plugin_id, source, road_index, episode_index).await
}

pub(crate) async fn preview_selection(state: AppState, plugin_id: String, source: String, road_index: usize, episode_index: usize) -> AppResult<Value> {
    let (loading, opening) = crate::android_player::start_rule_loading(&state, None).await?;
    crate::android_player_page::preview_origin(&loading.id, &plugin_id, &source, road_index, episode_index);
    tauri::async_runtime::spawn(async move {
        let result = async {
            crate::android_player::rule_loading_phase(&loading, "正在获取剧集信息…", false).await?;
            let rule = definition(&state.pool, &plugin_id).await?;
            let data = chapters(&state.pool, &plugin_id, &source, false).await?;
            crate::android_player::rule_loading_phase(&loading, "正在解析播放地址…", false).await?;
            let episode = data
                .roads
                .get(road_index)
                .and_then(|road| road.episodes.get(episode_index))
                .ok_or_else(|| AppError::Validation("请选择有效线路与剧集".into()))?;
            let stream =
                crate::rule_stream::for_page(&rule, &episode.url, loading.operation).await?;
            crate::android_player::preview_stream(&state, stream, plugin_id, &loading).await
        }
        .await;
        if let Err(error) = result {
            crate::android_player::rule_loading_failed(&loading, &error).await;
        }
    });
    Ok(opening)
}

/// Keep same-site page identities relative to the rule base, so an explicit
/// rule domain update preserves existing media IDs and viewing positions.
pub(crate) fn page_key(base: &str, page: &str) -> AppResult<String> {
    let base = http_url(base)?;
    let url = http_url(&absolute(base.as_str(), page)?)?;
    if base.origin() == url.origin() {
        Ok(format!(
            "{}{}{}",
            url.path(),
            url.query().map(|v| format!("?{v}")).unwrap_or_default(),
            url.fragment().map(|v| format!("#{v}")).unwrap_or_default()
        ))
    } else {
        Ok(url.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Live public repository probe; run explicitly before release"]
    async fn live_rules_repository_download_and_reinstall_preserve_identity() {
        let pool = db::test_pool().await.unwrap();
        let index = crate::rules_network::fetch(&pool, &format!("{REPOSITORY}index.json"), crate::rules_network::Document::Catalog).await.unwrap();
        assert_eq!(index.source, crate::rules_network::Source::Mirror);
        let name = index.data[0]["name"].as_str().unwrap();
        let origin = format!("{REPOSITORY}{name}.json");
        let first = crate::rules_network::fetch(&pool, &origin, crate::rules_network::Document::Rule).await.unwrap();
        assert_eq!(first.source, crate::rules_network::Source::Mirror);
        let id = install(&pool, first.data, Some(origin.clone())).await.unwrap();
        sqlx::query("UPDATE library_roots SET enabled=0 WHERE id=?").bind(&id).execute(&pool).await.unwrap();
        let next = crate::rules_network::fetch(&pool, &origin, crate::rules_network::Document::Rule).await.unwrap();
        assert_eq!(install(&pool, next.data, Some(origin.clone())).await.unwrap(), id);
        let stored: (String, bool) = sqlx::query_as("SELECT p.origin,r.enabled FROM rule_plugins p JOIN library_roots r ON r.id=p.id WHERE p.id=?").bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(stored, (origin, false));
    }
    #[tokio::test]
    async fn late_catalog_reply_cannot_overwrite_cache_after_connection_change() {
        let pool = db::test_pool().await.unwrap();
        let old_revision = catalog_revision(&pool).await.unwrap();
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('rules.network','{\"mode\":\"direct\"}','new-setting')").execute(&pool).await.unwrap();
        let current = json!([{"name":"QA","version":"2"}]);
        cache_catalog(&pool, &current, &catalog_revision(&pool).await.unwrap()).await.unwrap();
        cache_catalog(&pool, &json!([{"name":"QA","version":"1"}]), &old_revision).await.unwrap();
        assert_eq!(cache_get(&pool, "catalog").await.unwrap().unwrap().0, current);
    }
    #[tokio::test]
    async fn repository_failure_keeps_existing_catalog_and_first_use_reports_error() {
        let pool = db::test_pool().await.unwrap();
        let previous = json!([{"name":"QA","version":"1"}]);
        cache_put(&pool, "catalog", &previous, 60).await.unwrap();
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('rules.network','{\"mode\":\"invalid\"}','now')").execute(&pool).await.unwrap();
        let cached = catalog(&pool, true).await.unwrap();
        assert_eq!(cached["items"], previous); assert_eq!(cached["stale"], true); assert_eq!(cached["source"], "cache");
        assert!(cached["warning"].as_str().unwrap().contains("本地缓存"));
        assert_eq!(catalog(&pool, false).await.unwrap()["stale"], false);
        sqlx::query("DELETE FROM metadata_cache WHERE provider='kazumi' AND cache_key='catalog'").execute(&pool).await.unwrap();
        assert!(catalog(&pool, true).await.is_err());
    }
    #[tokio::test]
    async fn captcha_regex_matches_kazumi_case_insensitive_multiline_detection() {
        let rule = json!({"antiCrawlerConfig":{"enabled":true,"captchaDetectType":3,"captchaDetectValue":"verify.*captcha"}});
        assert_eq!(
            parse_html(&rule, "VERIFY\nCAPTCHA", "search")
                .await
                .unwrap()["verificationRequired"],
            true
        );
    }
    fn rule(base: &str) -> Value {
        json!({"api":"8","name":"QA","version":"1","baseURL":base,"searchMode":"api","chapterMode":"api","searchApiConfig":{"request":{"url":format!("{base}search")}},"chapterApiConfig":{"request":{"url":format!("{base}detail/@source")}}})
    }
    #[tokio::test]
    async fn installation_updates_preserve_ids_preferences_media_and_records() {
        let pool = db::test_pool().await.unwrap();
        let id = install(
            &pool,
            rule("https://first.example.org/"),
            Some("https://example.org/rule.json".into()),
        )
        .await
        .unwrap();
        sqlx::query("UPDATE library_roots SET enabled=0 WHERE id=?")
            .bind(&id)
            .execute(&pool)
            .await
            .unwrap();
        let mut updated = rule("https://new.example.org/");
        updated["api"] = json!("9");
        updated["version"] = json!("2");
        let next = install(&pool, updated, None).await.unwrap();
        assert_eq!(next, id);
        let enabled: bool = sqlx::query_scalar("SELECT enabled FROM library_roots WHERE id=?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(!enabled);
        assert_eq!(
            page_key(
                "https://first.example.org/",
                "https://first.example.org/p/13?line=a#part"
            )
            .unwrap(),
            "/p/13?line=a#part"
        );
        assert_eq!(
            absolute("https://new.example.org/", "/p/13?line=a#part").unwrap(),
            "https://new.example.org/p/13?line=a#part"
        );
        assert!(definition(&pool, &id).await.is_err());
    }
    #[tokio::test]
    async fn api_request_encodes_keywords_and_retains_json_body_types() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            loop {
                let mut byte = [0];
                socket.read_exact(&mut byte).await.unwrap();
                header.push(byte[0]);
                if header.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let header = String::from_utf8(header).unwrap();
            let length: usize = header
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                .unwrap()
                .1
                .trim()
                .parse()
                .unwrap();
            let mut bytes = vec![0; length];
            socket.read_exact(&mut bytes).await.unwrap();
            let raw = format!("{header}{}", String::from_utf8(bytes).unwrap());
            assert!(raw.starts_with("POST /search "));
            let lower = raw.to_lowercase();
            assert_eq!(lower.matches("referer:").count(), 1);
            assert!(lower.contains("referer: https://custom.example.org/"));
            assert_eq!(lower.matches("user-agent:").count(), 1);
            assert!(lower.contains("user-agent: qa-custom"));
            assert!(raw
                .to_lowercase()
                .contains("content-type: application/json"));
            assert!(raw.contains("\"enabled\":true"));
            assert!(raw.contains("你 / +"));
            let body = "{\"data\":[]}";
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let r = json!({"baseURL":format!("http://{address}/"),"searchMode":"api","searchApiConfig":{"request":{"url":format!("http://{address}/search"),"method":"post","headers":{"Referer":"https://custom.example.org/","User-Agent":"qa-custom"},"bodyType":"json","body":{"q":"@keyword","enabled":true}}}});
        let (body, _) = request(&r, "search", "你 / +").await.unwrap();
        assert!(body.contains("data"));
        task.await.unwrap();
    }
}
