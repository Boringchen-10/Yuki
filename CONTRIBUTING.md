# 参与 Yuki 安卓开发

先阅读 [AGENTS](AGENTS.md)、[项目上下文](PROJECT_CONTEXT.md)、[设计方向](DESIGN_DIRECTION.md) 和 [交接](AI_HANDOFF.md)。Windows 工作在原 Genzo 仓库进行。

## 开发与检查

- `pnpm install --frozen-lockfile` 后运行 `pnpm check`、`pnpm test`、`pnpm build`。浏览器仅验证界面；原生功能按 [构建指南](docs/BUILD_ANDROID.md) 验收。
- 前端任务使用 Refactoring UI；沿用现有组件、主题变量、桥接和数据模型，只改需求相关内容。
- 保留其他人的未提交工作和用户资料。数据库新增迁移，不清库、不重建；不修改真实媒体，不猜测分集对应。
- 问题报告提供复现、设备和脱敏错误，不上传个人数据库、媒体地址、Token 或凭据。
- 提交采用 Conventional Commits，说明行为和实际验证；Rust / Kotlin / 数据库变动补充相应检查。

## 发布与许可

遵循 SemVer 和 [发布指南](docs/RELEASING.md)，保留包名、原证书、数据格式与同步协议。推送源码不等于发布安装包。

代码采用 GPL-3.0-only；保留上游归属，新增依赖先核对许可并更新第三方声明。历史交接 patch 已纳入基线，不重复套用。
