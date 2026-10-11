# libmpv v1.2.7 default：来源、构建与许可

Genzo GPLv3 使用动态链接的 libmpv / FFmpeg；不限制为调试修改后的库而逆向工程、替换或重新链接。此目录提供许可证全文、版权与版本来源。上游构建仓库的 MIT 只覆盖脚本 / 适用代码，不能替代下列原生依赖的许可。

二进制：https://github.com/Predidit/libmpv-android-video-build/releases/tag/v1.2.7

构建脚本与所有本次原生补丁：https://github.com/Predidit/libmpv-android-video-build/tree/dd2bfba8209bcd22e2d4c79f125b40e619e637ed/buildscripts

使用 default 路径：FFmpeg `--disable-gpl --disable-nonfree --enable-version3`，mpv `-Dgpl=false -Dlua=disabled -Dlibmpv=true -Dvulkan=enabled`。FFmpeg 因 version3 与 Apache-2.0 组件按 LGPLv3 分发；mpv / libplacebo 本身 LGPL2.1+，与 Genzo GPLv3 兼容。未取 encoders-gpl、x264、fftools-ffi 或 media-kit-android-helper。

| 组件 | 本次上游锁定来源 | 许可 / 本目录全文 |
| --- | --- | --- |
| mpv | https://github.com/mpv-player/mpv/tree/32a164cc017acab50389f2194f720ccfd0b01a28 | LGPL2.1+；mpv-Copyright、LGPL-2.1；client.h 单独 ISC，保留文件头 |
| FFmpeg 7.1.3 | https://github.com/FFmpeg/FFmpeg/tree/f46e514491172d15bd74b4abb1814cd2f05a763e | LGPLv3；FFmpeg-LICENSE、LGPL-3.0 |
| libplacebo | https://code.videolan.org/videolan/libplacebo/-/tree/d4624cbfb37fdef337a7da5794b66202671a89cd | LGPL2.1+；libplacebo-LGPL-2.1 |
| Mbed TLS 3.4.0 | https://github.com/Mbed-TLS/mbedtls/tree/1873d3bfc2da771672bd8e7e8f41f57e0af77f33 | Apache-2.0；mbedtls-Apache-2.0 |
| dav1d 1.2.0 | https://code.videolan.org/videolan/dav1d/-/tree/676a864a11af2c0522e1f992e770589543894686 | BSD-2-Clause；dav1d-BSD-2-Clause |
| libxml2 2.10.3 | https://github.com/GNOME/libxml2/tree/f507d167f1755b7eaea09fb1a44d29aab828b6d1 | MIT；libxml2-MIT |
| FreeType 2.13.0 | https://gitlab.freedesktop.org/freetype/freetype/-/tree/de8b92dd7ec634e9e2b25ef534c54a3537555c11 | FTL；freetype-FTL |
| FriBidi 1.0.12 | https://github.com/fribidi/fribidi/tree/6428d8469e536bcbb6e12c7b79ba6659371c435a | LGPL2.1+；fribidi-COPYING |
| HarfBuzz 7.2.0 | https://github.com/harfbuzz/harfbuzz/tree/a321c4fee56b15247c10f9aa3db7e7ccb3b8173b | Old MIT；harfbuzz-MIT |
| libass 0.17.1 | https://github.com/libass/libass/tree/e8ad72accd3a84268275a9385beb701c9284e5b3 | ISC；libass-ISC |
| Little CMS 2.17 | https://github.com/mm2/Little-CMS/tree/5176347635785e53ee5cee92328f76fda766ecc6 | MIT；lcms2-MIT |
| fast_float | https://github.com/fastfloat/fast_float/tree/97b54ca9e75f5303507699d27c6b4f4efe4641a1 | 选择 MIT；fast-float-MIT |
| glad | https://github.com/Dav1dde/glad/tree/73db193f853e2ee079bf3ca8a64aa2eaf6459043 | MIT / Khronos Apache-2.0；glad-LICENSE |
| Vulkan-Headers | https://github.com/KhronosGroup/Vulkan-Headers/tree/74d8a6cb930c68ef617b202c3ff3c59d919e086b | Apache-2.0 / MIT；Vulkan-Headers-LICENSE 与 mbedtls-Apache-2.0 全文 |
| shaderc / SPIRV / glslang / NDK runtime | 上游脚本使用 [Android NDK r27c](https://github.com/android/ndk/wiki/Unsupported-Downloads)，NDK 的 sources/third_party/shaderc | Apache-2.0、BSD / MIT / LLVM 等，Android-NDK-NOTICE 与 NOTICE.toolchain 保留完整第三方声明 |

上游 `buildscripts/include/depinfo.sh` / `download-deps.sh` 给出完整来源与版本校验；libplacebo 的 git submodules 也须递归获取。NDK 是构建工具，许可证声明使用本地 r27 同系列 NOTICE，原生上游指定 r27c；Genzo JNI 使用本机 r27.0.12077973。

重新构建内核：在 Linux 按上游 workflow 的 Ubuntu / meson / ninja / pkg-config / NDK r27c 环境准备，审阅后执行 `buildscripts/bundle_default.sh`，产出 default-ABI.jar。使用者可用修改后的 libmpv.so 替换 Gradle 生成目录中的库并重新打包签名；若替换上游制品，维护者应同时更新 app/anime4k.gradle.kts 的版本 / SHA 校验与本声明。APK 不包含 DRM 或密钥来阻止用户重新链接。

公开分发新 APK 时应同时提供 Genzo 对应源代码、上述固定版本与补丁的对应源码获取方式和许可；不能只提供旧版本 Genzo 源码。当前为本机预览，没有创建公开发布。
