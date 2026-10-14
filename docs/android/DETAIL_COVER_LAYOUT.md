# 详情原比例封面与状态栏

2026-10-14，私有预览 v0.14.2；延续当前 OpenDesign，公开版仍 v0.5.2。

- 原共享详情将图片放进固定2:3框并contain显示，非2:3图片出现留白，封面高度也小于信息区。现在读取实际naturalWidth / naturalHeight，按右侧可见信息总高度计算尺寸；ResizeObserver处理宽度 / 信息变化，图片加载与替换更新比例。可用宽度为上限，避免窄屏和极宽图片挤压文字；没有修改图片文件。
- MainActivity原先给content加状态栏顶部padding，WebView从屏幕141像素以下开始。现在背景绘制从0开始，原生和前端同步真实--safe-top / --safe-bottom，main保留安全内距。共享动漫 / 书籍详情背景扩展至状态栏，主题遮罩保留图标对比，普通页不受详情背景串入。
- 保留左右切口与IME处理、系统返回、底部手势区、已有主题和媒体 / 个人数据。没有新依赖或迁移。
- TypeScript与真实组件回归通过：5种图片比例、6种窗口宽度，图片与框尺寸一致，常规竖图与信息高度一致；9组既有详情场景通过。实机WebView从[0,0]绘制，真实480×678图显示157.835×222.938，信息高度222.946，无额外留白，背景到屏幕顶，返回入口在40.286CSS像素安全区之下。构建、升级与签名见AI_HANDOFF。
- AndroidApp / ExplorePanel / MainActivity原WIP保留，自身增量见DETAIL_COVER_SOURCE_HANDOFF.patch，**已经应用**；用git apply --unidiff-zero --reverse --check核对，不重复应用。
