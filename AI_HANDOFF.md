# Yuki 交接

## 当前版本

用户确认发布 **v1.0.0** 到 [Yuki Releases](https://github.com/Boringchen-10/Yuki/releases/tag/v1.0.0)，说明仅用四条更新，当前主文档已精简。正式包 `com.genzo.android`，versionCode `1000000`；原证书、资料与同步格式不变。

正式 Release 已公开；发布提交 `48f4f89`、带注释标签 `v1.0.0` 和 main 已推送。APK 与校验文件公开回下载通过，哈希与 GitHub 资产记录一致。

## 本版变化

- 首次使用协议确认和规则配置；支持稍后添加、仓库及自定义导入。
- 蓝白默认主题，网页 / 原生颜色一致，保留已有外观选择。
- 修复主题模式和恢复默认的重启保持。
- 用户级及项目 AGENTS 均要求前端任务使用 Refactoring UI；安装位于 `C:/Users/Administrator/.codex/skills/refactoring-ui`。

## 验证与产物

- v1.0.0 已通过 135 项测试、类型检查、生产构建和真实生产入口回归。前一提交的新 UI 14 项 / 72 布局、配色 24 组对比度结论仍适用，本轮未修改界面实现。
- 正式 APK `Yuki_1.0.0_android_arm64-v8a.apk`，50,700,357 字节；SHA-256 `1f6f86a103ec9666805233a3911485682572b9deea91a46b72ade81c4b570a62`。包名、版本、原证书、16 KiB 对齐、54 项许可 / 来源资产及 412 项生产输入一致性通过。
- Android 16 / PLK110 新建测试安装：0.16.1 覆盖至 1.0.0 成功，SQLite 浅色模式与 WebView AMOLED 设置保留；协议、规则仓库 17 项加载、系统返回、中途重启恢复及完成后跳过引导通过。全新 1.0.0 显示蓝白主题和未勾选协议。
- 产物在 `D:/DevTools/Android/Build/releases/yuki/v1.0.0/`；实测、公开资产核对及测试安装清理记录在 `D:/DevTools/Android/Build/qa/release-1.0.0-20261017/`。测试前正式包不存在，现有 readerqa 与真实媒体不参与测试。
- 本轮未做真实媒体库播放 / 阅读或多机型全面回归，不将上述测试扩大为所有使用场景保证。
- 设备内检查更新遇 GitHub 限流，准确显示重试提示；未宣称更高版本下载链路实机通过。本轮创建的测试安装已移除，原 readerqa 保留；完整结果见上述 QA 目录 `verification.json`。

## 维护边界

- 不清库、不修改真实媒体；数据库只新增迁移，保留原包名、证书、内部标识及资料路径。
- 旧包仍查询 Genzo 仓库时先手动覆盖安装 Yuki；readerqa 不能与正式包交叉覆盖。
- 根文档和实际代码优先；历史 patch 已导入，不重复应用。旧交接见 [归档](docs/history/HANDOFF_PRE_1.0.md)。
