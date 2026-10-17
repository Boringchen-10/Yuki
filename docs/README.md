# 文档索引

当前安卓项目以根目录 README、PROJECT_CONTEXT、ROADMAP、DESIGN_DIRECTION、AGENTS 和 CONTRIBUTING 为准。

- [安卓构建](BUILD_ANDROID.md)：依赖、当前 Windows 工具链与 APK 构建。
- [发布与更新](RELEASING.md)：新仓库发布规范及旧安装包迁移。
- [源码基线](android/SOURCE_BASELINE.md)：导入来源、生产输入与兼容性。
- [应用图标](android/APP_ICONS.md)：三款桌面图标与设置入口。
- [规则更新修复](android/RULE_CATALOG_API9.md)：API 版本与目录反馈。
- [第三方声明](../THIRD_PARTY_NOTICES.md)：上游、原生库及许可。

`android/` 中的功能规格、测试记录与 `*SOURCE_HANDOFF.patch` 保留用于追溯。其日期、机器路径、包版本和「仅本机预览」属于当时事实；历史 patch 已纳入生产源码，不要再次自动应用。若某项能力的后续决定不同，以当前根文档和实际代码为准。

其余旧版本规格、Windows 设计资料和原项目交接记录仅供历史参考，不构成本仓库的新功能或多端发布承诺。根文档的旧版本可从 Git 历史查阅。
