# Bangumi 官网读取可靠性

本轮基于 v0.16.1 安卓工作树，针对实际使用的 Bangumi 作品吐槽、分集讨论和热门番组，保留当前 OpenDesign、Bangumi ID、分页、已有缓存及个人资料。

## 已确认问题

- 官网 P1 与配置的 v0 镜像是不同服务。原连接测试只读取 v0 搜索 / 详情和 `/calendar`，三项成功不能证明官网评论可读。
- 原 ECH 客户端只在启动 / 保存设置后准备一次，没有有效期；连接中断后两次评论请求仍使用同一个客户端和固定地址集合。
- 上述是代码与受控服务验证的可靠性缺口；没有取得用户当次失败的网络抓包，不能将所有实际失败归因于同一个原因。

## 修改

- P1 作品吐槽、分集讨论和热门番组共用既有的独立官网限流器；每次最多两次请求、单次六秒、包含排队的总预算十六秒。
- 连接 / 超时 / 断传等瞬态故障后，第二次以普通 TLS 读取同一个官网 URL，保留发起请求时的系统代理 / 直连选择。不会改写到 v0 镜像、第三方域名或其他作品 / 分集。
- HTTP 403 / 429、完整非法 JSON 与无效业务结构保持失败；不会通过换传输重试访问限制。5xx 仍只在既定次数内重试。失败继续由原 UI 保留已展示数据并提供重试。
- ECH 客户端有效期最长三十分钟，按需后台单飞更新；准备失败冷却三十秒，故障客户端撤下后暂避六十秒。普通 TLS 继续可用，旧设置的异步结果不能覆盖当前设置。
- 普通连接与 DoH 启动连接增加四秒连接超时。直连 / 镜像模式的 DoH 与其请求一致禁用系统代理；系统模式保留系统代理。镜像用户的 P1 仍是官方域名，独立准备官方 ECH。
- 连接测试增加“作品吐槽 / 官网”和“本集讨论 / 官网”，返回原有 probe DTO，不保存设置或用户作品。

证书和域名验证始终启用，不新增账号、Cookie、Token、下载、数据库迁移或第三方运行依赖；不叠加评论缓存。

## 验证

- 定向 Rust 编译：`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib bangumi -- --test-threads=1`，31 通过、7 个需外网测试忽略、0 失败。覆盖坏首选传输只命中一次、同资源直连恢复、403 / 429 / 非法响应保持错误、固定分页以及 ECH 过期 / 设置隔离。
- 最新完整默认并行 Rust：`cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`，426 通过、19 个既有外部环境测试忽略、0 失败，约 36.82 秒。首次完整运行暴露三个受控官网测试争用生产全局限流器，导致合成服务的等待期限提前用尽；仅在 `#[cfg(test)]` 中串行隔离这三项，生产的限流、重试和时间预算保持不变。最终日志 `D:/DevTools/Android/Build/qa/network-update-20261016/rust-final.log`。
- 固定地址失效回归通过：首选客户端将 localhost 固定到无人监听的 127.0.0.2；第二次按同一 URL 的正常解析访问合成服务，核对仍是指定官方分集路径。
- Windows 测试进程显式执行 `bangumi_network::tests::live_bangumi_ech`：1 通过，约 10.86 秒，真实读取公开作品吐槽、分集目录及封面并解析图片；不写用户作品、数据库、设置或媒体。它不是 Android 真机或全部网络环境的性能证明。
- 本轮不将受控 HTTP 成功当作所有运营商、代理、真实服务或手机环境均已验证。最终全套测试、Android 构建及实机结果记录在本轮交接。

## 开源参考

1. Kazumi `11671bc0ec61727e99e34810f142a1b5e4121a8e`，GPLv3：核对 [Bangumi 传输](https://github.com/Predidit/Kazumi/blob/11671bc0ec61727e99e34810f142a1b5e4121a8e/lib/request/core/bangumi_transport.dart) 的代理 / 超时 / 连接池分离和 [ECH resolver](https://github.com/Predidit/Kazumi/blob/11671bc0ec61727e99e34810f142a1b5e4121a8e/lib/services/network/bangumi_ech_resolver.dart) 的官方域名范围、AliDNS 与既有固定地址策略。本轮沿用 Genzo Rust 实现并修复生命周期，不复制 Dart、品牌、账号凭据或媒体素材；原许可声明已保留在 THIRD_PARTY_NOTICES 与 licenses。
2. [Bangumi 官方 P1 文档](https://bangumi.github.io/dev-docs/)：核对作品吐槽、分集讨论和官网热门列表是独立官网接口，不假定 v0 镜像实现 P1。该接口属于官网内部 API，不承诺长期稳定。
3. [curl 的 ECH 文档](https://github.com/curl/curl/blob/master/docs/ECH.md)，curl 许可，仅行为 / 文档参考：ECH 配置可能轮换，错误配置会导致握手失败；本轮据此避免永久复用单份配置。不移植 curl 源码，不添加 curl 依赖。
