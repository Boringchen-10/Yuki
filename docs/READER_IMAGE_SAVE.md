# 漫画图片保存到相册

双击漫画页面打开的图片浮层新增「保存」，把当前页面写入系统相册。小说插图共用同一浮层，也可保存。

## 行为

- 保存位置：`Pictures/Yuki/`，显示名形如 `Yuki <章节名> 第N页.jpg`。
- 文件名会去掉 `/ \ : * ? " < > |`、控制字符与首尾句点，压缩空白并限制为 64 字符；章节名为空时退回作品名，仍为空时使用 `Yuki 图片`。
- JPEG、PNG、WebP、GIF 按原始字节复制，不重新压缩，保留画质和 GIF 动画；其他可解码格式按最长边 4096 采样后转 JPEG（质量 92）。
- 保存期间按钮显示「保存中…」并禁用；成功后提示「已保存到相册」，失败提示「保存失败，请重试」。浮层保持打开，可继续查看或再次保存。
- 同名文件：Android 10 及以上由 MediaStore 自动区分；旧版写入前以独占方式创建新文件，重名追加 ` (2)`、` (3)`，不覆盖已有图片。
- 保存的是页面原图，不包含浮层里的旋转或缩放状态。

- v1.3.0 起，横竖屏切换保留图片浮层、缩放与旋转，系统栏图标随阅读背景调整深浅。

## 权限与存储

- Android 10（API 29）及以上通过 MediaStore 写入 `RELATIVE_PATH=Pictures/Yuki`，先以 `IS_PENDING` 占位，写完再公开，不需要存储权限。
- Android 8–9（API 26–28）需要 `WRITE_EXTERNAL_STORAGE`，在首次保存时请求；`AndroidManifest.xml` 中声明 `maxSdkVersion="28"`，不会出现在 Android 10 及以上的权限列表。拒绝授权则不保存并提示。
- 实现入口：`ReaderGallery.kt`（相册写入、格式识别、命名）、`ReaderImages.kt`（浮层与保存按钮）、`ReaderActivity.kt`（旧版权限回调），调用方为 `ComicReaderSurface.kt` 与 `NovelReaderSurface.kt`。

## 验证

- `ReaderGalleryTest` 覆盖格式识别（JPEG / PNG / GIF / WebP、截断头、非图片）、文件名清理与长度上限、空名回退；原有 `testArm64DebugUnitTest` 20 项通过；新增大量同名文件的防覆盖回归用例，修复前失败、修复后 21 项全部通过。
- `scripts/verify-reader-image-save.mjs` 在 OnePlus PLK110 / Android 16（`3B164M00Z0500000`）的隔离包 `com.genzo.android.readerqa` 上打开合成漫画，双击第 1 页后点击「保存」：相册出现 `Yuki 合成漫画测试 · 1 第1页.png`（25,650 字节，PNG 头与源文件一致），Toast 显示「已保存到相册」，浮层保持打开，返回后阅读器正常关闭。
- 结果与截图：`D:/DevTools/Android/Build/qa/reader-image-save/1792306357317/`（`viewer.png`、`saved.png`、`result.json`）。
- arm64 QA APK 构建通过；测试结束后已删除设备上的测试图片与合成阅读缓存。

- v1.2.0 组合验收：独立 libraryqa 在同机验证下载目录、漫画 / 小说书签与图片保存。相册 PNG 2,889 字节与合成源文件完全一致，竖横屏浮层操作均可见；旋转重建活动后重新打开浮层。正式包 1.1.0 → 1.2.0 覆盖升级及原设置保留通过。
- 本轮证据：`D:/DevTools/Android/Build/qa/gallery-release-20261018/`。测试包、两张生成图片与设备夹具已清理，未操作用户真实媒体。

## 限制

- 未在 Android 8 / 9 真机上验证旧版存储权限路径。
- 不写入应用私有目录，也不修改下载记录、阅读进度或数据库。
