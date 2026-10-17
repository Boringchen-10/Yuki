# 构建 Yuki 安卓版

## 前端检查与预览

使用支持当前 Vite / pnpm 的 Node.js（建议 22.12+ 或较新的 LTS）和 package.json 指定的 pnpm。安装和检查：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

开发与生产构建默认进入 `src/android/main.tsx`，无需设置安卓前端环境变量。`dist/` 是安卓 WebView 资产，不能独立提供原生文件、播放、阅读或更新安装功能。

## 已有 Windows APK 构建路径

当前已验证的完整 APK 脚本使用 Windows PowerShell 与独立工具根目录。默认 `D:\DevTools\Android`，可设置 `GENZO_ANDROID_TOOLS` 指向采用相同子目录布局的工具根目录。该变量沿用旧名以兼容已有配置。

需要自行准备：

| 目录 | 内容 |
| --- | --- |
| `Java/jdk-17.0.20.1+1` | JDK 17 |
| `Sdk` | Android SDK，platforms/android-36、build-tools/35.0.0、platform-tools |
| `Sdk/ndk/27.0.12077973` | 固定 NDK r27 |
| `Cargo`、`Rustup` | Rust 工具链与 Cargo 缓存，包含 aarch64-linux-android / x86_64-linux-android target |
| `Gradle` | Gradle 缓存，首次构建由 Wrapper 下载 |

Rust 与依赖版本以 Cargo.lock 为准；脚本不会替用户下载安装整套 SDK / JDK。Node / pnpm 需要在 PATH。初次构建需联网解析锁定依赖及下载带固定 SHA-256 的 libmpv 制品。

从仓库根运行隔离调试包构建（不安装到设备）：

```powershell
# 可选；省略则使用 D:\DevTools\Android
$env:GENZO_ANDROID_TOOLS = 'D:\DevTools\Android'
powershell -ExecutionPolicy Bypass -File scripts/build-reader-qa.ps1 -Target aarch64 -Optimize
```

x86_64 模拟器改用 `-Target x86_64`。默认生成 `com.genzo.android.readerqa`。只有明确传入 `-Install` 才会安装到脚本指定的 emulator-5554，且仅允许 x86_64；不要将测试数据写进用户的正式包。

脚本复制 Git 可见输入到工具目录的 `Build/yuki-source`，生成本地 Tauri / Gradle 路径配置与 Kotlin 桥，构建 Rust、前端和 APK。无需从旧工作区复制被忽略的 generated 文件。临时文件、node_modules、数据库与密钥不得混入构建源码。

优化调试包输出为 `Build/yuki-reader-optimized-gradle/app/outputs/apk/arm64/debug/app-arm64-debug.apk`（x86_64 使用对应 ABI 目录），普通调试包使用 `Build/yuki-reader-gradle`。本仓库独立使用 yuki 构建目录，避免覆盖原工作区的预览产物。

## 正式签名 APK

将持久发布证书 `genzo-release.p12` 与密码文件 `store-password.txt` 放在仓库外目录，证书 alias 延续 `genzo`。现有正式包必须继续使用原证书；新贡献者可自行签名测试，但不能覆盖用户官方版本。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android-release.ps1 -SigningDirectory 'D:\DevTools\Android\Signing'
```

脚本先构建优化 native / frontend，再生成 `com.genzo.android` 的 release APK，执行 16 KiB ZIP 对齐、签名与校验，输出到工具目录 `Build/releases/yuki/vX.Y.Z/`，同时生成 `SHA256SUMS.txt`。它不会安装手机或上传 GitHub。

工具根目录变化需同时满足上表布局；其他操作系统与任意 SDK 路径的通用构建尚未作为本次交付验证。`scripts/build-android.ps1` 等旧辅助脚本保留用于历史开发，当前可复核路径以上述两个脚本为准。

## 验证边界

前端检查通过不能证明原生播放或覆盖升级可用。Kotlin / JNI / Rust 或发布变化须补充对应原生测试、签名身份校验和目标设备回归。公开发布另见 [发布指南](RELEASING.md)。
