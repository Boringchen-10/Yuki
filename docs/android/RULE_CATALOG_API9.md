# 规则仓库 API 9 更新与界面修复

用户报告规则更新提示「目前支持 Kazumi API 1–8」。2026-10-17 核对官方目录 17 项，其中 dalvdm、giriGiriLove、LMM、mgnacg、mutefun 使用 API 9；前三者包含搜索详情页 `sourceTemplate`。旧校验拒绝 API 9，即使只放宽版本也会丢掉详情页地址模板。

## 修复

- 接受 API 1–9，缺省仍按 1 处理；非法格式与未来版本明确拒绝，不改已安装定义。
- 实现 API 9 搜索 `sourceTemplate`，按上游语义将 `@source` 替换为编码后的来源 ID，支持 `/GV@source/` 等紧邻字母的写法。缺少变量、过长模板和展开超过 16KiB 的地址拒绝；既有 GET / POST、JSONPath、地址及体积限制继续生效。
- 更新报错与缓存警告放在仓库浮层内部，避免藏在浮层后面；保留失败后的重试与安装版本反馈。仓库顶栏避开实际状态栏，列表使用剩余高度独立滚动，长名称换行且操作按钮保持可见。
- 更新复用现有规则 ID / 来源根目录，保留启停、媒体关联与个人记录，不新增迁移。应用更新不会自动替换用户的规则定义，用户仍在仓库选择更新。

## 源码交接

`RuleSourceManager.tsx`、`rules.css` 已有其他维护者的 OpenDesign 草稿，本轮只将自身增量保存为 `RULE_CATALOG_SOURCE_HANDOFF.patch`，当前已应用；勿整文件覆盖或重复应用。可用 `git apply --ignore-whitespace --reverse --check docs/android/RULE_CATALOG_SOURCE_HANDOFF.patch` 检查。Rust 修复、版本、回归夹具与脚本直接纳入提交。

## 验证入口

- `pnpm check`、`pnpm test` 与完整 Rust 库测试。
- `node scripts/verify-rule-catalog.mjs`：浮层内错误、重试后版本更新、身份 / 停用保留及手机竖横屏 / 三种桌面宽度 × 深浅主题。
- 安装独立 `com.genzo.android.rulesqa` 后，以明确的 `GENZO_ANDROID_SERIAL` 运行 `scripts/verify-rule-catalog-native.mjs`；只操作测试包，验证真实仓库 API8→9 更新、未来 API 拒绝、当前仓库定义导入与实际安全区。不会播放来源视频或写入日常资料库。

上游依据：[官方规则仓库](https://github.com/Predidit/KazumiRules)、[LMM API 9 定义](https://github.com/Predidit/KazumiRules/blob/main/LMM.json)、[Kazumi 搜索模板实现](https://github.com/Predidit/Kazumi/blob/main/lib/services/plugin/api_rule_strategy.dart)。未增加 Dart / Flutter 依赖，继续沿用既有 GPLv3 兼容实现；实际测试结果见 AI_HANDOFF.md。
