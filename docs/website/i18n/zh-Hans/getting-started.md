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

### Skill、MCP 与生命周期

所选 Agent 获得团队 Skill 目录链接和带版本的 fx Skill 副本。非 fx 所有的文件会被保留；Windows 用 junction 链接团队目录。用 `skill list` 查看交付状态，用 `sync --only skills` 协调资源。

harness 向所选宿主投射 MCP 条目和规则指针，秘密值保持为环境变量引用。`mcp list/show` 和 `can mcp:<name>` 说明前置条件；配置正确不证明宿主已激活。见 [MCP 契约](user-guide.md#for-coding-agents)。

工作区启动钩子可以返回缓存上下文，并后台刷新 manifest、文档和 Skill；不会同步业务仓库或确认信任。宿主仍控制项目与钩子信任。用 `hook list/inject/remove` 管理，见[生命周期契约](user-guide.md#for-coding-agents)。

### 贡献共享知识

`source push` 可预览或提交所选源文件，保留源 checkout 的 HEAD、索引和工作文件。提交需要个人 fork 及其上游关系的证据。实际提交前阅读 `fx source push --help` 与[贡献契约](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

| 意图                   | 命令                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| 创建、同步和检查工作区 | `init`、`sync`、`status`                                                           |
| 设置访问并检查就绪     | `login`、`doctor`、`can`                                                           |
| 查询环境坐标与发布证据 | `where`、`release`                                                                 |
| 管理仓库               | `repo list/show/pick/unpick/add/remove/fork/open`                                  |
| 管理环境与 Agent       | `env list/show/pick/unpick`、`agent list/pick/unpick`                              |
| 管理工具和 Skill       | `tool list/show/install/update`、`skill list`                                      |
| 管理共享来源           | `manifest validate/lint/explain/schema/providers/set/render/import`、`source push` |
| 查询成员与配置         | `member list/show`、`config list/get/set/unset/export/import`                      |
| 检查宿主资源           | `hook list/inject/remove`、`mcp list/show`                                         |
| CLI 信息与更新         | `self info/update`、`completion`                                                   |

完整语法以 `--help` 和[生成的 CLI 参考](cli/README.md)为准。

## 给编码 Agent {#for-coding-agents}

使用 `--format json` 或 `FX_FORMAT=json`。stdout 只包含数据；通知、进度和错误写入 stderr。集合包络为 `{items, has_more, next?}`，缺失或未知值会显式表示。

`--fields` 可投影字段，`--quiet` 抑制通知，`--no-input` 禁止等待输入。写命令支持 `--dry-run` 和只读姿态；`--allow-writes` 是单次调用的显式覆盖。

doctor/release 即使有失败检查也退出零；init/sync 也可能在部分成功时退出零。init 查看 `sync.summary`、`sync.stages`；sync 查看 `summary`、`stages` 和每个失败条目的 `failure`。`stage_details` 保留资源阶段结果和 handoff。不要把退出码当作就绪证据，不要捏造认证或绕过宿主信任。

先读[内置 Skill](../skills/fx-workspace/SKILL.md)和[响应指南](../skills/fx-workspace/references/commands.md)，再设置 `FX_SKILL_LOADED=1`。`self info` 可定位安装后的 Skill。

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
