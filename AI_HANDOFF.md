# Yuki 交接

## 当前版本

本轮修复用户报告的检查更新限流，准备发布 **v1.0.2** 到 [Yuki Releases](https://github.com/Boringchen-10/Yuki/releases/tag/v1.0.2)。正式包 `com.genzo.android`，versionCode `1000002`；原证书、资料与同步格式不变。公开发布和后续实测结果完成后补记。

## 本版变化

- 已复现匿名 GitHub API 返回 403，当前出口剩余额度为 0；v1.0.0 / v1.0.1 只依赖 API，规则镜像不影响应用更新。
- 优先读取官方 Release 的静态 `update.json`，清单缺失或无效时兼容 API。发布须同时上传 APK、SHA256SUMS.txt 和构建生成的 update.json，见 [发布说明](docs/RELEASING.md)。
- 更新页失败时可打开固定的官方发布页；保留 ABI、大小、SHA-256、包名、递增版本和签名校验。
- 旧版遇限流时需手动覆盖安装新版一次，不卸载、不清库。沿用 v1.0.1 的规则镜像与蓝白主题，见 [规则连接](docs/RULES_NETWORK.md)。

## 已验证

- 类型检查、135 项前端测试通过；更新页 10 组行为 / 16 组尺寸、主题、字号组合通过，含 375 / 1280 宽度与失败恢复。
- Android 16 / PLK110 独立 `com.genzo.android.updateqa`：10 项更新策略 instrumentation 测试通过，覆盖清单成功不调用 API、旧版 / ABI、缺失 / 无效清单回退及全源失败；16 项 JVM 单元测试通过。
- UI 沿用 React SPA、Tailwind 3、OpenDesign 变量和现有深浅主题；按 Refactoring UI §2.8 保持下载 / 安装主操作，官方发布页仅作失败恢复入口，已检查渲染。
- 正式 APK 包名、1.0.2 / 1000002、arm64、原证书、16 KiB 对齐、43 项许可资产、419 项生产输入及静态清单核对通过。50,733,125 字节，SHA-256 `12e22a5e066f6799c1121005c893906d7c8b81ef5cbb06faf601c0a614f710b3`。
- 正式包 1.0.1 覆盖升级至 1.0.2，原安装时间与已完成引导保留；发布前复现 API 限流，新备用按钮可在系统浏览器打开官方最新发布页。
- 产物目录 `D:/DevTools/Android/Build/releases/yuki/v1.0.2/`，验证日志和截图在 `D:/DevTools/Android/Build/qa/update-limit-20261018/`。
- 待完成：公开发布、公开清单 / APK 联网下载、发布后正式包检查更新及隔离测试安装清理。不得把当前测试描述为这些步骤均已通过。

## 维护边界

- 不清库、不修改真实媒体；数据库只新增迁移，保留原包名、证书、内部标识及资料路径。
- readerqa 不参与本轮设备安装；updateqa 使用独立临时包和缓存，不读取真实媒体或数据库。
- 应用内更新仍由用户手动检查、下载和安装。未验证所有地区 / 运营商可达性或媒体播放 / 阅读全面回归。
- 根文档和实际代码优先；历史 patch 已导入，不重复应用。旧交接见 [归档](docs/history/HANDOFF_PRE_1.0.md)。
