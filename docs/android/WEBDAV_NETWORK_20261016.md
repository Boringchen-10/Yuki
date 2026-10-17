# Android WebDAV 播放连接优化（2026-10-16）

## 范围与定位

基于 `codex/android-first` / `c9feaf370fdefaf5eca1a7a54f719b86c0d5242d` 的 v0.16.1 当前工作区增量。用户报告 WebDAV 视频连接很久；没有读取用户服务器、凭据或真实视频，不能把以下受控复现认定为用户服务的唯一原因。

实际链路为 `android_player::open_player` → `remote_transfer::stream_only` → 单字节 Range 探测 → 本机 relay → libmpv 的读取、定位及 HEAD。原实现已经读完探测字节，但每次读取仍从 WebDAV 地址重新取得网关的重定向；每次创建 `DavClient` 也新建 HTTP 客户端及连接池。高延迟云盘网关会在探测、读取和定位时重复支付解析成本。

## 修改

- `webdav.rs` 复用 HTTP 连接池。账号密码仍逐请求添加，不放入全局客户端或 Cookie 存储。
- 成功解析后的地址只保存在当前 `DavClient` 及其播放 relay 克隆中；同一文件的后续 Range / HEAD 直接使用该地址。新播放客户端或其他文件不会复用这条签名地址，地址不会写入数据库、日志或播放器 URL。
- 签名地址返回 401 / 403 / 404 / 410 或请求连接失败时，只通过原 WebDAV 地址重新解析一次，并保留 Range / If-Range；不对认证失败无限重试。跨来源不转发账号密码，继续拒绝 HTTPS 降级和带账号密码的跳转目标。
- 连接和整条重定向的响应头准备共用 15 秒截止，与既有 mpv 网络超时一致；视频正文继续使用原来的 60 秒空闲读取超时，不给整个视频传输设置 15 秒总时长。
- Android 单字节探测正文最多等待 5 秒；继续严格检查 206、有效 Content-Range 和单字节正文。服务不支持 Range 时仍明确报错，不悄悄完整下载视频。

无新依赖、数据库迁移、播放器内核或媒体身份变更。

## 受控验证

新增 `src-tauri/src/webdav_network_tests.rs`，由 `webdav.rs` 的测试模块加载。两台临时 loopback 服务分别模拟 WebDAV 网关和带签名地址的 CDN；网关每次解析故意增加 80 ms，数据仅为合成的 `0123456789`。relay 集成测试使用临时 SQLite 和随机 UUID 的合成凭据，退出时清理自己的凭据，不读取用户连接。

在旧 `webdav.rs` 上运行新增的重定向回归，稳定失败：GET 探测、重复 Range 与 HEAD 共解析 3 次，首次 92 ms、重复 Range 91 ms。恢复修复后相同测试通过：共解析 1 次，最终样本首次 90 ms、重复 Range 小于 1 ms。这是本机合成链路的观测值，不代表所有真实服务器的速度或整体视频首帧时间。

验证包括：

1. 同一播放客户端及其克隆复用解析；签名过期 403 后仅回源一次；其他文件与新客户端隔离。
2. Range 和 If-Range 保持，CDN 不收到 WebDAV 认证或 Cookie；HEAD 的实际 Content-Length 头保持。
3. 真实 Rust Android relay 路径的探测、首段读取、定位和 HEAD 共用一次解析；过期后仍返回正确字节，下游不收到 Cookie 或签名地址；不创建完整视频缓存。
4. 新客户端在同一来源复用已读完的 HTTP 连接，同时使用各自的新凭据。
5. 故意不返回响应头的服务约 15 秒报 `network_timeout`，不会等待原正文的 60 秒空闲超时。

最终执行：

```powershell
$env:CARGO_TARGET_DIR = 'D:/DevTools/Android/Build/genzo-windows'
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked webdav -- --nocapture
```

17 项通过、0 失败、0 忽略，包含 4 项新增网络测试及既有扫描、索引、剧照、下载中心 WebDAV 回归。保留已有 Windows 链接器提示。`git diff --check` 通过。

初次受控运行误将 reqwest HEAD 的 `content_length()` 当作实体长度（其为空正文返回 0），修正为核对实际 `Content-Length` 头后重验通过；这是测试夹具断言修正。

## Android 原生短测（2026-10-17）

脚本 `scripts/verify-webdav-latency-native.mjs` 在一加 PLK110 / Android 16 / 设备 `3B164M00Z0500000` 上通过。只允许 `com.genzo.android.organizeqa`，先核对 v0.17.0 与实际 QA 数据目录，拒绝已连接同步的 QA 资料；没有读取或启动普通包的媒体。使用 FFmpeg 自行生成 40 秒、640×360、10,860,281 字节 MP4，经两台 loopback 服务分别模拟带认证 WebDAV 与签名 CDN；每次网关解析增加 250 ms，并节流传输以保证定位确实读取未缓存字节。

| 原生实际链路 | 结果 |
| --- | --- |
| `open_internal_player` 到首次 `playing`，已有视频尺寸与实际画面 | 1103 ms，时长 40000 ms；探测与首段读取共 1 次网关解析 |
| 定位到 28 秒后的未缓存 Range 并继续解码 | 2101 ms 后播放位置 29000 ms；网关解析仍为 1 次 |
| 使旧签名失效，定位到未缓存的 16 秒 | 旧地址 403 后只回源 1 次，2289 ms 后播放位置 17041 ms；网关解析共 2 次 |

三项均为真实 libmpv / Rust relay / HTTP 路径，整个过程 `engineInstance` 相同，未重建内核；CDN 未收到 WebDAV 认证或 Cookie。首次与恢复后的截图均已查看，显示真实合成彩条与对应时间。耗时包含原生回调采样及脚本等待，只代表当前设备与受控服务，不作真实网盘速度保证。

测试未创建作品。收尾只移除本轮来源及其合成凭据，在已停止的 QA 数据库副本中按随机 source / media ID 核对文件名及归属后删除 1 条合成媒体、其进度和任务，保留原有 0 条作品，SQLite 完整性为 `ok`；QA 原播放器偏好已恢复。只清理自己创建的 ADB 映射和服务，未修改普通包资料。数据库、合成视频与截图仅保存在私有 QA 证据目录，不纳入 Git。

运行命令：`node scripts/verify-webdav-latency-native.mjs`。证据：`D:/DevTools/Android/Build/qa/webdav-latency-20261017/1792204995227/result.json`。真实网盘、长时间播放、系统代理切换和其他机型仍未在本专项验证。

## 开源参考与许可证

- [rclone WebDAV](https://github.com/rclone/rclone/blob/99f904d7118a9e3ece300a47f26e173b4b3d707e/backend/webdav/webdav.go)，固定快照 `99f904d7118a9e3ece300a47f26e173b4b3d707e`，研究其持有并复用 HTTP 客户端、默认跨主机跳转剥离认证的设计。[COPYING](https://github.com/rclone/rclone/blob/99f904d7118a9e3ece300a47f26e173b4b3d707e/COPYING) 为 Nick Craig-Wood 的 MIT 许可，与本项目 GPLv3 兼容。仅参考设计，没有移植 Go 代码或品牌素材；会话内重定向复用由 Genzo 独立实现。
- [reqwest 官方 Client 文档](https://docs.rs/reqwest/latest/reqwest/struct.Client.html) 说明客户端持有内部连接池，建议复用；本项目继续使用锁文件既有 reqwest 0.12.28（MIT OR Apache-2.0），未升级或新增依赖。

## 仍可能影响连接时间的因素

首次网关解析、CDN 网络与视频容器索引仍需实际传输。本次没有把临时地址作为媒体身份，也没有绕过服务器权限或削弱 Range 校验。已有 `android_player.rs` 还会在打开视频前下载自动选中的 WebDAV 外挂字幕；该路径未在本专项改变，实际服务的字幕响应也可能增加准备时间。
