# Yuki 项目上下文

## 产品与兼容

- 独立安卓 ACGN 媒体库；主页、源码和更新源为 [Boringchen-10/Yuki](https://github.com/Boringchen-10/Yuki)。Windows 留在原 Genzo 仓库。
- 当前版本 v1.0.1，含规则仓库连接修复。保留正式包 `com.genzo.android`、原签名、内部 genzo 标识、资料路径、偏好与同步协议。
- `com.genzo.android.readerqa` 为隔离测试包。数据库只新增迁移，不清库、不重建资料、不修改用户真实媒体。

## 架构与功能

- Tauri 2 + React / TypeScript；Rust 管理 SQLite、来源与缓存，Kotlin 承载授权、播放和阅读。
- 视频统一 libmpv / Anime4K；Media3 仅负责支持的离线任务。漫画和 Readium 小说阅读器沿用现有实现。
- 来源支持系统授权本地文件、WebDAV、Kazumi API 1–9 规则。官方分集、来源对应和个人进度共用身份，不按文件顺序猜集号。
- 规则仓库默认 GitCode 镜像优先、失败后尝试官方，连接方式仅保存在本机。目录、安装、更新统一路由，自定义链接不改写，已有规则身份与更新地址保留；见 `docs/RULES_NETWORK.md`。
- 默认蓝白浅色，保留用户外观选择；网页与原生共用颜色。主题模式兼容原数据库设置，恢复默认同时保存浅色模式。
- 首次启动先同意协议，再配置规则或稍后添加。确认保存在本机、不参与同步；完成后才启动自动资料更新与同步。
- 延续 OpenDesign、三款已确认图标及现有下载 / 阅读 / 同步范围，不额外引入账号、DRM、投屏或云端媒体服务。

## 更新与许可

- 手动检查 Yuki 正式 Releases；验证 APK 的 ABI、大小、SHA-256、包名、证书与递增 versionCode 后交给系统安装。
- 旧包查询旧仓库时需先手动安装兼容新版；不要求卸载或清库。发布流程见 [RELEASING](docs/RELEASING.md)。
- GPL-3.0-only；保留历史、版权及第三方归属。代码许可不授予第三方角色、商标或媒体权利。
