# 独立安卓项目验证（2026-10-17）

验证对象：本仓库导入 0.17.2 生产基线后，安卓默认入口、Yuki 更新来源和独立构建路径的变更。以下不代表公开 Release 或真实手机迁移已完成。

| 检查 | 结果 |
| --- | --- |
| frozen lockfile 独立依赖安装 | 通过 |
| pnpm check / test / build | 通过，31 个测试文件、130 项用例 |
| 图标 UI | 6 项行为、12 个布局 / 主题组合通过 |
| 规则目录 UI | 更新错误可见、重试保留身份 / 启用状态，12 布局通过 |
| 应用更新 UI | 8 组场景、12 布局通过 |
| 完整 arm64 优化调试 APK | Rust、Kotlin、JNI、Gradle 打包通过 |
| Android JVM 单元测试 | 16 项通过，无失败 / 跳过 |
| Android instrumentation 源码 | 包含新旧更新来源约束的测试编译通过，未执行设备测试 |
| APK 身份 / 对齐 | com.genzo.android.readerqa，0.17.2 / 17002，API 26–36 配置，arm64-v8a，16 KiB ZIP 对齐通过 |
| APK 更新来源 | dex 包含 Boringchen-10/Yuki，无旧 Boringchen-10/genzo 常量 |
| 主文档链接 / 版本一致 / diff 空白 | 通过 |

本机验证 APK 为 `Build/yuki-reader-optimized-gradle/app/outputs/apk/arm64/debug/app-arm64-debug.apk`（相对安卓工具根目录），SHA-256 为 `1aa1a3895c0ec4d72a497ee30656d7d83db750aa9f75b73e3e380197d4095c3f`。该 APK 为隔离调试制品，未上传 Releases，不能代替正式签名升级包。

未执行：手机安装、现有正式包跨仓库升级、公开 Release 下载及新路径下正式签名发布。原工作区与用户设备资料没有改变。首次正式发布仍需完成 RELEASING 指南中的升级验收。

环境说明：独立运行 Gradle 时曾出现 Java loopback 连接错误，补齐脚本已有的工具目录 TEMP / TMP 设置后通过。保留既有 Rust 死代码、Android 弃用 API 和 Vite 体积提醒，没有为消除警告改动无关代码。
