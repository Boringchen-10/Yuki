# 安卓每话评论与 Bangumi 评论恢复

2026-10-13，用户要求漫画每话来源数据、改善 Bangumi 评论读取，并明确详情小标签只让正文左右滑动。继续完整当前 OpenDesign、原生阅读器、同一 Rust 核心，无新依赖或数据库迁移。

## 漫画

参考 Kira 固定 `fc3f242fee2e3b68de94bc35296fc73db60031c3` 的 MangaApi / ChapterComment：每话走 COPY `GET /api/v3/roasts`，参数 chapter_id、limit、offset、_update=true；整本评论仍走comments，二者不混用。6字段为id、createAt、userId、userName、userAvatar、comment，总数为实际来源total。来源未提供每话热度 / 浏览量 / 点赞；页数和作品目录数量不能充当热度。

Tauri `get_comic_chapter_comments(pathWord,chapterId,group,offset,limit)` 及私有阅读会话 `GET chapter/<id>/comments/<offset>` 共用只读归属校验与既有网络设置。章节UUID、目录作品与分组核对后读取评论，不获取正文图片、不写阅读进度 / 书签。空目录却total非零时明确失败，避免无进展循环。

原生“本话评论”面板使用当前可见章节，30条分页、手动更多、独立失败重试、正文可选取；追加失败保留内容并重试同一游标。阅读会话内仅缓存最近3话，超过200条的页在关闭后不保留；退出取消UI请求并忽略晚到结果。标题与评论数量真实显示，没有发布 / 登录 / 点赞行为。使用既有主题和Material面板动画。

## Bangumi

官网P1评论固定next.bgm.tv，不发往v0镜像；沿用公开网络代理配置与官网限流。最多2次、单次6秒、含排队总计16秒，只恢复瞬断 / 5xx / 响应体截断，429、4xx及完整非法数据保留错误。失败不冒充空评论。

两处详情页面共用专用评论控制器：同步pending去重、代次隔离、独立offset+limit游标、会话缓存、追加失败暂停自动Observer并手动重试。原生播放器同步修正源游标及失败重试同页。刷新失败保留已有内容。

## 详情动画

概览 / 剧集 / 评论 / 人物等标签只对稳定的正文容器短左右滑动，方向按标签顺序决定，封面、标题及标签栏不参与。保留真正开 / 返回作品的原转场；减少动态时直接更新。OpenDesign未提交部分仍按归属保留，集成增量见本轮交接。

## 验证

受控网络、隔离数据库、前端竞态测试与独立APK实机短测的实际结果见AI_HANDOFF.md。测试夹具只在organizeqa / 临时目录运行，不写日常包测试数据，不复制用户数据库、凭据或Cookie。单机短测不代表来源永久稳定或全部机型覆盖。

## 来源与工作树集成

参考：[Kira MangaApi](https://github.com/caolib/kira/blob/fc3f242fee2e3b68de94bc35296fc73db60031c3/lib/api/manga/manga_api.dart#L540)、[每话评论模型](https://github.com/caolib/kira/blob/fc3f242fee2e3b68de94bc35296fc73db60031c3/lib/models/chapter_comment.dart)。只读公开来源，不新增发布评论或账号能力。

AndroidApp / ExplorePanel 当前完整 OpenDesign 草稿包含其他维护者未提交功能，本轮仅将自身接入增量记录为 `READING_COMMUNITY_SOURCE_HANDOFF.patch`，当前工作树已经应用，勿重复应用；可用 `git apply --unidiff-zero --ignore-whitespace --reverse --check` 核对。动画模块只提交独立的新方法及必要导入，原有未提交面板转场保留。APK与403份生产源字节核对，包含当前完整工作树，不用旧界面代替。
