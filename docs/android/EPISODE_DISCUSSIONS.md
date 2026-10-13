# 播放界面的 Bangumi 分集讨论

2026-10-13用户澄清：播放页显示当前集对应的评论。作品详情的条目短评独立保留，播放器不回退到作品短评。

参考Kazumi的独立接口 `https://next.bgm.tv/p1/episodes/<官方分集ID>/comments`，实际返回完整主楼数组及嵌套replies，没有HTTP分页。Rust沿用现有官网限流和有限重试，当前播放会话只获取一次；界面每次展示20个主楼，下滑自动追加，回复用独立RecyclerView面板按需展开。总数为可显示主楼数，楼层保留原位置，非公开状态不显示正文或回复。

当前卡片显示头像、名称、相对时间和正文。头像与最多4个来源内嵌图片由当前讨论内容allowlist与既有HTTPS / 域名 / 图片限制校验，复用Bangumi网络传输；生成图片缓存独立按64MiB预算淘汰，Kotlin按宽高及像素预算采样，并定点更新对应图片，不重绑整个评论列表。图片失败释放pending、暂停自动重试，主动返回评论或重试可恢复；不会把源URL扩展为任意请求接口。

本地 / WebDAV优先当前文件的显式官方链接，包括人工修正 / 显式解除；规则复用当前作品已匹配的官方分集，实际文件的显式对应优先。文件13→官方1直接用官方1的ID，不靠文件名或列表下标。没有分集链接时提示回作品详情匹配，不读取另一集或整部作品。

切集新会话独立缓存；同会话上下文变更会清空旧评论、关闭回复窗口并废弃在途请求ID。评论失败可重试，源网络 / 数据错误不变成空讨论。没有新依赖或迁移，不新增发表评论或账号功能。

来源：[Kazumi API定义](https://github.com/Predidit/Kazumi/blob/main/lib/request/config/api_endpoints.dart)、[分集评论模型](https://github.com/Predidit/Kazumi/blob/main/lib/modules/comments/comment_item.dart)。实际测试与APK / 个人数据保留证据见最新AI_HANDOFF.md。
