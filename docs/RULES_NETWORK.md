# 规则仓库连接

- 默认“镜像优先”：GitCode 镜像失败、超时或内容无效时尝试官方 GitHub Raw。
- “官方直连”只访问官方仓库；选择后自动保存在本机，不参与同步。
- 新人规则页、规则设置和「我的 → 网络」可调整并测试连接。目录、安装与更新使用同一策略；自定义链接不改写。
- 已有官方仓库规则自动适用，无需重新安装。保存连接方式会刷新目录，旧响应不能覆盖新设置的缓存；离线时保留已有目录并明确提示。
- 镜像仅获取规则 JSON，不代理影片、Bangumi 或应用更新；网络和镜像同步速度仍取决于实际环境。

官方仓库根地址为 `https://raw.githubusercontent.com/Predidit/KazumiRules/main/`，镜像为 `https://raw.gitcode.com/gh_mirrors/ka/KazumiRules/raw/main/`，与 [Kazumi 固定版本端点](https://github.com/Predidit/Kazumi/blob/9a20a019c0457683adc68bf01e5c3e49696ffcde/lib/request/config/api_endpoints.dart) 一致。只改写这个仓库下的直接 JSON 文件；数据库保留官方更新地址和既有规则身份。

## 检查

- Rust 本地 HTTP 夹具验证超时、错误状态、无效 JSON / 规则、官方回退、单源成功、设置与缓存保留、自定义 URL 隔离和晚到响应。
- `cargo test --lib live_rules_repository_download_and_reinstall_preserve_identity -- --ignored` 为显式联网检查，使用隔离数据库，不读取用户资料。
- `node scripts/verify-onboarding-ui.mjs` 检查保存 / 失败恢复 / 连接结果及手机布局；`pnpm build` 后运行 `node scripts/verify-onboarding-entry.mjs` 检查真实网络设置入口。
- 实际结果及安卓设备覆盖范围见 `AI_HANDOFF.md`。

## 界面走查

沿用 React SPA、Tailwind 3、自有蓝白主题和深色模式。修改前已核对 375 / 1280 宽度：规则页没有连接恢复入口，原网络页的 Bangumi 镜像易被误认为覆盖规则。按 Refactoring UI §2.1 / §2.8 / §3.6，规则添加保持主要操作，连接选项放入就地折叠区；网络页复用同一设置卡，使用现有间距、颜色和 44 dp 控件，不引入新组件库。
