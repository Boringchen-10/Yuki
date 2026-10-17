# 安卓动漫详情封面恢复 v0.17.1

用户报告“青之箱 第二季”在发现列表有封面，从发现或媒体库进入详情均没有。公开 Bangumi 条目为 548156，官方 v0 与 P1 提供同一封面地址；本轮读取时 JPEG 返回 200、459141 字节，尺寸 1938×2744。

## 根因与修复

已入库的发现条目跳转到同一个媒体库详情。发现列表按 Bangumi ID / URL 读取自己的图片缓存，而详情只显示作品的 `cover_path`；之前封面下载失败或保存发生在图片缓存完成前，作品路径可能为空，之后已有的发现封面也不会被详情使用。

详情新增只读的 `coverFallbackPath`，从当前作品明确的 Bangumi 锚点、已有详情缓存 / Provider 记录查找有效图片，不按标题或相邻条目猜测。后台不发请求、不等待重新刮削，不回写 `cover_path` 或个人资料；失效图片可回退到有效缩略图。显式锁定、手动来源及 UUID 导入封面不进行自动恢复。原封面正常时优先使用原封面，主图与背景保持一致。

无数据库迁移、新依赖或真实媒体操作。没有匹配缓存时保持明确缺图状态，不能凭空生成封面。

## 验证

- 浏览器真实 React 修复前稳定复现：发现列表有图，点击已入库“青之箱 第二季”后详情没有 `<img>`，回归超时失败；修复后缺保存路径、原路径 404、手动图优先及背景四场景通过，六种宽度无横向溢出。原有详情九场景、前端 130 项和 TypeScript 通过。
- 新增两个 Rust 临时 SQLite / 图片测试，通过过期缓存、Provider 记录、损坏原图的缩略图、跨条目拒绝、缺缓存、人工 / 锁定保护，并通过拒绝 UPDATE 的触发器与完整 Work 前后对照确认只读。完整 Rust 最终 428 通过 /19 个既有外部环境测试忽略。
- 独立 organizeqa / PLK110 / Android16 使用官方公开资料和 JPEG 快照建立隔离资料与图片缓存。v0.17.0 原生复现：缓存图片可实际加载，详情无恢复封面；v0.17.1 同样输入实际显示封面与背景，截图已检查。`coverPath` 保持 null、收藏 / 评分 / 测试笔记不变，收尾仅删除自有生成作品并核对作品列表哈希恢复，未接触普通包资料。
- 原生首轮依赖在线详情请求遇到 Bangumi 超时，随后改为受控公开快照；一次 `adb shell cat` 二进制副本被终端转换，种子校验拒绝且未写回设备，改为 `exec-out` 后通过。上述均为测试前置问题，不能当作真实网络或数据库故障已修复。
- 原生修复前证据：`D:/DevTools/Android/Build/qa/blue-box-cover-20261017/native-1792214059650/result.json`；修复后：`native-1792214475023/result.json`。浏览器修复后：`browser-1792213340673/result.json`。公开图片、数据库和截图只存 QA 目录，不随 APK 或 Git 分发。

原生复跑需要先将官方 `https://api.bgm.tv/v0/subjects/548156` 的 JSON 与其 images.large JPEG 保存为 QA 根目录的 public-subject.json / public-cover.jpg，然后执行 `node scripts/verify-anime-cover-native.mjs`；`--expect-missing` 仅用于旧包复现。脚本只允许固定 organizeqa 包、核对实际数据目录并拒绝已连接同步的 QA 资料；种子仅修改已停止的独立 QA 数据库副本。

## 草稿保护

AndroidApp 原有 OpenDesign 草稿与本轮同时发生的设计修改均保留。`ANIME_COVER_SOURCE_HANDOFF.patch` 仅记录 Poster 与详情背景这次的改动，已应用、逆向检查通过，不整文件纳入提交。其余 clean 后端、类型、回归脚本与版本按范围提交。Windows 原有显示行为保持。

最终签名安装包：`D:/DevTools/Android/Build/previews/blue-box-cover-20261017/Genzo_0.17.1_android_arm64-v8a.apk`，50,158,789 字节，SHA-256 `a8dc48dad0c756aac7f9e60d5328803307ee90d02eefc406c2537a80e7f2654e`。原包名、原发布证书、versionCode17001、arm64-v8a、min26 / target36、非debuggable、16KiB ZIP 对齐通过；无用户数据库或测试媒体。校验文件和构建输入清单在同目录。

构建清单记录 353 个实际构建快照输入，Rust 合并 / 符号剥离输出与包内库核对通过，核心修复文件及 Poster / 背景增量与工作区一致。构建期间另一维护者继续添加 Launcher 图标功能，后续 12 处图标相关输入变化已在 build-manifest.json 明确列出；它们保留在工作区，没有打入这个已验证的封面修复快照。不得将这项差异误报为全部工作区字节完全一致。普通包与日常 readerqa 未在本轮替换，未创建公开 Release / 标签 / 推送。
