# 更新日志

## 未发布

- 自更新与版本查询自动复用 npm 的 scope/默认 Registry 和认证配置，`FX_REGISTRY` 改为可选覆盖；自更新保留公共依赖的默认路由。

## 0.3.0 (2026-09-20)

- 保留登录人工接手及异常后的部分结果、汇总和结构化恢复信息；非零退出也可能返回有效 stdout。
- 保护 manifest 与指南写入期间的并发编辑；获准替换时原子移动原对象到备份，文档失败保留逐文件结果。
- 明确初始化和同步的整体准备结论，修复名称或说明被误判为阶段失败的问题。
- 保证自更新安装器输出不污染 JSON，补充恢复流程与源码/已发布功能的区别。

- 新增 `calendar`、`task`、`worklog`、`metrics` 四个能力：前两个有飞书与企业微信 provider，工时有 Jira provider；`metrics` 只命名未实现，manifest 可以描述它，绑定则要等 provider。`im` 的含义收窄为纯消息。
- 新增 Jira 工作项 provider 与飞书知识库 provider，这两个能力各有了第二种实现；一个配套 CLI 服务多个能力时仍只安装和检查一次。
- workspace 的工具链改为从其绑定的 provider 推导，内置工具不必再声明一遍；`tool list` 说明每个工具是被绑定带进来的还是 manifest 声明的，`--catalog` 列出其余的。
- manifest 声明了同名工具时，能力可以绑定 fx 未实现的 provider；仅与内置工具重名的 provider id 会被指出更正，而不是照单全收。
- tools 文档的 `defaults` 块支持 `install_on_init`，单个条目仍可覆盖。
- 能力已绑定 provider、但工具文档未声明该 provider 所用配套工具时报告 `TOOL_UNDECLARED`，不再误称该能力没有 provider。
- platform 的 `service` 按其名称推导出的 provider 校验：合法声明不再被误报，此前被跳过的真实问题也会报出。
- 预先记录 session-start 后台运行承诺执行的阶段，worker 被终止时未执行到的阶段留下 `HOOK_PHASE_UNREPORTED`，不再直接消失。
- session-start 后台运行中某条伴随命令用尽预算时不再终止整个运行，其后的每个阶段照常给出结论；宿主正在等待的前台运行仍在该处结束。
- 分离的后台运行如何结束，记录为 workspace 的 `run` 观测，此前其 supervisor 只能写进无人读取的流。

- 修复所有格式的报告字段投影、恢复命令的 workspace 上下文和贡献锁内的来源身份校验。
- 支持经验证的本地 Git 导入与匹配 upstream 的安全补充，按启用和必需工具声明统一准备状态。
- 接受各类声明的 setup 验证形式，并在 manifest 合并时保留可空比较值。

- 增加全局工作区发现、健康诊断、解除托管、重定位与换源；保留业务 checkout，阻止同目录重复身份。
- 增加 repo/env select 的固定、动态全部和空集合模式；首次 init 可先选择仓库，本地来源预览显示实际计划。
- 修复未跟踪文件在状态筛选中被遗漏、必需 manifest 缺失却验证通过，以及旧可读性缓存阻断正常恢复。
- doctor 默认按实际声明和活跃 provider 检查工具，保留显式工具检查。
- 兼容性说明：init 的 registered 现在表示实际注册状态；预览动作另列于 plan。config import 按名称合并并保留未提到的注册，不再用省略名称来取消托管。

- 兼容性说明：`fx skill show` 在 bundled Skill 缺失时返回 `BUNDLED_SKILL_MISSING`；`SKILL_MISSING` 仅表示面向 Agent 的通知。

## 0.2.1 (2026-09-18)

- 精简仓库入口与 bundled Skill，详细恢复步骤集中到命令参考。
- 同步四语言的报告、就绪、Skill 加载与服务版本说明，使其符合当前行为。
- 修正站点发布状态与预览示例，补充公共依赖的 Registry scope 分流说明。

## 0.2.0 (2026-09-17)

- 破坏性变更：四类工作流报告默认精简 JSON，完整数据使用 `--details`，显式 `--fields` 仍从完整结果投影。
- 修复显式空 Agent 选择；增加 `FX_SKILL_VERSION` 核对和 `bundled_skill_version`。
- 增加 `operation`、`preparation_complete` 与 `SKILL_WRITE_DENIED`，保留部分结果和具体恢复步骤。

- 新增独立的伴生 Skill install、uninstall、path、status 和 show 命令。
- 在工作区指南生成团队 Skill 的触发说明和源文件链接。
- 区分显式刷新与自动维护，并保护团队共享源。

- 初始化与显式同步支持公共服务预设、明确选定服务的个人登录和原生冲突恢复。
- 拒绝共享 service 中的个人凭证，保留既有配套工具配置。

- 跨已注册工作区记录工具安装历史与来源，仅提示不再需要的 fx 安装包，不自动卸载。
- 帮助与补全优先展示标准资源命令，保留兼容别名。

## 0.1.2

已在内部 Registry 提供；公共发布仍暂停。

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
