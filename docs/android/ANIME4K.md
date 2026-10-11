# 安卓 Anime4K 超分

用户于 2026-10-11 确认：优先效果与兼容性，接受包体增加，保留现有内核回退。此功能针对 Android；业务页面保留完整当前 OpenDesign 工作区。首次默认关闭，播放界面的“超分”按钮提供关闭、流畅和画质，选择保存在本机。三种来源共用设置，不修改视频文件，不下载转换后的副本。

用户随后明确参照 Kazumi 的硬件解码、硬件解码器、视频渲染器设置，实际参考对象是 Kazumi（不是名为 Bangumi 的客户端）。新增“播放设置”保留倍速入口，保存硬解开关、安卓解码器与渲染器，并显示实际生效的解码 / 渲染路径。

## 解码与渲染设置

- 升级默认仍是兼容 LibVLC；关闭超分后恢复兼容路径。用户也可明确选择 GPU 路径，关闭超分时继续使用该路径。
- 安卓解码器提供 auto-safe、auto、auto-copy、mediacodec、mediacodec-copy；硬解关闭时 mpv 使用 no，LibVLC 也关闭硬解。未把 Windows / macOS / Linux 专属解码器作为安卓可用选项。
- 渲染器提供兼容、自动、OpenGL gpu、Vulkan gpu-next 与 mediacodec_embed。自动参考 Kazumi，在 Android14+ 且有 Vulkan1.2 能力时选择 Vulkan，其余使用 OpenGL；Vulkan 运行失败可切 OpenGL，GPU 路径仍失败时切兼容内核。保留用户原偏好，实际路径与请求配置分别显示。
- 直通模式强制硬解 / MediaCodec，并关闭超分和字幕；选项及提示明确说明限制，字体 / ASS 需要 GPU 路径。开启超分会把直通切到 OpenGL。直通 Surface 单独按视频比例居中适配，不能把未处理的全屏 Surface 当成已保持比例。
- Vulkan 下显式 mediacodec 使用可兼容的 mediacodec-copy；硬解不可用由 mpv 尝试软件解码。切换设置保留当前会话、位置、暂停、倍速和可用音轨 / 字幕；不增加数据库迁移。

## Rust 重写版本核对

已读取用户提供的 `randspace0/Anime4K-rs@e3b3ff132018d5314462ae4b328a7f4b859b3aa5`。当前 main.rs 是输入图像 → image_kernel 的缩放 / luminance / push color / gradient → 输出图像的 CLI；Cargo 使用 image / raster / rayon。没有直接可供 Android 视频播放器接入的实时 GPU / Surface 链路。官方 Anime4K README 把该实现列在可能使用较旧算法的一组参考中。

本轮继续采用与 Kazumi 对应的 libmpv + 官方 GLSL 视频路径，没有因 Rust 实现语言相同就替换现有 CNN shader，也没有移植该仓库的第三方示例图片。未进行两者的质量 / 性能实测对比，不声称 Rust 语言本身更慢或效果更差。

## 实现与来源

- 兼容播放继续使用 LibVLC 3.7.7；GPU 路径使用原生 libmpv 的 OpenGL 或 Vulkan 与选定解码器。硬解失败由 mpv 尝试软件解码；GPU 初始化、着色器或播放失败恢复兼容路径，界面明确显示原因。
- 原封不动打包 Anime4K 官方 GLSL 文件，固定 `bloc97/Anime4K@7684e9586f8dcc738af08a1cdceb024cc184f426`，MIT。不是普通锐化滤镜，也不将 UI 开关当作生效证据。
- 流畅档采用上游低端 GPU Mode A：Clamp Highlights → Restore CNN M → Upscale CNN x2 M → AutoDownscalePre x2 / x4 → Upscale CNN x2 S。画质档采用 Mode A 高端组合：Clamp → Restore VL → Upscale VL → AutoDownscale x2 / x4 → Upscale M。`WHEN` 条件由 mpv 按源视频与实际显示尺寸判断，并非每个文件在每个尺寸都运行全部放大阶段。
- Surface JNI 接入参考 `mpv-android@c2e02fe111541e4063ab8f868bf629649ed937a3`（MIT），Genzo 使用独立 Activity handle、结构化命令与非阻塞事件轮询；没有全局 mpv 播放器、Dart / Flutter 运行时或上游品牌素材。
- 原生二进制来自 `Predidit/libmpv-android-video-build@dd2bfba8209bcd22e2d4c79f125b40e619e637ed` / v1.2.7 的 **default** 构建，仅取 `libmpv.so`；不取 Dart helper、full 或 encoders-gpl。制品按 ABI 锁定 SHA256，构建时校验，运行时不下载内核。来源及各组件许可证见 `licenses/libmpv-1.2.7/SOURCES.md`，不能把构建脚本的 MIT 误写成全部内核的许可证。

## 与现有能力共存

规则 / WebDAV 沿用 Rust 的会话代理、鉴权、Cookie、显式 UA / Referer、Range 与 HLS 子资源转发；不向前端暴露实际签名地址或凭据。规则解析仍先进入原生加载界面，返回取消解析和晚到结果的保护不变。本地 SAF / content 来源保留授权、以文件描述符读取，不复制视频。

切换处理方式重建当前渲染器，保留 session / 媒体 ID、播放位置、暂停、倍速、音轨顺序、字幕选择和外挂字幕偏移；已有 SQLite 观看记录沿用同一模型，没有迁移。切换可能短暂重新缓冲。回退只影响当前播放，保留用户希望下次启用的偏好；主动选“关闭”后后续默认使用 LibVLC。

该 default 内核未带 fontconfig。字幕仅加载手机上可读的 Roboto / Noto Sans CJK 系统字体，在私有缓存中建立链接，不将系统字体复制进 APK，也不把整个系统字体目录载入内存。已检查中文 SRT 与内嵌 ASS 的实际文字 / 样式画面。规则加载壳先用现有普通视图，取得媒体地址后才初始化 GPU，避免加载页等待超分内核。

## 构建与验证

`app/anime4k.gradle.kts` 为各 ABI 注册独立原生制品校验 / JNI 编译任务，使用 NDK 27.0.12077973；Gradle 用户缓存保留已验证 jar，生成目录位于 build 下，仓库不提交 .so。JNI 与上游 arm64 ELF 支持 16 KiB 对齐。所有许可和第三方说明写入 APK assets；播放器“超分 → 开源说明”可查看。替换 LGPL 库可重新构建 / 签名本项目，不禁止为调试库修改而逆向工程。

`scripts/verify-android-anime4k.mjs` 严格限定独立 `com.genzo.android.organizeqa`，使用自建 MP4 / HLS / 字幕 / WebDAV；测试私有 FileProvider content FD、GPU pass 记录、两档、暂停拖动、音轨倍速、字幕、方向、WebDAV 鉴权与续播、规则 HLS、关闭回 LibVLC。测试文件只写入 QA cache 与显式命名临时文件，不向用户包写入测试数据。

设备结果与具体证据在本轮 `AI_HANDOFF.md`，不据单机短测宣称所有芯片、HDR / Dolby Vision、长时间功耗或所有编码均已验证。Anime4K 主要面向动画线条与放大显示；画质档成本更高，1080p / 4K 或实拍视频可按观感关闭。
