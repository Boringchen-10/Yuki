# Yuki 安卓项目 Agent 说明

## 开始前

完整阅读本文件、`AI_HANDOFF.md`、`PROJECT_CONTEXT.md`、`ROADMAP.md`、`DESIGN_DIRECTION.md`，检查 Git 分支、远程、工作区与相关实现。当前用户指令优先；既有文档冲突须明确指出。先给出简短计划与可检查的完成条件。

## 项目边界

- 本仓库为独立的安卓 Yuki，公开主页与更新来源为 `Boringchen-10/Yuki`。Windows 项目留在原 Genzo 仓库；这是用户于 2026-10-17 明确确认的拆分。
- 使用 Tauri 2、React、TypeScript、Rust、SQLite 与 Kotlin，延续当前 OpenDesign 和单 libmpv。不要因目录仍含桌面共享代码擅自扩大平台范围或重写架构。
- 正式包 `com.genzo.android`，隔离包 `com.genzo.android.readerqa`。保留签名、内部 genzo 标识、资料与凭据路径、偏好和同步协议，除非用户另有明确迁移要求。
- 规则搜索、选集、播放与离线范围以现有安卓实现及 PROJECT_CONTEXT 为准；旧内容来源限制已被用户于 2026-10-10 作废。
- 不删除、移动、修改用户真实媒体，不覆盖或重建用户数据库。数据库变更新增迁移并验证存量升级，不修改已经执行的迁移。
- GPL-3.0-only；保留版权、上游来源和许可证。代码许可不授权第三方品牌、角色或媒体。

## 实施与验证

1. 明确假设和范围，遇到影响结果的歧义先澄清。优先简单、最小必要改动，不做无关清理或重构。
2. 保留其他 Agent 与用户尚未提交的工作，不擅自吸收或丢弃。不要执行 `git reset --hard`、`git clean -fd` 等破坏操作。
3. 外部程序使用结构化参数，凭据和签名材料始终放在仓库外，不记录媒体 URL、Cookie、Token 或个人数据库。
4. 运行与改动相称的类型检查、测试、构建或原生验收。UI 检查手机尺寸、系统安全区、字体与横竖屏；不要用浏览器结果冒充实机通过。
5. 将功能、修复及必要文档纳入范围清晰的 Git 提交。使用 Conventional Commits，不混入无关内容；未经实际验证不得宣称完成。
6. 普通交付完成后提交 Git；正式 Release 另按 `docs/RELEASING.md`。不要因建立仓库就自动发布 APK。

## 版本与交接

- 遵循 SemVer；发布同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 并更新 CHANGELOG。Android versionCode 按既有公式递增。
- 发布提交 `chore(release): vX.Y.Z`、同名带注释标签、同证书签名 APK 和 SHA256SUMS.txt 一起核对后推送。签名密码和密钥不进 Git。
- 更新 `AI_HANDOFF.md`，区分实际验证、用户报告与待办，只记录结论、必要路径与限制。
- 历史 `docs/android/*SOURCE_HANDOFF.patch` 已反映在导入基线中，不要再次自动应用。旧桌面计划和本机测试记录不覆盖当前根文档。

## 技能与协作

主要技能位于 `.agents/skills/`：`project-builder` 用于完整新功能，`bug-hunter` 用于排错修复，`project-maintainer` 用于维护与文档。一次任务优先选最匹配技能，遵循其流程。默认简体中文交流。Codex 与 DeepSeek Harness 均须核实实际 Git / 代码状态后接力，不把交接记录当作完成证明。
