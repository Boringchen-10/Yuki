use crate::{db::{self, AppState}, error::{AppError, AppResult}};
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingHistoryItem {
    kind: String,
    path_word: String,
    group: String,
    entry_id: String,
    work_id: Option<String>,
    title: String,
    entry_title: String,
    cover_path: Option<String>,
    cover_url: Option<String>,
    location: Value,
    page_count: Option<i64>,
    updated_at: String,
}

#[derive(sqlx::FromRow)]
struct HistoryRow {
    kind: String, book_id: String, group_id: String, entry_id: String,
    work_id: Option<String>, title: Option<String>, cover_path: Option<String>,
    entry_title: Option<String>, page_count: Option<i64>, location_json: String, updated_at: String,
}

#[derive(Default)]
struct CachedLabels {
    title: Option<String>,
    cover_url: Option<String>,
    entries: HashMap<String, (String, Option<i64>)>,
}

fn valid(kind: &str, book: &str, group: &str, entry: &str) -> AppResult<()> {
    if !matches!(kind, "comic" | "novel") || !crate::comic_explore::valid_id(book)
        || !crate::comic_explore::valid_id(entry)
        || (!group.is_empty() && !crate::comic_explore::valid_id(group)) {
        return Err(AppError::Validation("阅读记录标识无效".into()));
    }
    Ok(())
}

pub(crate) async fn save_progress(pool: &SqlitePool, kind: &str, book: &str, group: &str, entry: &str,
    location: &str, title: &str, page_count: Option<i64>, now: &str) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    sqlx::query("INSERT INTO android_reading_progress(kind,book_id,group_id,entry_id,location_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET location_json=excluded.location_json,updated_at=excluded.updated_at")
        .bind(kind).bind(book).bind(group).bind(entry).bind(location).bind(now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO android_reading_history(kind,book_id,group_id,entry_id,entry_title,page_count,hidden) VALUES(?,?,?,?,?,?,0) ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET entry_title=excluded.entry_title,page_count=excluded.page_count,hidden=0")
        .bind(kind).bind(book).bind(group).bind(entry).bind(title).bind(page_count).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

async fn cached_labels(pool: &SqlitePool, kind: &str, book: &str, group: &str) -> AppResult<CachedLabels> {
    let mut labels = CachedLabels::default();
    let provider = if kind == "comic" { "copymanga" } else { "copynovel" };
    let detail_path = if kind == "comic" { format!("/api/v3/comic2/{book}:") } else { format!("/api/v3/book/{book}:") };
    let detail: Option<String> = sqlx::query_scalar("SELECT response_json FROM metadata_cache WHERE provider=? AND instr(cache_key,?)>0 ORDER BY fetched_at DESC LIMIT 1")
        .bind(provider).bind(detail_path).fetch_optional(pool).await?;
    if let Some(item) = detail.and_then(|data| serde_json::from_str::<Value>(&data).ok()).and_then(|value| value.get("item").cloned()) {
        if item["pathWord"].as_str() == Some(book) {
            labels.title = item["title"].as_str().filter(|value| !value.is_empty()).map(str::to_owned);
            labels.cover_url = item["coverUrl"].as_str().filter(|value| value.starts_with("https://")).map(str::to_owned);
        }
    }
    let path = if kind == "comic" { format!("/api/v3/comic/{book}/group/{group}/chapters:") } else { format!("/api/v3/book/{book}/volumes:") };
    let pages: Vec<String> = sqlx::query_scalar("SELECT response_json FROM metadata_cache WHERE provider='copy-reading' AND instr(cache_key,?)>0 ORDER BY fetched_at DESC")
        .bind(path).fetch_all(pool).await?;
    for data in pages {
        let Ok(value) = serde_json::from_str::<Value>(&data) else { continue };
        if value["group"].as_str() != Some(group) { continue; }
        if let Some(entries) = value["entries"].as_array() {
            for entry in entries {
                if let (Some(id), Some(title)) = (entry["id"].as_str(), entry["title"].as_str()) {
                    if !title.is_empty() {
                        labels.entries.entry(id.into()).or_insert_with(|| (title.into(), entry["count"].as_i64().filter(|count| *count > 0)));
                    }
                }
            }
        }
    }
    Ok(labels)
}

pub(crate) async fn list_in_pool(pool: &SqlitePool) -> AppResult<Vec<ReadingHistoryItem>> {
    let rows: Vec<HistoryRow> = sqlx::query_as("SELECT p.kind,p.book_id,p.group_id,p.entry_id,p.location_json,p.updated_at,h.entry_title,h.page_count,w.id AS work_id,w.title,w.cover_path FROM android_reading_progress p LEFT JOIN android_reading_history h ON h.kind=p.kind AND h.book_id=p.book_id AND h.group_id=p.group_id AND h.entry_id=p.entry_id LEFT JOIN work_external_ids e ON e.external_id=p.book_id AND e.provider=CASE p.kind WHEN 'comic' THEN 'copymanga' ELSE 'copynovel' END LEFT JOIN works w ON w.id=e.work_id AND w.type=p.kind WHERE COALESCE(h.hidden,0)=0 ORDER BY p.updated_at DESC,p.kind,p.book_id,p.group_id,p.entry_id")
        .fetch_all(pool).await?;
    let mut labels = HashMap::new();
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let key = (row.kind.clone(), row.book_id.clone(), row.group_id.clone());
        if !labels.contains_key(&key) {
            labels.insert(key.clone(), cached_labels(pool, &row.kind, &row.book_id, &row.group_id).await?);
        }
        let cached = &labels[&key];
        let entry = cached.entries.get(&row.entry_id);
        items.push(ReadingHistoryItem {
            title: row.title.or_else(|| cached.title.clone()).unwrap_or_else(|| row.book_id.clone()),
            entry_title: row.entry_title.filter(|title| !title.is_empty()).or_else(|| entry.map(|(title, _)| title.clone()))
                .unwrap_or_else(|| if row.kind == "comic" { "漫画章节" } else { "小说卷册" }.into()),
            page_count: row.page_count.or_else(|| if row.kind == "comic" { entry.and_then(|(_, count)| *count) } else { None }),
            cover_url: cached.cover_url.clone(),
            location: serde_json::from_str(&row.location_json).unwrap_or(Value::Null),
            kind: row.kind, path_word: row.book_id, group: row.group_id, entry_id: row.entry_id,
            work_id: row.work_id, cover_path: row.cover_path, updated_at: row.updated_at,
        });
    }
    Ok(items)
}

pub(crate) async fn remove_in_pool(pool: &SqlitePool, kind: &str, book: &str, group: &str, entry: &str) -> AppResult<()> {
    valid(kind, book, group, entry)?;
    let (_guard, mut tx) = db::begin_write(pool).await?;
    sqlx::query("INSERT INTO android_reading_history(kind,book_id,group_id,entry_id,hidden) SELECT kind,book_id,group_id,entry_id,1 FROM android_reading_progress WHERE kind=? AND book_id=? AND group_id=? AND entry_id=? ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET hidden=1")
        .bind(kind).bind(book).bind(group).bind(entry).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn clear_in_pool(pool: &SqlitePool) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    sqlx::query("INSERT INTO android_reading_history(kind,book_id,group_id,entry_id,hidden) SELECT kind,book_id,group_id,entry_id,1 FROM android_reading_progress WHERE 1 ON CONFLICT(kind,book_id,group_id,entry_id) DO UPDATE SET hidden=1")
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn list_reading_history(state: State<'_, AppState>) -> AppResult<Vec<ReadingHistoryItem>> { list_in_pool(&state.pool).await }
#[tauri::command]
pub async fn remove_reading_history(kind: String, path_word: String, group: String, entry_id: String, state: State<'_, AppState>) -> AppResult<()> {
    remove_in_pool(&state.pool, &kind, &path_word, &group, &entry_id).await
}
#[tauri::command]
pub async fn clear_reading_history(state: State<'_, AppState>) -> AppResult<()> { clear_in_pool(&state.pool).await }

#[cfg(test)]
mod tests {
    use super::*;

    async fn seed_books(pool: &SqlitePool) {
        sqlx::raw_sql("INSERT INTO works(id,title,type,favorite,rating,notes,created_at,updated_at) VALUES('comic-work','同名作品','comic',1,8,'私人笔记','2020','2020'),('novel-work','同名作品','novel',0,7,'小说笔记','2020','2020'); INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('comic-work','copymanga','book','2020','2020'),('novel-work','copynovel','book','2020','2020'); INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('media','comic-work','unchanged.cbz','unchanged.cbz','cbz','comic','2020','2020'); INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":4,\"offset\":0.3}','2026-10-14T08:00:00Z'),('comic','book','volume','one','{\"pageIndex\":1}','2026-10-14T07:00:00Z'),('novel','book','','one','{\"href\":\"OEBPS/chapter-0.xhtml\",\"locations\":{\"totalProgression\":0.4}}','2026-10-14T06:00:00Z'); INSERT INTO android_reading_bookmarks VALUES('mark','comic','book','default','one','{\"pageIndex\":4}','书签','2020');")
            .execute(pool).await.unwrap();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('copy-reading','v1:https://example.invalid/api/v3/comic/book/group/default/chapters:[]',?,'2026','2027')")
            .bind(serde_json::json!({"group":"default","entries":[{"id":"one","title":"第一话","count":24}]}).to_string()).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn existing_locations_upgrade_into_history_without_changing_user_data_or_migration_checksums() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = std::borrow::Cow::Owned(old.migrations.into_owned().into_iter().filter(|migration| migration.version <= 31).collect());
        old.run(&pool).await.unwrap();
        seed_books(&pool).await;
        let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        let locations: Vec<(String, String)> = sqlx::query_as("SELECT location_json,updated_at FROM android_reading_progress ORDER BY kind,group_id").fetch_all(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        let items = list_in_pool(&pool).await.unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].entry_title, "第一话");
        assert_eq!(items[0].page_count, Some(24));
        assert_eq!(items[0].location["pageIndex"], 4);
        assert_eq!(items[0].work_id.as_deref(), Some("comic-work"));
        assert_eq!(items[1].group, "volume");
        assert_eq!(items[2].kind, "novel");
        assert_eq!(items[2].work_id.as_deref(), Some("novel-work"));
        assert_eq!(items[2].title, items[0].title);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM android_reading_history").fetch_one(&pool).await.unwrap(), 0);
        assert_eq!(sqlx::query_as::<_, (String, String)>("SELECT location_json,updated_at FROM android_reading_progress ORDER BY kind,group_id").fetch_all(&pool).await.unwrap(), locations);
        assert_eq!(sqlx::query_as::<_, (i64, Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=31 ORDER BY version").fetch_all(&pool).await.unwrap(), checksums);
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT notes FROM works WHERE id='comic-work'").fetch_one(&pool).await.unwrap(), "私人笔记");
        crate::migration_compat::run(&pool).await.unwrap();
    }

    #[tokio::test]
    async fn hiding_history_keeps_resume_bookmarks_media_and_other_groups_and_real_reading_restores_only_that_entry() {
        let pool = crate::db::test_pool().await.unwrap();
        seed_books(&pool).await;
        remove_in_pool(&pool, "comic", "book", "default", "one").await.unwrap();
        let items = list_in_pool(&pool).await.unwrap();
        assert_eq!(items.len(), 2);
        assert!(!items.iter().any(|item| item.kind == "comic" && item.group == "default"));
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&pool).await.unwrap(), 3);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM android_reading_bookmarks").fetch_one(&pool).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT path FROM media_files WHERE id='media'").fetch_one(&pool).await.unwrap(), "unchanged.cbz");
        clear_in_pool(&pool).await.unwrap();
        assert!(list_in_pool(&pool).await.unwrap().is_empty());
        save_progress(&pool, "comic", "book", "default", "one", "{\"pageIndex\":5}", "重新阅读第一话", Some(24), "2026-10-14T09:00:00Z").await.unwrap();
        let reread = list_in_pool(&pool).await.unwrap();
        assert_eq!(reread.len(), 1);
        assert_eq!(reread[0].entry_title, "重新阅读第一话");
        assert_eq!(reread[0].location["pageIndex"], 5);
        assert_eq!(reread[0].updated_at, "2026-10-14T09:00:00Z");
        assert_eq!(sqlx::query_as::<_, (bool, f64, String)>("SELECT favorite,rating,notes FROM works WHERE id='comic-work'").fetch_one(&pool).await.unwrap(), (true, 8., "私人笔记".into()));
    }

    #[tokio::test]
    async fn progress_and_history_are_saved_atomically_and_uncollected_books_use_cached_titles() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("CREATE TRIGGER fail_history BEFORE INSERT ON android_reading_history BEGIN SELECT RAISE(ABORT, 'history failure'); END").execute(&pool).await.unwrap();
        assert!(save_progress(&pool, "comic", "uncollected", "default", "one", "{\"pageIndex\":0}", "第一话", Some(12), "2026-10-14T09:00:00Z").await.is_err());
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&pool).await.unwrap(), 0);
        sqlx::query("DROP TRIGGER fail_history").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) VALUES('copymanga','v1:https://example.invalid/api/v3/comic2/uncollected:[]',?,'2026','2027')")
            .bind(serde_json::json!({"item":{"pathWord":"uncollected","title":"未入书架漫画","coverUrl":"https://example.invalid/cover.jpg"}}).to_string()).execute(&pool).await.unwrap();
        save_progress(&pool, "comic", "uncollected", "default", "one", "{\"pageIndex\":0}", "第一话", Some(12), "2026-10-14T09:00:00Z").await.unwrap();
        let items = list_in_pool(&pool).await.unwrap();
        assert_eq!(items[0].title, "未入书架漫画");
        assert_eq!(items[0].work_id, None);
        assert_eq!(items[0].cover_url.as_deref(), Some("https://example.invalid/cover.jpg"));
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM works").fetch_one(&pool).await.unwrap(), 0);
        assert!(remove_in_pool(&pool, "comic", "../invalid", "default", "one").await.is_err());
    }
}
