# 安卓播放控件 v0.15.0

2026-10-14，基于当前 OpenDesign 的本机预览，公开版仍为 v0.5.2。

## 行为

- 竖屏播放器由固定 16:9 区域调整为约屏幕高度的 40%，最多占一半，仍保留原比例视频与下方选集 / 评论。PLK110 实测区域为 1272×1108 物理像素，屏幕为 1272×2772。
- 三点设置保持 Genzo 深色样式，倍速、超分、音轨、字幕及偏移在主菜单旁展开，当前选择高亮；窗口按实际边界定位、长列表可滚动。返回先关子菜单，再关主菜单；点击外部关闭整体。加载或故障时禁用依赖媒体的设置。
- 横屏顶部显示返回、当前作品 / 官方分集与更多。底部依次是时间、全宽进度、播放 / 下一集 / 字幕、超分 / 倍速 / 选集 / 退出全屏。图标使用已有资源与 Lucide ISC 矢量转换，许可随包提供，包含无障碍名称和 tooltip。
- 横屏选集从右侧展开，复用现有剧照、目录、当前标记与来源；来源面板在横屏完整展开，切换后标题与内容同步。切集继续传递当前方向，不改变媒体身份、人工分集对应或观看记录。下一集只取紧邻的实际目录项，缺文件、未匹配或到末尾时禁用，不跨缺集播放。
- 全局硬解 / 解码器 / 渲染器仍在既有设置。画中画、弹幕、投屏、一起看、定时关闭及视频比例没有现有实现，未增加入口。无新依赖或数据库迁移。

## 实现与交接

`PlayerActivity.kt` 负责播放器尺寸、横竖屏工具栏和已有设置操作；`PlayerSettingsMenu.kt` 用一个原生弹出窗口承载主 / 子菜单，并处理 Android 弹出窗口直接调用 dismiss 的返回路径；`PlayerPage.kt` 复用原有数据和 RecyclerView 适配器承载横屏选集。

`GenzoPlugin.kt` 原有其他维护者修改保持，本轮仅增加替换播放会话时的方向传递；增量已应用并记录在 `PLAYER_CONTROLS_SOURCE_HANDOFF.patch`，可用 `git apply --reverse --check` 核对，不重复应用或整文件提交其余 WIP。

## 验证

- TypeScript 与前端 27 文件 / 115 项通过；现有 Kotlin 12 项通过；Android 优化 Rust、QA 与 Release 构建通过。本轮未修改 Rust 业务逻辑，未重跑 Rust 单元测试。
- `scripts/verify-android-player-page.mjs` 使用独立 `com.genzo.android.organizeqa`、合成 WebDAV / MP4 / 剧照和规则来源，覆盖原比例视频、实际封面与 13→1 对应、同集版本、并排菜单 / 逐层返回 / 外部关闭、倍速和真实 Anime4K、横屏快捷入口 / 选集 / 下一集 / 来源展开、方向与解码器保留、评论、失败与取消。测试数据不进入用户包。
- 最终完整回归 **24 组通过**，证据在 `D:/DevTools/Android/Build/qa/player-page-1791978267661/`。普通签名包与日常 readerqa 均覆盖更新；更新前后 36 作品 / 17 来源 / 30 观看记录 / 16 规则 / 7 书籍及个人字段、阅读位置、书架和播放偏好哈希一致，无隐式扫描，设备 APK 与制品哈希一致。
- 验证中修复了 Android 弹出窗口返回直接关闭整层和横屏 Material 来源面板只露出折叠区的问题。脚本按实际选中对勾和同集合法文件身份核对，并显式设置测试方向，不为脚本断言修改媒体对应。
- 最终专项结果在 `D:/DevTools/Android/Build/qa/player-controls-20261014/final-ui-result.json`；最终原生布局、来源和菜单截图已查看。设备为 PLK110 / Android 16，属于单机短测，不代表所有设备与长期热稳定性。
- 构建副本与 427 份生产源匹配，APK 内嵌 `index-iuzA3pU5.js` / `index-mGG9iYmE.css`；v2 / v3 原证书签名与 16KiB ZIP 对齐通过，Lucide 许可和第三方说明资产一致，无用户数据库、书籍或测试媒体。旧压缩资源缓存曾冲突，使用新的生成输出目录完成打包，未清理用户数据。

安装包：`D:/DevTools/Android/Build/previews/player-controls-20261014/Genzo_0.15.0_player-controls_arm64-v8a.apk`。最终升级、哈希和完整回归结果见本轮 `AI_HANDOFF.md` 记录及 `D:/DevTools/Android/Build/qa/player-controls-20261014/` 回执。
