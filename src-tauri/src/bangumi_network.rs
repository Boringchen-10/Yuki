//! Device-local public Bangumi transport. Account authorization is separate.
use crate::{db::AppState, error::{AppError, AppResult}};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{sync::Mutex, time::{Duration, Instant}};
use tauri::State;

const KEY: &str = "bangumi.network";
static TRANSPORT: Mutex<Option<(BangumiNetwork, Client)>> = Mutex::new(None);
static SETTINGS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ECH_TRANSPORT: Mutex<Option<EncryptedTransport>> = Mutex::new(None);
#[cfg(target_os="android")]
static ECH_REFRESH: Mutex<(bool, Option<Instant>)> = Mutex::new((false, None));

struct EncryptedTransport {
    config: BangumiNetwork,
    client: Client,
    expires_at: Instant,
}

impl EncryptedTransport {
    fn matches(&self, config: &BangumiNetwork) -> bool {
        &self.config == config && Instant::now() < self.expires_at
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BangumiNetwork {
    pub mode: String,
    pub mirror_url: String,
}

impl Default for BangumiNetwork {
    fn default() -> Self {
        Self { mode: "system".into(), mirror_url: String::new() }
    }
}

impl BangumiNetwork {
    pub fn normalized(mut self) -> AppResult<Self> {
        self.mirror_url = self.mirror_url.trim().trim_end_matches('/').to_string();
        if !matches!(self.mode.as_str(), "system" | "direct" | "mirror") {
            return Err(AppError::Validation("Bangumi 连接方式无效".into()));
        }
        if self.mode == "mirror" && self.mirror_url.is_empty() {
            return Err(AppError::Validation("请输入 Bangumi 镜像根地址".into()));
        }
        if !self.mirror_url.is_empty() {
            let url = reqwest::Url::parse(&self.mirror_url)
                .map_err(|_| AppError::Validation("镜像地址须为有效的 HTTPS 根地址".into()))?;
            let local_http = url.scheme() == "http"
                && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
            if (url.scheme() != "https" && !local_http)
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path().trim_end_matches('/').ends_with("/v0")
            {
                return Err(AppError::Validation("镜像请填写提供 /v0 和 /calendar 的根地址，不带账号、查询参数或 /v0 后缀；远程地址须使用 HTTPS".into()));
            }
            self.mirror_url = url.to_string().trim_end_matches('/').to_string();
        }
        Ok(self)
    }

    pub fn base_url(&self) -> &str {
        if self.mode == "mirror" { &self.mirror_url } else { "https://api.bgm.tv" }
    }

    pub fn source_label(&self) -> &'static str {
        if self.mode == "mirror" { "Bangumi 自定义镜像" } else { "Bangumi 官方 API" }
    }

    pub fn cache_key(&self, key: &str) -> String {
        if self.mode == "mirror" { format!("mirror:{}:{key}", self.mirror_url) } else { key.to_string() }
    }

    pub fn client(&self) -> AppResult<Client> {
        if let Some(transport) = ECH_TRANSPORT.lock().map_err(|_| AppError::System("Bangumi 加密连接不可用".into()))?.as_ref() {
            if transport.matches(self) { return Ok(transport.client.clone()); }
        }
        self.plain_client()
    }

    pub(crate) fn plain_client(&self) -> AppResult<Client> {
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(4))
            .user_agent(concat!("Genzo/", env!("CARGO_PKG_VERSION"), " (local media library)"))
            .redirect(reqwest::redirect::Policy::none());
        if self.mode != "system" { builder = builder.no_proxy(); }
        builder.build().map_err(|error| AppError::Network(format!("无法初始化 Bangumi 客户端：{error}")))
    }
}

pub fn current() -> BangumiNetwork {
    TRANSPORT.lock().expect("Bangumi transport lock")
        .as_ref().map(|(config, _)| config.clone()).unwrap_or_default()
}

pub fn transport() -> AppResult<(BangumiNetwork, Client)> {
    let mut state = TRANSPORT.lock().expect("Bangumi transport lock");
    if state.is_none() {
        let config = BangumiNetwork::default();
        let client = config.plain_client()?;
        *state = Some((config, client));
    }
    let (config,client) = state.as_ref().expect("initialized transport");
    let result = {
        let encrypted = ECH_TRANSPORT.lock().expect("Bangumi ECH transport lock");
        (config.clone(), encrypted.as_ref().filter(|stored| stored.matches(config))
            .map(|stored| stored.client.clone()).unwrap_or_else(|| client.clone()))
    };
    drop(state);
    #[cfg(target_os="android")]
    prepare_encrypted(result.0.clone());
    Ok(result)
}

pub(crate) fn invalidate_encrypted(config: &BangumiNetwork) {
    if &current() != config { return; }
    let mut encrypted = ECH_TRANSPORT.lock().expect("Bangumi ECH transport lock");
    if encrypted.as_ref().is_some_and(|stored| &stored.config == config) { *encrypted = None; }
    drop(encrypted);
    #[cfg(target_os="android")]
    {
        // Keep subsequent reads on ordinary TLS briefly instead of repeatedly selecting
        // the same unhealthy pinned route while the network is changing.
        ECH_REFRESH.lock().expect("Bangumi ECH refresh lock").1 = Some(Instant::now() + Duration::from_secs(60));
    }
}

/// Kazumi reference for the public Bangumi domains: authenticated DoH, Cloudflare ECH and
/// a small pinned address set. Certificate/hostname verification remains enabled.
#[cfg(any(target_os="android",test))]
async fn ech_client(config: &BangumiNetwork) -> AppResult<Client> {
    use base64::Engine;
    let mut bootstrap = Client::builder().timeout(Duration::from_secs(8)).connect_timeout(Duration::from_secs(4))
        .user_agent(concat!("Genzo/", env!("CARGO_PKG_VERSION")));
    if config.mode != "system" { bootstrap = bootstrap.no_proxy(); }
    let bootstrap = bootstrap.build()
        .map_err(|error|AppError::Network(error.to_string()))?;
    let records: serde_json::Value = bootstrap.get("https://dns.alidns.com/resolve")
        .query(&[("name","crypto.cloudflare.com"),("type","HTTPS")]).send().await
        .map_err(|error|AppError::Network(format!("Bangumi 安全 DNS 连接失败：{error}")))?
        .error_for_status().map_err(|error|AppError::Network(error.to_string()))?.json().await
        .map_err(|error|AppError::Network(error.to_string()))?;
    let encoded = records["Answer"].as_array().into_iter().flatten().filter(|record|record["type"] == 65)
        .filter_map(|record|record["data"].as_str()).find_map(|value|value.split("ech=\"").nth(1).and_then(|value|value.split('"').next()))
        .ok_or_else(||AppError::Network("安全 DNS 尚未提供 Bangumi 加密连接配置".into()))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|error|AppError::Network(error.to_string()))?;
    let ech = rustls::client::EchConfig::new(rustls::pki_types::EchConfigListBytes::from(bytes),rustls::crypto::aws_lc_rs::hpke::ALL_SUPPORTED_SUITES)
        .map_err(|error|AppError::Network(error.to_string()))?;
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_ech(ech.into()).map_err(|error|AppError::Network(error.to_string()))?.with_root_certificates(roots).with_no_client_auth();
    let addresses: Vec<std::net::SocketAddr> = ["172.67.134.140:443","104.21.6.61:443","172.67.73.67:443"].iter().map(|value|value.parse().expect("pinned public address")).collect();
    let mut builder = Client::builder().use_preconfigured_tls(tls).timeout(Duration::from_secs(12)).connect_timeout(Duration::from_secs(6))
        .user_agent(concat!("Genzo/",env!("CARGO_PKG_VERSION"))).redirect(reqwest::redirect::Policy::none());
    if config.mode != "system" { builder = builder.no_proxy(); }
    for host in ["api.bgm.tv","next.bgm.tv","lain.bgm.tv"] { builder = builder.resolve_to_addrs(host,&addresses); }
    builder.build().map_err(|error|AppError::Network(error.to_string()))
}

#[cfg(target_os="android")]
fn prepare_encrypted(config: BangumiNetwork) {
    if ECH_TRANSPORT.lock().expect("Bangumi ECH transport lock").as_ref().is_some_and(|stored| stored.matches(&config)) { return; }
    let mut refresh = ECH_REFRESH.lock().expect("Bangumi ECH refresh lock");
    if refresh.0 || refresh.1.is_some_and(|next| Instant::now() < next) { return; }
    refresh.0 = true;
    drop(refresh);
    tauri::async_runtime::spawn(async move {
        match ech_client(&config).await {
            Ok(client) => {
                // A completed preparation must not replace a newer connection setting.
                let mut refresh = ECH_REFRESH.lock().expect("Bangumi ECH refresh lock");
                if current() == config && !refresh.1.is_some_and(|next| Instant::now() < next) {
                    *ECH_TRANSPORT.lock().expect("Bangumi ECH transport lock") = Some(EncryptedTransport {
                        config, client, expires_at: Instant::now() + Duration::from_secs(30 * 60),
                    });
                }
                refresh.0 = false;
                if refresh.1.is_some_and(|next| Instant::now() >= next) { refresh.1 = None; }
            }
            Err(_) => {
                // A failed bootstrap should neither block reads nor start a DNS request per card.
                let mut refresh = ECH_REFRESH.lock().expect("Bangumi ECH refresh lock");
                refresh.0 = false;
                refresh.1 = Some(refresh.1.unwrap_or_else(Instant::now).max(Instant::now() + Duration::from_secs(30)));
            }
        }
    });
}

pub async fn load(pool: &SqlitePool) -> AppResult<BangumiNetwork> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?")
        .bind(KEY).fetch_optional(pool).await?;
    let config = match value {
        Some(value) => serde_json::from_str(&value)?,
        None => BangumiNetwork::default(),
    };
    config.normalized()
}

pub async fn initialize(pool: &SqlitePool) -> AppResult<()> {
    let config = load(pool).await?;
    let client = config.plain_client()?;
    *TRANSPORT.lock().expect("Bangumi transport lock") = Some((config.clone(), client));
    #[cfg(target_os="android")]
    prepare_encrypted(config);
    Ok(())
}

#[tauri::command]
pub async fn get_bangumi_network(state: State<'_, AppState>) -> AppResult<BangumiNetwork> {
    load(&state.pool).await
}

#[tauri::command]
pub async fn save_bangumi_network(config: BangumiNetwork, state: State<'_, AppState>) -> AppResult<()> {
    let _guard = SETTINGS_LOCK.lock().await;
    let config = config.normalized()?;
    let client = config.plain_client()?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(KEY).bind(serde_json::to_string(&config)?).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.pool).await?;
    *TRANSPORT.lock().expect("Bangumi transport lock") = Some((config.clone(), client));
    #[cfg(target_os="android")]
    prepare_encrypted(config);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BangumiProbe {
    pub name: String,
    pub milliseconds: Option<u128>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_bangumi_network(config: BangumiNetwork) -> AppResult<Vec<BangumiProbe>> {
    let config = config.normalized()?;
    let provider = crate::bangumi::BangumiProvider::configured(&config)?;
    let mut probes = vec![];
    for name in ["目录 / 搜索", "条目详情", "每周时间表", "作品吐槽 / 官网", "本集讨论 / 官网"] {
        let start = std::time::Instant::now();
        let result = match name {
            "目录 / 搜索" => provider.ranking(1, 0).await.map(|_| ()),
            "条目详情" => provider.get_details("326").await.map(|_| ()),
            "作品吐槽 / 官网" => provider.comments("400602", 0, 1).await.map(|_| ()),
            "本集讨论 / 官网" => provider.episode_comments("1212094").await.map(|_| ()),
            _ => provider.calendar_by_weekday().await.map(|_| ()),
        };
        probes.push(BangumiProbe {
            name: name.into(),
            milliseconds: result.as_ref().ok().map(|_| start.elapsed().as_millis()),
            error: result.err().map(|error| error.to_string()),
        });
    }
    Ok(probes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_transport_expires_and_never_crosses_connection_settings() {
        let config = BangumiNetwork { mode: "direct".into(), mirror_url: String::new() };
        let mut transport = EncryptedTransport { config: config.clone(), client: config.plain_client().unwrap(), expires_at: Instant::now() + Duration::from_secs(60) };
        assert!(transport.matches(&config));
        assert!(!transport.matches(&BangumiNetwork::default()));
        assert!(!transport.matches(&BangumiNetwork { mode: "mirror".into(), mirror_url: "https://example.com".into() }));
        transport.expires_at = Instant::now() - Duration::from_secs(1);
        assert!(!transport.matches(&config));
    }
    #[tokio::test]
    #[ignore = "explicit public Bangumi encrypted transport smoke test"]
    async fn live_bangumi_ech() {
        let config = BangumiNetwork {mode:"direct".into(),mirror_url:String::new()};
        let client = ech_client(&config).await.unwrap();
        let provider = crate::bangumi::BangumiProvider::with_transport(&config,client.clone());
        assert!(!provider.comments("400602",0,2).await.unwrap().items.is_empty());
        assert!(!provider.episodes("400602").await.unwrap().is_empty());
        let cover = client.get("https://lain.bgm.tv/pic/cover/l/d3/99/622288_nmbC3.jpg")
            .send().await.unwrap().error_for_status().unwrap().bytes().await.unwrap();
        assert!(image::load_from_memory(&cover).unwrap().width() > 80);
    }

    #[test]
    fn validates_modes_and_mirror_base_urls() {
        for mode in ["system", "direct"] {
            assert!(BangumiNetwork { mode: mode.into(), mirror_url: String::new() }.normalized().is_ok());
        }
        for value in ["", "http://example.com", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com/#fragment", "https://example.com/v0"] {
            assert!(BangumiNetwork { mode: "mirror".into(), mirror_url: value.into() }.normalized().is_err(), "{value}");
        }
        let config = BangumiNetwork { mode: "mirror".into(), mirror_url: " https://example.com/bangumi/ ".into() }.normalized().unwrap();
        assert_eq!(config.base_url(), "https://example.com/bangumi");
        assert_eq!(config.source_label(), "Bangumi 自定义镜像");
        assert!(BangumiNetwork { mode: "mirror".into(), mirror_url: "http://127.0.0.1:8080".into() }.normalized().is_ok());
    }

    #[tokio::test]
    async fn settings_remain_device_local_and_defaults_are_compatible() {
        let pool = crate::db::test_pool().await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), BangumiNetwork::default());
        let config = BangumiNetwork { mode: "mirror".into(), mirror_url: "https://example.com".into() };
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,'test')")
            .bind(KEY).bind(serde_json::to_string(&config).unwrap()).execute(&pool).await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), config);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM works").fetch_one(&pool).await.unwrap(), 0);
    }
}
