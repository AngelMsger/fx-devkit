# 使用 fx

安装 fx，连接团队 manifest，并管理仓库、工具与编码 Agent。

各版本的变更见[更新日志](../CHANGELOG.md)。请查看已安装版本的 `fx <command> --help` 和随包 Skill，确认当前可执行文件支持的功能。

按任务选择阅读入口：

- 新建工作区：[安装](#install)，然后[快速上手](#quick-start)。
- 仓库较多：[下载前选择仓库](#choose-repositories-before-downloading)。
- 设置中断：[判读结果并恢复](#reading-initialization-and-recovery-results)。
- 编码 Agent：[结构化结果与 bundled Skill](#for-coding-agents)。

## 环境要求 {#requirements}

- Node.js ≥22；开发版本以 package.json 为准。Bun 也可以作为运行时。
- Git 位于 PATH 中。全局安装和 `fx self update` 仍需要 npm，包括使用 Bun 时。
- 团队提供的 manifest，或[自行创建的 manifest](manifest-guide.md)。

支持 macOS 和 Linux。原生 Windows 适配器已实现，但 Windows 实机执行和 Agent 宿主激活尚未完成验证；目标为本地 NTFS 上的 PowerShell 5.1/7 和 cmd。参见 [Windows 支持边界](support.md#platform-support)。

## 安装 {#install}

<!-- distribution:internal -->

fx 通过团队的私有 Registry 分发，暂不推进公开发布。请向团队获取 Registry 地址和 npm 访问权限；已有 npm scope 配置可直接复用，`FX_REGISTRY` 仅作为可选覆盖。以下 URL 为虚构示例，安装前需确认 Registry 已提供该包。

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
npm install -g @fx/devkit
fx --version
```

`npm login --scope=@fx --registry=...` 会关联 scope 与 Registry。已配置时只需执行安装命令。`fx self info --format json` 会显示有效的 `registry` 与 `registry_source`，不修改 npm 配置。

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

你只需要团队提供的 manifest 来源，以及工作区要放的目录。可以直接告诉 Agent：“请用 fx 根据这个 manifest，把工作区准备到这个目录。”自己操作终端时，先预览再执行：

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
```

fx 会检查来源，完成已授权的本地工具与配置准备，克隆所选仓库，并准备 Agent 指南和 Skill。工作区名称自动生成并避开已有注册，已有文件和已完成的工作会保留。批准新命令前，请检查展示的准确参数。

看到 **Ready to work** 即可开始工作。若需要个人登录、权限或批准，fx 会集中列出剩余事项。处理后使用返回的继续命令：

```sh
fx init --resume --workspace work
```

终端输出会直接列出个人登录命令和继续命令。在自己的终端完成登录，解决所列前置条件后运行继续命令即可。

续跑会验证当前状态并跳过已完成的准备，不会重新导入目录来源或重建已有仓库。无需自行选择内部阶段或再组合一套诊断命令。

新工作区默认选择全部共享仓库。需要减少首次下载时，先[选择仓库](#choose-repositories-before-downloading)，给初始预览和执行都加 `--repos`。已有目录自动纳入管理。日常更新使用 `fx sync`，查看仓库状态使用 `fx status`。

## 发现和管理工作区 {#find-and-manage-workspaces}

`fx workspace list` 可在任意目录运行，即使没有默认工作区，或某项注册的根目录、manifest 已缺失。`fx workspace show <name>` 返回身份、来源、健康状态与选择上下文，不要求 manifest 完整。用 `fx status --workspace <name>` 显式选择；未指定时，当前目录所属工作区优先于 `default_workspace`。

```sh
fx workspace list
fx workspace show work
fx status --workspace work
fx config set default_workspace work
```

目录已移动时，用 `workspace relocate <name> <new-dir>` 更新注册；它不会移动或重新克隆 checkout。用 `workspace rebind <name> --from <source>` 更换 manifest 来源，同时保留工作区身份和个人选择。将同一物理目录注册为第二个名称不等于迁移。

`workspace unregister <name>` 解除托管并保留业务 checkout。先用 `--dry-run` 预览生命周期操作，检查受管资源清理和冲突；外来文件会保留。

## 下载前选择仓库 {#choose-repositories-before-downloading}

初始化时用 `--repos` 限制首次下载，名称必须存在于已检查的 manifest；`--no-repos` 表示空仓库集合。重复 init 时不带这两个参数会保留已有选择。

```sh
fx init ./work --from <manifest-repository> --repos example-api --dry-run
fx init ./work --from <manifest-repository> --repos example-api
```

已有工作区中，`select` 替换集合，`pick` 加入名称，`unpick` 移除名称。选择操作不删除文件，也不会自行下载 checkout；随后运行 sync 获取或更新已选仓库。

```sh
fx repo select example-api
fx repo pick example-web
fx sync --dry-run
fx sync
fx repo select --all
fx env select dev
fx env select --none
fx env select --all
```

仅使用显式 Git URL、未绑定代码托管 provider 的 manifest，同步仓库无需配置代码托管用户名。

未下载的仓库仍保留在完整目录中。可以直接让 Agent 处理该仓库的任务，或运行 `fx repo show <name>`：返回的 `next_steps` 会在正确的工作区补选仓库并同步下载，随后在返回的路径继续工作。

`--all` 持续跟随团队完整集合，包括未来新增项；逐个选中目前全部名称仍然是固定列表。`--none` 选择空集合。清单与选择结果展示当前模式，避免将空选误认为未设置默认值。

仓库选择只控制共享条目；本机单独注册的仓库和 manifest checkout 仍单独管理。`select` 接收以空格分隔的名称，init 的 `--repos` 接收以逗号分隔的列表。

## 判读仓库状态 {#read-repository-status}

`fx status` 标明工作区并展示未跟踪文件数。`fx status --dirty` 同时查找已跟踪文件的修改与新建的未跟踪文件。JSON 保留 `dirty` 表示已跟踪文件或索引修改，新增 `uncommitted` 表示任一类未提交工作。被忽略文件不计入未跟踪工作。空结果解释是未选择仓库，还是没有仓库匹配筛选。

工作区根目录不是 Git 仓库，因此 `fx status` 还会返回 `stray_entries`：根目录下既不是 checkout、派生指南、Agent 或服务配置，也不是工作台的文件和目录。`fx doctor` 在 `root` 组里逐项列出，级别为警告，不影响就绪判定。

sync 保留工作文件和分支。应查看计划动作：已跟踪文件修改可能触发 `skip_dirty`；checkout 位于其他分支时，只更新被跟踪的分支引用。status 默认不 fetch，需要刷新远端比较时显式加 `--fetch`。

## 核心概念 {#concepts}

### 工作区和 manifest {#the-workspace-and-the-manifest}

工作区是注册过的普通目录，内含独立 checkout 和受管理的 Agent 资源。manifest 源位于 `~/.fx/workspaces/<name>/source`，fx 不会在受管理的工作区根目录运行 Git。同步不会通过切分支、reset 或 stash 覆盖脏工作区、分叉状态或其他分支上的工作。

不属于任何仓库的产物放在工作区根目录的 `.workbench/` 下：每个任务一个带日期的目录，存放报告、计划和证据；`worktrees/` 放 `git worktree add` 的目标；`tmp/` 放随时可以丢弃的内容。派生指南向 Agent 说明同样的规则。fx 不会写入该目录。

workspace、environments、tools 和 members 文档保存共享事实；可选 harness 文档描述 MCP 和规则。用以下命令查看字段：

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 个人配置

全局配置记录工作区和偏好。Agent 选择在同一 FX_HOME 注册的工作区间共享；仓库与环境选择属于各自工作区。`repo add` 登记本机引用，`repo remove` 仅移除引用，保留文件。配置导出不复制凭据、信任记录或 manifest checkout。

### 能力、提供者与配套工具

capability 表示代码托管、CI、日志、错误追踪等意图，provider 通过配套 CLI 实现它。manifest 绑定能力、提供者和环境坐标。`can` 查询就绪，`where` 查询坐标，`release` 查询声明的发布检查项。

工作区级能力一次绑定：`code-host`、`issue-tracker`、`knowledge-base`、`im`、`calendar`、`meeting`、`task`、`worklog`；环境级能力按平台实例绑定：`error-tracker`、`log-store`、`metrics`、`ci`、`cluster`。`fx manifest providers` 列出已绑定的内容和每个能力可选的 provider。`calendar` 是日程与忙闲所在；`meeting` 是承载在线会议及其录制、纪要的会议系统，在一个产品里排日程、在另一个产品里开会的团队两者都绑定。

`metrics` 由 `prometheus-cli` 提供。它的坐标是服务的抓取 job：`where` 输出一条 `up{job="..."}` 查询，返回该服务各抓取目标的标签集合，可作为编写后续选择器的起点。选择器匹配不到任何序列时查询仍然成功，因此指标不提供存在性探测，`where --probe` 对它报告 `unknown`，不作猜测。

`tool list/show` 展示工具要求，`tool install/update` 使用声明的安装器，`login` 引导设置。认证由各工具负责，包括已保存的凭据可以发往哪个服务。fx 为内置工具定义的命令无需确认即可运行；团队 `tools.yaml` 新增或覆盖的命令向量需要信任一次，向量改变后需要重新确认。口头确认手动步骤不能替代验证成功。

工具定义由内置目录与所选工作区的 `tools.yaml` 合并；工作区的工具链则是其中它真正使用的部分：被绑定 provider 驱动的工具，加上 tools.yaml 声明的工具。`fx tool list` 说明每个工具因何在此，`--catalog` 会再列出 fx 知道但没有被选用的工具。工作区优先级为 `--workspace`、`FX_WORKSPACE`、当前目录所属的已注册工作区、`default_workspace`；无法确定工作区时没有绑定可推导，因此列出内置目录。包管理器决定安装位置，工具由多个工作区共享。

`tool install` 和 `tool update` 必须指定名称或 `--all`，两者互斥。安装的 `--all` 补齐已启用且 PATH 缺失的工具；更新的 `--all` 选择当前工具表中全部已启用工具。显式名称可以选择被禁用的工具。无参数调用会在执行包操作前报错。

doctor 默认检查工作区声明的工具及所选环境中实际启用的 provider 依赖。未使用的内置工具仍可通过 `tool list --catalog` 或显式 `doctor --tool <name>` 查询；缺少它们不会导致无关工作区不健康。工具链本身覆盖 manifest 声明的全部环境（安装是整机的），而 doctor 的检查仍按所选环境收窄。活跃 provider 的依赖若被禁用，仍会报告检查不完整。

init/sync 使用相同的相关工具范围。缺少可选工具仍会显示，但不阻断准备。启用的 `install_on_init` 工具需要验证；已禁用的可选工具不会仅因这个安装标记而变成必需工具。

内置 Sentry 工具通过 npm 的 `sentry` 包安装；manifest 启用初始化安装时也适用。

### 共享服务设置与个人凭证 {#shared-service-settings-and-personal-credentials}

manifest 可声明 URL、context、组织和认证方式等公共 `service` 设置。`init`、显式 `sync` 和 `login` 通过配套工具自身的命令准备这些设置；后台 hook 只检查。使用 `fx sync --only services --dry-run` 预览。

配置和认证分开进行。每位成员通过配套 CLI 获取并保存自己的凭证。已有冲突设置保留并报告；sync 不执行个人登录。Sentry 仅写入工作区 `.sentryclirc` 的公共默认值，保留外来文件。

sync 的 `stages.services` 和 `stage_details.services.items` 表示阶段结果；init 在 `sync` 下嵌套这些字段。摘要保留阻塞与失败，`--details` 还包含成功条目。参见[服务预设](manifest-guide.md#public-service-presets)与[恢复参考](../skills/fx-workspace/references/commands.md#service-preparation)。

### 工具安装历史 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install` 和 `tool update` 在 `$FX_HOME/tool-history.json` 记录尝试。`installed` 表示包管理器成功，但后续版本核验仍可能失败；单独的 `started` 不证明成功。dry-run 和 init 跳过的已有工具不产生记录。

`tool inventory` 的安装来源与 `tool list/show` 的定义来源分别表达不同事实：

| installation_origin | 证据                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `fx`                | fx 成功安装此前不存在的程序，当前路径仍与记录匹配。                      |
| `external`          | 已知程序在 fx 安装记录之外已经存在；后来由 fx 更新或重装，仍保留此来源。 |
| `unknown`           | 旧记录、未完成操作或变化／缺失的路径无法确认当前来源。                   |

依赖检查覆盖同一 FX_HOME 的全部已注册工作区，包括启用的可选工具和内置默认项。只有已确认由 fx 安装且没有剩余需求的工具才可成为 `unused`；其他 FX_HOME 和未注册项目不在检查范围。建议仅供人工判断，sync/doctor 从不卸载工具。读取失败或证据不足不能证明可以移除。

查询不会接管 PATH 中的工具，也不重建旧安装历史。完整字段见[安装清单参考](../skills/fx-workspace/references/commands.md#installation-audit-and-inventory)，数据范围见[本机数据](user-privacy.md#what-stays-on-your-machine)。

### fx 伴生 Skill 与团队 Skill

fx 伴生 Skill 引导 Agent 使用 CLI。无需安装或注册工作区即可读取：

```sh
fx self info --format json
fx skill show
fx skill status
```

希望宿主自动发现副本时，使用 `fx skill install --agent codex`。`--project` 面向当前目录；`--dir ./custom-skills` 面向独立目录，不能与 `--agent`、`--project` 同用。独立 Skill 命令的目标选择不依赖工作区 Agent 配置。检测、替换与卸载规则见[Skill 参考](../skills/fx-workspace/references/commands.md#standalone-companion-skill)。

显式 install 将已识别副本刷新到调用 CLI 的版本，包括同版修复和替换较新副本；init/sync 同版复用且不降级。外来内容替换需要确认和备份。卸载不改变 Agent 选择，后续 sync 可能再次安装。

`skill status` 报告安装版本与 `activation: unverified`。文件已安装不代表宿主已加载。按需读取随包指南，普通命令无需声明 Skill 已加载。

团队 Skill 位于 manifest 的 `skills/`，由 init/sync 链接到所选宿主，并在根 AGENTS.md 生成目录。请从工作区根启动，子仓库中的发现行为没有保证。用 `fx sync --only docs,skills` 刷新；不要通过团队共享链接安装 fx 伴生 Skill，应使用用户副本或独立目录。

### 贡献共享知识

`source push` 可预览或提交所选源文件，保留源 checkout 的 HEAD、索引和工作文件。提交需要个人 fork 及其上游关系的证据。实际提交前阅读 `fx source push --help` 与[贡献契约](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

用 `fx <topic> --help` 查看标准入口与兼容别名。集合参数同时接受重复参数和逗号分隔的值。

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

先执行 `fx self info --format json`。初始化任务读取返回的 `initialization_guide`，并持续使用同一准确入口；无需声明已加载 Skill 的环境变量。[完整 Skill](../skills/fx-workspace/SKILL.md) 提供其他任务的路由。

用 `--format json` 分开保存 stdout 结果与 stderr 进度、通知和错误。默认结果保留准备结论和全部阻塞项，`--details` 展开阶段证据。human 默认先显示任务结论和下一步。在终端上还会加上颜色和符号、按宽度收窄表格，并以文本显示错误；管道或文件得到纯文本和 JSON 错误信封，`NO_COLOR` 去掉颜色。显式 `--fields` 从完整报告提取字段，点路径保留为扁平键，例如 `fx sync --format json --fields operation,preparation.state,items,summary`。

| 结果               | 完成判定                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| `init/sync/doctor` | `preparation.state` 为 `planned`、`ready` 或 `incomplete`，仅针对 `preparation.scope`。 |
| `release`          | 读取 `ok`、`complete` 和检查项；此命令不发布或部署。                                    |
| `can`              | 读取目标能力的 `status` 和接手指引。                                                    |

准备就绪退出 0，未完成退出 12；预览只是计划。配置或执行异常保留原分类退出码，也可能返回部分 stdout。`doctor.coverage` 单独描述诊断覆盖；可选宿主激活未验证不会阻塞必需工作，文件存在也不证明激活。

Init 会自行执行已授权的本地准备。结果保留已完成步骤；认证未完成时，不要重复这些步骤。

`--workspace` 可接收已注册的名称或根目录路径。`--details` 可统一用于各命令；事实查询本来就返回完整结果。若需保存输出进行分析，请使用任务授权目录；只读姿态无法控制 shell 重定向。

先读 `preparation.next`：审阅预览、准备完成后继续原任务、执行 Agent 动作，或等待人工条件补齐。`next_actions` 只包含 Agent 可处理的动作；个人操作保留在阻塞项内并标为 `actor: user`。条件变化后才运行 `resume`。

一次阅读全部 `preparation.blockers`。`next_actions` 提供准确 argv、cwd、可选 env 坐标和审批要求；续跑时保留这些值，`resume` 继续已注册工作区。已有授权继续有效，新向量仍需审阅。不要凭注册或克隆推断成功，不要为获取明细重复写入，也不要将个人凭据放入 manifest。

文件冲突的逐项结果保留在 `stage_details.docs.files`（init 中位于 `sync` 下）。替换外来内容需要批准，并保留同级备份。详见[响应契约](../skills/fx-workspace/references/commands.md)。

## 迁移到 0.4.0 {#migrating-to-040}

- 工具文档使用 `schema_version: 3`。`kind: run` 必须声明 `phase: prepare`（本地非交互准备）或 `phase: authenticate`（个人登录）。旧格式在产生工作区效果前报出迁移问题，fx 不猜测脚本用途。
- 已移除 Skill 加载握手及 `skill_notice` 配置。`FX_SKILL_LOADED`、`FX_SKILL_VERSION`、`FX_SKILL_NOTICE` 不再使用；请改读安装版本和 `activation`，不要再读取 loaded/version_verified。
- `preparation.state` 替代 `preparation_complete`。doctor 的顶层 `ok/complete` 改为准备结果和诊断 `coverage`；release 保留原契约。准备未完成退出 12。
- 工作区发现使用 `registration_status: available` 表示注册可读，不代表准备完成。
- `init --resume --workspace <name>` 使用托管来源和现有选择继续。普通源指南无需 fx 标记：缺少的区域会补入生成的目标指南，共享源保持不变。

配置格式见 [manifest 指南](manifest-guide.md)。

## 配置 {#configuration}

`~/.fx` 保存工作区注册、个人层、资源所有权状态、信任和缓存。`FX_HOME` 只改变 fx 的个人目录，不改变配套工具的凭据位置。

`config list` 展示配置键、默认值、环境变量名及实际来源；`config get <key> --explain` 展示各层。优先级为显式参数、环境变量、配置文件、内置默认值。用 `config export/import` 迁移个人设置。

导入按名称合并工作区注册，保留 profile 中未提到的工作区；明确列出的个人层会被替换。导入不会改变已有工作区的根目录或来源，请先使用 `workspace relocate` 或 `workspace rebind`。用 `workspace unregister` 明确解除托管。计划会列出注册情况和仍需完成的准备步骤；缺失的 manifest checkout 可通过输出的 init 命令恢复。导出不复制 manifest checkout、信任或凭证。

`format` 控制输出。`command_shell` 只控制生成命令的文本，不改变执行方式；auto 在 Windows 选择 PowerShell，其他平台选择 POSIX。可用 `--command-shell`、`FX_COMMAND_SHELL` 或 cmd 配置覆盖。manifest 中的 shell 模板保持原样。

补全支持 bash、zsh、fish 和 PowerShell，通过 `fx completion <shell>` 生成，按需自行加载。

### Agent 选择 {#agent-selection}

`fx config set agents codex` 选择指定宿主，`fx config set agents ''` 或空 `FX_AGENTS` 选择无宿主。取消配置和环境覆盖后恢复检测。Agent 选择影响同一 FX_HOME 的全部工作区；FX_HOME 不迁移全局 Skill 或配套工具凭证。

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

## 判读初始化与恢复结果 {#reading-initialization-and-recovery-results}

按结果返回的继续操作处理。新来源尚未被接受时，使用完整的原始重试命令；否则续跑读取托管来源和现有选择。注册与文件写入只是已发生的效果，完成判定看 `preparation.state` 和阻塞项。

本地预览检查目录、stdin 或 Git 已提交内容；新的远端来源在获取前保持 `source_inspected: false`。已知指南冲突与计划命令会先展示，预览不授予信任。普通源指南会在生成的目标中补齐 fx 区域，保留共享源正文；模糊标记交给维护者修正。

部分失败会保留已完成仓库、本地准备和用户文件。补齐列出的前置条件后，按返回动作继续；已有安装和通过验证的步骤会跳过。相对验证文件以工作区根为基准。含空格或 Unicode 的目录会自动生成名称，直接使用返回的身份即可。

遇到 `SKILL_WRITE_DENIED` 先处理被拒绝的路径；改变 FX_HOME 不会移动全局锁。可用 `fx sync --only repos,docs --no-refresh-manifest` 继续允许的工作，但不能声称 Skill 已修复。外来文件替换仍需批准并保留备份。Git 来源刷新保留本地修改，普通重试重新检查仓库可读性。详见[支持](support.md#troubleshooting)。

### 人工接手后恢复登录 {#resume-login-after-a-handoff}

`login` 需要人工输入时，先完成已授权的 handoff，再重跑同一命令。fx 会先检查当前状态，再决定是否重复操作；随后重新执行原先的 `can` 或 `doctor` 检查，继续原任务。

机器调用方在非零退出时也要同时读取部分 stdout 与 stderr 错误。已完成步骤仍保留；`handoff`、`blocked`、`failed`、`not_started` 区分后续工作。汇总、计划问题和步骤恢复字段见[登录响应契约](../skills/fx-workspace/references/commands.md#readiness-and-recovery)。

### Skill 所有权与宿主激活 {#skill-ownership-and-host-activation}

用户级 fx Skill 跨工作区共享，并由用户级锁保护；团队链接属于各自工作区，配套安装器管理自己的版本行为。文件正确不证明宿主已激活。

用 `hook list` 查看支持和验证状态。已测试的 Grok 1.0.25 仅在 Git 根发现项目 hook，普通目录信任不能解除此限制。使用显式 `fx sync --only docs,skills`，保持工作区根为普通目录；宿主执行审批仍独立生效。

### 复用已有登录

初始化会保留团队统一的 context 名称。兼容的配套 CLI 会先匹配同一服务的已有登录，复用个人身份，再决定是否需要你登录。Token 继续保存在原 CLI 的凭据存储中，当前 context 和已有身份保持不变。多个身份匹配时，可使用原 CLI 的 `auth reuse --from-context` 选择来源；网络或钥匙串问题会与缺少凭据分开报告。
