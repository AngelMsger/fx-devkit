# 更新日志

## 0.2.0 (2026-09-17)

- 破坏性变更：四类工作流报告默认精简 JSON，完整数据使用 `--details`，显式 `--fields` 仍从完整结果投影。
- 修复显式空 Agent 选择；增加 `FX_SKILL_VERSION` 核对和 `bundled_skill_version`。
- 增加 `operation`、`preparation_complete` 与 `SKILL_WRITE_DENIED`，保留部分结果和具体恢复步骤。

- 新增独立的伴生 Skill install、uninstall、path、status 和 show 命令。
- 在工作区指南生成团队 Skill 的触发说明和源文件链接。
- 区分显式刷新与自动维护，并保护团队共享源。

- 初始化与显式同步支持公共服务预设、明确选定服务的个人登录和原生冲突恢复。
- 拒绝共享 service 中的个人凭证，保留既有配套工具配置。

## 0.1.2

已在内部 Registry 提供；公共发布仍保留。

- 修复显式输入、就绪状态、Git 源恢复和配置并发更新。
- 保留初始化部分结果，精简终端输出并报告仓库进度。
- 隔离等待授权的 Skill 命令，保护用户共享副本，明确宿主激活限制。
- 为可选代码托管探测设置期限，在保留取消语义的同时报告预检查进度。
- 支持工作区根目录的路径别名，中断后保留逐项安装结果和资源状态。

## 0.1.1

已在内部 Registry 发布, 公共发布仍暂停. Git tag、包发布和本机安装是独立状态.

`fx-devkit` / `fx`; Apache-2.0. `@fx/devkit` / `@angelmsger/fx`.

- `install_on_init` (fx ≥0.1.1).
- 声明驱动的工作区初始化、同步和仓库选择.
- 结构化配置、发现、就绪与发布报告.
- 配套工具、Agent Skill、生命周期 hook 和 MCP 投影.
- 保留信任、所有权和恢复边界的源码贡献计划.
- 已实现 Windows 适配器; 原生执行与宿主激活仍未验证.
