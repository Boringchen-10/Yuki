# 拷贝作品评论回复

用户于2026-10-13要求回复内容可展开。作品评论原来的“回复内容待接入”已替换为按需读取的展开 / 收起入口，漫画探索、书架及轻小说共用当前ComicComments面板。每话roasts没有回复关系，不将作品回复冒充本话数据。

请求沿用Kira固定快照fc3f242f的约定：漫画`/api/v3/comments`携带comic_id、reply_id、limit、offset、platform=3；轻小说`/api/v3/bookcomments`携带book_id、reply_id、limit、offset。作品UUID仍由当前作品详情取得，reply_id仅接受正整数，省略时维持原主评论接口兼容性。浏览器来源请求头和阅读网络配置保持一致，匿名只读，不新增账号 / 发帖或依赖。

每条主评论独立保存当前面板的展开状态、回复列表和游标。首次展开才获取10条，下滑自动追加，收起不重取也不继续加载；追加失败保留已读内容并手动重试原游标。按源offset+limit推进并按ID去重，不用去重后的显示数量作为下一页偏移；来源返回空页但仍声称有未读数据时显示错误，避免无限请求。主评论沿用同一源分页规则、同一实际滚动容器；不放正常翻页按钮。

回复仅在原评论下展开，短过渡尊重prefers-reduced-motion。组件由作品类型 / 路径 / 评论ID共同标识，退出或切换作品的旧请求不能覆盖新内容，不写观看 / 阅读记录或真实媒体。

接口参考：[Kira漫画评论](https://github.com/caolib/kira/blob/main/lib/api/manga/manga_api.dart)、[Kira轻小说评论](https://github.com/caolib/kira/blob/main/lib/api/novel/novel_api.dart)。回归脚本`scripts/verify-copy-comment-replies.mjs`使用真实组件与隔离回复夹具；最终设备 / 构建证据见最新AI_HANDOFF.md。
