//! Kazumi-compatible rule data and API templates. Adapted from Predidit/Kazumi
//! 2768c230 (GPL-3.0), api_rule_strategy.dart; no Dart/Flutter runtime required.
use crate::error::{AppError, AppResult};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub name: String,
    pub source: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub name: String,
    pub url: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Road {
    pub name: String,
    pub episodes: Vec<Episode>,
}
pub fn string(value: &Value) -> String {
    match value {
        Value::String(v) => v.trim().into(),
        Value::Null => String::new(),
        _ => value.to_string(),
    }
}
pub fn field(value: &Value, key: &str) -> String {
    string(&value[key])
}
pub fn flag(value: &Value, key: &str) -> bool {
    value[key].as_bool().unwrap_or(false)
}
fn config_field(value: &Value, key: &str, default: &str) -> String {
    if value[key].is_null() {
        default.into()
    } else {
        field(value, key)
    }
}
pub fn http_url(raw: &str) -> AppResult<Url> {
    let url =
        Url::parse(raw.trim()).map_err(|_| AppError::Validation("规则中的网址无效".into()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || raw.len() > 16384
    {
        return Err(AppError::Validation(
            "规则网址须为有效 HTTP / HTTPS 地址，不能含账号密码".into(),
        ));
    }
    Ok(url)
}
pub fn absolute(base: &str, raw: &str) -> AppResult<String> {
    let base = http_url(base)?;
    let url = base
        .join(raw.trim())
        .map_err(|_| AppError::Validation("规则返回了无效链接".into()))?;
    Ok(http_url(url.as_str())?.to_string())
}
pub fn merge_query(url: &mut Url, values: &Value) {
    if let Some(values) = values.as_object() {
        let mut merged: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
        merged.extend(
            values
                .iter()
                .map(|(key, value)| (key.clone(), string(value))),
        );
        url.set_query(None);
        if !merged.is_empty() {
            url.query_pairs_mut().extend_pairs(merged);
        }
    }
}
pub fn validate(rule: &Value) -> AppResult<()> {
    if serde_json::to_vec(rule)?.len() > 262144 {
        return Err(AppError::Validation("规则 JSON 超过 256 KiB".into()));
    }
    if !rule.is_object()
        || field(rule, "name").is_empty()
        || field(rule, "name").chars().count() > 80
        || field(rule, "version").len() > 64
    {
        return Err(AppError::Validation("规则需包含有效 name / version".into()));
    }
    let api = if rule["api"].is_null() { 1 } else {
        field(rule, "api").parse::<u32>().map_err(|_| AppError::Validation("规则 API 版本须为整数".into()))?
    };
    if !(1..=9).contains(&api) {
        return Err(AppError::Validation("目前支持 Kazumi API 1–9 规则，请更新客户端后重试".into()));
    }
    http_url(&field(rule, "baseURL"))?;
    for key in ["userAgent", "referer"] {
        let text = field(rule, key);
        if text.len() > 4096 || text.contains(['\r', '\n']) {
            return Err(AppError::Validation("规则请求头无效".into()));
        }
    }
    for (mode, config, selectors) in [
        (
            "searchMode",
            "searchApiConfig",
            vec!["searchList", "searchName", "searchResult"],
        ),
        (
            "chapterMode",
            "chapterApiConfig",
            vec!["chapterRoads", "chapterResult"],
        ),
    ] {
        if field(rule, mode) == "api" {
            let c = &rule[config];
            let request = &c["request"];
            let method = field(request, "method").to_uppercase();
            if !method.is_empty() && !["GET", "POST"].contains(&method.as_str()) {
                return Err(AppError::Validation("API 规则只支持 GET / POST".into()));
            }
            let template = field(request, "url");
            if template.is_empty() {
                return Err(AppError::Validation("API 规则缺少请求地址".into()));
            }
            if mode == "searchMode" {
                search_source_template(c)?;
            }
            for key in [
                "listPath",
                "namePath",
                "sourcePath",
                "roadsPath",
                "roadNamePath",
                "episodesPath",
                "episodeNamePath",
                "episodeUrlPath",
                "roadNamesPath",
                "roadEpisodesPath",
            ] {
                let expression = field(c, key);
                if !expression.is_empty() {
                    path_tokens(&expression)?;
                }
            }
        } else {
            for key in selectors {
                let expression = field(rule, key);
                if expression.is_empty() || expression.len() > 2048 {
                    return Err(AppError::Validation(format!("规则 {key} 选择器为空或过长")));
                }
            }
            if mode == "searchMode" {
                http_url(&field(rule, "searchURL").replace("@keyword", "test"))?;
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
enum Step {
    Key(String),
    Index(usize),
    All,
}
fn path_tokens(path: &str) -> AppResult<Vec<Step>> {
    let invalid =
        || AppError::Validation("规则 JSONPath 需使用 Kazumi 支持的字段、下标或 [*] 语法".into());
    if path.len() > 2048 || !path.starts_with('$') {
        return Err(invalid());
    }
    let mut rest = &path[1..];
    let mut steps = Vec::new();
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix('.') {
            let end = tail
                .find(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$' | '-'))
                .unwrap_or(tail.len());
            if end == 0 {
                return Err(invalid());
            }
            steps.push(Step::Key(tail[..end].into()));
            rest = &tail[end..];
        } else if let Some(tail) = rest.strip_prefix('[') {
            let mut quote = None;
            let mut escaped = false;
            let mut end = None;
            for (i, c) in tail.char_indices() {
                if escaped {
                    escaped = false;
                    continue;
                }
                if c == '\\' {
                    escaped = true;
                    continue;
                }
                if let Some(q) = quote {
                    if c == q {
                        quote = None;
                    }
                } else if c == '\'' || c == '"' {
                    quote = Some(c);
                } else if c == ']' {
                    end = Some(i);
                    break;
                }
            }
            let end = end.ok_or_else(invalid)?;
            let part = tail[..end].trim();
            let step = if part == "*" {
                Step::All
            } else if part.chars().all(|c| c.is_ascii_digit()) && !part.is_empty() {
                Step::Index(part.parse().map_err(|_| invalid())?)
            } else if part.starts_with('"') && part.ends_with('"') {
                Step::Key(serde_json::from_str(part).map_err(|_| invalid())?)
            } else if part.starts_with('\'') && part.ends_with('\'') && part.len() >= 2 {
                Step::Key(
                    part[1..part.len() - 1]
                        .replace("\\'", "'")
                        .replace("\\\\", "\\"),
                )
            } else {
                return Err(invalid());
            };
            steps.push(step);
            rest = &tail[end + 1..];
        } else {
            return Err(invalid());
        }
        if steps.len() > 64 {
            return Err(invalid());
        }
    }
    Ok(steps)
}
pub fn query<'a>(value: &'a Value, path: &str) -> AppResult<Vec<&'a Value>> {
    let mut values = vec![value];
    for step in path_tokens(path)? {
        let mut next = Vec::new();
        for value in values {
            match &step {
                Step::Key(key) => {
                    if let Some(v) = value.get(key) {
                        next.push(v);
                    }
                }
                Step::Index(index) => {
                    if let Some(v) = value.get(*index) {
                        next.push(v);
                    }
                }
                Step::All => {
                    if let Some(items) = value.as_array() {
                        next.extend(items);
                    } else if let Some(items) = value.as_object() {
                        next.extend(items.values());
                    }
                }
            }
            if next.len() > 10000 {
                return Err(AppError::Validation("规则返回内容过多，请缩小查询".into()));
            }
        }
        values = next;
    }
    Ok(values)
}
pub fn first(value: &Value, path: &str) -> AppResult<String> {
    if path.is_empty() {
        return Ok(String::new());
    }
    Ok(query(value, path)?
        .first()
        .map(|v| string(v))
        .unwrap_or_default())
}
pub type Variables = BTreeMap<String, Value>;
pub fn render(template: &str, vars: &Variables, encode: bool) -> AppResult<String> {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    let mut previous = None;
    while let Some(c) = chars.next() {
        if c == '@'
            && !previous.is_some_and(|p: char| p.is_ascii_alphanumeric() || p == '_')
            && chars
                .peek()
                .is_some_and(|p| p.is_ascii_alphabetic() || *p == '_')
        {
            let mut name = String::new();
            while chars
                .peek()
                .is_some_and(|p| p.is_ascii_alphanumeric() || *p == '_')
            {
                name.push(chars.next().unwrap());
            }
            let value = vars
                .get(&name)
                .ok_or_else(|| AppError::Validation(format!("规则缺少模板变量 @{name}")))?;
            let value = string(value);
            if encode {
                out.push_str(
                    &percent_encoding::utf8_percent_encode(
                        &value,
                        percent_encoding::NON_ALPHANUMERIC,
                    )
                    .to_string(),
                );
            } else {
                out.push_str(&value);
            }
            previous = name.chars().last();
        } else {
            out.push(c);
            previous = Some(c);
        }
    }
    Ok(out)
}
pub fn render_value(value: &Value, vars: &Variables) -> AppResult<Value> {
    Ok(match value {
        Value::String(s) => {
            if let Some(name) = s.strip_prefix('@').filter(|s| {
                !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            }) {
                vars.get(name)
                    .cloned()
                    .ok_or_else(|| AppError::Validation(format!("规则缺少模板变量 @{name}")))?
            } else {
                Value::String(render(s, vars, false)?)
            }
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|v| render_value(v, vars))
                .collect::<AppResult<_>>()?,
        ),
        Value::Object(items) => Value::Object(
            items
                .iter()
                .map(|(k, v)| Ok((render(k, vars, false)?, render_value(v, vars)?)))
                .collect::<AppResult<_>>()?,
        ),
        v => v.clone(),
    })
}
fn search_source_template(config: &Value) -> AppResult<String> {
    let template = field(config, "sourceTemplate");
    if template.len() > 16384 || (!template.is_empty() && !template.contains("@source")) {
        return Err(AppError::Validation("搜索详情页地址模板须包含 @source，且不能超过 16 KiB".into()));
    }
    Ok(template)
}
pub fn api_search(value: &Value, config: &Value) -> AppResult<Vec<SearchItem>> {
    let list = config_field(config, "listPath", "$.data[*]");
    let name = config_field(config, "namePath", "$.name");
    let source = config_field(config, "sourcePath", "$.url");
    let template = search_source_template(config)?;
    let mut items = Vec::new();
    for row in query(value, &list)? {
        let name = first(row, &name)?;
        let source = first(row, &source)?;
        if !name.is_empty() && !source.is_empty() {
            // API 9 allows embedded markers such as /GV@source, unlike request variables.
            let source = if template.is_empty() { source } else {
                let encoded = percent_encoding::utf8_percent_encode(&source, percent_encoding::NON_ALPHANUMERIC).to_string();
                let count = template.matches("@source").count();
                if (template.len() - count * "@source".len()).saturating_add(count.saturating_mul(encoded.len())) > 16384 {
                    return Err(AppError::Validation("搜索详情页地址超过 16 KiB".into()));
                }
                template.replace("@source", &encoded)
            };
            items.push(SearchItem { name, source });
        }
        if items.len() >= 200 {
            break;
        }
    }
    Ok(items)
}
pub fn api_roads(value: &Value, rule: &Value, source: &str) -> AppResult<Vec<Road>> {
    let config = &rule["chapterApiConfig"];
    let base = field(rule, "baseURL");
    let mut vars = Variables::from([("source".into(), json!(source))]);
    if let Some(variables) = config["variables"].as_object() {
        for (key, path) in variables {
            let value = query(value, &string(path))?
                .first()
                .copied()
                .cloned()
                .ok_or_else(|| AppError::Validation(format!("规则变量 {key} 未找到")))?;
            vars.insert(key.clone(), value);
        }
    }
    let episode_url = |raw: &str, ri: usize, ei: usize| -> AppResult<String> {
        if config["episodePage"].is_object() {
            let mut vars = vars.clone();
            for (key, value) in [
                ("episodeUrl", json!(raw)),
                ("roadIndex", json!(ri)),
                ("roadNumber", json!(ri + 1)),
                ("episodeIndex", json!(ei)),
                ("episodeNumber", json!(ei + 1)),
            ] {
                vars.insert(key.into(), value);
            }
            let mut url = http_url(&absolute(
                &base,
                &render(&field(&config["episodePage"], "url"), &vars, true)?,
            )?)?;
            merge_query(
                &mut url,
                &render_value(&config["episodePage"]["query"], &vars)?,
            );
            Ok(url.to_string())
        } else {
            absolute(&base, raw)
        }
    };
    let mut roads = Vec::new();
    if field(config, "format") == "delimited" {
        let separator = |key: &str, default: &str| {
            let s = field(config, key);
            if s.is_empty() {
                default.to_string()
            } else {
                s
            }
        };
        let rs = separator("roadSeparator", "$$$");
        let es = separator("episodeSeparator", "#");
        let fs = separator("fieldSeparator", "$");
        let names = first(value, &field(config, "roadNamesPath"))?;
        let road_names: Vec<_> = names.split(&rs).collect();
        for (ri, road) in first(value, &field(config, "roadEpisodesPath"))?
            .split(&rs)
            .enumerate()
        {
            let mut episodes = Vec::new();
            for (ei, entry) in road.split(&es).enumerate() {
                if let Some((name, url)) = entry.split_once(&fs) {
                    if !url.trim().is_empty() {
                        episodes.push(Episode {
                            name: if name.trim().is_empty() {
                                format!("第{}集", ei + 1)
                            } else {
                                name.trim().into()
                            },
                            url: episode_url(url.trim(), ri, ei)?,
                        });
                    }
                }
            }
            if !episodes.is_empty() {
                roads.push(Road {
                    name: road_names
                        .get(ri)
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| v.trim().to_string())
                        .unwrap_or_else(|| format!("线路{}", ri + 1)),
                    episodes,
                });
            }
        }
    } else {
        let rp = config_field(config, "roadsPath", "$.data.roads[*]");
        let list = if rp.is_empty() {
            vec![value]
        } else {
            query(value, &rp)?
        };
        for (ri, road) in list.into_iter().enumerate() {
            let mut episodes = Vec::new();
            for (ei, episode) in
                query(road, &config_field(config, "episodesPath", "$.episodes[*]"))?
                    .into_iter()
                    .enumerate()
            {
                let name = first(episode, &config_field(config, "episodeNamePath", "$.name"))?;
                let raw = first(episode, &config_field(config, "episodeUrlPath", "$.url"))?;
                if raw.is_empty() && !config["episodePage"].is_object() {
                    continue;
                }
                episodes.push(Episode {
                    name: if name.is_empty() {
                        format!("第{}集", ei + 1)
                    } else {
                        name
                    },
                    url: episode_url(&raw, ri, ei)?,
                });
            }
            let name = first(road, &config_field(config, "roadNamePath", "$.name"))?;
            if !episodes.is_empty() {
                roads.push(Road {
                    name: if name.is_empty() {
                        format!("线路{}", ri + 1)
                    } else {
                        name
                    },
                    episodes,
                });
            }
        }
    }
    if roads.len() > 100 || roads.iter().map(|r| r.episodes.len()).sum::<usize>() > 10000 {
        return Err(AppError::Validation("规则返回剧集过多".into()));
    }
    Ok(roads)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn api9_search_templates_keep_embedded_source_markers_and_encode_ids() {
        let mut rule = json!({"api":"9","name":"API9","version":"2","baseURL":"https://example.org/","searchMode":"api","chapterMode":"xpath","searchApiConfig":{"request":{"url":"https://example.org/search"},"listPath":"$.list[*]","namePath":"$.name","sourcePath":"$.id","sourceTemplate":"https://example.org/GV@source/"},"chapterRoads":"//ul","chapterResult":".//a"});
        assert!(validate(&rule).is_ok());
        let items = api_search(&json!({"list":[{"name":"作品","id":"a /?中文"}]}), &rule["searchApiConfig"]).unwrap();
        assert_eq!(items[0].source, "https://example.org/GVa%20%2F%3F%E4%B8%AD%E6%96%87/");
        rule["searchApiConfig"]["sourceTemplate"] = json!("https://example.org/fixed");
        assert!(validate(&rule).is_err());
        assert!(api_search(&json!({"list":[{"name":"作品","id":"x".repeat(1000)}]}), &json!({"listPath":"$.list[*]","sourcePath":"$.id","sourceTemplate":format!("https://example.org/{}", "@source".repeat(20))})).is_err());
        rule["searchApiConfig"]["sourceTemplate"] = json!("");
        rule["api"] = json!(10);
        assert!(validate(&rule).is_err());
        rule["api"] = json!("invalid");
        assert!(validate(&rule).is_err());
    }
    #[test]
    fn restricted_paths_and_typed_templates_match_kazumi_api_rules() {
        let data = json!({"data":{"records":[{"id":17,"title":"作品甲"},{"id":18,"title":"作品乙"}]},"odd-key":{"中文":true}});
        let search = api_search(
            &data,
            &json!({"listPath":"$.data.records[*]","namePath":"$.title","sourcePath":"$.id"}),
        )
        .unwrap();
        assert_eq!(search[0].source, "17");
        assert_eq!(search[1].name, "作品乙");
        assert_eq!(
            query(&data, "$['odd-key'][\"中文\"]").unwrap(),
            vec![&json!(true)]
        );
        for invalid in [
            "$.data..records",
            "$.data[?(@.id)]",
            "data",
            "$[-1]",
            "$.data[",
        ] {
            assert!(path_tokens(invalid).is_err());
        }
        let vars = Variables::from([
            ("keyword".into(), json!("你 + /")),
            ("episodeIndex".into(), json!(2)),
        ]);
        let url = render("https://example.org/?q=@keyword", &vars, true).unwrap();
        assert_eq!(
            http_url(&url).unwrap().query_pairs().next().unwrap().1,
            "你 + /"
        );
        let body = render_value(
            &json!({"q":"@keyword","index":"@episodeIndex","enabled":true}),
            &vars,
        )
        .unwrap();
        assert_eq!(body["index"], 2);
        assert_eq!(body["enabled"], true);
        assert!(render("https://example.org/@missing", &vars, true).is_err());
    }
    #[test]
    fn nested_api_roads_keep_zero_one_based_indices_and_capture_variables() {
        let data = json!({"data":{"slug":"名字 /","sources":[{"name":"高清","episodes":[{"name":"第13集","id":"a"},{"name":"第14集","id":"b"}]}]}});
        let rule = json!({"baseURL":"https://example.org/","chapterApiConfig":{"request":{"url":"https://example.org/api/@source"},"roadsPath":"$.data.sources[*]","roadNamePath":"$.name","episodesPath":"$.episodes[*]","episodeNamePath":"$.name","episodeUrlPath":"$.id","variables":{"slug":"$.data.slug"},"episodePage":{"url":"https://example.org/@slug/@episodeUrl","query":{"r":"@roadIndex","n":"@episodeNumber"}}}});
        let roads = api_roads(&data, &rule, "42").unwrap();
        assert_eq!(roads[0].name, "高清");
        assert_eq!(roads[0].episodes[0].name, "第13集");
        let url = http_url(&roads[0].episodes[1].url).unwrap();
        let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["r"], "0");
        assert_eq!(query["n"], "2");
        assert!(url.path().contains("%2F"));
    }
    #[test]
    fn delimited_api_roads_and_relative_urls_preserve_source_order() {
        let data = json!({"from":"甲$$$乙","urls":"第1集$/p1#第2集$/p2$$$第一集$https://cdn.example.org/v.mp4"});
        let rule = json!({"baseURL":"https://example.org/","chapterApiConfig":{"format":"delimited","roadNamesPath":"$.from","roadEpisodesPath":"$.urls"}});
        let roads = api_roads(&data, &rule, "x").unwrap();
        assert_eq!(roads.len(), 2);
        assert_eq!(roads[0].episodes[1].url, "https://example.org/p2");
        assert_eq!(roads[1].name, "乙");
        assert!(http_url("file:///private/db").is_err());
        assert!(http_url("https://user:password@example.org/").is_err());
    }
    #[test]
    fn relative_episode_page_templates_override_existing_query_parameters() {
        let rule = json!({"baseURL":"https://example.org/base/","chapterApiConfig":{"roadsPath":"","episodesPath":"$.episodes[*]","episodePage":{"url":"/watch/@source/@episodeNumber?id=old&keep=1","query":{"id":"@episodeUrl"}}}});
        let roads = api_roads(
            &json!({"episodes":[{"name":"第1集","url":"fresh + /"}]}),
            &rule,
            "work",
        )
        .unwrap();
        let url = http_url(&roads[0].episodes[0].url).unwrap();
        assert_eq!(url.path(), "/watch/work/1");
        let query: Vec<_> = url.query_pairs().into_owned().collect();
        assert_eq!(
            query,
            vec![
                ("id".into(), "fresh + /".into()),
                ("keep".into(), "1".into())
            ]
        );
    }
}
