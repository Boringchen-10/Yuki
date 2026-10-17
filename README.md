<p align="center">
  <img src="src/android/assets/app-icons/classic.png" width="112" alt="Yuki 经典校服图标" />
</p>
<h1 align="center">Yuki</h1>
<p align="center">把动漫、漫画与轻小说，放进同一个安卓媒体库。</p>
<p align="center">
  <a href="https://github.com/Boringchen-10/Yuki/releases">版本下载</a> ·
  <a href="https://github.com/Boringchen-10/Yuki/issues">问题反馈</a> ·
  <a href="docs/BUILD_ANDROID.md">构建指南</a> ·
  <a href="docs/RELEASING.md">发布与更新</a>
</p>

Yuki 是本地优先的安卓 ACGN 媒体库，整合作品管理、视频播放、漫画与小说阅读、收藏和个人进度。它从 [Genzo](https://github.com/Boringchen-10/genzo) 的安卓分支独立而来；此仓库只维护安卓版本，原仓库继续保留桌面项目与历史。

> 当前源码基线为 **0.17.2**。创建仓库不等于已经发布安装包；可下载版本以本仓库 Releases 中实际提供的 APK 为准。请勿把旧项目的版本记录当作本仓库已有下载。

## 可以做什么

- 管理动漫媒体库、漫画和轻小说书架，记录收藏、追番、观看与阅读位置。
- 浏览作品资料、标签、角色、关联作品和评论；发现与已入库作品使用一致的详情。
- 通过系统文件授权或 WebDAV 连接自己的视频，整理目录并核对官方分集对应。
- 按需导入、安装、更新和管理 Kazumi 兼容规则，支持 `kazumiapi 1–9`；规则服务可用性取决于来源。
- 用原生 libmpv 播放本地、WebDAV 与规则视频，提供倍速、字幕、音轨、横竖屏及 Anime4K 选项。
- 使用原生漫画阅读器与 Readium 小说阅读器；下载中心管理支持的离线任务。
- 选择浅色、深色或跟随系统的外观，并在「我的 → 通用 → 应用图标」切换三款图标。

<p align="center">
  <img src="src/android/assets/app-icons/classic.png" width="96" alt="经典校服（默认）" />
  <img src="src/android/assets/app-icons/beret.png" width="96" alt="贝雷帽约会" />
  <img src="src/android/assets/app-icons/winter.png" width="96" alt="围巾冬装" />
</p>

## 安装与更新

支持 **Android 8.0 / API 26 及以上**。正式发布优先提供 `arm64-v8a` APK；`x86_64` 用于开发验收，是否提供下载以具体 Release 为准。播放性能与 Anime4K 效果取决于设备、视频和渲染设置。

从 [Releases](https://github.com/Boringchen-10/Yuki/releases) 下载 APK 后按系统提示安装。应用内可在「我的 → 关于 → 检查更新」检查本仓库的正式版本，手动下载并安装；目前没有后台推送或启动时自动更新。

沿用原安卓正式包 `com.genzo.android` 和发布签名，签名一致且版本更高时可覆盖升级。`com.genzo.android.readerqa` 是隔离测试包，不能用正式 APK 覆盖。**旧包仍查询旧仓库时，需要先手动安装一次包含新更新地址的兼容版本。** 不要为了切换仓库卸载应用，以免丢失本机数据。

## 开发与项目文档

技术栈为 Tauri 2、React、TypeScript、Rust、SQLite 和 Kotlin。浏览器预览只展示安卓业务界面；文件授权、原生播放、阅读与安装更新需要安卓运行环境。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

完整 APK 的工具链、构建和签名方法见 [安卓构建指南](docs/BUILD_ANDROID.md)。仓库保留安卓依赖的共享模块以及原项目提交历史，未将这些文件全部重写为独立实现。

| 文档 | 内容 |
| --- | --- |
| [项目上下文](PROJECT_CONTEXT.md) | 已确认的产品、架构与兼容性决策 |
| [路线图](ROADMAP.md) | 当前状态与后续待办 |
| [设计方向](DESIGN_DIRECTION.md) | 安卓布局、主题与交互规范 |
| [贡献指南](CONTRIBUTING.md) | 开发、验证与提交要求 |
| [发布指南](docs/RELEASING.md) | GitHub Release、APK、签名及更新来源 |
| [更新记录](CHANGELOG.md) | 变更与历史版本 |
| [文档索引](docs/README.md) | 当前文档与历史记录的边界 |

## 许可与来源

项目代码使用 [GPL-3.0-only](LICENSE)。完整的上游归属、第三方组件及原生库对应源码说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。独立建仓不改变既有版权与许可义务。

应用图标为用户确认的雪之下雪乃同人 Q 版设计，不代表原作或相关产品官方。代码许可不授予第三方角色、作品、封面、规则站点或接口的权利。Yuki 不提供或分发媒体文件，使用者应自行确认内容访问与使用权限。
