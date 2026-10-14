# 安卓详情玻璃背景与封面转场

2026-10-14，本机预览 v0.14.3，延续当前 OpenDesign；公开版仍为 v0.5.2。

## 变更与根因

- 动漫详情改用封面衬底、28px 背景模糊、轻微高光和主题染色组成的磨砂玻璃层，背景经遮罩完整渐隐到正文；底部导航移除硬边，增加不阻挡点击的 24px 渐变衔接。状态栏背景与真实安全区保持。
- 漫画 / 轻小说的发现和书架详情不再创建装饰封面背景，主封面继续按原比例显示；应用主题保持用户选择。
- 原共享封面转场为 400ms，头部同时运行 `gz-rise` 的 9px 入场移动。浏览器对照复现发现页和媒体库均在转场结束时向上跳 9px。现在共享转场为 560ms，缓动为 `cubic-bezier(.32,0,.2,1)`；详情不叠加独立入场位移，避免截图落点偏移，也避免清理转场后重新启动头部动画。减少动态仍跳过截图转场。
- 无新依赖、迁移、媒体文件或个人记录模型变更。`AndroidApp.tsx` / `ExplorePanel.tsx` 原有其他维护者 WIP 保留；本轮两处取消背景参数的增量已应用，单独保存为 `DETAIL_GLASS_SOURCE_HANDOFF.patch`，可通过 `git apply --reverse --check` 核对，不重复应用。

## 验证

- `pnpm check` 与 `pnpm test`：27 文件、115 项通过。
- `node scripts/verify-detail-glass-motion.mjs`：真实 React 发现 / 媒体库共享封面落点与最终尺寸一致；转场清理不重启入场动画；快速系统返回三次后名称清理；漫画、小说发现与书架无背景；深浅主题玻璃 / 渐变检查；减少动态无截图转场。360×800、412×915、915×412、1024×640、1366×768、1920×1080 无横向溢出或封面 / 信息重叠。
- 既有 `verify-detail-cover.mjs` 的 5 种比例 / 安全区 / 6 宽度及 `verify-detail-unification.mjs` 的 9 场景回归通过，页面无 JS 错误。截图复核发现玻璃层曾被带 transform 的图片盖住，修正伪元素 z-index 后复跑并查看最终截图。
- Android 优化 Rust 构建、调试 APK 与 Release APK 构建通过。最终修改重新编入资源，421 份生产源与构建副本匹配；内嵌 `index-CEgcxyFv.js` / `index-mGG9iYmE.css`，v2 / v3 签名与 16KiB ZIP 对齐通过。此次纯前端修改未重跑 Rust / Kotlin 单元测试。
- 一加 PLK110 / Android 16 实机：封面截图与结束位置均为 y=179.0313、高 222.942 CSS px，无头部入场动画；玻璃层实际 `blur(28px) saturate(1.35) contrast(.96)`，背景 top=-20、安全区 40.2857，漫画 / 小说详情无装饰背景。实机截图已查看。首次升级后的 CDP 连接早于 WebView 就绪，重试后通过，没有修改生产代码迎合测试。
- 两个既有包均 `install -r` 更新，设备 APK 哈希与最终制品一致。更新前后 36 作品 / 17 来源 / 29 观看记录 / 16 规则 / 7 书籍及个人字段、收藏评分、阅读位置 / 条目、书架状态、播放偏好哈希一致，无隐式扫描。只读快照不复制 DB 或凭据；实机浏览书籍正常记录浏览时间，不操作真实媒体或自动播放。

证据：`D:/DevTools/Android/Build/qa/detail-glass-motion-20261014/`，包含浏览器 before / after、实机截图、升级和安装回执。最终包：`D:/DevTools/Android/Build/previews/detail-glass-motion-20261014/Genzo_0.14.3_detail-glass-motion_arm64-v8a.apk`，49,399,731 字节，SHA256 `af4daa4746d66f0102df91128872127bd380c0c4d971ad8f29a9663196a6d9c6`。本轮为单机短测，不宣称所有设备的长期流畅性；不创建公开 Release、标签或推送。
