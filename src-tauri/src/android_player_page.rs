//! Native portrait player data. Reuse the library identities, artwork cache and
//! Bangumi transport; never hand media addresses or credentials to the page.
use crate::{android_bridge, android_player, db::AppState, error::{AppError, AppResult}, rule_bindings::BindingInput};
use serde_json::{json, Value};
use sqlx::FromRow;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct RuleOrigin { plugin: String, source: String, work: Option<String>, title: String, road: usize, index: usize, offset: i64 }
static PREVIEW: Mutex<Option<(String, RuleOrigin)>> = Mutex::new(None);
static SERVING: Mutex<Vec<String>> = Mutex::new(Vec::new());
pub(crate) fn preview_origin(session: &str, plugin: &str, source: &str, road: usize, index: usize) {
    *PREVIEW.lock().unwrap() = Some((session.into(), RuleOrigin { plugin:plugin.into(), source:source.into(), work:None, title:"规则试播".into(), road, index, offset:0 }));
}
pub(crate) fn bound_origin(session: &str, input: &BindingInput) {
    *PREVIEW.lock().unwrap() = Some((session.into(), RuleOrigin {plugin:input.plugin_id.clone(),source:input.source.clone(),work:Some(input.work_id.clone()),title:input.title.clone(),road:input.road_index,index:input.episode_indexes[0],offset:input.episode_offset}));
}

#[derive(Clone, FromRow)]
struct FileRow {
    id: String, file_name: String, library_root_id: Option<String>,
    missing: bool, enabled: bool, label: String, provider: Option<String>, external_id: Option<String>,
    original_number: Option<i64>, official_number: Option<i64>, episode_title: Option<String>,
}
#[derive(Clone)]
struct PageContext { work: Option<String>, bangumi: Option<String>, comment_episode: Option<(String,String)>, comments: Arc<tokio::sync::Mutex<Option<Vec<crate::models::BangumiEpisodeDiscussion>>>>, rule: Option<RuleOrigin>, rows: Vec<Value>, title: String, roads: Vec<Value>, selected_source: String }

fn episode_key(file: &FileRow) -> Option<String> {
    Some(format!("{}:{}", file.provider.as_ref()?, file.external_id.as_ref()?))
}
fn file_card(file: &FileRow, current: &str) -> Value {
    json!({"id":file.id,"mediaFileId":file.id,"label":file.official_number.or(file.original_number).map(|n|format!("第{n:02}集")).unwrap_or_else(||"视频文件".into()),
        "title":file.episode_title.as_ref().unwrap_or(&file.file_name),"sourceId":file.library_root_id,"sourceLabel":file.label,
        "episodeKey":episode_key(file),"current":file.id==current,"available":!file.missing&&file.enabled})
}

fn comment_episode(rows: &[Value], media: Option<&str>) -> Option<(String,String)> {
    // A real file's explicit official link takes precedence, including an explicit unlink.
    let file = media.and_then(|id| rows.iter().find(|row|row["mediaFileId"]==id && row["current"]==true));
    let row = file.or_else(|| rows.iter().find(|row|row["current"]==true && row.get("ruleRoad").is_some()))?;
    let id = row["episodeKey"].as_str()?.strip_prefix("bangumi:")?.parse::<u64>().ok().filter(|id|*id>0)?;
    Some((id.to_string(), row["label"].as_str().unwrap_or("当前集").into()))
}

async fn context(state: &AppState, session: &str, media: Option<&str>) -> AppResult<PageContext> {
    let preview = PREVIEW.lock().unwrap().as_ref().filter(|(id,_)| id==session).map(|(_,origin)|origin.clone());
    let work: Option<String> = if let Some(media) = media { sqlx::query_scalar("SELECT work_id FROM media_files WHERE id=?").bind(media).fetch_optional(&state.pool).await?.flatten() } else { None };
    let work = work.or_else(||preview.as_ref().and_then(|origin|origin.work.clone()));
    let title: Option<String> = if let Some(work) = &work { sqlx::query_scalar("SELECT title FROM works WHERE id=?").bind(work).fetch_optional(&state.pool).await? } else { None };
    let bangumi = if let Some(work) = &work { sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id=? AND provider='bangumi'").bind(work).fetch_optional(&state.pool).await? } else { None };
    let files: Vec<FileRow> = sqlx::query_as("SELECT m.id,m.file_name,m.library_root_id,m.missing,COALESCE(r.enabled,0) enabled,COALESCE(p.name,w.name,s.label,'本地') label,l.provider,l.episode_external_id external_id,m.parsed_episode_start original_number,e.episode_number official_number,e.title episode_title FROM media_files m LEFT JOIN library_roots r ON r.id=m.library_root_id LEFT JOIN rule_plugins p ON p.id=r.id LEFT JOIN remote_sources w ON w.id=r.id LEFT JOIN android_saf_sources s ON s.source_id=r.id LEFT JOIN media_episode_links l ON l.media_file_id=m.id AND l.work_id=m.work_id LEFT JOIN anime_episodes e ON e.work_id=l.work_id AND e.provider=l.provider AND e.external_id=l.episode_external_id WHERE m.media_type='video' AND ((? IS NOT NULL AND m.work_id=?) OR m.id=?) ORDER BY COALESCE(e.sort_number,m.parsed_episode_start),m.file_name,m.id")
        .bind(&work).bind(&work).bind(media).fetch_all(&state.pool).await?;
    let current_file = files.iter().find(|file|Some(file.id.as_str())==media);
    let mut rule = preview;
    if rule.is_none() {
        if let Some(media) = media {
            let row: Option<(String,String,String)> = sqlx::query_as("SELECT plugin_id,source_key,page_url FROM rule_episodes WHERE media_file_id=?").bind(media).fetch_optional(&state.pool).await?;
            if let Some((plugin, source, key)) = row {
                let definition = crate::rule_sources::definition(&state.pool,&plugin).await?;
                let chapters = crate::rule_sources::chapters(&state.pool,&plugin,&source,false).await?;
                'find: for (road_index,road) in chapters.roads.iter().enumerate() {
                    for (index,episode) in road.episodes.iter().enumerate() {
                        if crate::rule_sources::episode_key(&definition,&source,road,index)?==key || episode.url==key {
                            let offset=current_file.and_then(|f|Some(f.original_number? - f.official_number?)).unwrap_or(0);
                            rule=Some(RuleOrigin {plugin:plugin.clone(),source:source.clone(),work:work.clone(),title:title.clone().unwrap_or_else(||"规则视频".into()),road:road_index,index,offset}); break 'find;
                        }
                    }
                }
            }
        }
    }
    let mut rows: Vec<Value> = files.iter().map(|file|file_card(file,media.unwrap_or(""))).collect();
    let mut roads = Vec::new();
    let selected_source = if let Some(rule) = &rule {
        let definition=crate::rule_sources::definition(&state.pool,&rule.plugin).await?;
        let chapters = crate::rule_sources::chapters(&state.pool,&rule.plugin,&rule.source,false).await?;
        let official = if let Some(work) = &work { crate::metadata_aggregator::episodes_for_work(&state.pool,work).await? } else { vec![] };
        let bound:Vec<(String,String)>=sqlx::query_as("SELECT e.page_url,e.media_file_id FROM rule_episodes e JOIN media_files m ON m.id=e.media_file_id WHERE e.plugin_id=? AND e.source_key=? AND m.work_id=?").bind(&rule.plugin).bind(&rule.source).bind(&rule.work).fetch_all(&state.pool).await?;
        for (road_index,road) in chapters.roads.iter().enumerate() {
            let source_id=format!("rule:{road_index}"); roads.push(json!({"id":source_id,"label":road.name}));
            for (index,episode) in road.episodes.iter().enumerate() {
                let target=crate::rule_bindings::number(&episode.name).map(|n|n-rule.offset);
                let matched:Vec<_>=official.iter().filter(|e|e.episode_type.unwrap_or(0)==0 && e.episode_number.map(i64::from)==target && target.is_some()).collect();
                let matched=(matched.len()==1).then(||matched[0]);
                let stable_key=crate::rule_sources::episode_key(&definition,&rule.source,road,index)?;
                let bound_file=bound.iter().find(|(key,_)|key==&stable_key||key==&episode.url).and_then(|(_,id)|files.iter().find(|file|&file.id==id));
                let (key,title)=if let Some(file)=bound_file {(episode_key(file),file.episode_title.clone())}else{(matched.map(|e|format!("{}:{}",e.provider,e.external_id)),matched.map(|e|e.title.clone()))};
                rows.push(json!({"id":format!("rule:{road_index}:{index}"),"label":episode.name,"title":title,"episodeKey":key,"sourceId":source_id,"sourceLabel":road.name,"ruleRoad":road_index,"ruleIndex":index,"current":road_index==rule.road&&index==rule.index,"available":bound_file.is_none_or(|file|!file.missing&&file.enabled)}));
            }
        }
        format!("rule:{}",rule.road)
    } else { current_file.and_then(|file|file.library_root_id.clone()).unwrap_or_default() };
    let title=title.or_else(||rule.as_ref().map(|r|r.title.clone())).or_else(||current_file.map(|f|f.file_name.clone())).unwrap_or_else(||"视频播放".into());
    // Each file keeps its actual official link; do not infer an episode from its position.
    if let Some(work) = &work {
        if let Ok(artwork) = crate::episode_artwork::cached(&state.pool,work).await {
            for row in &mut rows {
                if let Some(url)=row["episodeKey"].as_str().and_then(|key|artwork.images.get(key)) {
                    let path=crate::metadata_aggregator::artwork_cache_path(&state.cover_cache_path,work,"episode",url);
                    if path.is_file() { row["imagePath"]=json!(path.to_string_lossy()); }
                }
            }
        }
    }
    let comment_episode=comment_episode(&rows,media);
    Ok(PageContext {work,bangumi,comment_episode,comments:Arc::new(tokio::sync::Mutex::new(None)),rule,rows,title,roads,selected_source})
}

async fn reply(session: &str, id: u64, channel: &str, data: Value) {
    if android_player::is_current(session) {
        let _=android_bridge::call("updatePlayerPage",json!({"sessionId":session,"requestId":id,"channel":channel,"data":data.to_string()})).await;
    }
}

pub(crate) fn serve(state: AppState, session: String) {
    { let mut serving=SERVING.lock().unwrap(); if serving.contains(&session) { return; } serving.push(session.clone()); }
    let page:Arc<tokio::sync::Mutex<Option<PageContext>>>=Arc::new(tokio::sync::Mutex::new(None));
    tauri::async_runtime::spawn(async move {
        let slots=Arc::new(tokio::sync::Semaphore::new(3));
        while android_player::is_current(&session) {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let Ok(request)=android_bridge::call("takePlayerPageRequest",json!({"sessionId":session})).await else { break };
            if request["closed"]==true { break; }
            let Some(id)=request["id"].as_u64() else { continue };
            let state=state.clone();let session=session.clone();let page=page.clone();let slots=slots.clone();
            tauri::async_runtime::spawn(async move {
                let action=request["action"].as_str().unwrap_or("");
                let _permit=if action=="image" { slots.acquire().await.ok() } else { None };
                if !android_player::is_current(&session) { return; }
                let result=async {
                    if action=="context" {
                        let context=context(&state,&session,request["mediaFileId"].as_str()).await?;
                        let data=json!({"title":context.title,"rows":context.rows,"roads":context.roads,"selectedSource":context.selected_source,"hasBangumi":context.bangumi.is_some(),"commentEpisodeId":context.comment_episode.as_ref().map(|value|&value.0),"commentEpisodeLabel":context.comment_episode.as_ref().map(|value|&value.1)});
                        *page.lock().await=Some(context); return Ok(data);
                    }
                    let context=page.lock().await.clone().ok_or_else(||AppError::Validation("播放资料尚未就绪，请稍后重试".into()))?;
                    match action {
                        "comments" => {
                            let (episode,label)=context.comment_episode.ok_or_else(||AppError::Validation("当前视频未匹配 Bangumi 分集，请先完成剧集匹配".into()))?;
                            let offset=request["offset"].as_u64().filter(|n|*n<=1_000_000).unwrap_or(0) as usize;
                            let mut cached=context.comments.lock().await;
                            if cached.is_none() { *cached=Some(crate::bangumi::BangumiProvider::new()?.episode_comments(&episode).await?); }
                            let all=cached.as_ref().unwrap();
                            let items=all.iter().skip(offset).take(20).collect::<Vec<_>>();
                            Ok(json!({"items":items,"total":all.len(),"offset":offset,"limit":20,"episodeId":episode,"episodeLabel":label}))
                        },
                        "image" => {
                            let key=request["episodeKey"].as_str().unwrap_or("");
                            if !context.rows.iter().any(|row|row["episodeKey"]==key) { return Err(AppError::Validation("分集不属于当前作品".into())); }
                            let path=if let Some(work)=context.work { crate::episode_artwork::cache_for_player(&state,&work,key).await? } else {None};
                            Ok(json!({"episodeKey":key,"path":path}))
                        },
                        "play" => {
                            let target=request["target"].as_str().unwrap_or("");
                            let row=context.rows.iter().find(|row|row["id"]==target && row["available"]==true).ok_or_else(||AppError::Validation("此剧集来源不可用，请重新选择".into()))?;
                            if !android_player::is_current(&session) { return Ok(Value::Null); }
                            if let Some(media)=row["mediaFileId"].as_str() {
                                    let (loading,opening)=android_player::start_rule_loading(&state,Some(media.into())).await?;
                                    let media=media.to_owned(); let state=state.clone();
                                    tauri::async_runtime::spawn(async move { if let Err(error)=android_player::open_rule_player(media,&state,&loading).await { android_player::rule_loading_failed(&loading,&error).await; } });
                                    Ok(opening)
                            } else {
                                let rule=context.rule.ok_or_else(||AppError::Validation("线路资料已失效".into()))?;
                                let road=row["ruleRoad"].as_u64().unwrap() as usize; let index=row["ruleIndex"].as_u64().unwrap() as usize;
                                if let Some(work)=rule.work {
                                    crate::rule_bindings::play_selection(state.clone(),BindingInput {work_id:work,plugin_id:rule.plugin,source:rule.source,title:rule.title,road_index:road,episode_indexes:vec![index],episode_offset:rule.offset,replace_existing:false}).await
                                } else { crate::rule_sources::preview_selection(state.clone(),rule.plugin,rule.source,road,index).await }
                            }
                        },
                        _ => Err(AppError::Validation("未知播放器操作".into())),
                    }
                }.await;
                match result { Ok(data)=>reply(&session,id,action,data).await, Err(_)=>reply(&session,id,action,json!({"error":match action {"comments"=>"Bangumi 本集讨论读取失败，请检查网络后重试。","play"=>"打开剧集失败，请重试或返回选择其他来源。","image"=>"",_=>"播放资料读取失败，请重试。"}})).await }
            });
        }
        SERVING.lock().unwrap().retain(|id|id!=&session);
        let mut preview=PREVIEW.lock().unwrap(); if preview.as_ref().is_some_and(|(id,_)|id==&session) { *preview=None; }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn episode_discussion_target_uses_explicit_link_and_never_filename_or_list_index() {
        let rows=vec![json!({"mediaFileId":"f","current":true,"episodeKey":"bangumi:1212094","label":"第01集","title":"13.mp4"})];
        assert_eq!(comment_episode(&rows,Some("f")),Some(("1212094".into(),"第01集".into())));
        let unlinked=vec![json!({"mediaFileId":"f","current":true,"episodeKey":null,"label":"第13集"}),json!({"current":true,"ruleRoad":0,"episodeKey":"bangumi:1212094"})];
        assert!(comment_episode(&unlinked,Some("f")).is_none());
        let other=vec![json!({"mediaFileId":"f","current":true,"episodeKey":"tmdb:1212094"})];
        assert!(comment_episode(&other,Some("f")).is_none());
        let rule=vec![json!({"current":true,"ruleRoad":0,"episodeKey":"bangumi:1212095","label":"第02集"})];
        assert_eq!(comment_episode(&rule,None),Some(("1212095".into(),"第02集".into())));
        assert!(comment_episode(&[json!({"current":true,"ruleRoad":0,"label":"第01集"})],None).is_none());
    }

    use super::*;
    #[tokio::test]
    async fn library_page_uses_actual_official_links_and_keeps_other_works_out() {
        let pool=crate::db::test_pool().await.unwrap();let dir=tempfile::tempdir().unwrap();
        let state=AppState {pool:pool.clone(),database_path:dir.path().join("qa.db"),data_directory:dir.path().into(),cover_cache_path:dir.path().into(),thumbnail_cache_path:dir.path().into()};
        sqlx::raw_sql("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','第二季','video','t','t'),('other','其他作品','video','t','t'); INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at) VALUES('s','saf://s','video',1,'t','t'),('off','saf://off','video',0,'t','t'); INSERT INTO android_saf_sources VALUES('s','content://qa/tree/s','本地测试'),('off','content://qa/tree/off','已停用'); INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES('w','bangumi','123','t','t'); INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,title,fetched_at) VALUES('w','bangumi','ep1',1,1,'官方第一集','t'); INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,size,created_at,updated_at,parsed_episode_start) VALUES('f','w','s','saf://s/a','13.mp4','mp4','video',1,'t','t',13),('next','w','s','saf://s/b','14.mp4','mp4','video',1,'t','t',14),('unavailable','w','off','saf://off/c','15.mp4','mp4','video',1,'t','t',15),('other-file','other','s','saf://s/d','01.mp4','mp4','video',1,'t','t',1); INSERT INTO media_episode_links VALUES('f','w','bangumi','ep1','manual',1,'t');")
            .execute(&pool).await.unwrap();
        let page=context(&state,"test-library",Some("f")).await.unwrap();
        assert_eq!(page.title,"第二季");assert_eq!(page.bangumi.as_deref(),Some("123"));assert_eq!(page.rows.len(),3);
        let current=page.rows.iter().find(|row|row["mediaFileId"]=="f").unwrap();
        assert_eq!(current["episodeKey"],"bangumi:ep1");assert_eq!(current["label"],"第01集");assert_eq!(current["current"],true);
        assert!(page.rows.iter().find(|row|row["mediaFileId"]=="next").unwrap()["episodeKey"].is_null());
        assert_eq!(page.rows.iter().find(|row|row["mediaFileId"]=="unavailable").unwrap()["available"],false);
        assert!(!serde_json::to_string(&page.rows).unwrap().contains("content://"));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM playback_progress").fetch_one(&pool).await.unwrap(),0);
    }
}
