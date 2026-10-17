# 安卓应用图标

2026-10-17 用户确认三套全身小人图标，经典校服为默认。入口：**我的 → 通用 → 应用图标**，可以选择经典校服、贝雷帽约会、围巾冬装。

## 行为

- 默认仅启用经典校服桌面入口，三个入口始终指向同一个 MainActivity，不创建第二份应用或资料库。
- 直接读取 PackageManager 的入口状态，只有系统成功应用后才更新选中项。切换失败显示错误并重新读取状态；连续点击被阻止，同一选项不重复保存。
- 状态由本机系统保存，关闭应用、强制停止后重新打开及覆盖升级保留。没有新增数据库迁移，也不把图标偏好放进 WebDAV 或 Bangumi 同步。
- Android 13+ 批量切换入口；Android 8–12 先启用新入口再关闭其他入口。均使用 DONT_KILL_APP，MainActivity 本体保持启用。部分桌面可能延迟刷新，旧固定快捷方式的保留行为由系统桌面决定。
- 原图、设置预览与系统 adaptive 资源均来自同三张已确认图片。仅等比缩放和留白，不重新生成角色；白底由系统裁成圆形或圆角，不把外框烘焙进原图。系统开启主题图标时的再次着色由桌面决定。
- Windows 图标暂不在本轮范围内。浏览器预览展示图片，但不伪装能够更改桌面图标。

## 实现与来源

`LauncherIcons.kt` 使用稳定的三个 `activity-alias`；`GenzoPlugin` 经现有 Rust android_native 白名单连接 `AppIconPicker`。组件名固定 Kotlin namespace，包名取当前 Context，因此独立 QA 包不会操作普通包。

参考 [Android activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element)、[PackageManager](https://developer.android.com/reference/android/content/pm/PackageManager)、[Adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)。原图来源与可重复生成说明见 `design/app-icons/yukino/README.md`。

## 验证

- `pnpm check`、`pnpm test`。
- `node scripts/verify-app-icons-ui.mjs`：真实 React 组件的默认值、切换、并发阻止、重挂载、失败保留、重试、同项不重复写；360 / 412 / 915 / 1024 / 1366 / 1920 深浅主题。
- 使用带 Pillow 的 Python 运行 `scripts/verify-app-icon-assets.py`，核对源哈希与 66dp 安全圆并检查圆形 / 圆角裁切图。
- `LauncherIconsTest` 严格限定独立 `com.genzo.android.iconqa`，验证每次只剩一个可启动入口、MainActivity 保持可用、三款均为 adaptive 图标与非法 ID 不改状态。

实际执行结果、构建产物与未验证范围以 AI_HANDOFF.md 当前交接为准。
