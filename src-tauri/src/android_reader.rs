//! Native reader sessions. Only opaque session resources are served on loopback.
use crate::{book_content, db::AppState, error::{AppError, AppResult}};
use serde_json::{json, Value};
use std::{collections::HashMap, io::Read, path::PathBuf, sync::{Arc, OnceLock}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::{Mutex, Notify, Semaphore}};

static ACTIVE: OnceLock<Mutex<Option<(String, Arc<Notify>)>>> = OnceLock::new();

struct Chapter {
    title: String,
    archive: Option<PathBuf>,
    pages: Vec<String>,
    sections: Vec<Value>,
    inline_images: HashMap<usize, Vec<u8>>,
}
struct Session {
    state: AppState,
    kind: String,
    book: String,
    group: String,
    initial: String,
    offline_only: bool,
    base: String,
    chapters: Mutex<HashMap<String, Arc<Chapter>>>,
    comment_avatars: Mutex<HashMap<String, String>>,
    loading: Mutex<()>,
    closed: Arc<Notify>,
}
fn invalid(message: &str) -> AppError { AppError::Validation(message.into()) }
fn valid_id(value: &str) -> bool { crate::comic_explore::valid_id(value) }
#[tauri::command]
pub async fn get_reading_resume(kind: String, path_word: String, state: tauri::State<'_, AppState>) -> AppResult<Option<Value>> {
    if !matches!(kind.as_str(), "comic" | "novel") || !valid_id(&path_word) { return Err(invalid("阅读来源标识无效")); }
    let row: Option<(String,String,String)> = sqlx::query_as("SELECT entry_id,group_id,updated_at FROM android_reading_progress WHERE kind=? AND book_id=? ORDER BY updated_at DESC LIMIT 1")
        .bind(kind).bind(path_word).fetch_optional(&state.pool).await?;
    Ok(row.map(|(entry,group,time)| json!({"entryId":entry,"group":group,"updatedAt":time})))
}
fn archive_pages(path: &std::path::Path) -> AppResult<Vec<String>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| invalid("漫画缓存无法读取，请重新获取"))?;
    if zip.len() == 0 || zip.len() > 1000 { return Err(invalid("漫画缓存页数无效")); }
    let mut pages = Vec::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(|_| invalid("漫画缓存目录损坏"))?;
        let name = file.name();
        if file.is_dir() || file.size() > 20 * 1024 * 1024 || name.contains(['/', '\\'])
            || ![".jpg", ".png", ".webp"].iter().any(|extension| name.ends_with(extension)) {
            return Err(invalid("漫画缓存页面无效"));
        }
        pages.push(name.to_owned());
    }
    pages.sort();
    Ok(pages)
}
fn archive_resource(path: &std::path::Path, name: &str) -> AppResult<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| invalid("阅读缓存损坏"))?;
    let mut file = zip.by_name(name).map_err(|_| invalid("缓存页面不存在"))?;
    if file.size() > 20 * 1024 * 1024 { return Err(invalid("缓存页面过大")); }
    let mut bytes = Vec::new();
    file.by_ref().take(20 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 20 * 1024 * 1024 { return Err(invalid("缓存页面过大")); }
    Ok(bytes)
}
fn xml(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}
fn image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
    else { "image/jpeg" }
}
fn section_document(section: &Value, index: usize) -> Vec<u8> {
    let title = xml(section["title"].as_str().unwrap_or("正文"));
    let body = if let Some(text) = section["text"].as_str() {
        book_content::reader_paragraphs(text)
    } else { format!("<p class=\"illustration\"><img src=\"image-{index}\" alt=\"{title}\"/></p>") };
    format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh\"><head><title>{title}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><style>p{{text-indent:2em;margin:0 0 .6em;overflow-wrap:anywhere}}p:empty{{min-height:.6em}}h1{{font-size:1.3em}}img{{max-width:100%;height:auto}}.illustration{{text-indent:0;text-align:center}}</style></head><body><h1>{title}</h1>{body}</body></html>").into_bytes()
}

impl Session {
    async fn chapter(&self, entry: &str) -> AppResult<Arc<Chapter>> {
        if !valid_id(entry) { return Err(invalid("阅读章节标识无效")); }
        if let Some(chapter) = self.chapters.lock().await.get(entry).cloned() { return Ok(chapter); }
        let _loading = self.loading.lock().await;
        if let Some(chapter) = self.chapters.lock().await.get(entry).cloned() { return Ok(chapter); }
        let (root, kind, book, id) = (self.state.data_directory.clone(), self.kind.clone(), self.book.clone(), entry.to_owned());
        let cached = tokio::task::spawn_blocking(move || book_content::reader_archive(&root, &kind, &book, &id))
            .await.map_err(|error| AppError::System(error.to_string()))??;
        let chapter = if let Some((title, archive)) = cached {
            let pages = if self.kind == "comic" {
                let path = archive.clone();
                tokio::task::spawn_blocking(move || archive_pages(&path)).await.map_err(|error| AppError::System(error.to_string()))??
            } else { Vec::new() };
            Chapter { title, archive: Some(archive), pages, sections: Vec::new(), inline_images:HashMap::new() }
        } else {
            if self.offline_only { return Err(invalid("此章卷没有完整离线缓存，请先下载后再阅读")); }
            let content = serde_json::to_value(book_content::online_content(&self.state.pool, &self.kind, &self.book, entry, &self.group).await?)?;
            Chapter { title: content["title"].as_str().unwrap_or(entry).into(), archive: None,
                pages: content["pages"].as_array().unwrap().iter().map(|value| value.as_str().unwrap().to_owned()).collect(),
                sections: content["sections"].as_array().unwrap().clone(), inline_images:HashMap::new() }
        };
        let chapter = Arc::new(chapter);
        let mut chapters = self.chapters.lock().await;
        // Retain current and nearby text, rather than accumulating entire series.
        if chapters.len() >= 3 { chapters.retain(|key, _| key == &self.initial); }
        chapters.insert(entry.to_owned(), chapter.clone());
        Ok(chapter)
    }
    async fn manifest(&self, entry: &str) -> AppResult<Value> {
        let chapter = self.chapter(entry).await?;
        let saved: Option<String> = sqlx::query_scalar("SELECT location_json FROM android_reading_progress WHERE kind=? AND book_id=? AND group_id=? AND entry_id=?")
            .bind(&self.kind).bind(&self.book).bind(&self.group).bind(entry).fetch_optional(&self.state.pool).await?;
        let content_base = format!("{}chapter/{entry}/", self.base);
        let pages: Vec<String> = chapter.pages.iter().enumerate().map(|(index, _)| format!("{content_base}page/{index}")).collect();
        let links: Vec<Value> = chapter.sections.iter().enumerate().map(|(index, section)| json!({"href":format!("OEBPS/chapter-{index}.xhtml"),"type":"application/xhtml+xml","title":section["title"]})).collect();
        let resources: Vec<Value> = chapter.sections.iter().enumerate().filter(|(_, section)| section["imageUrl"].is_string())
            .map(|(index, _)| json!({"href":format!("OEBPS/image-{index}"),"type":"image/jpeg"})).collect();
        let cache_keys:Vec<String>=chapter.pages.iter().map(|source|{
            use sha2::{Digest,Sha256};format!("{:x}",Sha256::digest(source.as_bytes()))
        }).collect();
        Ok(json!({"kind":self.kind,"entryId":entry,"title":chapter.title,"offline":chapter.archive.is_some(),"cacheKeys":cache_keys,
            "archivePath":chapter.archive,"archiveEntries":if chapter.archive.is_some() {chapter.pages.clone()} else {vec![]},"pages":pages,"contentBase":content_base,
            "location":saved.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
            "publication":{"metadata":{"identifier":format!("genzo:{}:{}:{entry}",self.kind,self.book),"title":chapter.title,"language":["zh"],"@type":"http://schema.org/Book"},
                "readingOrder":links,"toc":links,"resources":resources}}))
    }
    async fn location(&self, entry: &str, value: &Value) -> AppResult<String> {
        let chapter = self.chapter(entry).await?;
        if self.kind == "comic" {
            let page = value["pageIndex"].as_u64().ok_or_else(|| invalid("漫画页码无效"))?;
            let offset = value["offset"].as_f64().unwrap_or(0.0);
            if page >= chapter.pages.len() as u64 || !offset.is_finite() || !(0.0..=1.0).contains(&offset) {
                return Err(invalid("漫画阅读位置超出范围"));
            }
            return Ok(serde_json::to_string(&json!({"pageIndex":page,"offset":offset}))?);
        }
        let href = value["href"].as_str().filter(|href| !href.is_empty() && href.len() <= 2048
            && !href.contains(['\\', '?', ':']) && !href.starts_with('/') && !href.split('/').any(|part| part == ".."))
            .ok_or_else(|| invalid("小说正文位置无效"))?;
        if let Some(archive) = chapter.archive.clone() {
            let name = href.split('#').next().unwrap().to_owned();
            let exists = tokio::task::spawn_blocking(move || {
                zip::ZipArchive::new(std::fs::File::open(archive)?).map(|mut zip| zip.by_name(&name).is_ok())
                    .map_err(|_| std::io::Error::other("EPUB 缓存损坏"))
            }).await.map_err(|error| AppError::System(error.to_string()))??;
            if !exists { return Err(invalid("小说正文位置不属于本卷")); }
        } else if !chapter.sections.iter().enumerate().any(|(index, _)| href.split('#').next() == Some(format!("OEBPS/chapter-{index}.xhtml").as_str())) {
            return Err(invalid("小说正文位置不属于本卷"));
        }
        for name in ["progression", "totalProgression"] {
            if !value["locations"][name].is_null() && !value["locations"][name].as_f64().is_some_and(|number| (0.0..=1.0).contains(&number)) {
                return Err(invalid("小说阅读进度无效"));
            }
        }
        let encoded = serde_json::to_string(value)?;
        if encoded.len() > 16 * 1024 { return Err(invalid("小说阅读位置过大")); }
        Ok(encoded)
    }
    async fn bookmarks(&self) -> AppResult<Value> {
        let rows: Vec<(String, String, String, String)> = sqlx::query_as("SELECT id,entry_id,location_json,label FROM android_reading_bookmarks WHERE kind=? AND book_id=? AND group_id=? ORDER BY created_at DESC LIMIT 1000")
            .bind(&self.kind).bind(&self.book).bind(&self.group).fetch_all(&self.state.pool).await?;
        Ok(Value::Array(rows.into_iter().map(|(id, entry, location, label)| json!({"id":id,"entryId":entry,"location":serde_json::from_str::<Value>(&location).unwrap_or(Value::Null),"label":label})).collect()))
    }
}

#[tauri::command]
pub async fn open_internal_reader(kind: String, path_word: String, entry_id: String, group: String, offline_only: Option<bool>, state: tauri::State<'_, AppState>) -> AppResult<Value> {
    if !cfg!(target_os = "android") { return Err(invalid("原生阅读器仅支持 Android")); }
    if !matches!(kind.as_str(), "comic" | "novel") || !valid_id(&path_word) || !valid_id(&entry_id)
        || (!group.is_empty() && !valid_id(&group)) || (kind == "novel" && !group.is_empty()) { return Err(invalid("阅读来源标识无效")); }
    start_reader(state.inner().clone(),kind,path_word,entry_id,group,HashMap::new(),offline_only.unwrap_or(false)).await
}
async fn start_reader(state: AppState, kind: String, path_word: String, entry_id: String, group: String, chapters: HashMap<String, Arc<Chapter>>, offline_only: bool) -> AppResult<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let closed = Arc::new(Notify::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let token = uuid::Uuid::new_v4().to_string();
    let base = format!("http://{}/{token}/", listener.local_addr()?);
    let session = Arc::new(Session { state, kind:kind.clone(), book:path_word,
        group, initial:entry_id.clone(), offline_only, base:base.clone(), chapters:Mutex::new(chapters), comment_avatars:Mutex::new(HashMap::new()), loading:Mutex::new(()), closed:closed.clone() });
    let active = ACTIVE.get_or_init(|| Mutex::new(None));
    if let Some((_, previous)) = active.lock().await.replace((id.clone(), closed.clone())) { previous.notify_one(); }
    tauri::async_runtime::spawn(async move {
        let slots = Arc::new(Semaphore::new(8));
        let mut workers = tokio::task::JoinSet::new();
        loop {
            let connection = tokio::select! {
                _ = closed.notified() => break,
                _ = workers.join_next(), if !workers.is_empty() => continue,
                connection = listener.accept() => connection,
            };
            let Ok((stream, _)) = connection else { break };
            let Ok(permit) = slots.clone().try_acquire_owned() else { continue };
            let session = session.clone(); let token = token.clone();
            workers.spawn(async move {
                let _permit = permit;
                let _ = tokio::time::timeout(Duration::from_secs(120), serve(stream, &session, &token)).await;
            });
        }
    });
    if let Err(error) = crate::android_bridge::call("openReader", json!({"sessionId":id,"baseUrl":base,"kind":kind,"entryId":entry_id})).await {
        if let Some((_, closed)) = active.lock().await.take() { closed.notify_one(); }
        return Err(error);
    }
    Ok(json!({"sessionId":id,"kind":kind}))
}

/// Uses only the independently seeded QA book; unavailable in ordinary/debug or release apps.
#[tauri::command]
pub async fn open_reader_online_fixture(state: tauri::State<'_, AppState>) -> AppResult<Value> {
    if !cfg!(debug_assertions) || !cfg!(target_os = "android") || state.data_directory.file_name().and_then(|value| value.to_str()) != Some("com.genzo.android.readerqa") {
        return Err(invalid("此入口仅支持独立阅读测试包"));
    }
    let root = state.data_directory.clone();
    let chapter = tokio::task::spawn_blocking(move || -> AppResult<Chapter> {
        let (_, archive) = book_content::reader_archive(&root,"novel","reader-fixture-novel","one")?.ok_or_else(|| invalid("请先准备合成测试卷"))?;
        let text = std::fs::read_to_string(archive.parent().unwrap().join("volume.txt"))?;
        let rows = text.lines().collect::<Vec<_>>();
        if rows.len() != 600 || !text.starts_with("这是阅读器验收使用的合成段落") { return Err(invalid("测试数据身份不符")); }
        let image = archive_resource(&archive,"OEBPS/image-1.png")?;
        Ok(Chapter {title:"合成小说测试 · 在线资源接口".into(),archive:None,pages:Vec::new(),
            sections:vec![json!({"title":"第一章：合成正文","text":rows[..300].join("\n")}),json!({"title":"独立合成插图","imageUrl":"qa-inline-image"}),json!({"title":"第二章：继续阅读","text":rows[300..].join("\n")})],
            inline_images:HashMap::from([(1,image)])})
    }).await.map_err(|error| AppError::System(error.to_string()))??;
    start_reader(state.inner().clone(),"novel".into(),"reader-fixture-novel".into(),"one".into(),String::new(),HashMap::from([("one".into(),Arc::new(chapter))]),false).await
}

async fn route(session: &Session, method: &str, path: &str, body: &[u8]) -> AppResult<(Vec<u8>, &'static str)> {
    let (path,query)=path.split_once('?').unwrap_or((path,""));
    let timeout=if query.is_empty(){15}else{
        let value=query.strip_prefix("timeout=").and_then(|value|value.parse::<u64>().ok()).filter(|value|(5..=60).contains(value));
        value.ok_or_else(||invalid("图片超时参数无效"))?
    };
    // Match EPUB-relative resource names, keeping online/offline locator HREFs equal.
    let normalized = path.replace("/OEBPS/", "/");
    let segments: Vec<_> = normalized.split('/').collect();
    let result = match segments.as_slice() {
        ["entries", offset] if method == "GET" => {
            let offset = offset.parse::<u32>().map_err(|_| invalid("目录页无效"))?;
            let offline = session.offline_only || session.chapter(&session.initial).await?.archive.is_some();
            let page = if offline { book_content::reader_cached_directory(&session.state.pool,&session.kind,&session.book,&session.group,offset).await? }
                else { book_content::directory(&session.state.pool, &session.kind, &session.book, &session.group, offset, false).await? };
            serde_json::to_value(page)?
        }
        ["bookmarks"] if method == "GET" => session.bookmarks().await?,
        ["history"] if method == "GET" => {
            let rows: Vec<(String,String,String)> = sqlx::query_as("SELECT p.entry_id,p.location_json,p.updated_at FROM android_reading_progress p LEFT JOIN android_reading_history h ON h.kind=p.kind AND h.book_id=p.book_id AND h.group_id=p.group_id AND h.entry_id=p.entry_id WHERE p.kind=? AND p.book_id=? AND p.group_id=? AND COALESCE(h.hidden,0)=0 ORDER BY p.updated_at DESC LIMIT 100")
                .bind(&session.kind).bind(&session.book).bind(&session.group).fetch_all(&session.state.pool).await?;
            Value::Array(rows.into_iter().map(|(entry,location,time)| json!({"entryId":entry,"location":serde_json::from_str::<Value>(&location).unwrap_or(Value::Null),"updatedAt":time})).collect())
        }
        ["close"] if method == "POST" => { session.closed.notify_one(); json!({}) }
        ["chapter", entry] if method == "GET" => session.manifest(entry).await?,
        ["chapter", entry, "comments", offset] if method == "GET" => {
            if session.offline_only { return Err(invalid("离线阅读不连接评论来源")); }
            if session.kind != "comic" { return Err(invalid("本话评论仅支持漫画来源")); }
            let offset = offset.parse::<u32>().map_err(|_| invalid("评论页码无效"))?;
            let page=crate::comic_explore::chapter_comments_for(
                &session.state.pool, &session.book, entry, &session.group, offset, 30,
            ).await?;
            let mut avatars=session.comment_avatars.lock().await;
            if avatars.len()>900 {avatars.clear();}
            for item in &page.items { if !item.user_avatar.is_empty() {avatars.insert(format!("{entry}:{}",item.id),item.user_avatar.clone());} }
            serde_json::to_value(page)?
        }
        ["chapter", entry, "comment-avatar", id] if method=="GET" => {
            if session.offline_only { return Err(invalid("离线阅读不连接评论来源")); }
            if session.kind != "comic" || entry.len() != 36 || uuid::Uuid::parse_str(entry).is_err()
                || id.parse::<u64>().ok().filter(|id| *id > 0).is_none() {
                return Err(invalid("本话评论头像标识无效"));
            }
            let url=session.comment_avatars.lock().await.get(&format!("{entry}:{id}")).cloned().ok_or_else(||invalid("头像不属于已读取的本话评论"))?;
            let bytes=book_content::reader_image(&session.state.pool,&url,timeout).await?;
            let mime=image_mime(&bytes);return Ok((bytes,mime));
        }
        ["chapter", entry, "page", index] if method == "GET" => {
            let chapter = session.chapter(entry).await?;
            let index = index.parse::<usize>().map_err(|_| invalid("图片页码无效"))?;
            let source = chapter.pages.get(index).ok_or_else(|| invalid("图片页码超出范围"))?.clone();
            let bytes = if let Some(archive) = chapter.archive.clone() {
                tokio::task::spawn_blocking(move || archive_resource(&archive, &source)).await.map_err(|error| AppError::System(error.to_string()))??
            } else { book_content::reader_image(&session.state.pool, &source,timeout).await? };
            let mime = image_mime(&bytes); return Ok((bytes, mime));
        }
        ["chapter", entry, resource] if method == "GET" => {
            let chapter = session.chapter(entry).await?;
            if let Some(index) = resource.strip_prefix("chapter-").and_then(|value| value.strip_suffix(".xhtml")).and_then(|value| value.parse::<usize>().ok()) {
                let section = chapter.sections.get(index).ok_or_else(|| invalid("小说章节超出范围"))?;
                return Ok((section_document(section, index), "application/xhtml+xml; charset=utf-8"));
            }
            if let Some(index) = resource.strip_prefix("image-").and_then(|value| value.parse::<usize>().ok()) {
                if let Some(bytes) = chapter.inline_images.get(&index) { return Ok((bytes.clone(),image_mime(bytes))); }
                let url = chapter.sections.get(index).and_then(|section| section["imageUrl"].as_str()).ok_or_else(|| invalid("小说插图不存在"))?;
                let bytes = book_content::online_image(&session.state.pool, url).await?;
                let mime = image_mime(&bytes); return Ok((bytes, mime));
            }
            return Err(invalid("未知正文资源"));
        }
        ["chapter", entry, action] if method == "POST" => {
            let value: Value = serde_json::from_slice(body)?;
            let now = chrono::Utc::now().to_rfc3339();
            if *action == "progress" {
                let location = session.location(entry, &value).await?;
                let chapter = session.chapter(entry).await?;
                crate::reading_history::save_progress(&session.state.pool, &session.kind, &session.book, &session.group, entry,
                    &location, &chapter.title, (session.kind == "comic").then_some(chapter.pages.len() as i64), &now).await?;
                crate::android_events::reading(json!({"kind":session.kind,"pathWord":session.book,"entryId":entry,"group":session.group,"updatedAt":now}));
            } else if *action == "bookmark" {
                let location = session.location(entry, &value["location"]).await?;
                let label = value["label"].as_str().filter(|label| label.chars().count() <= 500).ok_or_else(|| invalid("书签标题无效"))?;
                sqlx::query("INSERT OR IGNORE INTO android_reading_bookmarks(id,kind,book_id,group_id,entry_id,location_json,label,created_at) VALUES(?,?,?,?,?,?,?,?)")
                    .bind(uuid::Uuid::new_v4().to_string()).bind(&session.kind).bind(&session.book).bind(&session.group).bind(entry).bind(location).bind(label).bind(now).execute(&session.state.pool).await?;
            } else if *action == "delete-bookmark" {
                let id = value["id"].as_str().ok_or_else(|| invalid("书签标识缺失"))?;
                sqlx::query("DELETE FROM android_reading_bookmarks WHERE id=? AND kind=? AND book_id=? AND group_id=? AND entry_id=?")
                    .bind(id).bind(&session.kind).bind(&session.book).bind(&session.group).bind(entry).execute(&session.state.pool).await?;
            } else { return Err(invalid("未知阅读操作")); }
            json!({})
        }
        _ => return Err(invalid("未知阅读资源")),
    };
    Ok((serde_json::to_vec(&result)?, "application/json; charset=utf-8"))
}

async fn serve(mut stream: tokio::net::TcpStream, session: &Session, token: &str) -> AppResult<()> {
    let mut header = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 { return Err(invalid("阅读请求头过大")); }
        let byte = tokio::time::timeout_at(deadline, stream.read_u8()).await.map_err(|_| invalid("阅读请求超时"))??;
        header.push(byte);
    }
    let text = String::from_utf8_lossy(&header);
    let mut lines = text.lines();
    let request = lines.next().unwrap_or("").split_whitespace().collect::<Vec<_>>();
    let headers = lines.filter_map(|line| line.split_once(':')).collect::<Vec<_>>();
    let length = headers.iter().find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>()).transpose().map_err(|_| invalid("阅读请求大小无效"))?.unwrap_or(0);
    if length > 20 * 1024 { return Err(invalid("阅读请求体过大")); }
    let mut body = vec![0; length];
    tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut body)).await.map_err(|_| invalid("阅读请求超时"))??;
    let prefix = format!("/{token}/");
    let path = request.get(1).and_then(|path| path.strip_prefix(&prefix));
    let origin_ok = headers.iter().filter(|(name, _)| name.eq_ignore_ascii_case("origin"))
        .all(|(_, origin)| session.base.starts_with(&format!("{}/", origin.trim())));
    let result = if request.len() == 3 && origin_ok && path.is_some() {
        if request[0]=="GET"&&path.unwrap().contains("/page/") {
            tokio::select! {
                result=route(session,"GET",path.unwrap(),&body)=>result,
                _=stream.read_u8()=>return Ok(()),
            }
        } else { route(session,if request[0]=="HEAD"{"GET"}else{request[0]},path.unwrap(),&body).await }
    } else { Err(invalid("阅读会话无效")) };
    let (status, bytes, mime) = match result {
        Ok((bytes, mime)) => ("200 OK", bytes, mime),
        Err(error) => ("400 Bad Request", serde_json::to_vec(&json!({"error":error.to_string()}))?, "application/json; charset=utf-8"),
    };
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",bytes.len()).as_bytes()).await?;
    if request.first() != Some(&"HEAD") { stream.write_all(&bytes).await?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn image_cache_identity_survives_new_session_addresses_and_timeout_is_bounded() {
        let (first,_one)=fixture("comic").await;let (mut second,_two)=fixture("comic").await;
        second.base="http://127.0.0.1:5678/different-session/".into();
        let a=first.manifest("one").await.unwrap();let b=second.manifest("one").await.unwrap();
        assert_ne!(a["pages"],b["pages"]);assert_eq!(a["cacheKeys"],b["cacheKeys"]);
        assert!(route(&first,"GET","chapter/one/page/0?timeout=999",b"").await.is_err());
        assert!(route(&first,"GET","chapter/one/page/0?timeout=0",b"").await.is_err());
    }
    async fn fixture(kind: &str) -> (Session, tempfile::TempDir) {
        let root = tempfile::tempdir().unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let state = AppState { pool, database_path:root.path().join("db"),data_directory:root.path().into(),cover_cache_path:root.path().join("covers"),thumbnail_cache_path:root.path().join("thumbs") };
        let session = Session { state,kind:kind.into(),book:"book".into(),group:"default".into(),initial:"one".into(),offline_only:false,base:"http://127.0.0.1:1234/test/".into(),
            chapters:Mutex::new(HashMap::from([("one".into(),Arc::new(Chapter {title:"第一章".into(),archive:None,pages:vec!["one".into(),"two".into()],sections:vec![json!({"title":"正文","text":"<正文>\n第二段"})],inline_images:HashMap::new()}))])),comment_avatars:Mutex::new(HashMap::new()),loading:Mutex::new(()),closed:Arc::new(Notify::new()) };
        (session, root)
    }

    const COMMENT_CHAPTER: &str = "52615840-10a4-11e9-b68d-00163e0ca5bd";

    #[tokio::test]
    async fn offline_only_missing_chapter_directory_and_comments_never_connect_or_write_reading_progress() {
        for kind in ["comic","novel"] {
            let (mut session,_root) = fixture(kind).await;
            session.offline_only = true; session.chapters.lock().await.clear();
            let proxy = comment_proxy(&session).await;
            for path in ["chapter/one".into(),"entries/0".into(),format!("chapter/{COMMENT_CHAPTER}/comments/0"),format!("chapter/{COMMENT_CHAPTER}/comment-avatar/1")] {
                let result = tokio::time::timeout(Duration::from_secs(1),route(&session,"GET",&path,b"")).await.expect("offline requests must not wait for a source");
                assert!(matches!(result,Err(AppError::Validation(_))),"{path}: {result:?}");
            }
            assert!(tokio::time::timeout(Duration::from_millis(50),proxy.accept()).await.is_err());
            assert!(session.chapters.lock().await.is_empty());
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&session.state.pool).await.unwrap(),0);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM metadata_cache").fetch_one(&session.state.pool).await.unwrap(),0);
        }
    }
    #[tokio::test]
    async fn offline_only_reads_verified_archive_and_deleted_pages_do_not_fall_back_to_network() {
        use sha2::{Digest,Sha256};
        use std::io::Write;
        let (mut session,root) = fixture("comic").await;
        session.offline_only = true; session.chapters.lock().await.clear();
        let proxy = comment_proxy(&session).await;
        let hash = format!("{:x}",Sha256::digest(b"comic\nbook\none"));
        let directory = root.path().join("reading-cache/v1").join(hash).join("complete-test");
        std::fs::create_dir_all(&directory).unwrap();
        let mut image = std::io::Cursor::new(vec![]); image::DynamicImage::new_rgb8(2,2).write_to(&mut image,image::ImageFormat::Png).unwrap();
        let path = directory.join("chapter.cbz");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        archive.start_file("0001.png",zip::write::SimpleFileOptions::default()).unwrap(); archive.write_all(image.get_ref()).unwrap(); archive.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let manifest = json!({"version":1,"kind":"comic","bookId":"book","entryId":"one","title":"离线章节","openFile":"chapter.cbz",
            "files":[{"name":"chapter.cbz","sha256":format!("{:x}",Sha256::digest(&bytes)),"bytes":bytes.len()}],"cachedAt":"2026-10-14T08:00:00Z"});
        std::fs::write(directory.join("manifest.json"),serde_json::to_vec(&manifest).unwrap()).unwrap();
        let manifest = session.manifest("one").await.unwrap(); assert_eq!(manifest["offline"],true); assert_eq!(manifest["pages"].as_array().unwrap().len(),1);
        assert_eq!(route(&session,"GET","chapter/one/page/0",b"").await.unwrap().0,image.into_inner());
        route(&session,"POST","chapter/one/progress",b"{\"pageIndex\":0,\"offset\":0.25}").await.unwrap();
        assert_eq!(crate::reading_history::list_in_pool(&session.state.pool).await.unwrap().len(),1);
        std::fs::remove_file(path).unwrap();
        assert!(route(&session,"GET","chapter/one/page/0",b"").await.is_err());
        assert!(tokio::time::timeout(Duration::from_millis(50),proxy.accept()).await.is_err());
    }

    async fn comment_proxy(session: &Session) -> tokio::net::TcpListener {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = crate::reading_network::ReadingNetwork {proxy_mode:"manual".into(),proxy_url:format!("http://{}",listener.local_addr().unwrap()),..Default::default()};
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('reading.network',?,'now')")
            .bind(serde_json::to_string(&config).unwrap()).execute(&session.state.pool).await.unwrap();
        listener
    }

    async fn comment_directory(session: &Session, book: &str, group: &str) {
        let host = crate::reading_network::ReadingNetwork::default().detail_hosts()[0].clone();
        let params = vec![("limit".to_string(),"100".to_string()),("offset".to_string(),"0".to_string())];
        for (key, value) in [
            (format!("v1:{host}/api/v3/comic2/{book}:[]"), json!({"comic":{"path_word":book},"groups":{"default":{"name":"默认"},"volume":{"name":"单行本"}}})),
            (format!("v1:{host}/api/v3/comic/{book}/group/{group}/chapters:{}",serde_json::to_string(&params).unwrap()),
                json!({"entries":[{"id":COMMENT_CHAPTER,"title":"合成章节","order":0,"count":61}],"total":1,"offset":0,"group":group,"groups":[],"stale":false})),
        ] {
            sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('copy-reading',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,expires_at=excluded.expires_at")
                .bind(key).bind(value.to_string()).bind(chrono::Utc::now().to_rfc3339()).bind((chrono::Utc::now()+chrono::Duration::hours(1)).to_rfc3339())
                .execute(&session.state.pool).await.unwrap();
        }
    }

    #[tokio::test]
    async fn chapter_comments_route_rejects_novels_and_invalid_identifiers_without_source_requests() {
        for kind in ["comic", "novel"] {
            let (session, _root) = fixture(kind).await;
            let proxy = comment_proxy(&session).await;
            let paths = if kind == "novel" { vec![format!("chapter/{COMMENT_CHAPTER}/comments/0")] }
                else { ["chapter/one/comments/0".into(), "chapter/not-a-uuid/comments/0".into(),
                    format!("chapter/{COMMENT_CHAPTER}/comments/-1"), format!("chapter/{COMMENT_CHAPTER}/comments/NaN"),
                    format!("chapter/{COMMENT_CHAPTER}/comments/4294967296"), format!("chapter/{COMMENT_CHAPTER}/comments/1000001")].to_vec() };
            for path in paths {
                let result = tokio::time::timeout(Duration::from_secs(1),route(&session,"GET",&path,b"")).await
                    .expect("invalid comments routes must fail before connecting to a source");
                assert!(matches!(result,Err(AppError::Validation(_))),"{path}: {result:?}");
            }
            assert!(tokio::time::timeout(Duration::from_millis(50),proxy.accept()).await.is_err());
            assert_eq!(session.chapters.lock().await.len(),1);
        }
    }

    #[tokio::test]
    async fn chapter_comments_route_is_confined_to_session_book_and_group() {
        let (session,_root) = fixture("comic").await;
        let proxy = comment_proxy(&session).await;
        comment_directory(&session,"book","default").await;
        comment_directory(&session,"other-book","default").await;
        comment_directory(&session,"book","volume").await;
        let path = format!("v1:{}/api/v3/comic/book/group/default/chapters:",crate::reading_network::ReadingNetwork::default().detail_hosts()[0]);
        let (key,data):(String,String) = sqlx::query_as("SELECT cache_key,response_json FROM metadata_cache WHERE provider='copy-reading' AND instr(cache_key,?)=1")
            .bind(path).fetch_one(&session.state.pool).await.unwrap();
        let mut page:Value = serde_json::from_str(&data).unwrap();
        page["entries"][0]["id"] = json!("c2d8f146-17b6-11e9-bfa4-00163e0ca5bd");
        sqlx::query("UPDATE metadata_cache SET response_json=? WHERE provider='copy-reading' AND cache_key=?")
            .bind(page.to_string()).bind(key).execute(&session.state.pool).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(1),route(&session,"GET",&format!("chapter/{COMMENT_CHAPTER}/comments/0"),b"")).await
            .expect("another book or group cannot supply chapter membership");
        assert!(matches!(result,Err(AppError::Validation(_))));
        assert!(tokio::time::timeout(Duration::from_millis(50),proxy.accept()).await.is_err());
        assert_eq!(session.chapters.lock().await.len(),1);
    }

    #[tokio::test]
    async fn chapter_comments_route_reads_only_comment_transport_without_loading_images_or_progress() {
        let (session,_root) = fixture("comic").await;
        let proxy = comment_proxy(&session).await;
        comment_directory(&session,"book","default").await;
        let server = tokio::spawn(async move {
            let (mut socket,_) = proxy.accept().await.unwrap();
            let mut request = [0;4096]; let length = socket.read(&mut request).await.unwrap();
            let text = String::from_utf8_lossy(&request[..length]);
            assert!(text.starts_with("CONNECT api.copy202601.com:443 "),"{text}");
            socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let result = tokio::time::timeout(Duration::from_secs(2),route(&session,"GET",&format!("chapter/{COMMENT_CHAPTER}/comments/30"),b"")).await
            .expect("controlled comment transport failure must complete");
        assert!(matches!(result,Err(AppError::Network(_))));
        server.await.unwrap();
        assert_eq!(session.chapters.lock().await.len(),1);
        assert!(!session.chapters.lock().await.contains_key(COMMENT_CHAPTER));
        for table in ["android_reading_progress","android_reading_bookmarks"] {
            let count:i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}")).fetch_one(&session.state.pool).await.unwrap();
            assert_eq!(count,0);
        }
    }
    #[tokio::test]
    async fn comment_avatars_reject_unread_comments_other_chapters_and_sessions_without_network() {
        let (session,_root) = fixture("comic").await;
        let proxy = comment_proxy(&session).await;
        session.comment_avatars.lock().await.insert(format!("{COMMENT_CHAPTER}:11"),"https://s3.mangafunb.fun/avatar.png".into());
        for path in [
            format!("chapter/{COMMENT_CHAPTER}/comment-avatar/12"),
            "chapter/c2d8f146-17b6-11e9-bfa4-00163e0ca5bd/comment-avatar/11".into(),
            "chapter/one/comment-avatar/11".into(),
            format!("chapter/{COMMENT_CHAPTER}/comment-avatar/0"),
            format!("chapter/{COMMENT_CHAPTER}/comment-avatar/-1"),
            format!("chapter/{COMMENT_CHAPTER}/comment-avatar/18446744073709551616"),
            format!("chapter/{COMMENT_CHAPTER}/comment-avatar/https://example.com"),
        ] {
            let result = tokio::time::timeout(Duration::from_secs(1),route(&session,"GET",&path,b"")).await.unwrap();
            assert!(matches!(result,Err(AppError::Validation(_))),"{path}: {result:?}");
        }
        let (other,_other_root) = fixture("comic").await;
        assert!(matches!(route(&other,"GET",&format!("chapter/{COMMENT_CHAPTER}/comment-avatar/11"),b"").await,Err(AppError::Validation(_))));
        let (novel,_novel_root) = fixture("novel").await;
        novel.comment_avatars.lock().await.insert(format!("{COMMENT_CHAPTER}:11"),"https://s3.mangafunb.fun/avatar.png".into());
        assert!(matches!(route(&novel,"GET",&format!("chapter/{COMMENT_CHAPTER}/comment-avatar/11"),b"").await,Err(AppError::Validation(_))));
        assert!(tokio::time::timeout(Duration::from_millis(50),proxy.accept()).await.is_err());
        assert_eq!(session.chapters.lock().await.len(),1);
    }

    #[tokio::test]
    async fn registered_comment_avatar_uses_source_transport_without_loading_chapter_or_writing_progress() {
        let (session,_root) = fixture("comic").await;
        let proxy = comment_proxy(&session).await;
        session.comment_avatars.lock().await.insert(format!("{COMMENT_CHAPTER}:11"),"https://s3.mangafunb.fun/avatar.png".into());
        let server = tokio::spawn(async move {
            let (mut socket,_) = proxy.accept().await.unwrap();
            let mut request = [0;4096]; let length = socket.read(&mut request).await.unwrap();
            let text = String::from_utf8_lossy(&request[..length]);
            assert!(text.starts_with("CONNECT s3.mangafunb.fun:443 "),"{text}");
            socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let result = tokio::time::timeout(Duration::from_secs(2),route(&session,"GET",&format!("chapter/{COMMENT_CHAPTER}/comment-avatar/11"),b"")).await.unwrap();
        assert!(matches!(result,Err(AppError::Network(_))));
        server.await.unwrap();
        assert_eq!(session.chapters.lock().await.len(),1);
        assert!(!session.chapters.lock().await.contains_key(COMMENT_CHAPTER));
        for table in ["android_reading_progress","android_reading_bookmarks"] {
            assert_eq!(sqlx::query_scalar::<_,i64>(&format!("SELECT COUNT(*) FROM {table}")).fetch_one(&session.state.pool).await.unwrap(),0);
        }
    }
    #[tokio::test]
    async fn comic_progress_roundtrips_and_rejects_invalid_page_or_offset() {
        let (session, _root) = fixture("comic").await;
        session.manifest("one").await.unwrap();
        assert!(crate::reading_history::list_in_pool(&session.state.pool).await.unwrap().is_empty());
        route(&session,"POST","chapter/one/progress",br#"{"pageIndex":1,"offset":0.4}"#).await.unwrap();
        assert_eq!(session.manifest("one").await.unwrap()["location"],json!({"pageIndex":1,"offset":0.4}));
        let history = serde_json::to_value(crate::reading_history::list_in_pool(&session.state.pool).await.unwrap()).unwrap();
        assert_eq!(history[0]["entryTitle"], "第一章");
        assert_eq!(history[0]["pageCount"], 2);
        assert_eq!(history[0]["location"], json!({"pageIndex":1,"offset":0.4}));
        for invalid in [json!({"pageIndex":2}),json!({"pageIndex":0,"offset":-1}),json!({"pageIndex":0,"offset":1.1})] {
            assert!(session.location("one",&invalid).await.is_err());
        }
    }
    #[tokio::test]
    async fn novel_locations_are_confined_to_publication_resources() {
        let (session, _root) = fixture("novel").await;
        assert!(session.location("one",&json!({"href":"OEBPS/chapter-0.xhtml","locations":{"progression":0.4}})).await.is_ok());
        for href in ["https://example.com","../secret","/absolute","OEBPS/chapter-9.xhtml"] {
            assert!(session.location("one",&json!({"href":href})).await.is_err());
        }
        assert!(session.location("one",&json!({"href":"OEBPS/chapter-0.xhtml","locations":{"progression":2}})).await.is_err());
    }
    #[tokio::test]
    async fn novel_progress_records_the_real_locator_without_comic_page_counts() {
        let (session, _root) = fixture("novel").await;
        let location = json!({"href":"OEBPS/chapter-0.xhtml","locations":{"progression":0.4,"totalProgression":0.2}});
        route(&session, "POST", "chapter/one/progress", &serde_json::to_vec(&location).unwrap()).await.unwrap();
        let history = serde_json::to_value(crate::reading_history::list_in_pool(&session.state.pool).await.unwrap()).unwrap();
        assert_eq!(history[0]["kind"], "novel");
        assert_eq!(history[0]["entryTitle"], "第一章");
        assert_eq!(history[0]["pageCount"], Value::Null);
        assert_eq!(history[0]["location"], location);
        assert!(route(&session, "POST", "chapter/one/progress", br#"{"href":"../outside.xhtml"}"#).await.is_err());
        assert_eq!(session.manifest("one").await.unwrap()["location"], location);
    }
    #[tokio::test]
    async fn reader_history_hides_removed_entries_but_keeps_resume_location_and_bookmarks() {
        let (session, _root) = fixture("comic").await;
        route(&session, "POST", "chapter/one/progress", br#"{"pageIndex":1,"offset":0.4}"#).await.unwrap();
        route(&session, "POST", "chapter/one/bookmark", br#"{"location":{"pageIndex":1},"label":"saved"}"#).await.unwrap();
        crate::reading_history::remove_in_pool(&session.state.pool, "comic", "book", "default", "one").await.unwrap();
        let (body, _) = route(&session, "GET", "history", b"").await.unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), json!([]));
        assert_eq!(session.manifest("one").await.unwrap()["location"], json!({"pageIndex":1,"offset":0.4}));
        assert_eq!(session.bookmarks().await.unwrap().as_array().unwrap().len(), 1);
        route(&session, "POST", "chapter/one/progress", br#"{"pageIndex":1,"offset":0.5}"#).await.unwrap();
        let (body, _) = route(&session, "GET", "history", b"").await.unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap().as_array().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn bookmarks_are_deduplicated_and_isolated_by_group() {
        let (mut session, _root) = fixture("comic").await;
        let body = br#"{"location":{"pageIndex":0},"label":"bookmark"}"#;
        route(&session,"POST","chapter/one/bookmark",body).await.unwrap();
        route(&session,"POST","chapter/one/bookmark",body).await.unwrap();
        let marks = session.bookmarks().await.unwrap();
        assert_eq!(marks.as_array().unwrap().len(),1);
        session.group = "another".into();
        assert!(session.bookmarks().await.unwrap().as_array().unwrap().is_empty());
    }
    #[test]
    fn source_text_is_escaped_and_paragraph_anchors_are_stable() {
        let html = String::from_utf8(section_document(&json!({"title":"<title>","text":"<script>\n第二段"}),0)).unwrap();
        assert!(!html.contains("<script>")); assert!(html.contains("&lt;script&gt;")); assert!(html.contains("id=\"p1\""));
    }
    #[tokio::test]
    async fn http_requires_token_and_rejects_foreign_origins() {
        let (session,_root) = fixture("comic").await;
        let session = Arc::new(session);
        for (path,origin,expected) in [("/wrong/chapter/one","",400),("/token/chapter/one","Origin: https://example.com\r\n",400),("/token/chapter/one","",200)] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let owned = session.clone();
            let server = tokio::spawn(async move { let (stream,_) = listener.accept().await.unwrap(); serve(stream,&owned,"token").await.unwrap(); });
            let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
            client.write_all(format!("GET {path} HTTP/1.1\r\nHost: {address}\r\n{origin}\r\n").as_bytes()).await.unwrap();
            let mut bytes = Vec::new(); client.read_to_end(&mut bytes).await.unwrap(); server.await.unwrap();
            let response = String::from_utf8(bytes).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {expected}")),"{response}");
        }
    }
    #[tokio::test]
    async fn existing_android_25_database_upgrades_without_changing_records_or_checksums() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = std::borrow::Cow::Owned(old.migrations.into_owned().into_iter().filter(|migration| migration.version <= 25).collect());
        old.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,favorite,rating,notes,created_at,updated_at) VALUES('existing','已有个人书籍','novel',1,8,'保留笔记','t','t')").execute(&pool).await.unwrap();
        let checksums: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let current: Vec<(i64,Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=25 ORDER BY version").fetch_all(&pool).await.unwrap();
        assert_eq!(current,checksums);
        let preserved: (String,bool,f64,String) = sqlx::query_as("SELECT title,favorite,rating,notes FROM works WHERE id='existing'").fetch_one(&pool).await.unwrap();
        assert_eq!(preserved,("已有个人书籍".into(),true,8.0,"保留笔记".into()));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&pool).await.unwrap(),0);
        crate::migration_compat::run(&pool).await.unwrap();
    }
}
