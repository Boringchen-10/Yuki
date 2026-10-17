# Yuki 产品更名

2026-10-17 用户确认正式名称由 Genzo 改为 **Yuki**。Windows 与 Android 的窗口 / 应用名称、关于页、提示文案、通知和新构建产物使用新名称；历史版本文件、原始设计交付与旧发布链接保持原样。

## 兼容性边界

- 桌面 bundle identifier 继续 `com.genzo.desktop`；Android 继续 `com.genzo.android`，已有日常预览包继续 `com.genzo.android.readerqa`。三个图标的组件名和 Kotlin namespace 保留，避免已有安装或图标选择失效。
- SQLite 文件仍为 `genzo.db`，既有配置 / 凭据键、Keystore alias、偏好 localStorage 键、缓存路径与 WebDAV V1 协议保持。更名不新增迁移或复制 / 重建资料库。
- Rust crate / JNI 库名、内部 CSS / TypeScript 标识和构建环境变量继续作为兼容实现标识使用。前端包元信息改为 yuki，用户可见产品名称为 Yuki。
- 已有签名证书、GitHub 仓库 `Boringchen-10/genzo` 与正式发布附件不改名。安卓更新器优先识别 `Yuki_<version>_android_<abi>.apk`，同时接受原有 `Genzo_...` 命名，并保留 URL、ABI、版本、校验和与签名检查。
- Windows 的新构建配置使用 Yuki 展示名。Tauri NSIS 以产品名构成卸载注册键；既有 Genzo 安装器的自动替换须在下次 Windows 正式发布时专项验证，本轮不在用户系统安装 / 卸载桌面包。资料目录由保留的 identifier 定位。

配置依据：[Tauri 配置](https://v2.tauri.app/reference/config/)、[官方 NSIS 模板](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)。旧发布链接和历史文档中的 Genzo 表示当时的产品 / 产物，不应用全局替换。

## 本轮验证

- Windows：TypeScript、79 项前端测试、生产前端构建、`cargo check --locked --offline` 通过；1024×640 / 1366×768 / 1920×1080 深浅主题六组合验证窗口标识与设置版本名为 Yuki，无水平溢出。
- Android：TypeScript、130 项前端测试、图标选择六场景 / 12 布局、完整优化原生构建与签名包通过。Android 16 独立 renameqa 的 6 项原生检查覆盖三款入口标签、默认图标、新旧更新文件名、来源 / ABI / 版本 / 签名 / SHA-256 拒绝规则。
- 实际日常 readerqa 已同签名覆盖更新为 Yuki，38 作品 / 428 关联媒体 / 17 来源 / 33 观看进度 / 16 规则 / 7 书籍作品 / 32 阅读历史及个人字段、位置与偏好摘要一致。没有清库 / 卸载日常包，图标选择保留。
- 更名仍为当前 0.17.1 开发预览，不创建正式发布或移动旧标签 / 附件；签名普通包、摘要、源清单及测试证据见 AI_HANDOFF.md 当前记录。
