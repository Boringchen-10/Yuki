# Android 播放内核评估与第一阶段选择

核对日期 2026-10-04，基线 Windows v0.5.0。选择 **LibVLC 3.7.7** 作为安卓首版主内核；已通过一加用户设备原型，尚未完成正式媒体库播放会话 / WebDAV 业务闭环。

2026-10-06 后续验证：稳定媒体 ID 的 SAF / WebDAV 原流播放、控制、候选字幕、单文件选择与 SQLite 续播已接，电脑 API36 x86_64 模拟器通过合成服务鉴权 / Range / 断线恢复。系统选择器后 surface 重绑、模拟器 debug 软件解码及暂停倍速延后应用均已有失败 / 修复截图。当前原生控件仍为验证版，真机没有部署本轮包；详细范围见 [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md)。以下表格保留第一阶段真机记录，不把其待办当当前未实现判断。

## 官方维护、许可与嵌入成本

| 内核 | 当前维护证据 | 许可核对 | 安卓 / Tauri 接入 | 包体依据 |
| --- | --- | --- | --- | --- |
| libmpv | [mpv-android releases](https://github.com/mpv-android/mpv-android/releases) 有 2026-09-17 构建；依赖含 FFmpeg、libass 等，不是停止维护项目 | [mpv Copyright](https://github.com/mpv-player/mpv/blob/master/Copyright)：默认 GPL 构建与可选 LGPL 构建需按启用代码 / 依赖确认；不是仅凭项目名认定 LGPL | 官方 [libmpv 嵌入接口](https://mpv.io/manual/stable/#embedding-into-other-programs-libmpv)；安卓需维护 JNI / NDK 和依赖构建链、surface / events / 生命周期。借鉴 mpv-android 不等于有官方可直接消费的稳定 AAR | 本轮未生成相同配置 APK，不提供估算“精确体积” |
| LibVLC | [VideoLAN 发布者 Maven 元数据](https://repo.maven.apache.org/maven2/org/videolan/android/libvlc-all/maven-metadata.xml) 最新稳定 3.7.7，4.0 为 EAP；元数据更新时间 2026-10-01 | [3.7.7 POM](https://repo.maven.apache.org/maven2/org/videolan/android/libvlc-all/3.7.7/libvlc-all-3.7.7.pom) 声明 LGPL-2.1；公开发布前继续核对精确二进制依赖 / 对应源码 | 发布 AAR；`LibVLC/Media/MediaPlayer/VLCVideoLayout` 可直接由 Kotlin Activity 调用，Tauri 原生插件桥仅传定位 / 操作 / 状态，免维护整个解码依赖链 | 全 ABI AAR 实测 92,576,688 bytes；打包仅 arm64。libvlc.so 45,875,392 bytes、JNI 97,736 bytes、libc++ 1,374,336 bytes，不能把总 APK 大小全部归因播放器 |
| Media3 / ExoPlayer | [AndroidX releases](https://github.com/androidx/media/releases) 最新 1.11.1，2026-09-11；官方持续维护 | [Apache-2.0](https://github.com/androidx/media/blob/release/LICENSE)，可与 Genzo GPLv3 集成并保留通知 | Kotlin / AndroidX 接入成本低，ContentResolver / MediaCodec / PlayerView / 原生事件成熟。若加入软件 decoder 扩展需额外原生构建；不自动获得所有格式 | 未生成相同功能配置 APK；平台解码路线通常无需打包完整 VLC 编解码核心，这是架构判断，不是实测大小 |

Media3 官方 [支持格式](https://developer.android.com/media/media3/exoplayer/supported-formats) 明确支持 MP4、Matroska 和独立 SSA/ASS、SubRip；默认解码依赖设备平台，HDR 也依赖平台 / 设备。本次没有以“Media3 完全不支持 ASS”排除它，也没有把支持 SSA/ASS 容器等同于完整复杂样式 / 字体附件兼容。

LibVLC 在当前样本中同时打通 H.264/H.265、MKV、双音轨、内嵌与外挂字幕，且使用已发布 AAR，能减少 JNI / 解码工具链维护。动漫字幕是首版重点，现有样本实际呈现 ASS 描边、颜色和移动；因此先选它推进业务。libmpv 的 libass 路线仍是后续对复杂字幕的参考，Media3 可在包体 / 平台集成需求变化时重新评估；首版不同时打包多套内核。

## 原型实现与“无损播放”

本地 SAF URI 用 `ContentResolver.openFileDescriptor(uri,"r")` 取得可读描述符，直接交给 `Media`；网络媒体用原始流及 Rust 鉴权 Range 代理。没有把视频复制到私有缓存再播放，没有编码 / 压缩 / 转码步骤，没有自有解码器。设备保留硬件优先并允许内核回退；debug ranchu / goldfish 模拟器使用 LibVLC 软件解码，避免暂停拖动后旧帧。不能宣称所有设备样本都硬解。

外挂字幕仅复制用户选中的小型 SRT/ASS/SSA 至私有临时目录，单项上限 16 MiB，Activity 结束清理；视频不复制。第一阶段仅用 URI 哈希 SharedPreferences 验证续播；后续已写既有 `playback_progress` 稳定媒体 ID 并接首页继续观看，实测范围见本阶段接入报告。

## 真机样本结果

设备：用户称一加 15；ADB 型号 PLK110，Android 16 / API 36，arm64-v8a，4096 bytes 页面。所有视频为自行生成的 40 秒、640×360 / 24 fps SDR 测试片，音频 AAC；未使用或改写用户真实媒体。

| 验证项 | 结果 / 实际范围 |
| --- | --- |
| MP4 + H.264，MKV + H.265 | 均能输出画面 / 播放位置与 40 秒时长；暂停、20 秒拖动、1.5× 倍速后继续通过 |
| 双 AAC 音轨 MKV | 两条非 disabled 音轨可列出并切换，选中 ID 可读取；不是人工听感 / 音质测试 |
| MKV 内嵌 ASS | 列轨与选轨通过；截图显示紫色移动字幕；外挂 ASS 截图还显示黄色粗体 / 黑描边 |
| 外挂 SRT、ASS | 通过授权文档 URI 加载，真实截图显示文字；`+500 ms` 在内核返回 `500000 us` |
| 横竖屏 / 原型续播 | 截图尺寸随方向变化；退出再打开位置恢复。不是进程回收中恢复整个播放会话的验收 |
| SSA 独立文件 | 独立 SSA v4 样本已通过，截图显示黄色粗体文字；不把一种样式扩展为全部 SSA 特效兼容 |
| 嵌入字体 / 复杂排版 / 特效 | 待带字体附件、遮罩 / 模糊 / 卡拉 OK / 多行样本，当前简单样式不足以给全兼容结论 |
| 10-bit / 4K / HDR10 / Dolby Vision | 未验证；不声明保真 HDR 输出 |
| FLAC / DTS / E-AC3 / 多声道 / 音频透传 | 未验证；不声明原码输出或 bit-perfect |
| 远程鉴权 / Range / 断线恢复 | 共享 Rust 机制已有，安卓会话业务待验证；不因本地通过就宣布完成 |

自动化脚本：`scripts/verify-android-player.mjs`。JSON 与截图保留在 `D:\DevTools\Android\Build\qa`；截图经实际查看，字幕渲染不是仅凭 addSlave 返回 true 判定。

## 包体与页大小

本阶段调试 APK 约 147 MiB；包含共享 Rust 数据 / 索引和未压缩原生库，并可能带 Gradle 增量打包留空，不能作为优化后正式包承诺。当前仅 arm64，工程 minSdk 26 / targetSdk 36，只实测 API36。

APK 已做 `zipalign -c -P 16`；Rust、VLC、JNI、libc++ 的 ELF LOAD 对齐均为 `0x4000`。这只证明静态对齐，真机为 4 KiB 页，尚未在 16 KiB 页设备 / 模拟器验收。Rust 链接标志见 `scripts/build-android.ps1`，NDK r27；最终发布还需 ABI / Release 签名 / 精确许可证源码清单。


## 规则播放与 media-kit / avbuild 核对（2026-10-11）

Kazumi 使用自己的 media-kit 分支；media-kit 的原生后端是 libmpv，Dart / Flutter 负责封装、事件和画面嵌入。Kazumi 另明确采用 avbuild 的 FFmpeg 树外补丁支持非标准流。avbuild 既是 FFmpeg 构建工具，也包含 HLS 图片伪装分片、非标准扩展名清单等补丁，不能把它当成独立的播放器组件。

本轮只核对其实现，没有把 media-kit、libmpv 或 avbuild 的 FFmpeg 二进制引入 Genzo。当前 LibVLC 继续保留，先修正能用失败样本证明的取流兼容差异。

| 方向 | 对现有项目的影响 | 当前判断 |
| --- | --- | --- |
| 保留 LibVLC，修正取流 / 清单适配 | 沿用 Kotlin Activity、字幕、音轨、续播和包体；无法自动获得所有 FFmpeg 树外补丁 | 本次具体故障已在该路径解决 |
| 直接原生接入 libmpv | Kotlin / JNI 对接其 C API 与 Surface，重接事件、字幕、拖动和生命周期；需验证包体与精确原生库构建 | 可作为确认解码 / 非标准流缺口后的候选，未实施 |
| 嵌入完整 media-kit | Dart / Flutter 封装与当前 Tauri / React / Kotlin 架构不直接兼容，需要额外运行时或嵌入模块 | 当前没有引入整套封装的必要 |
| avbuild 定制 FFmpeg | 可参考补丁与编译配置；不能把其库直接替换 LibVLC 内部依赖而假定 ABI / 行为兼容 | 对非标准 HLS 有参考价值，须以失败样本与受控回归决定移植范围 |

用户提供 7sefun《相反的你和我》第 1 集作为失败样本：旧包线路 1 收到取流错误，线路 2 正常；隔离对照发现 Genzo 自动把网页 / iframe Referer 加到媒体请求，而 Kazumi 仅发送规则显式配置的 Referer。去掉自动继承后两条线路均播放，时长 1,447,090 ms。本例不能据此归因于视频解码器或非标准 HLS。

同时修正解析器把任意 mp4 / m3u8 资源请求抢先当作正片的路径，改由实际媒体节点或已确认的 HLS 响应发现地址，排除广告容器中的视频；受控广告占位回归单独检查。规则显式 UA / Referer、Cookie、HLS 子资源和 Range 继续保留。

源码核对：Kazumi `2768c230407d5fd8a57716160ba1a85a99161581` 的 `lib/pages/video/video_controller.dart`、Android 解析器和 README；avbuild `2f17eb8f64fe540e11b5d89c9a3fd9db6e5fa4b3` 的 `patches/master/0027-hls-support-segments-pretend-to-be-gif-png.patch` 与 `0033-hls-allow-playlist-w-o-extension.patch`。本次未复制 avbuild 补丁或捆绑其库。资料见 [media-kit 实现](https://github.com/media-kit/media-kit#implementation)、[Kazumi 致谢](https://github.com/Predidit/Kazumi#致谢)、[avbuild 补丁](https://github.com/wang-bin/avbuild/tree/master/patches/master)。
