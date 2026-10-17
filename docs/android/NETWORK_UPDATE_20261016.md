# 安卓发现播放、应用更新与网络优化

基线为安卓 v0.16.1 / `c9feaf3` 的完整当前 OpenDesign 工作区，本轮本机预览为 v0.17.0；Windows 主目录和公开安卓 v0.5.2 保留。

## 使用

- 发现打开动漫作品，点官方剧集卡片，进入与媒体库相同的规则来源面板。检索和关闭不写库；明确选择实际来源剧集播放时幂等保存作品，官方分集 ID 决定记录归属，不按来源第 13 集猜官方第 13 集。已有个人状态保留。
- “我的 → 关于 → 检查更新”读取 `Boringchen-10/genzo` 的 GitHub Releases，选择比当前安装版更高的正式版本、匹配 arm64-v8a / x86_64 的标准 APK。预发布、旧版、Windows 附件和缺少校验值的 APK 不作为更新。
- 点“下载安装包”后显示实际字节，支持取消及失败重试。校验完整长度、SHA-256、包名、严格更高的 versionCode 和完全相同的签名证书，成功后显示“安装更新”；再次核验后才将私有缓存 APK 交给系统安装器。首次授权返回后再点安装，不自动安装。
- 包名与签名保持，更新没有卸载、清除数据或重建数据库操作。媒体库、来源、收藏和播放记录继续使用既有 SQLite / 加密存储；数据库后续变更仍须新增迁移。
- 网络设置测试现在同时覆盖 Bangumi v0、作品吐槽与本集讨论。评论的 P1 官网接口独立于 v0 镜像。WebDAV 无需改来源地址或重新扫描即可使用连接 / 重定向复用。

## 后续发布契约

- 保持 `com.genzo.android`、同一发布签名、递增 SemVer 和 versionCode。
- 对应 GitHub Release 提供 `Genzo_<版本>_android_arm64-v8a.apk`，若交付 x86_64 则提供相应 ABI 文件；`SHA256SUMS.txt` 使用 `sha256  文件名`。GitHub 返回有效 sha256 digest 时可直接采用，否则读取校验附件。
- 发布 APK 必须构建自审阅后的完整源码，校验资产与包内版本一致。现有 `scripts/build-android-release.ps1` 已使用该命名及校验格式。
- 本轮没有创建公开 Release，因此已安装预览版可能显示没有更高正式版本；不能把旧公开包作为升级或声称未来版本已经发布。

## 验证与边界

- TypeScript、前端 130 项与安卓更新 Kotlin / instrumentation 源码编译通过。更新真实 React 夹具通过手动检查、下载进度、取消重试、显式安装、授权说明、校验错误及本机预览高于公开版等 8 组，在 360 / 412 / 915 / 1024 / 1366 / 1920 深浅主题 12 组合无横向溢出；已看窄屏截图。
- 完整 Windows Rust 默认并行回归最终 426 通过 / 19 个既有外部环境测试忽略；首次一项受控评论服务因全局限流排队超时，仅修复测试互斥后重跑通过，未放宽生产预算。安卓优化 Rust、隔离 QA、日常 debug 与签名 Release 均构建成功，保留既有平台死代码、Gradle 弃用与前端大 chunk 提示。
- PLK110 / Android 16 独立 organizeqa 的 `AppUpdatePolicyTest` 4 项原生通过，覆盖正式版本与 ABI 选择、地址与校验值、同包名 / 更高版本 / 同签名、断传 / 过长 / 错哈希。实际关于页检查 GitHub Release 约 2099 ms 返回没有更高正式版，随后同包真实读取 2 条 Bangumi 吐槽；作品、来源与进度只读哈希前后相同，截图已查看。首次 CDP 截图在设备休眠时超时，改为唤醒后按 QA 前台守卫用原生截图重跑，通过结果在 `D:/DevTools/Android/Build/qa/network-update-20261016/native-update-1792205162061/result.json`。
- WebDAV 实际 libmpv 三场景通过：受控首帧 1103 ms、未缓存定位后继续播放、旧签名 403 后仅重新解析一次；具体证据与测量限制见专项文档。
- 发现播放与后端绑定验证见对应脚本和本轮交接；Bangumi / WebDAV 的根因证据、受控回归、参考版本与许可证见 [Bangumi](BANGUMI_NETWORK_RELIABILITY.md) 和 [WebDAV](WEBDAV_NETWORK_20261016.md)。本机受控时间不能推广为所有网盘或运营商的起播承诺。
- 首版更新任务仅在当前进程中保留。进程结束后重新检查并显式下载，会重新获取整个 APK；这不影响已存在的个人数据。没有后台自动下载、断点续传或静默安装。
- 当前没有真实的更高公开 APK 可进行完整 GitHub 下载 → 系统升级实测；原生策略测试与隔离 APK 原位升级验证需与这一外部发布条件区分。实际用户网络、长时播放和更多机型仍需日常验收。

## 制品与草稿归属

最终签名制品：`D:/DevTools/Android/Build/previews/network-update-20261017/Genzo_0.17.0_android_arm64-v8a.apk`，50,060,485 字节，SHA-256 `bc0ce15fc5bc3a0fda8f019b09f63860e6aa86e2e7c995cdd6b1661cbeaf218f`。同目录提供 SHA256SUMS.txt 与 build-manifest.json。

包名 `com.genzo.android`、versionCode 17000、arm64-v8a、min API 26 / target 36、非 debuggable、v2 / v3 签名及 16 KiB ZIP 对齐验证通过，签名证书 SHA-256 与 v0.16.1 相同。353 项生产源码 / 配置输入与 D 构建副本一致；Rust 输入、Gradle 合并 / 符号剥离输出与 APK 库按相应阶段核对，APK 不含用户数据库或测试媒体。初次直接比较剥离前库与包内库失败，改为核对真实 Gradle 输入 → 剥离输出 → APK 的链路后通过，未修改业务产物。

本轮只在独立 QA 包安装测试，未替换普通包或日常 readerqa，未发布 / 推送 Release。新安装包可以直接覆盖原签名普通包，首次获得更新入口仍需安装此包。

保留当前 OpenDesign 全部草稿；`NETWORK_UPDATE_SOURCE_HANDOFF.patch` 仅记录 AndroidApp、android_bridge、GenzoPlugin 与 NetworkPanel 的本轮增量，`DISCOVERY_PLAYBACK_SOURCE_HANDOFF.patch` 记录发现 / 剧集与来源面板增量，均已应用且逆向检查通过，不能重复应用。未把这些原已修改 / 未跟踪文件整文件纳入提交。其余 clean / 新模块、验证脚本、版本和配套文档按范围提交。

## 依据

更新采用 Android 既有 API，未增加依赖：[应用签名与更新身份](https://developer.android.com/studio/publish/app-signing)、[安装来源权限](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())、[FileProvider 临时读取授权](https://developer.android.com/reference/androidx/core/content/FileProvider)。网络参考项目及许可记录在上述两个专项文档和第三方声明中。
