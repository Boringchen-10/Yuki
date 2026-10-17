# 安卓发现剧集规则播放（2026-10-16）

发现中的未入库动漫现在复用媒体库的播放来源面板。点击官方剧集会检索已启用规则，保留当前官方分集身份；用户核对作品、线路与来源剧集后才能开始播放。仅浏览、检索或关闭面板不创建作品、文件或观看记录。真正选择来源剧集时提示加入媒体库并保存观看记录，复用 Bangumi 作品身份，不按同名创建第二部作品。

`ExploreSaveInput.forPlayback` 是可选字段，未传时保留原有加入 / 更新行为。播放入口只读取已载入的磁盘作品资料、官方分集和已有封面，允许使用过期缓存，不等待 TMDB / AniList 补源或图片下载；资料尚未载入时明确失败。已有作品直接复用，事务再次核对，保留追番状态、收藏、评分、备注与人工字段。

`RuleBinding.targetEpisodeExternalId` 仅适用于单集，由当前作品的官方目录验证。来源第 13 集可由用户明确选作官方第 2 集，特别篇按真实 ID 和类型保存；不以数组位置或同号正片替代。跨作品 ID、批量目标及与原有关联冲突的选择拒绝写入。已有媒体身份与进度保留。普通规则选集未传此字段时沿用既有编号与手工偏移逻辑。

返回优先关闭来源面板，保存期间重复点击去重，取消后的晚到响应不能重新打开播放器。已有可用本地 / WebDAV 文件仍直接播放。

## 验证

- `pnpm check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml rule_bindings::tests --lib -- --test-threads=1`：6 项通过，包括精确官方 ID、特别篇、跨作品拒绝、原有关联和进度保留。
- `cargo test --manifest-path src-tauri/Cargo.toml playback_save_ --lib -- --test-threads=1`：2 项通过，覆盖过期磁盘缓存入库、身份幂等、个人资料保留和缺缓存不写入。
- `node scripts/verify-discovery-playback.mjs`：真实 React 隔离夹具覆盖检索 / 返回不写库、明确选择才保存、精确分集 ID、重复点击、取消晚到隔离和失败重试；360 / 412 / 915 / 1024 / 1366 / 1920 宽度无水平溢出，未发生 `pageerror`。截图与结果在 `D:/DevTools/Android/Build/qa/discovery-playback-1792165642675/`，截图已查看。
- `node scripts/verify-detail-unification.mjs`：原有 9 项详情 / 导航 / 图片隔离场景与六种宽度通过，更新“未入库剧集按钮禁用”的旧断言。

前端夹具不调用真实媒体源或原生播放器；不能据此宣称所有第三方规则均可用或已经完成新 APK 实机播放验收。Rust 仅操作临时 SQLite 和生成缓存，不修改用户媒体或普通应用数据。

## 草稿保护

`DISCOVERY_PLAYBACK_SOURCE_HANDOFF.patch` 保存本轮对原已修改 / 未跟踪的 `ExplorePanel`、`EpisodeSources`、`PlaySourceSheet` 与整理夹具的增量；当前已应用，不能重复应用。其它规则 / 缓存逻辑和回归文件可独立纳入本轮提交，不把原设计草稿整文件混入提交。
