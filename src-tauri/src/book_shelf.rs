use crate::{db::{self,AppState},error::{AppError,AppResult}};
use chrono::Utc;
use serde::{Deserialize,Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

const PREFIX:&str="android.book-shelf:";
#[derive(Clone,Default,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct ShelfEntry { pub hidden:bool, pub browsed_at:Option<String>, pub collected_at:Option<String> }
#[derive(Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum ShelfAction { Browse, Remove, Restore }

pub(crate) async fn shelf_event(pool:&SqlitePool,id:&str,action:ShelfAction)->AppResult<ShelfEntry> {
    let (_guard,mut tx)=db::begin_write(pool).await?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id=? AND type IN ('comic','novel'))").bind(id).fetch_one(&mut *tx).await?;
    if !exists {return Err(AppError::NotFound("书架作品不存在".into()));}
    let key=format!("{PREFIX}{id}");
    let previous:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(&key).fetch_optional(&mut *tx).await?;
    let mut entry=previous.and_then(|value|serde_json::from_str::<ShelfEntry>(&value).ok()).unwrap_or_default();
    let now=Utc::now().to_rfc3339();
    match action {ShelfAction::Browse=>entry.browsed_at=Some(now.clone()),ShelfAction::Remove=>entry.hidden=true,
        ShelfAction::Restore=>{if entry.hidden {entry.collected_at=Some(now.clone());}entry.hidden=false;}}
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(key).bind(serde_json::to_string(&entry)?).bind(now).execute(&mut *tx).await?;
    tx.commit().await?;Ok(entry)
}

#[tauri::command]
pub async fn get_book_shelf_state(state:State<'_,AppState>)->AppResult<HashMap<String,ShelfEntry>> {
    let rows:Vec<(String,String)>=sqlx::query_as("SELECT w.id,s.value FROM works w JOIN app_settings s ON s.key='android.book-shelf:'||w.id WHERE w.type IN ('comic','novel')")
        .fetch_all(&state.pool).await?;
    Ok(rows.into_iter().filter_map(|(id,value)|serde_json::from_str(&value).ok().map(|entry|(id,entry))).collect())
}
#[tauri::command]
pub async fn update_book_shelf_state(work_id:String,action:ShelfAction,state:State<'_,AppState>)->AppResult<ShelfEntry> {shelf_event(&state.pool,&work_id,action).await}

pub(crate) async fn favorite(pool:&SqlitePool,id:&str,value:bool)->AppResult<()> {
    let (_guard,mut tx)=db::begin_write(pool).await?;
    let current:bool=sqlx::query_scalar("SELECT favorite FROM works WHERE id=?").bind(id).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("作品不存在".into()))?;
    if current!=value {sqlx::query("UPDATE works SET favorite=?,updated_at=? WHERE id=?").bind(value).bind(Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await?;}
    tx.commit().await?;Ok(())
}
#[tauri::command]
pub async fn set_work_favorite(id:String,favorite:bool,state:State<'_,AppState>)->AppResult<()> {self::favorite(&state.pool,&id,favorite).await}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn shelf_removal_and_restore_keep_personal_data_media_and_reading_progress() {
        let pool=crate::db::test_pool().await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,status,favorite,rating,notes,created_at,updated_at) VALUES('book','测试漫画','comic','in_progress',1,9,'私人笔记','2020','2020'); INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES('file','book','unchanged.cbz','unchanged.cbz','cbz','comic',100,'2020','2020'); INSERT INTO android_reading_progress VALUES('comic','source','default','chapter','{\"page\":12}','2020');")
            .execute(&pool).await.unwrap();
        let first=shelf_event(&pool,"book",ShelfAction::Browse).await.unwrap();
        assert!(first.browsed_at.is_some());assert!(!first.hidden);
        let removed=shelf_event(&pool,"book",ShelfAction::Remove).await.unwrap();assert!(removed.hidden);assert_eq!(removed.browsed_at,first.browsed_at);
        let restored=shelf_event(&pool,"book",ShelfAction::Restore).await.unwrap();assert!(!restored.hidden);assert!(restored.collected_at.is_some());
        let row:(String,bool,f64,String,String)=sqlx::query_as("SELECT status,favorite,rating,notes,created_at FROM works WHERE id='book'").fetch_one(&pool).await.unwrap();
        assert_eq!(row,("in_progress".into(),true,9.,"私人笔记".into(),"2020".into()));
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT path FROM media_files WHERE id='file'").fetch_one(&pool).await.unwrap(),"unchanged.cbz");
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT location_json FROM android_reading_progress").fetch_one(&pool).await.unwrap(),"{\"page\":12}");
        favorite(&pool,"book",false).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT notes FROM works WHERE id='book'").fetch_one(&pool).await.unwrap(),"私人笔记");
        assert!(shelf_event(&pool,"missing",ShelfAction::Remove).await.is_err());
    }
}
