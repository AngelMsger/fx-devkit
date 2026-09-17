# 使用 fx

安装 fx，连接团队 manifest，并管理仓库、工具与编码 Agent。

## 环境要求 {#requirements}

- Node.js ≥22；开发版本以 package.json 为准。Bun 也可以作为运行时。
- Git 位于 PATH 中。全局安装和 `fx self update` 仍需要 npm，包括使用 Bun 时。
- 团队提供的 manifest，或[自行创建的 manifest](manifest-guide.md)。

支持 macOS 和 Linux。原生 Windows 适配器已实现，但 Windows 实机执行和 Agent 宿主激活尚未完成验证；目标为本地 NTFS 上的 PowerShell 5.1/7 和 cmd。参见 [Windows 支持边界](support.md#platform-support)。

## 安装 {#install}

<!-- distribution:internal -->

fx 通过团队的私有 Registry 分发，暂不推进公开发布。请向团队获取 Registry 地址和 npm 访问权限，并设置 `FX_REGISTRY`。以下 URL 为虚构示例，安装前需确认 Registry 已提供该包。

```sh
export FX_REGISTRY=https://npm.example.com/
npm login --registry="$FX_REGISTRY"
npm install -g @fx/devkit --registry="$FX_REGISTRY" --@fx:registry="$FX_REGISTRY"
fx --version
```

<!-- /distribution -->

<!-- distribution:public -->

### 公开包

对外分发使用 npmjs 上的 `@angelmsger/fx`，无需团队私有 Registry。当前公开发布暂缓，请在目标版本提供后执行。

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

<!-- /distribution -->

也可以从源码运行：

```sh
npm ci
npm run build
node bin/fx.js --help
node bin/fx.js --version
```

运行后续示例时，将 `fx` 替换为 `node /absolute/path/to/fx-devkit/bin/fx.js`。启动器读取 `dist/`，因此必须先构建。

PowerShell 执行策略阻止 `.ps1` shim 时，可使用 `npm.cmd` 和 `fx.cmd`，无需更改策略。

### 更新

源码安装可通过 Git 更新 checkout，然后执行 `npm ci` 和 `npm run build`。使用 `fx self info --format json` 查看当前版本及包更新来源。参见[更新说明](support.md#updates)。

## 快速上手 {#quick-start}

先将占位符替换为团队提供的实际来源：

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` 会先在命令信任确认后安装 manifest 中显式标记 `install_on_init` 的缺失工具，再同步仓库和所选 Agent 资源。已有工具安装会保留。

`init` 会同时同步仓库和所选 Agent 资源。注册成功不代表所有同步阶段成功，请检查失败条目并在解决权限或设置问题后重试相关阶段。

已有目录会自动纳入管理，`--adopt` 仅为兼容保留。对陌生工作区先使用 `--dry-run` 查看计划。

```sh
fx sync --dry-run
fx sync
fx status
fx repo list
fx where <repo> --env <environment>
fx can <capability> --env <environment>
```

`where` 输出坐标和命令，但不会执行这些命令。`can` 和 `doctor` 检查当前就绪状态。缺少设置、认证或权限时，按 handoff 处理。报告生成成功不等于准备完成：同时阅读 `ok`、`complete` 和各项结果。

使用 `repo pick/unpick`、`env pick/unpick` 限定本机关注范围。`fx config set agents claude-code,codex` 选择 Agent；未配置时自动检测。`fx sync --only docs,skills` 只刷新对应资源。

## 核心概念 {#concepts}

### 工作区和 manifest {#the-workspace-and-the-manifest}

工作区是注册过的普通目录，内含独立 checkout 和受管理的 Agent 资源。manifest 源位于 `~/.fx/workspaces/<name>/source`，fx 不会在受管理的工作区根目录运行 Git。同步不会通过切分支、reset 或 stash 覆盖脏工作区、分叉状态或其他分支上的工作。

workspace、environments、tools 和 members 文档保存共享事实；可选 harness 文档描述 MCP 和规则。用以下命令查看字段：

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 个人配置

全局配置记录工作区和偏好。Agent 选择在同一 FX_HOME 注册的工作区间共享；仓库与环境选择属于各自工作区。`repo add` 登记本机引用，`repo remove` 仅移除引用，保留文件。配置导出不复制凭据、信任记录或 manifest checkout。

### 能力、提供者与配套工具

capability 表示代码托管、CI、日志、错误追踪等意图，provider 通过配套 CLI 实现它。manifest 绑定能力、提供者和环境坐标。`can` 查询就绪，`where` 查询坐标，`release` 查询声明的发布检查项。

`tool list/show` 展示工具要求，`tool install/update` 使用声明的安装器，`login` 引导设置。认证由各工具负责。manifest 提供的执行向量需要信任；向量改变后需要重新确认。口头确认手动步骤不能替代验证成功。

工具定义由内置基线与所选工作区的 `tools.yaml` 合并。工作区优先级为 `--workspace`、`FX_WORKSPACE`、当前目录所属的已注册工作区、`default_workspace`；无法确定工作区时仅使用内置基线。包管理器决定安装位置，工具由多个工作区共享。

`tool install` 和 `tool update` 必须指定名称或 `--all`，两者互斥。安装的 `--all` 补齐已启用且 PATH 缺失的工具；更新的 `--all` 选择当前工具表中全部已启用工具。显式名称可以选择被禁用的工具。无参数调用会在执行包操作前报错。

### 工具安装历史 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install` 和 `tool update` 将尝试保存到 `$FX_HOME/tool-history.json`（默认 `~/.fx/tool-history.json`）。每次尝试有 `started`、可选的 `installed` 和 `finished` 检查点，包含工作区、包管理器与包名、脱敏安装命令、退出码、版本和操作前后的程序路径。`installed` 表示包管理器成功退出，即使之后版本验证失败；单独的 `started` 不证明执行成功。dry-run、手动安装说明及 init 跳过的已有工具不产生记录。历史属于本机操作证据，不随配置导出。

`tool inventory` 的 `installation_origin` 与 `tool list/show` 展示的工具定义来源分别表达不同事实：

| installation_origin | 证据                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `fx`                | fx 成功安装此前不存在的程序，当前路径仍与记录匹配。                      |
| `external`          | 已知程序在 fx 安装记录之外已经存在；后来由 fx 更新或重装，仍保留此来源。 |
| `unknown`           | 旧记录、未完成操作或变化／缺失的路径无法确认当前来源。                   |

`external` 不确定具体安装者，可能是用户或其他管理器。PATH 观察不能证明历史所有权，也不能识别外部在同一路径替换程序。v1 历史仍可读取，新操作写入 v2；旧记录缺少的来源证据保持未知。新版记录不保证可被旧版 fx 读取。

清单包含内置定义、已注册工作区本地 manifest 中的已知工具，以及定义移除后保留在历史中的包。没有记录的 PATH 程序显示 `recorded: false`；包管理器、包名、版本及操作字段为 null，不进行猜测。查询不会补写安装凭据或接管已有程序。

依赖检查覆盖同一 FX_HOME 下**全部已注册工作区**，包括启用的可选工具与内置默认项。任一工作区需要相同程序或包管理器／包时保持 `required`。禁用内置工具使用 `enabled: false`，删除覆盖项会恢复默认值。只有来源为 `fx`、执行证据完整、程序路径匹配且所有工作区都不再需要的安装，才可成为 `unused`。外部工具和未知来源不会收到卸载建议。`sync` 输出 `TOOL_UNUSED` 和 `stage_details.tools.installations`，`doctor` 增加提示；均不执行卸载。

无法读取或含隔离条目的 manifest、执行证据不完整时为 `unknown`；从未成功的尝试为 `unverified`。程序缺失为 `not_on_path`，路径变化为 `changed`，有工作区外操作记录时为 `unscoped`。这些状态不建议卸载。检查只读取本地 manifest，不刷新远端；其他 FX_HOME 和未注册项目不在依赖覆盖范围内。无效历史文件会在执行前阻止新的包操作，应保留并修复后重试。

### fx 伴生 Skill 与团队 Skill

fx 伴生 Skill 用于引导 Agent 使用 CLI、初始化工作区和恢复就绪状态。初始化前即可执行：

```sh
fx skill install
fx skill install --agent codex
fx skill status
fx skill path
fx skill show
```

`install/uninstall` 默认检测所选作用域的 Agent；`--agent` 可重复或用逗号分隔。`path/status` 默认列出全部支持的 Agent。`--project` 使用当前目录，`--dir ./custom-skills` 安装到 `<dir>/fx-workspace`，且与 `--agent`、`--project` 互斥。无需注册工作区或登录服务。独立安装不使用工作区 Agent 选择；项目检测使用原生标记，用户级检测还识别 PATH 中的 Agent 程序。

显式 `skill install` 将已识别副本刷新到当前 CLI 版本，包括同版修复和覆盖较新副本；`init/sync` 则同版复用且不降级。外来路径替换需要确认和备份。写操作支持 `--dry-run` 和只读限制。`skill uninstall` 确认后移除已识别副本，非交互使用 `--yes`；外来路径保留。卸载不修改工作区选择，后续同步可能重新安装所选宿主的用户级副本。

`status` 分别报告安装状态、版本匹配和 `FX_SKILL_LOADED=1` 加载握手。安装成功不等于 Agent 已加载。`path` 查询安装目标，`self info` 提供包内源路径。`show` 在所有输出格式下都输出 SKILL.md 原文。Skill 命令仅做本地操作，不检查在线更新、不刷新 manifest、不调用配套安装器或登录探测。非 TTY 的业务命令会在未加载 Skill 时向 stderr 输出结构化发现提示；setup 和 Skill 命令保持安静。`FX_SKILL_NOTICE=0` 可关闭提示。

团队 Skill 保存在 manifest 的 `skills/`，由 `init/sync` 链接到所选 Agent 的 Project Skill 目录，Windows 使用 junction。工作区根 AGENTS.md 还列出每个 Skill 的触发说明和源文件链接，供 Agent 按任务读取。请从工作区根启动 Agent；不承诺子仓库内启动时能发现。`agent skills` 检查工作区分发，`sync --only docs,skills` 刷新指南和 Skill。不要经团队共享链接安装 fx 伴生 Skill；CLI 会返回 `SKILL_SOURCE_PROTECTED`。请使用用户级安装或独立目录。

harness 向所选宿主投射 MCP 条目和规则指针，秘密值保持为环境变量引用。`mcp list/show` 和 `can mcp:<name>` 说明前置条件；配置正确不证明宿主已激活。见 [MCP 契约](user-guide.md#for-coding-agents)。

工作区启动钩子可以返回缓存上下文，并后台刷新 manifest、文档和 Skill；不会同步业务仓库或确认信任。宿主仍控制项目与钩子信任。用 `hook list/enable/disable` 管理，见[生命周期契约](user-guide.md#for-coding-agents)。

### 贡献共享知识

`source push` 可预览或提交所选源文件，保留源 checkout 的 HEAD、索引和工作文件。提交需要个人 fork 及其上游关系的证据。实际提交前阅读 `fx source push --help` 与[贡献契约](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

主题帮助优先展示主命令，并单独列出兼容映射。命令名补全和拼写建议使用主名称；已输入旧名称后仍能补全参数。根帮助和主题帮助均接受放在前面的全局参数。

`manifest validate/lint/providers/repo-set/render` 优先使用显式 `--workspace` 或 `FX_WORKSPACE`，即使当前目录位于另一份源 checkout 内。未知的显式名称会报错，不会退回修改附近的 manifest。未显式选择时，仍优先使用当前目录附近的源 checkout，支持独立维护。`manifest import <dir>` 保留目录参数语义，`manifest record-probe` 使用所选已注册工作区。所有文件输出参数支持 `-o` 和 `--out`，包括 render。

`agent skills` 检查工作区 Skill 分发；`skill install/show/path/status/uninstall` 独立管理内置伴生 Skill。`manifest repo-set` 修改仓库字段，`manifest record-probe <repo> --env <env> --platform <platform>` 写回已验证的坐标证据，`--dry-run` 仅生成计划且不探测。`where` 用于查询。兼容入口 `skill list`、`tool installed`、`hook inject/remove`、`manifest set` 和 `where --probe --record` 继续可用。

集合参数（如 `--only`、可重复的 `--env` 和 `--agent`）支持重复传入或逗号分隔。Agent 选择跨工作区，结果包含 `scope: global` 与 `affected_workspaces`；仓库／环境选择返回 `scope: workspace` 与 `workspace`。清单和历史覆盖整个 FX_HOME，即使传入 `--workspace` 也一样。补全识别参数值、位置参数和否定选项，升级后需重新生成补全脚本。根帮助接受全局参数；帮助、补全、`skill show` 和 `manifest schema` 保持其原生文本／文件格式。

| 意图                   | 命令                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 创建、同步和检查工作区 | `init`、`sync`、`status`                                                                             |
| 设置访问并检查就绪     | `login`、`doctor`、`can`                                                                             |
| 查询环境坐标与发布证据 | `where`、`release`                                                                                   |
| 管理仓库               | `repo list/show/pick/unpick/add/remove/fork/open`                                                    |
| 管理环境与 Agent       | `env list/show/pick/unpick`、`agent list/pick/unpick`                                                |
| 管理工具和 Skill       | `tool list/show/install/update/history/inventory`、`agent skills`                                    |
| 管理共享来源           | `manifest validate/lint/explain/schema/providers/repo-set/record-probe/render/import`、`source push` |
| 查询成员与配置         | `member list/show`、`config list/get/set/unset/export/import`                                        |
| 检查宿主资源           | `hook list/enable/disable`、`mcp list/show`                                                          |
| CLI 信息与更新         | `self info/update`、`completion`                                                                     |

完整语法以 `--help` 和[生成的 CLI 参考](cli/README.md)为准。

## 给编码 Agent {#for-coding-agents}

使用 `--format json` 或 `FX_FORMAT=json`。stdout 只包含数据；通知、进度和错误写入 stderr。集合包络为 `{items, has_more, next?}`，缺失或未知值会显式表示。

`--fields` 可投影字段，`--quiet` 抑制通知，`--no-input` 禁止等待输入。写命令支持 `--dry-run` 和只读姿态；`--allow-writes` 是单次调用的显式覆盖。

doctor/release 即使有失败检查也退出零；init/sync 也可能在部分成功时退出零。init 查看 `sync.summary`、`sync.stages`；sync 查看 `summary`、`stages` 和每个失败条目的 `failure`。`stage_details` 保留资源阶段结果和 handoff。不要把退出码当作就绪证据，不要捏造认证或绕过宿主信任。

先读[内置 Skill](../skills/fx-workspace/SKILL.md)和[响应指南](../skills/fx-workspace/references/commands.md)，再设置 `FX_SKILL_LOADED=1`。`self info` 定位随包源，`skill path` 查询安装目标。

## 配置 {#configuration}

`~/.fx` 保存工作区注册、个人层、资源所有权状态、信任和缓存。`FX_HOME` 只改变 fx 的个人目录，不改变配套工具的凭据位置。

`config list` 展示配置键、默认值、环境变量名及实际来源；`config get <key> --explain` 展示各层。优先级为显式参数、环境变量、配置文件、内置默认值。用 `config export/import` 迁移个人设置。

`format` 控制输出。`command_shell` 只控制生成命令的文本，不改变执行方式；auto 在 Windows 选择 PowerShell，其他平台选择 POSIX。可用 `--command-shell`、`FX_COMMAND_SHELL` 或 cmd 配置覆盖。manifest 中的 shell 模板保持原样。

补全支持 bash、zsh、fish 和 PowerShell，通过 `fx completion <shell>` 生成，按需自行加载。

## 集成 {#integrations}

manifest 选择工作区使用的 provider 和配套 CLI。当前实现包括：

| 能力         | 提供者                            |
| ------------ | --------------------------------- |
| 代码托管     | Bitbucket CLI、本地 bare Git 仓库 |
| CI           | Jenkins CLI                       |
| 日志         | OpenObserve CLI                   |
| 错误追踪     | Sentry CLI                        |
| 集群发现     | kubectl，只读查询向量             |
| 工作项与知识 | 飞书项目、Confluence CLI          |
| 通讯入口     | Lark CLI、WeCom CLI               |

使用 `fx manifest providers` 与 `fx tool list` 查看实际绑定。通讯和知识入口交接给配套工具，不代表 fx 代理了所有服务 API。

Agent 发现包括 Claude Code、Codex CLI、Cursor 等已注册宿主。Skill、hook、MCP 与规则的支持因宿主而异；用 `agent list`、`hook list`、`mcp list` 检查具体能力。参见[宿主契约](user-guide.md#for-coding-agents)。

## 判读初始化与恢复结果

位置参数仅来自 argv; 只有显式请求时才读取 stdin, 例如 `init --from -`. 将多词命令整体加引号会返回用法错误. Git 克隆使用独立的 Git 凭据, 不强制依赖代码托管 API CLI. Git 错误区分分支不存在、传输认证、网络与本地冲突, 恢复命令保留分支和目标目录.

源验证并注册后, `INIT_PREPARED` 会在执行工具和克隆前展示安装命令及 Skill 目标位置. 安装缺失工具后可能产生额外 Skill 命令, 仍须逐条通过精确信任检查. 新远端来源的 `init --dry-run` 不拉取源, 也不声称已获知其内容. 替换外来文件始终需要批准与备份.

后续初始化阶段抛出异常时, stdout 保留含 `failed_phase`、`phases`、结构化 `failure`、已完成仓库结果和恢复步骤的部分结果. 失败结果中的阶段状态为 `done`、`failed` 或 `not_started`; 成功的同步阶段仍使用原有统计计数. stderr 保留原错误, 退出码非零. 未信任的 Skill 命令单独标记为 blocked (`tools_blocked`), 独立的自有本地投影仍可完成. 即使退出码为零也应查看 blocked 和 failed 行.

仓库操作期间每五秒在 stderr 报告完成数/总数、当前仓库和耗时. 这是心跳, 不是 Git 字节进度或预计完成时间. 人类输出汇总未选择仓库和较大列表; `--verbose` 显示未选择行, `--format json` 保留完整详情. `FIELDS_UNMATCHED` 表示请求字段未出现在本次结果中, 也可能是可选字段; 投影继续宽松处理, 空集合不会产生该提示.

就绪结果区分 `missing_tool`、`outdated_tool` 与 `disabled_tool`. Doctor 工具证据提供 `binary_path`, 与执行使用相同的 PATH 解析规则, 可能指向运行时管理器的 shim. 状态进程成功但 `configured=false` 不代表就绪; 配置完整也不证明资源权限或远端查询成功. `no_access` 表示环境不在个人选择范围, 并非远端 ACL 拒绝.

个人配置采用加锁读改写与原子替换. 遇到 `CONFIG_BUSY` 时, 等竞争更新结束再重试. 初始化失败留下的 Git source checkout 可用于相同来源的重试, 仍保护不匹配的 upstream 和本地工作.

Bitbucket 的可选仓库与用户探测各有 5 秒进程执行期限. 工具不可用或探测超时不会阻止 Git 传输; 明确的仓库访问拒绝或缺仓结论仍然有效. 用户取消和非预期异常会停止操作. 进度从 `preflight` 预检查开始, 随后切换为仓库变更的 `apply` 阶段.

Skill 阶段中断时, `sync.stage_details.skills` 保留 `links`、`fx` 和 `tools`; 工具安装保留 `tool_install`. 条目 `status` 区分 `done`、`failed`、`not_started`、`skipped` 和预览的 `planned`. 资源条目在失败时附带 `observed` 磁盘状态, 若观察也失败则为 `unknown`. 写入报错时目标可能已经改变. 安装器 `ran: true` 表示已尝试执行, `code: null` 表示未取得退出结果. `phase: version` 失败且 `code: 0` 表示包安装已成功. 先处理失败条目再重试; 抛异常后不会执行后续写入.

相同工作区名称和来源可通过已注册根目录的符号链接别名重试. 注册在配置锁内重新核对物理路径, 真正不同的目录仍会冲突.

### Skill 所有权与宿主激活

团队 Skill 链接属于工作区; fx 内置 Skill 副本属于用户和所选宿主, 多工作区复用, 初始化和同步不用旧版覆盖已识别的新版. 更新在用户级锁内重新核对所有权和版本, 外来副本保留. 第三方工具拥有各自的 Skill 安装与版本策略, 因此 fx 仍可能在另一工作区同步时再次调用其安装器. 本地 Skill 安装不天然需要网络; 应区分调用器审批等待与已启动子进程.

`agent list` 提供 `detected`、`selected`、`selection` (automatic 或 explicit) 和 `active: null`, 因为检出并不能证明当前活跃. 初始化前显式设置 `fx config set agents <id,...>` 可限制投影范围. `FX_HOME` 只隔离 fx 配置, 不隔离全局 Skill; 实验还应使用独立 HOME.

Grok 1.0.25 仅在 Git 根发现项目 hook. 普通工作区根完成正常目录信任后可以发现指南和 Skill, 但不能因此修复 hook 发现. `hook list` 会说明激活限制; 需显式执行 `fx sync --only docs,skills`, 不要在工作区根初始化 Git. 宿主执行批准或取消独立于 fx 执行, auto 模式也不关闭宿主权限检查. Hook 保持 fail-open, 在 stderr 输出有界的 `HOOK_FAILED_OPEN` 诊断, 不含原始输入或异常文本; 文件投影本身不能证明激活.
