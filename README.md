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

Yuki 是本地优先的安卓动漫、漫画与轻小说媒体库，源自 [Genzo](https://github.com/Boringchen-10/genzo) 安卓分支。当前版本 **v1.0.2**，支持 **Android 8.0+、arm64-v8a**。

## 可以做什么

- 媒体库与书架：作品资料、收藏、观看和阅读进度。
- 来源管理：本地文件、WebDAV、Kazumi API 1–9 规则及离线任务。
- 规则仓库默认镜像优先，失败时尝试官方，支持连接测试与本地目录缓存。
- 原生播放与阅读：libmpv、Anime4K、漫画与 Readium 小说阅读器。
- 蓝白默认主题：支持深色、跟随系统、自定义配色与三款应用图标。
- 首次使用引导：确认协议后添加规则，也可稍后添加并使用本地媒体。

<p align="center">
  <img src="src/android/assets/app-icons/classic.png" width="96" alt="经典校服（默认）" />
  <img src="src/android/assets/app-icons/beret.png" width="96" alt="贝雷帽约会" />
  <img src="src/android/assets/app-icons/winter.png" width="96" alt="围巾冬装" />
</p>

## 安装与更新

从 [Releases](https://github.com/Boringchen-10/Yuki/releases/latest) 下载 APK；后续在「我的 → 关于 → 检查更新」手动更新。规则在「我的 → 规则设置」管理，旧用户可在「我的 → 外观 → 恢复默认外观」使用新默认主题。

正式包 `com.genzo.android` 沿用原签名，可覆盖兼容旧版并保留数据。旧包仍查询 Genzo 仓库时，需先手动安装一次 Yuki 新版。测试包 `com.genzo.android.readerqa` 与正式包相互隔离，不能交叉覆盖；请勿卸载旧包或清空数据来切换更新来源。

## 开发与项目文档

技术栈：Tauri 2、React、TypeScript、Rust、SQLite、Kotlin。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

浏览器仅供界面预览，原生功能需安卓设备。[构建指南](docs/BUILD_ANDROID.md) · [贡献指南](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [文档索引](docs/README.md)

## 许可与来源

代码采用 [GPL-3.0-only](LICENSE)，上游归属与原生对应源码见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [licenses](licenses/)。图标为角色同人设计，代码许可不授予第三方角色或内容权利；请仅使用已获合法授权的来源与内容。
