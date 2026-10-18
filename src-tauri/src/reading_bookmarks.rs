use crate::{db::AppState, error::{AppError, AppResult}, reading_history::cached_labels};
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReadingBookmark {
    id: String, kind: String,
    #[sqlx(rename = "book_id")]
    path_word: String,
    #[sqlx(rename = "group_id")]
    group: String,
    entry_id: String, label: String, created_at: String,
    work_id: Option<String>, title: String, entry_title: String,
    cover_path: Option<String>, cover_url: Option<String>, page_count: Option<i64>,
    #[sqlx(skip)]
    location: Value,
    #[serde(skip)]
    location_json: String,
}
pub(crate) async fn list_in_pool(pool: &SqlitePool) -> AppResult<Vec<ReadingBookmark>> {
    let mut rows: Vec<ReadingBookmark> = sqlx::query_as("SELECT b.*,w.id AS work_id,COALESCE(w.title,'') AS title,COALESCE(h.entry_title,'') AS entry_title,w.cover_path,NULL AS cover_url,h.page_count FROM android_reading_bookmarks b LEFT JOIN android_reading_history h ON h.kind=b.kind AND h.book_id=b.book_id AND h.group_id=b.group_id AND h.entry_id=b.entry_id LEFT JOIN work_external_ids e ON e.external_id=b.book_id AND e.provider=CASE b.kind WHEN 'comic' THEN 'copymanga' ELSE 'copynovel' END LEFT JOIN works w ON w.id=e.work_id AND w.type=b.kind ORDER BY b.created_at DESC,b.id")
        .fetch_all(pool).await?;
    let mut labels = HashMap::new();
    for row in &mut rows {
        let key = (row.kind.clone(), row.path_word.clone(), row.group.clone());
        if !labels.contains_key(&key) { labels.insert(key.clone(), cached_labels(pool, &row.kind, &row.path_word, &row.group).await?); }
        let cached = &labels[&key]; let entry = cached.entries.get(&row.entry_id);
        if row.title.is_empty() { row.title = cached.title.clone().unwrap_or_else(|| row.path_word.clone()); }
        if row.entry_title.is_empty() { row.entry_title = entry.map(|(title, _)| title.clone()).unwrap_or_else(|| if row.kind == "comic" { "漫画章节" } else { "小说卷册" }.into()); }
        row.cover_url = cached.cover_url.clone();
        if row.page_count.is_none() && row.kind == "comic" { row.page_count = entry.and_then(|(_, count)| *count); }
        row.location = serde_json::from_str(&row.location_json).unwrap_or(Value::Null);
    }
    Ok(rows)
}
pub(crate) async fn location_in_pool(pool: &SqlitePool, id: &str, kind: &str, book: &str, group: &str, entry: &str) -> AppResult<Value> {
    let location: String = sqlx::query_scalar("SELECT location_json FROM android_reading_bookmarks WHERE id=? AND kind=? AND book_id=? AND group_id=? AND entry_id=?")
        .bind(id).bind(kind).bind(book).bind(group).bind(entry).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("书签已不存在，请刷新列表".into()))?;
    Ok(serde_json::from_str(&location)?)
}
#[tauri::command]
pub async fn list_reading_bookmarks(state: State<'_, AppState>) -> AppResult<Vec<ReadingBookmark>> { list_in_pool(&state.pool).await }
pub(crate) async fn remove_in_pool(pool: &SqlitePool, id: &str) -> AppResult<()> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::Validation("书签标识无效".into()))?;
    sqlx::query("DELETE FROM android_reading_bookmarks WHERE id=?").bind(id).execute(pool).await?;
    crate::android_events::bookmarks(); Ok(())
}
#[tauri::command]
pub async fn remove_reading_bookmark(id: String, state: State<'_, AppState>) -> AppResult<()> { remove_in_pool(&state.pool, &id).await }

#[cfg(test)]
mod tests {
    use super::*;
    async fn seed(pool: &SqlitePool) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::raw_sql("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('work','测试漫画','comic','保留笔记','old','old'); INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('work','copymanga','book','old','old'); INSERT INTO android_reading_progress VALUES('comic','book','default','one','{\"pageIndex\":8}','new'); INSERT INTO android_reading_history VALUES('comic','book','default','one','第一话',20,1);")
            .execute(pool).await.unwrap();
        sqlx::query("INSERT INTO android_reading_bookmarks VALUES(?,'comic','book','default','one','{\"pageIndex\":2,\"offset\":0.4}','第三页书签','old')").bind(&id).execute(pool).await.unwrap(); id
    }
    #[tokio::test]
    async fn listing_keeps_hidden_history_bookmarks_and_their_original_location() {
        let pool = crate::db::test_pool().await.unwrap(); let id = seed(&pool).await;
        let items = list_in_pool(&pool).await.unwrap(); assert_eq!(items.len(),1);
        assert_eq!(items[0].id,id); assert_eq!(items[0].title,"测试漫画"); assert_eq!(items[0].entry_title,"第一话");
        assert_eq!(items[0].location["pageIndex"],2); assert_eq!(items[0].page_count,Some(20));
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT location_json FROM android_reading_progress").fetch_one(&pool).await.unwrap(),"{\"pageIndex\":8}");
    }
    #[tokio::test]
    async fn jump_requires_the_book_group_chapter_and_kind_to_match() {
        let pool = crate::db::test_pool().await.unwrap(); let id = seed(&pool).await;
        assert_eq!(location_in_pool(&pool,&id,"comic","book","default","one").await.unwrap()["offset"],0.4);
        for (kind,book,group,entry) in [("novel","book","default","one"),("comic","other","default","one"),("comic","book","volume","one"),("comic","book","default","two")] {
            assert!(location_in_pool(&pool,&id,kind,book,group,entry).await.is_err());
        }
    }
    #[tokio::test]
    async fn deletion_removes_only_one_bookmark_and_preserves_progress_and_notes() {
        let pool = crate::db::test_pool().await.unwrap(); let id = seed(&pool).await;
        let other=uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO android_reading_bookmarks VALUES(?,'novel','book','','one','{\"href\":\"OEBPS/chapter-0.xhtml\"}','小说书签','old')").bind(&other).execute(&pool).await.unwrap();
        assert!(remove_in_pool(&pool,"invalid").await.is_err());
        remove_in_pool(&pool,&id).await.unwrap(); remove_in_pool(&pool,&id).await.unwrap();
        assert_eq!(list_in_pool(&pool).await.unwrap()[0].id,other);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM android_reading_progress").fetch_one(&pool).await.unwrap(),1);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT notes FROM works").fetch_one(&pool).await.unwrap(),"保留笔记");
    }
}
