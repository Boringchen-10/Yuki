//! Images explicitly embedded in public Bangumi comments, separate from provider artwork.
use crate::{db::AppState, error::{AppError, AppResult}, models::BangumiComment};
use std::{net::IpAddr, path::{Path, PathBuf}, sync::{LazyLock, Mutex}, time::Duration};
use tauri::State;

static MARKUP: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)\[img(?:=[^\]]*)?\]\s*((?:https?:)?//[^\s\[\]]+)\s*\[/img\]").unwrap());
static SUBJECT_IMAGES: LazyLock<Mutex<lru::LruCache<String, ()>>> = LazyLock::new(|| Mutex::new(lru::LruCache::new(std::num::NonZeroUsize::new(2048).unwrap())));
static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
const MAX_BYTES: usize = 20 * 1024 * 1024;

pub(crate) fn image_urls(comment: &BangumiComment) -> Vec<String> {
    comment.user_avatar.iter().cloned().chain(MARKUP.captures_iter(&comment.comment).take(4).map(|cap| {
        let value = &cap[1];
        if value.starts_with("//") { format!("https:{value}") }
        else if value.get(..7).is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://")) { format!("https://{}", &value[7..]) }
        else { value.to_owned() }
    })).collect()
}

pub(crate) fn remember_subject_comments(comments: &[BangumiComment]) {
    let mut allowed = SUBJECT_IMAGES.lock().expect("Bangumi comment images lock");
    for comment in comments { for url in image_urls(comment) { allowed.put(url, ()); } }
}

#[tauri::command]
pub async fn cache_bangumi_comment_image(url: String, state: State<'_, AppState>) -> AppResult<String> {
    if !SUBJECT_IMAGES.lock().expect("Bangumi comment images lock").contains(&url) {
        return Err(AppError::Validation("图片不属于已读取的 Bangumi 评论".into()));
    }
    Ok(cache(&state, &url).await?.to_string_lossy().into_owned())
}

fn image_url(value: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(value).map_err(|_| AppError::Validation("评论图片地址无效".into()))?;
    if value.len() > 4096 || url.scheme() != "https" || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443)
        || url.fragment().is_some() {
        return Err(AppError::Validation("评论图片须使用公开 HTTPS 地址".into()));
    }
    if let Some(ip) = url.host_str().and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok()) {
        if !public_ip(ip) { return Err(AppError::Validation("评论图片不能访问本地地址".into())); }
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a,b,_,_] = ip.octets();
            !ip.is_private() && !ip.is_loopback() && !ip.is_link_local() && !ip.is_broadcast()
                && !ip.is_documentation() && !ip.is_multicast() && !ip.is_unspecified()
                && a != 0 && a < 240 && !(a == 100 && (64..=127).contains(&b)) && !(a == 198 && (18..=19).contains(&b))
        },
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() { return public_ip(IpAddr::V4(v4)); }
            let [a,b,_,_,_,_,_,_] = ip.segments();
            !ip.is_loopback() && !ip.is_unspecified() && !ip.is_multicast()
                && a & 0xfe00 != 0xfc00 && a & 0xffc0 != 0xfe80 && !(a == 0x2001 && b == 0xdb8)
                && a & 0xe000 == 0x2000
        },
    }
}

async fn response(mut url: reqwest::Url) -> AppResult<reqwest::Response> {
    for _ in 0..4 {
        let host = url.host_str().ok_or_else(|| AppError::Validation("评论图片地址无效".into()))?;
        let client = if matches!(host, "lain.bgm.tv" | "bgm.tv") {
            crate::bangumi_network::transport()?.1
        } else if matches!(host, "i.imgur.com" | "i.postimg.cc") {
            // These fixed public image CDNs also work with the user's system proxy / fake-IP DNS.
            reqwest::Client::builder().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(8))
                .user_agent(concat!("Genzo/", env!("CARGO_PKG_VERSION"))).redirect(reqwest::redirect::Policy::none())
                .build().map_err(|_| AppError::Network("评论图片连接初始化失败".into()))?
        } else {
            // Pin the checked DNS result so a second lookup cannot target local services.
            let addresses = tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, 443))).await
                .map_err(|_| AppError::Network("评论图片 DNS 请求超时".into()))?
                .map_err(|_| AppError::Network("评论图片域名解析失败".into()))?.collect::<Vec<_>>();
            if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
                return Err(AppError::Validation("评论图片不能访问本地地址".into()));
            }
            reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(8))
                .user_agent(concat!("Genzo/", env!("CARGO_PKG_VERSION"))).redirect(reqwest::redirect::Policy::none())
                .resolve_to_addrs(host, &addresses).build().map_err(|_| AppError::Network("评论图片连接初始化失败".into()))?
        };
        let result = client.get(url.clone()).header(reqwest::header::REFERER, "https://bgm.tv/").send().await
            .map_err(|_| AppError::Network("评论图片连接失败".into()))?;
        if result.status().is_redirection() {
            let next = result.headers().get(reqwest::header::LOCATION).and_then(|value| value.to_str().ok())
                .and_then(|value| url.join(value).ok()).ok_or_else(|| AppError::Network("评论图片跳转无效".into()))?;
            url = image_url(next.as_str())?;
        } else {
            return result.error_for_status().map_err(|_| AppError::Network("评论图片暂时不可用".into()));
        }
    }
    Err(AppError::Network("评论图片跳转次数过多".into()))
}

pub(crate) async fn cache(state: &AppState, value: &str) -> AppResult<PathBuf> {
    let url = image_url(value)?;
    let directory = state.cover_cache_path.join("comment-discussions");
    std::fs::create_dir_all(&directory)?;
    let target = crate::metadata_aggregator::artwork_cache_path(&directory, "bangumi-discussion", "comment", value);
    let _permit = SLOTS.acquire().await.map_err(|_| AppError::System("评论图片缓存不可用".into()))?;
    if !target.is_file() {
        let mut response = response(url).await?;
        if response.content_length().is_some_and(|size| size > MAX_BYTES as u64) { return Err(AppError::Validation("评论图片超过 20 MB".into())); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| AppError::Network("评论图片读取失败".into()))? {
            if bytes.len() + chunk.len() > MAX_BYTES { return Err(AppError::Validation("评论图片超过 20 MB".into())); }
            bytes.extend_from_slice(&chunk);
        }
        let destination = target.clone();
        tauri::async_runtime::spawn_blocking(move || crate::metadata_aggregator::decode_and_save_comment_image(&bytes, &destination)).await
            .map_err(|_| AppError::System("评论图片处理失败".into()))??;
    }
    trim(&directory, &target)?;
    Ok(target)
}

fn trim(directory: &Path, target: &Path) -> AppResult<()> {
    let mut files = std::fs::read_dir(directory)?.filter_map(Result::ok).filter_map(|entry| {
        let path = entry.path(); let metadata = std::fs::symlink_metadata(&path).ok()?;
        (metadata.file_type().is_file() && path.file_name()?.to_str()?.starts_with("art-v2-") && path.file_name()?.to_str()?.ends_with("-comment.jpg"))
            .then(|| (metadata.modified().unwrap_or(std::time::UNIX_EPOCH), metadata.len(), path))
    }).collect::<Vec<_>>();
    let mut total = files.iter().map(|(_,size,_)| size).sum::<u64>(); files.sort_by_key(|(time,_,_)| *time);
    for (_,size,path) in files { if total <= 64 * 1024 * 1024 { break; } if path != target && std::fs::remove_file(path).is_ok() { total = total.saturating_sub(size); } }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sent_images_accept_real_external_hosts_but_reject_local_and_credential_urls() {
        for value in ["https://i.imgur.com/GKb6x3l.png", "https://i.postimg.cc/MpnMkNR4/image.png", "https://lain.bgm.tv/pic/photo/l/test.jpg"] { assert!(image_url(value).is_ok()); }
        for value in ["file:///secret", "http://example.org/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://10.0.0.1/a.png", "https://user:secret@example.org/a.png", "https://example.org:8443/a.png"] { assert!(image_url(value).is_err(), "{value}"); }
        for value in ["127.0.0.1", "10.1.1.1", "169.254.1.1", "100.64.0.1", "198.18.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"] { assert!(!public_ip(value.parse().unwrap()), "{value}"); }
        for value in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] { assert!(public_ip(value.parse().unwrap())); }
    }
    #[test]
    fn actual_markup_keeps_image_order_normalizes_urls_and_is_bounded() {
        let comment = BangumiComment { id:"1".into(), user_name:String::new(), user_avatar:None, comment:"before [IMG=176,99] \n//lain.bgm.tv/a.jpg \n[/IMG] between [img]https://i.postimg.cc/b.png[/img] [img]file:///secret[/img] after".into(), created_at:String::new(), rate:None };
        assert_eq!(image_urls(&comment), vec!["https://lain.bgm.tv/a.jpg", "https://i.postimg.cc/b.png"]);
        let mut many = comment; many.comment = "[img]https://example.org/a.png[/img]".repeat(8); assert_eq!(image_urls(&many).len(), 4);
    }
    #[tokio::test]
    #[ignore = "explicit live public Bangumi sent-image cache smoke test"]
    async fn live_external_comment_images_cache() {
        let rows = crate::bangumi::BangumiProvider::new().unwrap().episode_comments("1212094").await.unwrap();
        let supplied = rows.iter().flat_map(|row| std::iter::once(&row.comment).chain(row.replies.iter())).flat_map(image_urls).collect::<Vec<_>>();
        let directory = tempfile::tempdir().unwrap();
        let state = AppState { pool:crate::db::test_pool().await.unwrap(), database_path:directory.path().join("qa.db"), data_directory:directory.path().into(), cover_cache_path:directory.path().into(), thumbnail_cache_path:directory.path().into() };
        for url in ["https://i.imgur.com/GKb6x3l.png", "https://i.postimg.cc/MpnMkNR4/image.png", "https://lain.bgm.tv/pic/photo/l/39/d3/2813_5QNV1.jpg"] {
            assert!(supplied.iter().any(|provided| provided == url));
            let path = cache(&state, url).await.unwrap();
            let (width,height) = image::image_dimensions(&path).unwrap(); assert!(width >= 80 && height >= 80);
            assert_eq!(cache(&state, url).await.unwrap(), path);
        }
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM works").fetch_one(&state.pool).await.unwrap(), 0);
    }
}
