# v1.0.0 前的交接记录

历史原文；发布状态以当前 [交接](../../AI_HANDOFF.md) 为准。

# Yuki 安卓交接

更新于 2026-10-17。继续任务前核对 Git 状态、实际代码、AGENTS 与三份根决策文档。

## 本轮：蓝白主题与新人界面（未发布）

- 用户要求安装 `edisonmbli/refactoring-ui-skill` 并在前端任务使用，默认改为雪乃风格蓝白清冷主题，优化协议确认和规则配置。
- 已用 skill-installer 安装到 `C:/Users/Administrator/.codex/skills/refactoring-ui`，已读取并用于本轮技术识别、修改前走查、修改与渲染核对。用户级 `C:/Users/Administrator/.codex/AGENTS.md` 和本项目 AGENTS 均加入前端必用要求；技能本体为用户级文件，不作为本仓库源码分发。
- 新安装及恢复默认为浅色、冷蓝 HSL(210,64%,64%) 与蓝灰 / 冷白底，保留已有外观选择。`themeStyles.ts` 共用原有主题系数；网页 / 原生默认调色板一致，启动底色同步冷色。
- 实际生产入口检查发现主应用原先以独立 `system` 状态启动，与前端偏好分开；已共用主题模式。引导只读本机数据库 `theme` 设置来保留旧模式，恢复默认同时保存数据库与前端浅色模式，重启不回到旧值。未增加网络或媒体读取。
- 协议页新增两步进度、使用要点、正文阅读分组；原完整条款与主动勾选流程保留。新人规则页突出仓库 / 导入两入口，无规则时隐藏搜索 / 更新空控件，添加后显示数量和完成状态，保留稍后进入本地媒体。
- 修改前后走查见 `docs/design/blue-white-onboarding.md`，保留既有样式架构，未引入新依赖或改动数据结构。
- 已实际通过：类型检查、135 项前端测试、生产构建；新人 UI 14 组行为与 72 组布局（320 / 360 / 375 / 412 竖屏、915×412 横屏、1280 宽屏，深浅主题、100% / 150% 字体及安全区）；实际生产入口 4 组行为与 4 组主界面布局。原规则仓库 2 项 / 12 布局、图标 6 项 / 12 布局通过。
- 默认配色 24 组文字 / 背景对比度通过，最低 4.80:1；14 组 UI 行为包含原生回退调色板与网页实际解析值逐项一致。不能将此结论扩展到任意用户自定义颜色。
- 本轮 UI 输出：`D:/DevTools/Android/Build/qa/onboarding-20261017/ui-1792248997278/`；生产入口结果为同级 `bluewhite-production-entry.json`，对比度矩阵为 `bluewhite-contrast.json`，安卓构建日志为 `bluewhite-android-build.log`。
- 最终 arm64 优化调试 APK 构建通过；本轮 10 个生产输入与构建副本逐项核对一致。预览包 `D:/DevTools/Android/Build/previews/bluewhite-onboarding-20261017/Yuki-0.17.2-bluewhite-readerqa-arm64-v8a.apk`，包名 `com.genzo.android.readerqa`，版本 `0.17.2 / 17002`，targetSdk 36，16 KiB ZIP 对齐通过；同级提供 `SHA256SUMS.txt` 与 `build-manifest.json`。SHA-256：`6008e62bde3b6ca18fe154b6be9cc57324463e32d9099518179a0435b2288a8a`。
- 本轮没有安装 / 修改手机应用，浏览器结果不代表实机验收；版本仍为 0.17.2，未发布正式 Release。

## 先前：首次使用协议与规则配置（未发布）

- 用户要求安卓首次打开先确认使用协议，再像 Kazumi 一样添加规则来源；已接入真实安卓入口。默认勾选为空，不同意不进入；规则支持稍后添加以保留本地媒体使用。
- `src/android/FirstRunGate.tsx` 控制主应用挂载，`LegalNotice.tsx` 为首次展示和「我的」重读入口共用文本。`onboarding.ts` 使用独立本机键 `yuki-android-onboarding` 保存协议版本、同意时间和完成时间；不修改用户数据库或同步协议。老版本首次升级到含此流程的版本也会要求确认一次。
- 原生启动检查发现原先会自动更新资料 / 阅读配置并启动同步，已移至 `src-tauri/src/app_startup.rs`，在完成引导、主应用挂载后调用；`Once` 防止重复启动。安卓初始化仍读取本地数据与内置索引，未同意前不挂载发现或规则目录。
- 协议说明授权、版权、第三方规则风险、本机数据和第三方网络请求，不作“24 小时删除即合法”或全面免责承诺。具体流程、措辞来源与限制见 `docs/ONBOARDING.md`；文本未经过律师审阅。
- 已实际通过：类型检查、32 文件共 135 项前端测试、安卓前端生产构建；首次使用 UI 10 组行为和 48 组布局（320 / 360 / 412 宽竖屏、915×412 横屏，深浅主题，100% / 150% 字体，模拟 38 / 24 安全区）；原规则仓库回归 2 项行为和 12 组布局。
- 最新 UI 输出：`D:/DevTools/Android/Build/qa/onboarding-20261017/ui-1792245651254/`；构建日志在同级 `android-build.log`。
- 实际生产入口的受控接口冒烟验证 3 组通过：未同意时只有本机主题 / 安全区调用；完成后才调用原生后台启动；「我的」协议入口和完成后刷新均正常。结果为同级 `production-entry-result.json`，仍属浏览器验证。
- 最终 arm64 优化调试 APK 构建通过；已核对本轮 10 个生产源码输入与构建副本一致。包名 `com.genzo.android.readerqa`，版本 `0.17.2 / 17002`，ABI `arm64-v8a`，16 KiB ZIP 对齐通过。测试包在 `D:/DevTools/Android/Build/qa/onboarding-20261017/Yuki-0.17.2-onboarding-readerqa-arm64-v8a.apk`，同级 `SHA256SUMS.txt`；SHA-256 为 `a64f1f4a1d29887089f43101dd03f3afebcbf504ff725987eaa1275232c551ae`。
- 本轮没有安装或修改手机应用，不能把浏览器流程测试描述为安卓系统返回、WebView 存储、覆盖升级或原生网络任务的实机验收。版本仍为 0.17.2，未创建正式 Release。

## 用户已确认

- 公开仓库 `https://github.com/Boringchen-10/Yuki` 独立维护安卓，作为项目主页和应用更新来源；重写主 Markdown 文档。
- 延续当前认可的安卓界面与三款图标：经典校服默认，贝雷帽约会 / 围巾冬装可选。
- 不因建仓改包名、签名、数据格式或重置版本号；本次没有要求发布正式 APK 或更新手机。

## 已完成的本地整理

- 公开仓库已创建；交付源码与文档推送到 main，不创建 Release 或发布标签。
- 独立检出目录为 `H:\Yuki`，分支 `main`，origin 指向新仓库；原工作区及其未提交内容没有移走或覆盖。
- 保留原分支历史至 `86b6ecc`，导入并提交已验证 0.17.2 生产输入。历史来源见 `docs/android/SOURCE_BASELINE.md` 和 JSON 清单；历史 patch 无需再套用。
- 主文档已改为安卓范围；默认 Vite / HTML / Tauri 配置面向安卓；更新器与关于页使用 Boringchen-10/Yuki。
- 构建脚本使用独立 yuki 构建目录，从锁定 Cargo 依赖生成本地 Gradle / Tauri 配置，不依赖原工作区忽略文件。密钥仍在仓库外。

## 验证事实

- 独立目录使用 frozen lockfile 安装依赖成功；类型检查、31 文件共 130 项前端测试、安卓前端生产构建通过。
- 图标 UI 验收通过：6 项行为、12 个尺寸 / 主题组合。
- 根主文档相对链接检查通过；版本三处一致为 0.17.2。
- 发布前扫描保留历史的 2969 个 blob，未发现检查模式匹配的 Token / 私钥或敏感扩展文件；这不是对所有可能秘密的形式化证明。
- 完整 arm64 优化调试 APK 构建通过，原生 JVM 单元测试 16 项通过；更新来源策略等 Android instrumentation 测试编译通过，未在设备执行。
- APK 包名 com.genzo.android.readerqa、版本 0.17.2 / versionCode 17002、minSdk 26 / targetSdk 36、arm64-v8a 与 16 KiB ZIP 对齐核对通过；编译后的 dex 包含新更新源且无旧源。
- 规则目录 UI（2 项行为、12 布局）和应用更新 UI（8 组、12 布局）通过。
- 本机直接运行 Gradle 时遇到 Java loopback 错误，设置与构建脚本一致的 D 盘 TEMP / TMP 后通过；默认构建脚本已包含此设置。
- Rust 死代码、Android 弃用 API 与 Vite 分包警告为现有提醒，未在本次做无关清理。

## 后续与限制

- 旧 APK 不会因新建仓库自动换源，需先手动安装兼容的新版本。readerqa 不能用正式包原地覆盖。
- 本次不创建正式 Release；首次独立发布按 docs/RELEASING.md，需升级验证和同证书签名。
- 当前公开源保留安卓复用的桌面模块、历史测试和旧版本文档，不能据此宣称 Windows 也在本仓库发布。
- 本次不修改真实手机或用户资料；未测试系统安装、旧包跨仓库升级或新仓库正式 Release 下载。
