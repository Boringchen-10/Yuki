# 安卓发布与更新

主页与更新源：[Boringchen-10/Yuki](https://github.com/Boringchen-10/Yuki)。应用在「我的 → 关于 → 检查更新」手动读取正式 Releases，提交代码或标签本身不会触发更新。

## 发布清单

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 和 CHANGELOG。版本遵循 SemVer；当前发布为 v1.0.1。
2. 运行类型检查、测试、生产构建和相关设备回归；核对升级数据保留、原生依赖、16 KiB 对齐及第三方对应源码。
3. 使用仓库外持久证书签名，保留正式包 `com.genzo.android`。构建命令见 [BUILD_ANDROID](BUILD_ANDROID.md)；不得发布 readerqa 包替代正式包。
4. APK 命名 `Yuki_X.Y.Z_android_arm64-v8a.apk`；实际提供 x86_64 时使用对应 ABI。`SHA256SUMS.txt` 每行写 `64位SHA256  APK文件名`。
5. 创建 `chore(release): vX.Y.Z` 提交和同名带注释标签，推送后发布非草稿、非预发布 Release，附 APK、校验文件、简短更新条目及对应源码标签。
6. 核对公开资产、哈希、签名和源码提交；验证兼容旧包的检查、下载与系统安装入口，并记录未覆盖范围。

versionCode 为 `major × 1000000 + minor × 1000 + patch`，minor / patch 小于 1000，整体必须递增。v1.0.1 对应 `1000001`。

## 兼容与边界

- 更新器校验 ABI、大小、SHA-256、包名、证书和 versionCode；由用户点安装，无静默安装或后台推送。
- 旧包内的 Genzo 更新地址不会自动变化，需先手动安装一次兼容新版。不要卸载或清库；readerqa 与正式包相互隔离。
- 原生 LGPL 来源、固定版本和重建说明见 [libmpv 来源](../licenses/libmpv-1.2.7/SOURCES.md)。许可证和第三方声明随源码保留。
- 设备未覆盖、网络受限或检查失败须如实记录，不将构建成功描述为全部机型验证通过。
