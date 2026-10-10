use crate::{
    credentials::{self, Credentials},
    db::AppState,
    error::{AppError, AppResult},
    webdav::{DavClient, DavEntry},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSource {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub directory: String,
    #[serde(skip_serializing)]
    pub credential_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub endpoint: String,
    pub directory: String,
    pub username: String,
    pub password: String,
    pub kind: String,
}

pub async fn source(pool: &SqlitePool, id: &str) -> AppResult<RemoteSource> {
    sqlx::query_as("SELECT * FROM remote_sources WHERE id = ? AND removed_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("WebDAV 来源不存在".into()))
}

pub fn client(source: &RemoteSource) -> AppResult<DavClient> {
    DavClient::new(&source.endpoint, credentials::read(&source.credential_id)?)
}

#[tauri::command]
pub async fn list_remote_sources(state: State<'_, AppState>) -> AppResult<Vec<RemoteSource>> {
    Ok(sqlx::query_as("SELECT * FROM remote_sources WHERE removed_at IS NULL ORDER BY name")
        .fetch_all(&state.pool)
        .await?)
}

pub(crate) async fn remove_source_in_pool(pool: &SqlitePool, id: &str) -> AppResult<String> {
    let (_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let credential: String = sqlx::query_scalar("SELECT credential_id FROM remote_sources WHERE id=? AND removed_at IS NULL")
        .bind(id).fetch_optional(&mut *transaction).await?.ok_or_else(|| AppError::NotFound("WebDAV 连接不存在或已移除".into()))?;
    if crate::scan_tasks::source_active(id) || crate::source_imports::source_active(id) { return Err(AppError::Validation("请先结束该来源的后台整理，再移除连接".into())); }
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE remote_sources SET removed_at=? WHERE id=?").bind(&now).bind(id).execute(&mut *transaction).await?;
    sqlx::query("UPDATE library_roots SET enabled=0,availability='offline',updated_at=? WHERE id=?").bind(&now).bind(id).execute(&mut *transaction).await?;
    sqlx::query("UPDATE media_files SET missing=1 WHERE library_root_id=?").bind(id).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(credential)
}

#[tauri::command]
pub async fn remove_webdav_source(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let credential = remove_source_in_pool(&state.pool, &id).await?;
    credentials::delete(&credential);
    crate::android_events::source_removed(&id);
    Ok(())
}

#[tauri::command]
pub async fn browse_webdav(input: ConnectionInput) -> AppResult<Vec<DavEntry>> {
    let client = DavClient::new(
        &input.endpoint,
        Credentials {
            username: input.username,
            password: input.password,
        },
    )?;
    client
        .list(client.directory_url(&input.directory)?.path())
        .await
}

#[tauri::command]
pub async fn add_webdav_source(
    input: ConnectionInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    if input.name.trim().is_empty()
        || !["auto", "video", "comic", "novel", "mixed"].contains(&input.kind.as_str())
    {
        return Err(AppError::Validation(
            "请填写名称并选择有效的媒体类型".into(),
        ));
    }
    let credential = Credentials {
        username: input.username,
        password: input.password,
    };
    let client = DavClient::new(&input.endpoint, credential.clone())?;
    let directory = input.directory.trim_matches('/').to_string();
    client
        .list(client.directory_url(&directory)?.path())
        .await?;
    let id = Uuid::new_v4().to_string();
    credentials::save(&id, &credential)?;
    let result: AppResult<()> = async {
        let (_write_guard, mut tx) = crate::db::begin_write(&state.pool).await?;
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type,availability) VALUES(?,?,?,1,?,?,'webdav','online')")
            .bind(&id).bind(format!("webdav://{id}")).bind(&input.kind).bind(&now).bind(&now).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES(?,?,?,?,?)")
            .bind(&id).bind(input.name.trim()).bind(client.base.as_str()).bind(directory).bind(&id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }.await;
    if result.is_err() {
        credentials::delete(&id);
    }
    result?;
    let _ = crate::android_sources::notify(&state.pool, &id).await;
    #[cfg(target_os = "android")]
    if matches!(input.kind.as_str(), "video" | "auto" | "mixed") {
        // A failed background start is listed as a resumable task. The saved
        // connection must not be reported as a failed save.
        let _ = crate::source_imports::start(&state, vec![id.clone()], None, true).await;
    }
    Ok(id)
}

#[tauri::command]
pub async fn update_webdav_credentials(
    id: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let source = source(&state.pool, &id).await?;
    let credential = Credentials { username, password };
    let client = DavClient::new(&source.endpoint, credential.clone())?;
    let checked = client
        .list(client.directory_url(&source.directory)?.path())
        .await;
    if let Err(error) = checked {
        crate::android_sources::set_failure(&state.pool, &id, &crate::android_sources::failure(&error.to_string())).await?;
        return Err(error);
    }
    credentials::save(&source.credential_id, &credential)?;
    sqlx::query("UPDATE library_roots SET availability='online' WHERE id=?").bind(&id).execute(&state.pool).await?;
    let _ = crate::android_sources::notify(&state.pool, &id).await;
    Ok(())
}

// Encoding every byte makes the virtual path safe with the legacy NOCASE path index.
// Case-sensitive WebDAV names such as A.mkv and a.mkv remain different resources.
pub fn virtual_path(id: &str, relative: &str) -> String {
    let segments: Vec<String> = relative
        .split('/')
        .filter(|p| !p.is_empty())
        .map(|p| p.as_bytes().iter().map(|b| format!("{b:02x}")).collect())
        .collect();
    format!("webdav://{id}/{}", segments.join("/"))
}

pub fn display_path(path: &str) -> String {
    if !path.starts_with("webdav://") {
        return path.into();
    }
    let mut parts = path[9..].split('/');
    let id = parts.next().unwrap_or_default();
    let decoded: Vec<String> = parts
        .map(|part| {
            let bytes: Option<Vec<u8>> = (0..part.len())
                .step_by(2)
                .map(|i| {
                    part.get(i..i + 2)
                        .and_then(|s| u8::from_str_radix(s, 16).ok())
                })
                .collect();
            bytes
                .and_then(|v| String::from_utf8(v).ok())
                .unwrap_or_else(|| part.into())
        })
        .collect();
    format!("webdav://{id}/{}", decoded.join("/"))
}

pub fn serialize_display_path<S: serde::Serializer>(
    path: &str,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&display_path(path))
}

#[cfg(test)]
mod removal_tests {
    use super::*;

    #[tokio::test]
    async fn existing_database_upgrade_and_removal_preserve_personal_records() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut previous = sqlx::migrate!("./migrations");
        previous.migrations = std::borrow::Cow::Owned(previous.migrations.into_owned().into_iter().filter(|migration| migration.version <= 29).collect());
        previous.run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,status,favorite,rating,notes,created_at,updated_at) VALUES('w','作品','video','completed',1,8,'保留笔记','t','t'); INSERT INTO library_roots(id,path,kind,source_type,created_at,updated_at) VALUES('r','webdav://r','video','webdav','t','t'); INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES('r','测试连接','http://127.0.0.1:1','/','qa-credential'); INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('m','w','r','webdav://r/30312e6d6b76','01.mkv','mkv','video','t','t'),('pending',NULL,'r','webdav://r/30322e6d6b76','02.mkv','mkv','video','t','t'); INSERT INTO remote_files(media_file_id,source_id,href) VALUES('m','r','/01.mkv'); INSERT INTO remote_cache(media_file_id,revision,size,completed,accessed_at) VALUES('m','v1',12,1,'t'); INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('m',1234,10000,'t');").execute(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        assert!(source(&pool, "r").await.is_ok());
        assert_eq!(remove_source_in_pool(&pool, "r").await.unwrap(), "qa-credential");
        assert!(source(&pool, "r").await.is_err()); assert!(crate::android_sources::list(&pool).await.unwrap().is_empty());
        assert!(crate::grouping::list_unassigned_groups(&pool).await.unwrap().is_empty());
        let personal: (String, bool, f64, String) = sqlx::query_as("SELECT status,favorite,rating,notes FROM works WHERE id='w'").fetch_one(&pool).await.unwrap();
        assert_eq!(personal, ("completed".into(), true, 8.0, "保留笔记".into()));
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT position_ms FROM playback_progress WHERE media_file_id='m'").fetch_one(&pool).await.unwrap(), 1234);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_files WHERE library_root_id='r' AND missing=1").fetch_one(&pool).await.unwrap(), 2);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM remote_cache").fetch_one(&pool).await.unwrap(), 1);
        assert!(remove_source_in_pool(&pool, "r").await.is_err());
    }
}

#[tauri::command]
pub async fn set_root_source_type(
    id: String,
    source_type: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if !["local", "mounted"].contains(&source_type.as_str()) {
        return Err(AppError::Validation("无效的来源类型".into()));
    }
    let result = sqlx::query(
        "UPDATE library_roots SET source_type = ? WHERE id = ? AND source_type != 'webdav' AND NOT EXISTS(SELECT 1 FROM android_saf_sources WHERE source_id=library_roots.id)",
    )
    .bind(source_type)
    .bind(id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("本地或挂载来源不存在".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn virtual_paths_roundtrip_without_case_collisions() {
        let a = virtual_path("source", "动漫/A.mkv");
        let b = virtual_path("source", "动漫/a.mkv");
        assert_ne!(a.to_lowercase(), b.to_lowercase());
        assert_eq!(display_path(&a), "webdav://source/动漫/A.mkv");
    }
}
