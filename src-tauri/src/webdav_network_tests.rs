//! Synthetic loopback servers; no user configuration, credentials or media are read.
use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

async fn request(socket: &mut TcpStream) -> Option<String> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") && bytes.len() <= 8192 {
        let mut byte = [0];
        if socket.read_exact(&mut byte).await.is_err() {
            return None;
        }
        bytes.push(byte[0]);
    }
    String::from_utf8(bytes).ok()
}

struct RedirectFixture {
    endpoint: String,
    lookups: Arc<AtomicUsize>,
    revision: Arc<AtomicUsize>,
    upstream_requests: Arc<Mutex<Vec<String>>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
impl Drop for RedirectFixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}
async fn redirect_fixture() -> RedirectFixture {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let upstream_requests = Arc::new(Mutex::new(Vec::new()));
    let revision = Arc::new(AtomicUsize::new(1));
    let (requests, current) = (upstream_requests.clone(), revision.clone());
    let upstream_task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = upstream.accept().await {
            let (requests, current) = (requests.clone(), current.clone());
            tokio::spawn(async move {
                while let Some(raw) = request(&mut socket).await {
                    let target = raw.split_whitespace().nth(1).unwrap();
                    let head = raw.starts_with("HEAD ");
                    requests.lock().unwrap().push(raw.clone());
                    if !target.ends_with(&format!("ticket={}", current.load(Ordering::SeqCst))) {
                        let _ = socket
                            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        continue;
                    }
                    let range = raw
                        .lines()
                        .filter_map(|line| line.split_once(':'))
                        .find(|(name, _)| name.eq_ignore_ascii_case("range"))
                        .map(|(_, value)| value.trim());
                    let (start, end) = range
                        .map(|range| {
                            let (start, end) = range
                                .strip_prefix("bytes=")
                                .unwrap()
                                .split_once('-')
                                .unwrap();
                            (
                                start.parse::<usize>().unwrap_or(0),
                                end.parse::<usize>().unwrap_or(9),
                            )
                        })
                        .unwrap_or((0, 9));
                    let body = &b"0123456789"[start..=end];
                    let headers = format!("HTTP/1.1 {}\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{end}/10\r\nAccept-Ranges: bytes\r\nContent-Type: video/mp4\r\nSet-Cookie: cdn=private\r\n\r\n",
                        if range.is_some() { "206 Partial Content" } else { "200 OK" }, body.len());
                    if socket.write_all(headers.as_bytes()).await.is_err() {
                        return;
                    }
                    if !head && socket.write_all(body).await.is_err() {
                        return;
                    }
                }
            });
        }
    });
    let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/dav/", origin.local_addr().unwrap());
    let lookups = Arc::new(AtomicUsize::new(0));
    let (count, current) = (lookups.clone(), revision.clone());
    let origin_task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = origin.accept().await {
            let (count, current) = (count.clone(), current.clone());
            tokio::spawn(async move {
                while let Some(raw) = request(&mut socket).await {
                    assert!(raw
                        .to_ascii_lowercase()
                        .contains("authorization: basic dxnlcjpwyxnz"));
                    count.fetch_add(1, Ordering::SeqCst);
                    // Model a gateway resolving a cloud download link on every request.
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    let target = raw.split_whitespace().nth(1).unwrap();
                    let response = format!("HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://{upstream_address}{target}?ticket={}\r\n\r\n", current.load(Ordering::SeqCst));
                    if socket.write_all(response.as_bytes()).await.is_err() {
                        return;
                    }
                }
            });
        }
    });
    RedirectFixture {
        endpoint,
        lookups,
        revision,
        upstream_requests,
        tasks: vec![origin_task, upstream_task],
    }
}
fn client(endpoint: &str) -> DavClient {
    DavClient::new(
        endpoint,
        Credentials {
            username: "user".into(),
            password: "pass".into(),
        },
    )
    .unwrap()
}

#[tokio::test]
async fn android_relay_reuses_probe_resolution_and_preserves_seek_without_caching_video() {
    let fixture = redirect_fixture().await;
    let directory = tempfile::tempdir().unwrap();
    let pool = crate::db::test_pool().await.unwrap();
    let root = uuid::Uuid::new_v4().to_string();
    let media = uuid::Uuid::new_v4().to_string();
    struct CredentialGuard(String);
    impl Drop for CredentialGuard {
        fn drop(&mut self) {
            crate::credentials::delete(&self.0);
        }
    }
    let _credentials = CredentialGuard(root.clone());
    crate::credentials::save(
        &root,
        &Credentials {
            username: "user".into(),
            password: "pass".into(),
        },
    )
    .unwrap();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES(?,?,'video',1,'now','now','webdav')")
        .bind(&root).bind(format!("webdav://{root}")).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES(?,'network fixture',?,'',?)")
        .bind(&root).bind(&fixture.endpoint).bind(&root).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES(?,?,'video.mkv','mkv','video',10,'now','now')")
        .bind(&media).bind(format!("webdav://{root}/video.mkv")).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO remote_files(media_file_id,source_id,href) VALUES(?,?,'/dav/video.mkv')",
    )
    .bind(&media)
    .bind(&root)
    .execute(&pool)
    .await
    .unwrap();
    let state = crate::db::AppState {
        pool,
        database_path: directory.path().join("test.db"),
        data_directory: directory.path().into(),
        cover_cache_path: directory.path().join("covers"),
        thumbnail_cache_path: directory.path().join("thumbnails"),
    };
    let stream = crate::remote_transfer::stream_only(&state, &media)
        .await
        .unwrap();
    assert!(stream.uri.starts_with("http://127.0.0.1:"));
    assert!(!stream.uri.contains("ticket="));
    let player = Client::builder().no_proxy().build().unwrap();
    for (range, expected) in [
        ("bytes=0-3", b"0123".as_slice()),
        ("bytes=6-8", b"678".as_slice()),
    ] {
        let response = player
            .get(&stream.uri)
            .header("Range", range)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 206);
        assert!(response.headers().get("set-cookie").is_none());
        assert_eq!(response.bytes().await.unwrap().as_ref(), expected);
    }
    let head = player.head(&stream.uri).send().await.unwrap();
    assert_eq!(head.headers().get("content-length").unwrap(), "10");
    assert!(head.bytes().await.unwrap().is_empty());
    assert_eq!(
        fixture.lookups.load(Ordering::SeqCst),
        1,
        "probe, playback, seek and HEAD must share one gateway resolution"
    );
    fixture.revision.store(2, Ordering::SeqCst);
    let response = player
        .get(&stream.uri)
        .header("Range", "bytes=4-5")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"45");
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM remote_cache")
            .fetch_one(&state.pool)
            .await
            .unwrap(),
        0
    );
    assert!(!state.data_directory.join("remote-cache").exists());
    assert!(stream.failure.as_ref().unwrap().lock().unwrap().is_none());
}

#[tokio::test]
async fn playback_redirect_is_reused_for_ranges_and_head_and_refreshed_after_expiry() {
    let fixture = redirect_fixture().await;
    let client = client(&fixture.endpoint);
    let cold = std::time::Instant::now();
    let probe = client
        .get("/dav/video.mkv", Some("bytes=0-0"), false, None)
        .await
        .unwrap();
    assert_eq!(probe.bytes().await.unwrap().as_ref(), b"0");
    let cold_ms = cold.elapsed().as_millis();
    let seek = std::time::Instant::now();
    let response = client
        .clone()
        .get(
            "/dav/video.mkv",
            Some("bytes=4-6"),
            false,
            Some("\"revision\""),
        )
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"456");
    let seek_ms = seek.elapsed().as_millis();
    let head = client
        .get("/dav/video.mkv", None, true, None)
        .await
        .unwrap();
    assert_eq!(head.headers().get("content-length").unwrap(), "10");
    assert!(head.bytes().await.unwrap().is_empty());
    println!("synthetic WebDAV gateway: first resolution {cold_ms} ms, repeated range {seek_ms} ms, 3 requests / {} resolutions", fixture.lookups.load(Ordering::SeqCst));
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 1);

    fixture.revision.store(2, Ordering::SeqCst);
    let response = client
        .get("/dav/video.mkv", Some("bytes=7-9"), false, None)
        .await
        .unwrap();
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"789");
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 2);
    let response = client
        .get("/dav/video.mkv", Some("bytes=2-3"), false, None)
        .await
        .unwrap();
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"23");
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 2);

    // The resolution cannot be reused for another file or a new playback client.
    assert_eq!(
        client
            .get("/dav/other.mkv", Some("bytes=0-0"), false, None)
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        b"0"
    );
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 3);
    assert_eq!(
        self::client(&fixture.endpoint)
            .get("/dav/video.mkv", Some("bytes=0-0"), false, None)
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        b"0"
    );
    assert_eq!(fixture.lookups.load(Ordering::SeqCst), 4);
    let requests = fixture.upstream_requests.lock().unwrap();
    assert!(requests
        .iter()
        .all(|raw| !raw.to_ascii_lowercase().contains("authorization:")
            && !raw.to_ascii_lowercase().contains("cookie:")));
    assert!(requests
        .iter()
        .any(|raw| raw.to_ascii_lowercase().contains("if-range: \"revision\"")));
    assert!(requests
        .iter()
        .any(|raw| raw.starts_with("GET /dav/other.mkv?ticket=2 ")));
}

#[tokio::test]
async fn new_clients_reuse_the_connection_pool_without_reusing_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/dav/", listener.local_addr().unwrap());
    let accepts = Arc::new(AtomicUsize::new(0));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (count, captured) = (accepts.clone(), requests.clone());
    let task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            count.fetch_add(1, Ordering::SeqCst);
            let captured = captured.clone();
            tokio::spawn(async move {
                while let Some(raw) = request(&mut socket).await {
                    captured.lock().unwrap().push(raw);
                    if socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nContent-Range: bytes 0-0/10\r\n\r\n0").await.is_err() { return; }
                }
            });
        }
    });
    client(&endpoint)
        .get("/dav/video.mkv", Some("bytes=0-0"), false, None)
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let other = DavClient::new(
        &endpoint,
        Credentials {
            username: "other".into(),
            password: "secret".into(),
        },
    )
    .unwrap();
    other
        .get("/dav/video.mkv", Some("bytes=0-0"), false, None)
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(accepts.load(Ordering::SeqCst), 1);
    let requests = requests.lock().unwrap();
    assert!(requests[0]
        .to_ascii_lowercase()
        .contains("authorization: basic dxnlcjpwyxnz"));
    assert!(requests[1]
        .to_ascii_lowercase()
        .contains("authorization: basic b3rozxi6c2vjcmv0"));
    task.abort();
}

#[tokio::test]
async fn response_header_timeout_does_not_wait_for_the_body_idle_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/dav/", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await.unwrap();
        tokio::time::sleep(Duration::from_secs(60)).await;
    });
    let started = std::time::Instant::now();
    let error = client(&endpoint)
        .get("/dav/video.mkv", Some("bytes=0-0"), false, None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("network_timeout"));
    assert!(started.elapsed() < Duration::from_secs(20));
    task.abort();
}
