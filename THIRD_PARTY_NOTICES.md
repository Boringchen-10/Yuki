# 第三方依赖与许可证

## 安卓 Anime4K / libmpv（2026-10-11）

- `bloc97/Anime4K@7684e9586f8dcc738af08a1cdceb024cc184f426`：MIT，Copyright (c) 2019 bloc97。直接包含官方 Clamp / Restore CNN M、VL / Upscale CNN x2 S、M、VL / AutoDownscalePre x2、x4 GLSL；全文 [licenses/anime4k-MIT.txt](licenses/anime4k-MIT.txt)。预设以官方低端 / 高端 Mode A 为准，参考 Kazumi 对 mpv shaders 的加载方式。
- Android Surface JNI 参考 `mpv-android@c2e02fe111541e4063ab8f868bf629649ed937a3`，MIT，Copyright (c) 2016 Ilya Zhuravlev；Copyright (c) 2016 sfan5。全文 [licenses/mpv-android-MIT.txt](licenses/mpv-android-MIT.txt)。Genzo 自行实现 handle 生命周期、控制适配、回退与测试；不复制应用 / 品牌素材。
- 原生库使用 `Predidit/libmpv-android-video-build` v1.2.7 / `dd2bfba8209bcd22e2d4c79f125b40e619e637ed` 的 default 制品，仅提取 libmpv.so。构建脚本 MIT **不等于原生库全部 MIT**：mpv / libplacebo 为 LGPL2.1+，本次 FFmpeg 配置为 LGPLv3，其他静态依赖的原始声明、精确来源与重建路径见 [licenses/libmpv-1.2.7/SOURCES.md](licenses/libmpv-1.2.7/SOURCES.md)。不嵌入 Dart / Flutter、media-kit helper、encoders-gpl 或 x264。
- 上述许可证与全部既有第三方说明打包为 Android assets；“超分 → 开源说明”可查看。允许替换 / 调试修改后的 LGPL 库并重新链接本 GPLv3 项目。
- 解码 / 渲染选项、自动选择与直通 / 超分联动参考同一 Kazumi GPLv3 快照的 `lib/utils/constants.dart`、`lib/services/storage/settings_keys.dart`、`lib/pages/settings/{player_settings,decoder_settings,renderer_settings}.dart`、`lib/pages/player/controller/player_playback_controller.dart`，适配到现有 Kotlin / Tauri 流程，仅提供安卓相关选项。完整 GPLv3 许可仍见 `licenses/kazumi-GPL-3.0.txt`。

Genzo v0.5.0 使用以下直接依赖。具体传递依赖及锁定版本以 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 为准。

## Android 原生阅读增量

本轮网络 / 缓存适配的 Kira 与 Kazumi 文件和固定提交见 `docs/android/READER_NETWORK_FIXES.md`。Kazumi GPLv3 许可保留于 `licenses/kazumi-GPL-3.0.txt`；仅参考公共域名连接、接口与图像缓存实现，不复制账号 / 镜像签名凭据和品牌素材。

启用 reqwest gzip 使用 async-compression `0.4.50`、compression-codecs `0.4.45`、compression-core `0.4.33`（MIT OR Apache-2.0）；声明保存于 `licenses/async-compression-LICENSE-*.txt`。ECH 直接使用已有锁定依赖 rustls `0.23.44`（Apache-2.0 OR ISC OR MIT）、base64 `0.22.1`（MIT OR Apache-2.0）和 webpki-roots `1.0.9`（CDLA-Permissive-2.0）；完整声明保留于相应 `licenses/` 文件。AWS-LC-RS 为既有密码学依赖（ISC AND (Apache-2.0 OR ISC)），TLS 保留证书验证；CA 数据随分发保留 CDLA 许可文本。

- 小说接入 Readium Kotlin Toolkit `3.1.2` 的 shared / streamer / navigator，BSD-3-Clause，源码核对 `71074ea0c424eabbc39a93b48a4cefe366f7741b`，完整许可见 `licenses/readium-BSD-3-Clause.txt`。使用公开 SDK 管理 Publication、EPUB 排版、导航、偏好与 Locator；Genzo 独立实现来源、原生控件和 SQLite 记录。当前不引入 LCP 二进制或第三方字体 / 品牌素材。
- 漫画使用 `com.davemorrissey.labs:subsampling-scale-image-view:3.10.0`，Apache-2.0，完整许可见 `licenses/subsampling-scale-image-view-Apache-2.0.txt`。原生采样 / 分块缩放视图与 Genzo 的加载、导航及进度模块组合；不将 Mihon 整套应用作为依赖。
- `org.jsoup:jsoup:1.18.1` 按 MIT 使用，完整声明见 `licenses/jsoup-MIT.txt`；用于在内存中兼容既有 EPUB 的段落与插图链接，不改写原始书籍或缓存。
- AndroidX RecyclerView `1.4.0`、ViewPager2 `1.1.0` 与 desugar_jdk_libs `2.1.5` 按 Apache-2.0 使用；Android 依赖版本以 `src-tauri/gen/android/app/build.gradle.kts` 及构建解析结果为准。Kira 继续按既有 MIT 快照参考基础交互，不移植 Logo、图标或作品素材。

## 前端与构建工具

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 用户界面 | MIT |
| React Router DOM | 页面路由 | MIT |
| Zustand | 前端状态 | MIT |
| Lucide React | 界面图标 | ISC |
| Tauri JavaScript API / Dialog Plugin | 桌面桥接与原生对话框 | Apache-2.0 OR MIT |
| Vite / React Plugin | 开发与前端构建 | MIT |
| TypeScript | 类型检查 | Apache-2.0 |
| Tailwind CSS | CSS 基础层 | MIT |
| PostCSS / Autoprefixer | CSS 处理 | MIT |
| Vitest | 前端测试 | MIT |
| Playwright Core | 本地 WebView 视觉验收 | Apache-2.0 |

## Rust 后端

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| Tauri / Tauri Build / Dialog Plugin | 桌面运行时与构建 | Apache-2.0 OR MIT |
| SQLx | SQLite 异步访问与迁移 | Apache-2.0 OR MIT |
| Tokio | 异步运行时 | MIT |
| Serde / serde_json | 数据序列化 | Apache-2.0 OR MIT |
| uuid | 本地记录标识 | Apache-2.0 OR MIT |
| chrono | 时间处理 | Apache-2.0 OR MIT |
| walkdir | 目录遍历 | Unlicense OR MIT |
| natord | 文件名自然排序 | MIT |
| dunce | Windows 路径规范化 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| thiserror | 错误类型 | Apache-2.0 OR MIT |
| regex | 动漫文件名规则解析 | Apache-2.0 OR MIT |
| strsim | 标题相似度评分 | MIT |
| reqwest | Bangumi 官方 API HTTPS 请求 | Apache-2.0 OR MIT |
| futures-util | 阅读图片有界并发与来源顺序保持 | Apache-2.0 OR MIT |
| anitomy-ng | 动画文件名结构解析（Anitomy 的纯 Rust 移植） | MPL-2.0 |
| tmdb-rs | TMDB 官方 API 的类型化 Rust 客户端 | MIT |
| async-trait | 异步元数据 Provider trait | Apache-2.0 OR MIT |
| lru | 进程内元数据搜索缓存 | MIT |
| image | 封面格式校验与缩略图生成 | Apache-2.0 OR MIT |
| windows | Windows Shell API 绑定 | Apache-2.0 OR MIT |
| tempfile | 测试临时目录 | Apache-2.0 OR MIT |

SQLite 本身属于公有领域（Public Domain）。

## Seanime

Genzo 的侧栏、首页媒体布局和主题实现基于 Seanime 的 GPLv3 界面结构进行移植与修改。Seanime 源码：<https://github.com/5rahim/seanime>，许可证为 GNU GPL v3.0。Genzo 不使用 Seanime 的名称、Logo、截图或其界面中展示的第三方动画素材。

`public/demo` 中的临时主题预览图片来自 Unsplash 图片服务，只能通过开发预览参数使用。正式应用界面不会加载这些图片；没有用户封面时使用 Genzo 自有的类型占位视觉。

Windows 包不捆绑 VLC、mpv、PotPlayer、MPC-BE 等外部程序。自动检测仅检查用户机器上的典型安装路径。Android v0.9.0 起仅使用下文说明的 libmpv，旧版 LibVLC 来源保留如下供历史版本核对。

## 旧版 Android LibVLC（v0.8.x 及以前）

安卓原型使用 VideoLAN 发布的 `org.videolan.android:libvlc-all:3.7.7` AAR，以 JNI / Java API 在进程内播放原始媒体。发布者 [Maven POM](https://repo.maven.apache.org/maven2/org/videolan/android/libvlc-all/3.7.7/libvlc-all-3.7.7.pom) 声明 LGPL-2.1，源码仓库为 [VideoLAN libvlcjni](https://code.videolan.org/videolan/libvlcjni)，核心源码为 [VLC](https://code.videolan.org/videolan/vlc)。Genzo 的集成代码继续使用 GPLv3；不移植上游播放器 UI、商标、Logo 或第三方媒体。

最终公开分发前须归档与精确 AAR 构建匹配的核心 / JNI / 编解码依赖源码、许可证与构建说明，保留 LGPL 修改 / 重新链接要求；不能把 JNI sources.jar 当全部核心对应源码。本阶段仅生成本机 / 用户设备调试 APK，未做正式公开发布。包体与内核评估见 `docs/android/PLAYER_EVALUATION.md`。

## Android Kazumi 兼容规则来源

本轮安卓规则来源实现核对以下固定源码快照，不捆绑或运行 Kazumi 应用，不引入 Dart / Flutter 运行时。实现范围与验收边界见 [docs/android/KAZUMI_RULE_SOURCES.md](docs/android/KAZUMI_RULE_SOURCES.md)。Genzo 保留自己的 OpenDesign 界面与作品模型，v0.9.0 起使用原生 libmpv。

| 上游 | 固定提交 | 许可证与使用范围 |
| --- | --- | --- |
| [Predidit/Kazumi](https://github.com/Predidit/Kazumi) | `2768c230407d5fd8a57716160ba1a85a99161581` | GNU GPL v3.0。参考并适配规则字段、XPath 上下文、API 请求 / 受限 JSONPath / 模板 / 选集语义、Android 网页媒体地址发现，以及可选 HLS discontinuity 广告片段判断。许可全文见 [licenses/kazumi-GPL-3.0.txt](licenses/kazumi-GPL-3.0.txt)。 |
| [Predidit/KazumiRules](https://github.com/Predidit/KazumiRules) | `fce5e15a2e6b57500912d41b3f1c65bb3eb7d392` | MIT，Copyright (c) 2024 Predidit。兼容规则仓库目录与 JSON 格式，用户可按需安装 / 导入 / 更新；仓库内容随上游变化，不作为固定可用站点清单。许可全文见 [licenses/kazumi-rules-MIT.txt](licenses/kazumi-rules-MIT.txt)。 |
| [simonkimi/xpath_selector](https://github.com/simonkimi/xpath_selector) | `5b3d178d06bafd445e03f8f2de9c06088546f3ef` | BSD-3-Clause，Copyright (c) 2021 simonkimi。本轮仅研究 XPath 的选择与节点上下文行为，没有复制或打包该 Dart 库的实现。实际解析使用 Android 标准 `javax.xml.xpath` 与已有 jsoup / W3CDom。 |

核对的 Kazumi 文件包括 `lib/plugins/plugins.dart`、`lib/services/plugin/xpath_rule_strategy.dart`、`lib/services/plugin/api_rule_strategy.dart`、`lib/plugins/anti_crawler_config.dart`、`lib/webview/video/impl/video_webview_android_impl.dart`、`lib/utils/episode_url.dart` 和 `lib/utils/m3u8_ad_filter.dart`。移植 / 适配代码继续按 Genzo 的 GPLv3 提供对应源码；没有复制上游商标、Logo、截图、作品封面或媒体文件。

规则 HTML 使用既有 `org.jsoup:jsoup:1.18.1`（MIT）转为 W3C DOM，然后由 Android 标准 XPath 引擎执行；许可见既有 [licenses/jsoup-MIT.txt](licenses/jsoup-MIT.txt)。网页媒体发现使用既有 AndroidX WebKit `1.14.0`（Apache-2.0）与系统 WebView，网络与代理使用已有 Rust 依赖。规则与本地 / WebDAV 共用下文说明的 libmpv 内核与许可。

规则仓库的代码许可证不等同于来源网站、媒体作品或第三方接口的授权。网站与规则可能失效、改变接口或要求网页验证；Genzo 不据规则目录或一次样本验收承诺全部站点永久可用。

PotPlayer 进度适配使用其 Windows 消息协议及安装目录的 `CmdLine64.txt` 参数说明；接口常量核对自 [PotPlayerControl 的 InternalSimpleCmd.h](https://github.com/ld3l/PotPlayerControl/blob/main/InternalSimpleCmd.h)。适配器为独立 Rust 实现，未复制该项目的控制器实现、商标或素材，也未捆绑 PotPlayer。该接口在不同播放器版本中可能变化，连接或文件核对失败时保留旧进度。

## Kira 漫画与轻小说接口参考

漫画阅读四项补充适配固定 `fc3f242fee2e3b68de94bc35296fc73db60031c3` 的 `reader_image_cache.dart`、`reader_image_pipeline.dart`、`reader_scroll_mode.dart` 和 `pinch_zoomable.dart`：图片请求头、缓存 / 重试 / 预加载及整段缩放算法。MIT Copyright (c) 2026 孤独的Lonely；完整许可仍见 `licenses/kira-MIT.txt`。Kotlin适配文件保留来源说明，具体差异及验收见 `docs/android/COMIC_KIRA_FOLLOWUP.md`。

漫画目录、章节及小说接口契约参考 [caolib/kira](https://github.com/caolib/kira)，固定核对提交 `8a7b3f060ef521f0cbeda719bf0931e9af5ed89e`（2026-10-05）：`lib/api/manga/manga_api.dart`、`lib/api/novel/novel_api.dart`、`lib/api/novel/novel_text.dart`、`lib/models/chapter.dart` 与 `lib/models/novel.dart`。Genzo 独立实现 Rust 请求 / 缓存、严格编码与目录解析和 React 界面，参考分页、请求头、来源标识与整卷 TXT 行号约定；不捆绑 / 启动 Kira，不移植 Flutter 界面或来源账号代码，不复制商标、Logo 与第三方素材。

上游为 MIT License，Copyright (c) 2026 孤独的Lonely；完整声明见 [licenses/kira-MIT.txt](licenses/kira-MIT.txt)。代码许可不等于作品版权或官方接口授权。当前仅按用户操作获取有权访问的匿名内容，不绕过锁定或分发正文；服务兼容性可能改变。

2026-10-05 的阅读网络增量另核对 `ac0a4db1d01f95d816d61a2960c48d5296a70c1b` 中 `lib/api/api_transport.dart`、`lib/api/network/network_api.dart` 和 `lib/api/copy_settings_auto_updater.dart`：仅参考六节点、API / 版本发现和启动时每日检查约定，Rust / React 独立实现，不复制登录或 Flutter 界面。

futures-util 0.3.34 的 MIT / Apache-2.0 声明见 `licenses/futures-util-LICENSE-MIT.txt` 与 `licenses/futures-util-LICENSE-APACHE.txt`。reqwest system-proxy 增量使用 hyper-util（MIT）与 Windows 上的 windows-registry（MIT OR Apache-2.0）；锁文件的平台传递依赖 system-configuration / system-configuration-sys / core-foundation 为 MIT OR Apache-2.0，与 GPLv3 兼容。Windows 已构建验证，未据此声称 macOS 运行通过。

## encoding_rs

小说 UTF-8 / GBK 校验使用 encoding_rs 0.8.42，许可证 `(Apache-2.0 OR MIT) AND BSD-3-Clause`，与 Genzo GPLv3 兼容。完整声明保留于 `licenses/encoding_rs-LICENSE-MIT.txt`、`licenses/encoding_rs-LICENSE-APACHE.txt`、`licenses/encoding_rs-LICENSE-WHATWG.txt`；许可证来自锁定 crates.io 发布包。传递依赖 core_detect 为 MIT / Apache-2.0，multiversion_no_op 为 Apache-2.0 OR MIT。源库见 <https://github.com/hsivonen/encoding_rs>。

## Bangumi

Genzo 通过 Bangumi 官方 API（<https://github.com/bangumi/api>）搜索动画条目并读取作品元数据，不抓取网页。作品数据及封面版权归各自权利人所有，Genzo 仅按用户操作在本地缓存。动画结构解析使用 MPL-2.0 的 `anitomy-ng`；中文目录预处理、目录回溯和加权候选评分为 Genzo 自有实现。实现未复制 Animeko 代码。

Genzo 的探索功能还使用 `bangumi-data`（<https://github.com/bangumi-data/bangumi-data>）提供的番组标题、译名、放送时间与 Bangumi 条目 ID 索引。该数据集采用 [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)（CC BY 4.0）许可；Genzo 通过项目文档公开的 `unpkg` 地址读取数据并保留来源标识，解析后仅缓存 Bangumi ID，不缓存或使用其中列出的在线播放站点标识。

发布包内置用户于 2026-09-15 提供的 `bangumi-data 0.3.132` 数据快照，用于离线标题索引、本季番组和放送时间表。Genzo 仅提取标题、译名、类型、日期和信息站点 ID；不将其中的在线播放站点作为媒体源。

## TMDB 与 AniList

Genzo 使用 `tmdb-rs` 访问 TMDB 官方 API。TMDB 仅在用户配置自己的 Read Access Token 后启用，用于补全经过标题与年份校验的海报和背景图；不提供媒体播放地址。TMDB API 使用受其服务条款约束，图片版权归各自权利人所有。

Genzo 使用 AniList 公共 GraphQL API 补全经过校验的国际评分、标签和视觉字段。Genzo 不要求 AniList 用户账号，不代表 AniList 官方客户端。豆瓣当前没有适合本地桌面应用稳定使用的授权公开 API，因此 Genzo 不抓取豆瓣网页，也不调用未公开移动端接口。

## 识别架构参考核对

v0.4 的 WebDAV XML 解析使用 `quick-xml 0.42`（MIT），路径解码使用 `percent-encoding 2`（MIT OR Apache-2.0），与项目 GPLv3 兼容。凭据通过既有 `windows` crate 调用 Windows Credential Manager；HTTP 传输复用 `reqwest`，没有引入或复制 Alist 的源码、商标或网盘专有接口。

- `Rapptz/anitomy-rs` 为 MPL-2.0，但没有适合本项目锁定的稳定 crates.io 发布；本项目改用同为 MPL-2.0、仍在维护的 `anitomy-ng 1.0.10`，没有复制其品牌资产。
- 用户提供的 `bangumi/api-client-rs` 地址当前不可用，因此保留已经通过真实 API 契约测试的 `reqwest` Bangumi 客户端，不假装使用不存在的 SDK。
- `jwalk 0.9.0` 已由维护者标记为 deprecated；现有 `walkdir` 扫描器已有重复扫描、缺失标记和目录重加测试，本轮不为依赖清单而替换稳定实现。
- Jellyfin Bangumi 插件与 Stump 仅用于核对候选加权、分层和缓存思路；本轮没有复制其代码。Genzo 的中文预处理、评分、聚合和迁移为独立实现。
