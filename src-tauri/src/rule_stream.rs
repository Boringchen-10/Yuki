//! Bounded, session-only MP4/HLS forwarding. Rule headers and browser cookies
//! reach every playlist/segment/key request without exposing them to React.
use crate::{
    db::AppState,
    error::{AppError, AppResult},
    remote_transfer::{AndroidStream, StreamFailure},
    rule_format::*,
    rule_sources,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinSet,
};

struct Proxy {
    client: reqwest::Client,
    token: String,
    origin: String,
    resources: Mutex<HashMap<String, String>>,
    user_agent: String,
    referer: String,
    filter: bool,
    failure: StreamFailure,
}
pub(crate) async fn for_page(rule: &Value, page: &str, operation: u64) -> AppResult<AndroidStream> {
    rule_sources::check_resolve(operation)?;
    let page = absolute(&field(rule, "baseURL"), page)?;
    let resolved = if rule_sources::direct_media(&page) || rule["useWebview"] == false {
        json!({"url":page,"referer":field(rule,"baseURL")})
    } else {
        let value = crate::android_bridge::call(
            "resolveRuleVideo",
            json!({"url":page,"legacy":flag(rule,"useLegacyParser"),"resolveOperation":operation}),
        )
        .await?;
        if let Some(error) = value["error"].as_str() {
            return Err(AppError::Network(error.into()));
        }
        value
    };
    let url = field(&resolved, "url");
    http_url(&url)?;
    let env = rule_sources::environment(&url).await?;
    rule_sources::check_resolve(operation)?;
    let user_agent = if field(rule, "userAgent").is_empty() {
        field(&env, "userAgent")
    } else {
        field(rule, "userAgent")
    };
    // Kazumi only sends a media Referer explicitly configured by the rule.
    // Reusing an iframe/page Referer can make an otherwise valid CDN URL fail.
    let referer = field(rule, "referer");
    start(url, user_agent, referer, flag(rule, "adBlocker")).await
}
pub(crate) async fn for_media(
    state: &AppState,
    id: &str,
    operation: u64,
) -> AppResult<AndroidStream> {
    let (plugin, source, page): (String, String, String) = sqlx::query_as(
        "SELECT plugin_id,source_key,page_url FROM rule_episodes WHERE media_file_id=?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("规则剧集入口不存在".into()))?;
    let rule = rule_sources::definition(&state.pool, &plugin).await?;
    let address = if page.starts_with("catalog:") {
        let chapters = rule_sources::chapters(&state.pool, &plugin, &source, true).await?;
        let mut address = None;
        for road in &chapters.roads {
            for (index, episode) in road.episodes.iter().enumerate() {
                if rule_sources::episode_key(&rule, &source, road, index)? == page {
                    address = Some(episode.url.clone());
                    break;
                }
            }
        }
        address.ok_or_else(|| {
            AppError::Validation("来源选集已变化，请在作品详情重新核对规则来源".into())
        })?
    } else {
        page
    };
    for_page(&rule, &address, operation).await
}
async fn start(
    url: String,
    user_agent: String,
    referer: String,
    filter: bool,
) -> AppResult<AndroidStream> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let token = uuid::Uuid::new_v4().to_string();
    let failure = Arc::new(Mutex::new(None));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .gzip(false)
        .build()
        .map_err(|_| AppError::Network("无法准备视频连接".into()))?;
    let proxy = Arc::new(Proxy {
        client,
        token: token.clone(),
        origin: format!("http://{address}"),
        resources: Mutex::new(HashMap::new()),
        user_agent,
        referer,
        filter,
        failure: failure.clone(),
    });
    let uri = resource(&proxy, &url)?;
    let task = tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(12 * 3600);
        let mut children = JoinSet::new();
        loop {
            tokio::select! {
                result=tokio::time::timeout_at(deadline,listener.accept())=>{let Ok(Ok((socket,_)))=result else{break;};if children.len()>=12{continue;}let p=proxy.clone();children.spawn(async move{let _=serve(socket,&p).await;});}
                _=children.join_next(),if !children.is_empty()=>{}
            }
        }
    });
    Ok(AndroidStream {
        uri,
        failure: Some(failure),
        abort: task.abort_handle(),
    })
}
fn resource(proxy: &Proxy, url: &str) -> AppResult<String> {
    let parsed = http_url(url)?;
    let key = format!("{:x}", sha2::Sha256::digest(parsed.as_str().as_bytes()));
    let extension = if parsed.path().to_ascii_lowercase().ends_with(".m3u8") {
        "m3u8"
    } else {
        "stream"
    };
    let key = format!("{key}.{extension}");
    let mut resources = proxy.resources.lock().unwrap();
    if resources.len() > 100000 {
        return Err(AppError::Validation("视频资源清单过大".into()));
    }
    resources.insert(key.clone(), url.into());
    Ok(format!("{}/{}/{}", proxy.origin, proxy.token, key))
}
use sha2::Digest;
fn rewrite(proxy: &Proxy, base: &str, text: &str) -> AppResult<String> {
    let filtered = if proxy.filter {
        filter_vod(text)
    } else {
        text.to_string()
    };
    let re = regex::Regex::new(r#"URI="([^"]+)""#).unwrap();
    let mut output = String::new();
    for line in filtered.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            output.push_str(&resource(proxy, &absolute(base, trimmed)?)?);
        } else {
            let mut previous = 0;
            for capture in re.captures_iter(line) {
                let whole = capture.get(0).unwrap();
                output.push_str(&line[previous..whole.start()]);
                let raw = &capture[1];
                let mapped = if raw.starts_with("data:") {
                    raw.into()
                } else {
                    resource(proxy, &absolute(base, raw)?)?
                };
                output.push_str(&format!("URI=\"{mapped}\""));
                previous = whole.end();
            }
            output.push_str(&line[previous..]);
        }
        output.push('\n');
    }
    Ok(output)
}
// Kazumi m3u8_ad_filter.dart (GPL-3.0, 2768c230): discontinuity groups.
// Keep encryption/byte ranges/maps/live playlists intact rather than alter IVs or offsets.
fn filter_vod(text: &str) -> String {
    if !text.contains("#EXT-X-ENDLIST")
        || [
            "#EXT-X-KEY",
            "#EXT-X-BYTERANGE",
            "#EXT-X-MAP",
            "#EXT-X-STREAM-INF",
            "#EXT-X-PART",
        ]
        .iter()
        .any(|tag| text.contains(tag))
    {
        return text.into();
    }
    let mut durations = HashMap::<usize, f64>::new();
    let (mut group, mut duration) = (0, 0.0);
    for line in text.lines() {
        let line = line.trim();
        if line == "#EXT-X-DISCONTINUITY" {
            group += 1;
        } else if let Some(v) = line.strip_prefix("#EXTINF:") {
            duration = v.split(',').next().unwrap_or("").parse().unwrap_or(0.0);
        } else if !line.is_empty() && !line.starts_with('#') {
            *durations.entry(group).or_default() += duration;
            duration = 0.0;
        }
    }
    let max = durations.values().copied().fold(0.0, f64::max);
    if durations.len() <= 1 || max <= 0.0 {
        return text.into();
    }
    let last = *durations.keys().max().unwrap();
    let ads: std::collections::HashSet<usize> = durations
        .iter()
        .filter(|(g, d)| {
            **d < max
                && (**d < max * 0.3 || ((**g == 0 || **g == last) && **d < 30.0) || **d < 10.0)
        })
        .map(|(g, _)| *g)
        .collect();
    if ads.is_empty() {
        return text.into();
    }
    let mut out = String::new();
    group = 0;
    let mut pending = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t == "#EXT-X-DISCONTINUITY" {
            group += 1;
            pending.push(line);
        } else if t.starts_with("#EXTINF:") || t.starts_with("#EXT-X-PROGRAM-DATE-TIME:") {
            pending.push(line);
        } else if !t.is_empty() && !t.starts_with('#') {
            if !ads.contains(&group) {
                for p in pending.drain(..) {
                    if p != "#EXT-X-DISCONTINUITY" || out.contains("#EXTINF:") {
                        out.push_str(p);
                        out.push('\n');
                    }
                }
                out.push_str(line);
                out.push('\n');
            } else {
                pending.clear();
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}
async fn empty(socket: &mut TcpStream, status: &str) -> AppResult<()> {
    socket
        .write_all(
            format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await?;
    Ok(())
}
async fn upstream(
    proxy: &Proxy,
    url: &str,
    head: bool,
    range: Option<&str>,
) -> AppResult<reqwest::Response> {
    let env = rule_sources::environment(url).await?;
    let mut request = if head {
        proxy.client.head(url)
    } else {
        proxy.client.get(url)
    };
    request = request.header(reqwest::header::USER_AGENT, &proxy.user_agent);
    if !proxy.referer.is_empty() {
        request = request.header(reqwest::header::REFERER, &proxy.referer);
    }
    let cookie = field(&env, "cookie");
    if !cookie.is_empty() {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    if let Some(range) = range {
        request = request.header(reqwest::header::RANGE, range);
    }
    tokio::time::timeout(Duration::from_secs(12), request.send())
        .await
        .map_err(|_| AppError::Network("视频连接超时".into()))?
        .map_err(|_| AppError::Network("视频来源连接失败".into()))
}
async fn serve(mut socket: TcpStream, proxy: &Proxy) -> AppResult<()> {
    let mut raw = Vec::new();
    loop {
        let mut byte = [0];
        if !matches!(
            tokio::time::timeout(Duration::from_secs(8), socket.read_exact(&mut byte)).await,
            Ok(Ok(_))
        ) {
            return Ok(());
        }
        raw.push(byte[0]);
        if raw.ends_with(b"\r\n\r\n") {
            break;
        }
        if raw.len() > 16384 {
            return empty(&mut socket, "431 Request Header Fields Too Large").await;
        }
    }
    let raw = String::from_utf8_lossy(&raw);
    let mut lines = raw.lines();
    let parts: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
    if parts.len() != 3 || !["GET", "HEAD"].contains(&parts[0]) {
        return empty(&mut socket, "404 Not Found").await;
    }
    let prefix = format!("/{}/", proxy.token);
    let Some(key) = parts[1].strip_prefix(&prefix) else {
        return empty(&mut socket, "404 Not Found").await;
    };
    let url = proxy.resources.lock().unwrap().get(key).cloned();
    let Some(url) = url else {
        return empty(&mut socket, "404 Not Found").await;
    };
    let headers: Vec<_> = lines.filter_map(|line| line.split_once(':')).collect();
    if headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("origin"))
    {
        return empty(&mut socket, "403 Forbidden").await;
    }
    let range = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim());
    if range.is_some_and(|v| {
        !regex::Regex::new(r"^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$")
            .unwrap()
            .is_match(v)
    }) {
        return empty(&mut socket, "416 Range Not Satisfiable").await;
    }
    let head = parts[0] == "HEAD";
    let mut response = match upstream(proxy, &url, head, range).await {
        Ok(v) => v,
        Err(error) => {
            *proxy.failure.lock().unwrap() =
                Some(json!({"code":"source_offline","message":error.to_string(),"retryable":true}));
            return empty(&mut socket, "502 Bad Gateway").await;
        }
    };
    if !response.status().is_success() {
        *proxy.failure.lock().unwrap() = Some(
            json!({"code":"source_offline","message":"视频来源不可用，请重新解析或切换线路","retryable":true}),
        );
        return empty(&mut socket, "502 Bad Gateway").await;
    }
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let playlist = kind.contains("mpegurl")
        || http_url(&url)?
            .path()
            .to_ascii_lowercase()
            .ends_with(".m3u8");
    if playlist && !head {
        if range.is_some() {
            response = upstream(proxy, &url, false, None).await?;
        }
        let base = response.url().to_string();
        let text = rule_sources::body(response).await?;
        if !text.trim_start().starts_with("#EXTM3U") {
            return empty(&mut socket, "502 Bad Gateway").await;
        }
        let body = rewrite(proxy, &base, &text)?;
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes()).await?;
        let _ = socket.write_all(body.as_bytes()).await;
        return Ok(());
    }
    let mut header = format!("HTTP/1.1 {}\r\nConnection: close\r\n", response.status());
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-encoding",
    ] {
        if let Some(v) = response.headers().get(name).and_then(|v| v.to_str().ok()) {
            header.push_str(&format!("{name}: {v}\r\n"));
        }
    }
    header.push_str("\r\n");
    if socket.write_all(header.as_bytes()).await.is_err() {
        return Ok(());
    }
    if head {
        return Ok(());
    }
    loop {
        match tokio::time::timeout(Duration::from_secs(30), response.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                if socket.write_all(&chunk).await.is_err() {
                    return Ok(());
                }
            }
            Ok(Ok(None)) => return Ok(()),
            _ => {
                *proxy.failure.lock().unwrap() = Some(
                    json!({"code":"source_offline","message":"视频连接中断，请重试","retryable":true}),
                );
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn omitted_rule_referer_does_not_leak_the_page_origin_to_media_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
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
            assert!(!String::from_utf8_lossy(&header)
                .to_lowercase()
                .contains("referer:"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest").await.unwrap();
        });
        let rule = json!({"baseURL":"https://page.example.org/","useWebview":false,"referer":""});
        let stream = for_page(
            &rule,
            &format!("http://{address}/video.mp4"),
            rule_sources::begin_resolve(),
        )
        .await
        .unwrap();
        assert_eq!(
            reqwest::get(&stream.uri)
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap()
                .as_ref(),
            b"test"
        );
        upstream.await.unwrap();
    }
    #[test]
    fn hls_rewrites_nested_playlists_maps_and_keys_and_keeps_encrypted_manifests() {
        let proxy = Proxy {
            client: reqwest::Client::new(),
            token: "private".into(),
            origin: "http://127.0.0.1:1".into(),
            resources: Mutex::new(HashMap::new()),
            user_agent: "qa".into(),
            referer: "https://site.example.org".into(),
            filter: true,
            failure: Arc::new(Mutex::new(None)),
        };
        let body="#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key?id=1\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n";
        let rewritten = rewrite(&proxy, "https://cdn.example.org/path/media.m3u8", body).unwrap();
        assert!(rewritten.contains("#EXT-X-DISCONTINUITY"));
        assert_eq!(rewritten.matches("http://127.0.0.1:1/private/").count(), 4);
        let values: Vec<_> = proxy.resources.lock().unwrap().values().cloned().collect();
        assert!(values.contains(&"https://cdn.example.org/key?id=1".to_string()));
        assert!(values.contains(&"https://cdn.example.org/path/a.ts".to_string()));
    }
    #[test]
    fn ad_filter_is_opt_in_vod_only_and_retains_original_content_when_unsafe() {
        let vod="#EXTM3U\n#EXTINF:2,\nad.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:100,\nmain.ts\n#EXT-X-ENDLIST\n";
        let filtered = filter_vod(vod);
        assert!(!filtered.contains("ad.ts"));
        assert!(filtered.contains("main.ts"));
        assert_eq!(
            filter_vod(&vod.replace("#EXT-X-ENDLIST", "")),
            vod.replace("#EXT-X-ENDLIST", "")
        );
        let encrypted = vod.replace("#EXTM3U", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"");
        assert_eq!(filter_vod(&encrypted), encrypted);
    }
    #[tokio::test]
    async fn mp4_range_forwarding_keeps_headers_and_rejects_untrusted_local_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            loop {
                let mut b = [0];
                socket.read_exact(&mut b).await.unwrap();
                header.push(b[0]);
                if header.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let raw = String::from_utf8_lossy(&header).to_lowercase();
            assert!(raw.contains("range: bytes=2-5"));
            assert!(raw.contains("referer: https://page.example.org/play"));
            assert!(raw.contains("user-agent: qa-player"));
            socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Range: bytes 2-5/8\r\nContent-Length: 4\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\ncdef").await.unwrap();
        });
        let stream = start(
            format!("http://{address}/video.mp4"),
            "qa-player".into(),
            "https://page.example.org/play".into(),
            false,
        )
        .await
        .unwrap();
        let client = reqwest::Client::new();
        let response = client
            .get(&stream.uri)
            .header("Range", "bytes=2-5")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], "bytes 2-5/8");
        assert_eq!(response.text().await.unwrap(), "cdef");
        upstream.await.unwrap();
        assert_eq!(
            client
                .get(&stream.uri)
                .header("Origin", "https://untrusted.example.org")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let bad = stream
            .uri
            .replace(stream.uri.split('/').nth(3).unwrap(), "wrong-token");
        assert_eq!(client.get(bad).send().await.unwrap().status(), 404);
    }
}
