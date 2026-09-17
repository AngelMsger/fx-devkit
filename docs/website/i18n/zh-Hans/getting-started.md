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
fx init ./work --name work --from <manifest-repository> --dry-run
fx init ./work --name work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` 会先在命令信任确认后安装 manifest 中显式标记 `install_on_init` 的缺失工具，再同步仓库和所选 Agent 资源。已有工具安装会保留。

注册成功不代表所有同步阶段成功，请检查失败条目并在解决权限或设置问题后重试相关阶段。

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

### 共享服务设置与个人凭证 {#shared-service-settings-and-personal-credentials}

manifest 可声明 URL、context、组织和认证方式等公共 `service` 设置。`init`、显式 `sync` 和 `login` 通过受信任的配套命令准备这些设置；后台 hook 只检查。使用 `fx sync --only services --dry-run` 预览。

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

安装、版本匹配与声明加载是不同事实。读取 bundled Skill 后设置 `FX_SKILL_LOADED=1` 和 `FX_SKILL_VERSION=<bundled_skill_version>`；声明本身不能证明实际阅读。引导命令保持安静，其余非 TTY 命令会在版本未匹配时给出非阻断提示，可用 `FX_SKILL_NOTICE=0` 关闭。

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

先执行 `fx self info --format json`，读取返回的 bundled Skill 或 `fx skill show`，再声明 `FX_SKILL_LOADED=1` 和匹配的 `FX_SKILL_VERSION`。[内置 Skill](../skills/fx-workspace/SKILL.md) 提供任务路由。

使用 `--format json`，将 stdout 结果与 stderr 通知、进度和错误分开解析。集合采用 `{items, has_more, next?}`；`--no-input` 不等待输入，`--quiet` 抑制通知和进度。

`init`、`sync`、`doctor`、`release` 默认输出摘要，保留计数、异常和恢复动作，`omitted` 统计省略项。`--details` 返回完整结果，显式 `--fields` 从完整结果投影；`--verbose` 独立控制诊断。human、NDJSON 及事实查询保持原有行为。

| 结果             | 判读字段                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `init/sync`      | `operation` 与 `preparation_complete`。预览为 `null`；执行只判断本次选择且请求的准备工作。 |
| `doctor/release` | `ok` 表示没有失败项；`complete` 表示没有缺少覆盖的请求项。仍需检查警告。                   |
| `can`            | `status` 和 `handoff`。准备就绪不保证某次远端查询成功。                                    |

报告可能退出零但仍有失败项，init/sync 的非零退出也可能伴随部分 stdout。脏仓库、分叉、阻塞、失败或未验证的激活会使准备不完整；未选资源不影响判定。`release` 只检查仓库，不发布包或部署服务。

在写入前选择输出视图。对已授权的同步，一次保存完整结果：

```sh
fx sync --format json --details > sync-result.json
```

随后解析同一文件，不截断 JSON，也不为补取明细重复写操作。一起判读部分结果和 stderr 错误，详见[响应契约](../skills/fx-workspace/references/commands.md)。

## 迁移到 0.2.0 {#migrating-to-020}

- 工作流 JSON 默认输出摘要；需要正常条目或证据的脚本请加 `--details`，显式 `--fields` 仍从完整结果投影。
- 显式空 Agent 选择表示不选择任何宿主；恢复检测见[Agent 选择](#agent-selection)。
- 读取当前 bundled Skill 后声明 `FX_SKILL_VERSION`，仅旧布尔变量不能核对版本。

具体判读方式见[给编码 Agent](#for-coding-agents)。

## 配置 {#configuration}

`~/.fx` 保存工作区注册、个人层、资源所有权状态、信任和缓存。`FX_HOME` 只改变 fx 的个人目录，不改变配套工具的凭据位置。

`config list` 展示配置键、默认值、环境变量名及实际来源；`config get <key> --explain` 展示各层。优先级为显式参数、环境变量、配置文件、内置默认值。用 `config export/import` 迁移个人设置。

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

init 可能先完成注册，再在后续阶段失败。即使退出码非零，也要读取部分 stdout；解决原因后，以相同名称、来源和目录重试。同一物理目录的符号链接别名可接受，不同目录仍是冲突。

| 证据                                | 含义                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `registered` / `written`            | 已注册或发生本地写入；完成程度另看 `preparation_complete`。       |
| `failed_phase`、`phases`、`failure` | 初始化停止的位置与恢复步骤。                                      |
| `sync.stages`、`sync.stage_details` | init 的同步结果；sync 命令去掉 `sync` 前缀。                      |
| `tool_install`                      | 安装尝试；`code: null` 不代表成功，安装成功后也可能版本检查失败。 |
| `observed`                          | Skill 失败后的磁盘状态，失败写入也可能已经改变目标。              |

`SKILL_WRITE_DENIED` 应先检查被拒绝的路径；修改 FX_HOME 不会移动共享锁。可用 `fx sync --only repos,docs --no-refresh-manifest` 继续本地仓库和指南工作，但不代表 Skill 已修复。访问条件未改变时不要重复重试，也不要绕过命令信任。

`INIT_PREPARED` 在安装和克隆前展示计划；新的远端来源 dry-run 不拉取 manifest，因此无法描述未知内容。stderr 进度是心跳，不是传输百分比或 ETA；完整 JSON 使用 `--details`。

工具、登录与更新问题见[支持](support.md#troubleshooting)。`no_access` 表示环境未被选中，不是远端 ACL 拒绝。Git 传输凭证与可选代码托管 API 检查相互独立。

### Skill 所有权与宿主激活 {#skill-ownership-and-host-activation}

用户级 fx Skill 跨工作区共享，并由用户级锁保护；团队链接属于各自工作区，配套安装器管理自己的版本行为。文件正确不证明宿主已激活。

用 `hook list` 查看支持和验证状态。已测试的 Grok 1.0.25 仅在 Git 根发现项目 hook，普通目录信任不能解除此限制。使用显式 `fx sync --only docs,skills`，保持工作区根为普通目录；宿主执行审批仍独立生效。
