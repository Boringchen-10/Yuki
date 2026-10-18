//! Device-local transport for rule repository JSON only. Site/media requests
//! and user-defined rule URLs never inherit the repository mirror.
use crate::{db::AppState, error::{AppError, AppResult}, rule_format, rule_sources};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::{sync::OnceLock, time::{Duration, Instant}};

pub const MIRROR: &str = "https://raw.gitcode.com/gh_mirrors/ka/KazumiRules/raw/main/";
pub(crate) const KEY: &str = "rules.network";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RulesNetwork { pub mode: String }
impl Default for RulesNetwork {
    fn default() -> Self { Self { mode: "auto".into() } }
}
impl RulesNetwork {
    fn validate(&self) -> AppResult<()> {
        if !matches!(self.mode.as_str(), "auto" | "direct") {
            return Err(AppError::Validation("请选择镜像优先或官方直连".into()));
        }
        Ok(())
    }
}
pub async fn load(pool: &SqlitePool) -> AppResult<RulesNetwork> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(KEY).fetch_optional(pool).await?;
    let config: RulesNetwork = match raw { Some(raw) => serde_json::from_str(&raw)?, None => RulesNetwork::default() };
    config.validate()?; Ok(config)
}
async fn save(pool: &SqlitePool, config: RulesNetwork) -> AppResult<RulesNetwork> {
    config.validate()?;
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(KEY).bind(serde_json::to_string(&config)?).bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await?;
    // Keep the previous catalog available when both transports are offline.
    sqlx::query("UPDATE metadata_cache SET expires_at='1970-01-01' WHERE provider='kazumi' AND cache_key='catalog'").execute(&mut *tx).await?;
    tx.commit().await?; Ok(config)
}
pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 80 && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
}
pub(crate) fn canonical_origin(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    if url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() { return None; }
    for base in [rule_sources::REPOSITORY, MIRROR] {
        if let Some(file) = url.as_str().strip_prefix(base) {
            if file.strip_suffix(".json").is_some_and(valid_name) {
                return Some(format!("{}{file}", rule_sources::REPOSITORY));
            }
        }
    }
    None
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source { Mirror, Official, Custom }
impl Source {
    fn label(self) -> &'static str { match self { Self::Mirror => "规则镜像", Self::Official => "官方仓库", Self::Custom => "自定义来源" } }
}
fn targets(config: &RulesNetwork, url: &str) -> Vec<(Source, String)> {
    let Some(canonical) = canonical_origin(url) else { return vec![(Source::Custom, url.into())]; };
    let mut result = vec![];
    if config.mode == "auto" { result.push((Source::Mirror, canonical.replacen(rule_sources::REPOSITORY, MIRROR, 1))); }
    result.push((Source::Official, canonical)); result
}
fn client() -> AppResult<Client> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() { return Ok(client.clone()); }
    let client = Client::builder().connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3)).user_agent("Yuki rule repository").build()
        .map_err(|_| AppError::Network("无法初始化规则仓库连接".into()))?;
    let _ = CLIENT.set(client.clone()); Ok(client)
}
#[derive(Clone, Copy)]
pub enum Document { Catalog, Rule }
fn validate(data: &Value, kind: Document) -> AppResult<()> {
    match kind {
        Document::Rule => rule_format::validate(data),
        Document::Catalog => {
            let valid = data.as_array().is_some_and(|items| items.len() <= 500 && items.iter().all(|item|
                item["name"].as_str().is_some_and(valid_name) && item["version"].as_str().is_some_and(|v| v.len() <= 64)));
            if valid { Ok(()) } else { Err(AppError::Validation("规则仓库目录格式无效".into())) }
        }
    }
}
pub struct RepositoryJson { pub data: Value, pub source: Source, pub fallback: bool }
async fn fetch_targets(client: &Client, urls: Vec<(Source, String)>, kind: Document) -> AppResult<RepositoryJson> {
    let mut errors = Vec::new();
    for (source, url) in urls {
        let result = async {
            let response = client.get(url).send().await.map_err(|_| AppError::Network("连接失败或超时".into()))?;
            let raw = rule_sources::body(response).await?;
            let data: Value = serde_json::from_str(&raw).map_err(|_| AppError::Validation("返回内容不是有效规则 JSON".into()))?;
            validate(&data, kind)?; Ok::<_, AppError>(data)
        }.await;
        match result {
            Ok(data) => return Ok(RepositoryJson { data, source, fallback: !errors.is_empty() }),
            Err(error) => errors.push(format!("{}：{error}", source.label())),
        }
    }
    Err(AppError::Network(format!("规则仓库暂不可用。{}。请测试连接或稍后重试。", errors.join("；"))))
}
pub async fn fetch(pool: &SqlitePool, url: &str, kind: Document) -> AppResult<RepositoryJson> {
    let (config, client) = if canonical_origin(url).is_some() { (load(pool).await?, client()?) }
        else { (RulesNetwork::default(), rule_sources::client()?) };
    fetch_targets(&client, targets(&config, url), kind).await
}
#[derive(Serialize)]
pub struct Probe { source: Source, milliseconds: u128, error: Option<String> }
async fn probe(source: Source, url: String) -> Probe {
    let started = Instant::now();
    let result = async { fetch_targets(&client()?, vec![(source, url)], Document::Catalog).await }.await;
    Probe { source, milliseconds: started.elapsed().as_millis(), error: result.err().map(|e| e.to_string()) }
}
#[tauri::command]
pub async fn get_rules_network(state: tauri::State<'_, AppState>) -> AppResult<RulesNetwork> { load(&state.pool).await }
#[tauri::command]
pub async fn save_rules_network(config: RulesNetwork, state: tauri::State<'_, AppState>) -> AppResult<RulesNetwork> { save(&state.pool, config).await }
#[tauri::command]
pub async fn probe_rules_network(state: tauri::State<'_, AppState>) -> AppResult<Vec<Probe>> {
    let config = load(&state.pool).await?;
    let official = format!("{}index.json", rule_sources::REPOSITORY);
    if config.mode == "direct" { return Ok(vec![probe(Source::Official, official).await]); }
    let (mirror, official) = tokio::join!(probe(Source::Mirror, format!("{MIRROR}index.json")), probe(Source::Official, official));
    Ok(vec![mirror, official])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

    async fn server(responses: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let paths = Arc::new(Mutex::new(Vec::new())); let requests = paths.clone();
        let task = tokio::spawn(async move {
            for (status, body) in responses {
                let (mut socket, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept()).await.unwrap().unwrap();
                let mut raw = vec![];
                while !raw.windows(4).any(|part| part == b"\r\n\r\n") {
                    let mut buf = [0; 1024]; let count = socket.read(&mut buf).await.unwrap();
                    if count == 0 { break; } raw.extend_from_slice(&buf[..count]);
                }
                requests.lock().unwrap().push(String::from_utf8_lossy(&raw).split_whitespace().nth(1).unwrap().to_string());
                socket.write_all(format!("HTTP/1.1 {status} Result\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        (base, paths, task)
    }
    fn test_client() -> Client { Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap() }
    fn rule() -> Value {
        json!({"api":"8","name":"QA","version":"1","baseURL":"https://example.org/","searchMode":"xpath","searchURL":"https://example.org/?q=@keyword","searchList":"//a","searchName":".","searchResult":"@href","chapterMode":"xpath","chapterRoads":"//ul","chapterResult":".//a"})
    }
    #[test]
    fn repository_urls_follow_mode_without_rewriting_custom_sites_or_query_urls() {
        let official = format!("{}QA.json", rule_sources::REPOSITORY);
        let mirror = format!("{MIRROR}QA.json");
        assert_eq!(targets(&RulesNetwork::default(), &official), vec![(Source::Mirror, mirror.clone()), (Source::Official, official.clone())]);
        assert_eq!(targets(&RulesNetwork { mode: "direct".into() }, &mirror), vec![(Source::Official, official.clone())]);
        assert_eq!(canonical_origin(&mirror), Some(official));
        for url in ["https://example.org/rule.json", "https://raw.githubusercontent.com/Other/Rules/main/a.json", "https://raw.githubusercontent.com/Predidit/KazumiRules/main/a.json?token=fixture", "https://raw.githubusercontent.com/Predidit/KazumiRules/main/sub/a.json"] {
            assert_eq!(targets(&RulesNetwork::default(), url), vec![(Source::Custom, url.into())]);
        }
    }
    #[tokio::test]
    async fn successful_mirror_does_not_contact_official() {
        let data = json!([{"name":"QA","version":"1"}]);
        let (base, paths, server) = server(vec![(200, data.to_string())]).await;
        let result = fetch_targets(&test_client(), vec![(Source::Mirror, format!("{base}/mirror/index.json")), (Source::Official, format!("{base}/official/index.json"))], Document::Catalog).await.unwrap();
        assert_eq!(result.data, data); assert_eq!(result.source, Source::Mirror); assert!(!result.fallback);
        server.await.unwrap(); assert_eq!(*paths.lock().unwrap(), vec!["/mirror/index.json"]);
    }
    #[tokio::test]
    async fn http_failure_falls_back_to_official() {
        let data = json!([{"name":"QA","version":"1"}]);
        let (base, paths, server) = server(vec![(503, "offline".into()), (200, data.to_string())]).await;
        let result = fetch_targets(&test_client(), vec![(Source::Mirror, format!("{base}/mirror/index.json")), (Source::Official, format!("{base}/official/index.json"))], Document::Catalog).await.unwrap();
        assert_eq!(result.source, Source::Official); assert!(result.fallback); assert_eq!(result.data, data);
        server.await.unwrap(); assert_eq!(paths.lock().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn unresponsive_mirror_times_out_and_uses_official() {
        let blackhole = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (base, _, server) = server(vec![(200, json!([]).to_string())]).await;
        let client = Client::builder().no_proxy().timeout(Duration::from_millis(200)).build().unwrap();
        let result = fetch_targets(&client, vec![(Source::Mirror, format!("http://{}/index.json", blackhole.local_addr().unwrap())), (Source::Official, format!("{base}/index.json"))], Document::Catalog).await.unwrap();
        assert_eq!(result.source, Source::Official); assert!(result.fallback); server.await.unwrap();
    }
    #[tokio::test]
    async fn malformed_catalog_does_not_block_a_valid_official_index() {
        for invalid in [json!({"message":"missing"}), json!([{"name":"../unsafe","version":"1"}])] {
            let (base, _, server) = server(vec![(200, invalid.to_string()), (200, json!([]).to_string())]).await;
            let result = fetch_targets(&test_client(), vec![(Source::Mirror, format!("{base}/mirror/index.json")), (Source::Official, format!("{base}/official/index.json"))], Document::Catalog).await.unwrap();
            assert_eq!(result.source, Source::Official); assert!(result.fallback); server.await.unwrap();
        }
    }
    #[tokio::test]
    async fn invalid_json_and_invalid_rule_payloads_fall_back_before_installation() {
        let future = { let mut value = rule(); value["api"] = json!(999); value.to_string() };
        for invalid in ["<html>captcha</html>".to_string(), json!({"message":"missing"}).to_string(), future] {
            let data = rule(); let (base, _, server) = server(vec![(200, invalid), (200, data.to_string())]).await;
            let result = fetch_targets(&test_client(), vec![(Source::Mirror, format!("{base}/mirror/QA.json")), (Source::Official, format!("{base}/official/QA.json"))], Document::Rule).await.unwrap();
            assert_eq!(result.data, data); assert_eq!(result.source, Source::Official); assert!(result.fallback);
            server.await.unwrap();
        }
    }
    #[tokio::test]
    async fn unavailable_sources_return_diagnostics_without_exposing_urls() {
        let (base, _, server) = server(vec![(403, "blocked".into()), (502, "offline".into())]).await;
        let error = fetch_targets(&test_client(), vec![(Source::Mirror, format!("{base}/mirror/index.json")), (Source::Official, format!("{base}/official/index.json"))], Document::Catalog).await.err().unwrap().to_string();
        assert!(error.contains("规则镜像") && error.contains("官方仓库")); assert!(!error.contains(&base)); server.await.unwrap();
    }
    #[tokio::test]
    async fn settings_preserve_cached_catalog_and_other_device_preferences() {
        let pool = crate::db::test_pool().await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), RulesNetwork::default());
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('theme','dark','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('kazumi','catalog','[]','now','9999'),('kazumi','search-fixture','[]','now','9999')").execute(&pool).await.unwrap();
        save(&pool, RulesNetwork { mode: "direct".into() }).await.unwrap();
        assert_eq!(load(&pool).await.unwrap().mode, "direct");
        assert!(save(&pool, RulesNetwork { mode: "unknown".into() }).await.is_err());
        assert_eq!(load(&pool).await.unwrap().mode, "direct");
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key='theme'").fetch_one(&pool).await.unwrap(), "dark");
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT response_json FROM metadata_cache WHERE cache_key='catalog'").fetch_one(&pool).await.unwrap(), "[]");
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT expires_at FROM metadata_cache WHERE cache_key='search-fixture'").fetch_one(&pool).await.unwrap(), "9999");
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT expires_at FROM metadata_cache WHERE cache_key='catalog'").fetch_one(&pool).await.unwrap(), "1970-01-01");
    }
}
