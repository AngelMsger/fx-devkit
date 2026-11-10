# 创建 manifest 来源

fx 提供 CLI、默认工具定义和内置 Agent Skill。每个团队提供自己的工作区声明。可以使用团队现有来源、导入已有 checkout，或从下面的最小声明开始。私有包 registry 不是 manifest 格式的一部分。

## 来源目录结构 {#source-layout}

来源目录应位于业务仓库工作区之外：

```text
team-workspace/
  manifest/
    workspace.yaml
    environments.yaml
    tools.yaml
    members.yaml
    harness.yaml
  AGENTS.md
  docs/
  skills/
```

只有 `manifest/workspace.yaml` 必填，保存仓库与工作区 provider。environments 保存环境和平台坐标，tools 覆盖内置工具定义，members 保存成员信息且必须标记 `sensitive: true`，harness 声明 MCP 和规则；这些文件均可选。

AGENTS.md、docs/ 和 skills/ 可以补充团队规则与文档。未提供环境、成员或 harness 文档时，相应能力保持未配置。凭据属于工具，不应写入这些文件。

fx 不假定任何工具。它内置的 CLI 只是一份目录，记录它知道如何驱动哪些工具；工作区的工具链由它绑定的 provider 推导而来：把 `ci` 绑定到 `jenkins-cli`，Jenkins 配套工具就进入工具链，版本下限、安装方式和命令仍由 fx 维护。因此多数团队不需要 tools.yaml。

只有在没有绑定会带来该工具时才在 tools.yaml 中声明它——团队自用的工具，或 fx 不认识的工具。写出内置工具的名字同样就是全部声明，fx 的命令因此保持受信任，无需逐条确认；只在与内置事实不同的地方覆盖字段，被覆盖的字段归团队所有，执行前 fx 会再次确认。

`fx tool list` 列出本工作区拥有的工具，并说明每个工具因何在此：`binding` 表示由绑定推导而来，`manifest` 表示本文件声明；`fx tool list --catalog` 会再列出 fx 知道但本工作区没有选用的工具。

当本文件声明了同名工具时，能力也可以绑定 fx 未实现的 provider：fx 不为它提供入口坐标，就绪判定完全来自该工具。

内置工具声明最低版本要求。使用 `fx tool show <tool>` 查看实际要求，通过 `fx tool update <tool> --dry-run` 预览升级。团队可在 `manifest/tools.yaml` 中覆盖 `min_version`，以维持适合自身环境的兼容性基线。最低版本要求不会将 npm 安装锁定到该版本。

## 初始化时安装团队工具 {#install-a-team-tool-during-initialization}

fx 0.4.0 起，可以在 `manifest/tools.yaml` 中声明初始化时安装工具。

```yaml
schema_version: 3
min_cli: '0.4.0'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

若团队希望新机器装齐全部工具，可在 `defaults` 中写一次，个别条目仍可覆盖回 `false`：

```yaml
schema_version: 3
defaults:
  install_on_init: true
tools:
  - name: example-optional-tool
    install_on_init: false
```

以下包名和可执行文件名均为虚构示例。Registry 和认证使用本机 npm 配置。`fx init` 只安装标记了 `install_on_init: true`、已启用且缺失的工具，并在仓库及 Skill 同步前完成安装。执行前须确认具体的安装与版本检查命令。已有工具即使低于最低版本也会保留，升级使用 `fx tool update`。普通 `fx sync` 不安装包，初始化也不会登录服务。

初始化成功后可查看 `tool_install` 中的结果。dry-run 不获取或复制来源、不运行安装器，`tool_install` 和 `sync` 均为 null；只读模式禁止安装。安装或版本验证失败会报告 `INIT_TOOL_INSTALL_FAILED`。此时工作区可能已经注册，修复 npm 访问或 PATH 后，用相同目录和来源重试即可。

## 本地准备与个人登录 {#local-preparation-and-personal-sign-in}

工具文档采用 schema 3，每个 run 步骤明确声明用途：

```yaml
schema_version: 3
tools:
  - name: example-team-tool
    required: true
    install: [{ via: npm, spec: '@example/team-tool' }]
    install_on_init: true
    setup:
      - id: local
        kind: run
        phase: prepare
        title: Prepare local files
        run: [prepare]
        verify: { file: ~/.example-tool/ready }
```

`prepare` 在准确命令获准后由初始化非交互执行；`authenticate` 在 init 中只验证已有登录，缺失时交给用户。manual/file 步骤只检查并交接。验证已通过时跳过执行，`init --resume` 继续剩余工作。仅声明自定义可执行文件不会自动要求认证，需要时显式声明 `auth`。

非法条目会阻止准备，不会悄悄删除需求。普通源 AGENTS.md 即可使用；fx 在目标指南中补齐缺少的发现区域，保留作者正文和已有区块位置。模糊或不完整的标记由维护者修正。

## 从最小声明开始 {#start-with-a-small-declaration}

使用 Bitbucket 的团队可以创建 `team-workspace/manifest/workspace.yaml`：

```yaml
schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars:
      host: ssh://git@git.example.com
      web: https://git.example.com
defaults:
  upstream_project: example
  branch: main
projects:
  example:
    label: Example team
    contact: Ask your repository administrator
repos:
  - name: example-api
    desc: Example API service
```

将虚构的域名、项目、仓库和分支替换为已确认的值。Git 克隆需要 Git 访问权限, API 操作需要 Bitbucket 配套 CLI，不是可连接的演示服务。使用 `fx tool show bitbucket-cli` 查看设置要求。其他已实现的代码托管 provider 有两个：`github` 通过 GitHub CLI `gh` 工作，其 `host` 是 `https://github.com` 这样的克隆前缀（GitHub Enterprise 服务器也用同样方式指定）；`local-git` 用于本地 bare 仓库目录，不是任意 Git 托管服务的适配器。`bitbucket-cli` 与 `github` 还会为 `fx source push` 创建 pull request，`local-git` 不会。

`fx manifest providers` 列出每个能力及其绑定。一个能力可以有多个实现——`issue-tracker` 可选 `feishu-project` 或 `jira-cli`，`knowledge-base` 可选 `confluence` 或 `lark-wiki`，`calendar` 可选 `lark-calendar`、`wecom-calendar` 或 `wecom-calendar-cli`；一个配套 CLI 也可以服务多个能力，lark-cli 就同时服务 `im` 与 `knowledge-base`，它仍然只安装和检查一次。

将工作区能力 `channel` 绑定到 `wecom-channel-cli` 即可安装 CLI 和 Skill。就绪检查通过代理套接字检测本地 broker。

在包含 team-workspace/ 的目录执行：

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx init --resume --workspace work
```

检查 init 各同步阶段并处理 handoff。manifest 有效不代表仓库可访问、工具已就绪或 Agent 宿主已激活。

包含方括号的字段路径应加引号，避免被 zsh 等 shell 当作文件匹配模式：

```sh
fx manifest explain 'repos[].upstream'
fx manifest explain --kind tools 'tools[].setup'
fx manifest schema --kind environments
```

## 企业微信智能机器人 worker {#wecom-smart-bot-workers}

此绑定仅用于管理员预先配置的隔离对话 worker。在 `manifest/workspace.yaml` 的 `providers` 下添加以下内容，并将示例坐标替换为管理员提供的 worker 套接字及作用域：

```yaml
providers:
  im:
    provider: wecom-chat-cli
    vars:
      socket: /run/chat-worker/bridge.sock
      bot_id: example-bot
      deployment: support
```

可信 supervisor 仅向 worker 的工具执行器提供 `WECOM_CHAT_TASK_TOKEN`。不要将其写入 manifest、命令行参数、提示词或共享环境；不要向 worker 提供 operator 套接字或机器人 Secret。broker、worker 和审核者必须满足 [Chat 部署指南](https://github.com/AngelMsger/wecom-chat-cli/blob/main/docs/security.md)中的操作系统与工具隔离要求。

`fx can im` 通过该套接字执行 `task get`，并要求响应包含不受信内容标记。它返回就绪状态和读取命令，不返回或持久化任务正文。令牌缺失、过期或被撤销时，绑定处于未配置状态。就绪只证明检查当时能够读取该任务，不代表后续回复仍然有效、沙箱已安装或真实企业微信部署已验收。

工具目录支持 `fx tool show/install/update wecom-chat-cli`，使用其 `version` 命令，最低版本为 v0.3.0。CLI 支持 Linux 和 macOS。它没有 `auth status`、`config init` 或 `skill install` 命令，因此 fx 不调用这些系列默认命令。请通过受限宿主的 Skill 机制安装对应 npm 包中的 `SKILL.md`；fx 不会将其复制给通用编程 Agent。仅安装工具不代表任务已就绪。

从 Chat 0.2.x 升级会改变 operator 的 watch 输出和游标。恢复 supervisor 前请按 [Chat 迁移指南](https://github.com/AngelMsger/wecom-chat-cli/blob/main/docs/host-integration.md#migration-and-acceptance) 操作；fx 不会迁移宿主队列或游标。

broker 配置、任务签发、会话路由、独立回复审核以及影响用户后续访问的记忆决策仍由可信宿主或管理员负责。此 provider 不会启动 broker、枚举收件箱、发送回复或复制凭据。普通开发工作区可以只安装工具，不将 `im` 绑定到它。

## 导入已有 checkout {#import-existing-checkouts}

使用现有工作区之外的来源目录：

```sh
fx manifest import ./existing-work --format json
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml --dry-run
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml
```

写入后、init 前，先审阅候选中的分支、上游、项目和未确定项。团队规则与 Skill 需要单独补充，不能从 Git 元信息中恢复。已有目录自动纳入，`--adopt` 仅为兼容保留。替换已有指南或 Skill 位置可能需要审阅并备份。导入不改 checkout，不删除 submodule 元信息。见[导入契约](manifest-guide.md#import-existing-checkouts)。

Provider 推断需要证据：经验证的本地 bare 仓库可生成 `local-git` 绑定。未知或混合托管保留显式 upstream URL 和待审阅说明，不猜测 provider。code host 未能作答的项目报告为未作答而非不存在，对应条目的待审阅说明或跳过原因会说明这次搜索并不完整。含凭证、查询参数或片段的 HTTP remote 会跳过且不回显这些数据。

只有 `origin` 且其 URL 与声明的 upstream 完全匹配时，sync 会添加 `upstream`，保留 `origin`、当前分支和本地文件。预览的 `upstream_to_add` 与结果的 `upstream_added` 分别说明计划和实际效果；冲突的 remote 保持不变。

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

`manifest repo-set` 不会覆盖并发的修改：它以 `MANIFEST_EDIT_CONFLICT` 停止，文件保持原样。检查源文件后用 `--dry-run` 重试；响应内容见[并发的 manifest 编辑](../skills/fx-workspace/references/commands.md#concurrent-manifest-edits)。

`manifest validate/lint/providers/repo-set/render` 优先使用显式 `--workspace` 或 `FX_WORKSPACE`，即使当前目录位于另一份源 checkout 内。未知的显式名称会报错，不会退回修改附近的 manifest。未显式选择时，仍优先使用当前目录附近的源 checkout，支持独立维护。`manifest import <dir>` 保留目录参数语义，`manifest record-probe` 使用所选已注册工作区。所有文件输出参数支持 `-o` 和 `--out`，包括 render。

## 共享与维护来源 {#share-and-maintain-the-source}

目录来源是快照；本地 Git 来源使用已提交内容，不包含未提交修改。持续共享应把审阅过的来源提交到权限适当的 Git 仓库，然后将 URL 提供给 `fx init`。

注册后的来源位于 `~/.fx/workspaces/<name>/source`。`sync` 先刷新符合条件的 Git 来源；目录和 stdin 快照不会持续跟踪原始来源。用 `fx self info --format json` 定位当前工作区及来源。再次指定不同来源不会隐式迁移已注册工作区。

用 `fx workspace rebind <name> --from <source> --dry-run` 预览显式换源，并保留工作区身份与个人选择。

在来源 checkout 维护共享声明；使用 `repo pick/unpick`、`env pick/unpick` 和 `agent pick/unpick` 管理个人选择。Agent 选择影响同一 FX_HOME 的全部工作区。通过已验证个人 fork 提交变更的流程见[共享源贡献](cli/README.md#fx-source-push)。

## 环境示例

以下虚构示例分别放入 `manifest/workspace.yaml` 和 `manifest/environments.yaml`。`obs.svc: api` 将日志流解析为 `example_api_test`。坐标在核验前仍是 `unverified`；声明它不会配置 CLI 或授予访问权限。

```yaml
schema_version: 2
defaults: { branch: main }
repos:
  - name: example-api
    upstream: https://git.example.com/team/example-api.git
    obs: { svc: api }
```

```yaml
schema_version: 2
platforms:
  logs:
    provider: openobserve-cli
    capability: log-store
    label: Application logs
    command: openobserve-cli search run --use-context {context} --sql "SELECT * FROM {stream} LIMIT 20" --since 1h
envs:
  test:
    label: Test
    platforms:
      logs:
        vars: { context: test, stream: 'example_{svc}_test' }
        confidence: unverified
```

```sh
fx manifest validate --strict --format json
fx where example-api --env test --format json
fx doctor --tool openobserve-cli --format json
```

指标平台的写法相同。它的坐标变量是 `job`，即服务的抓取 job。只有 job 名称确实遵循某个模式时才声明模板；否则把逐个核实过的 job 记在对应仓库的 `obs.overrides.<platform>.<env>.vars` 下，没有登记的仓库不会得到命令，而不是一个猜出来的选择器。

```yaml
platforms:
  metrics:
    provider: prometheus-cli
    capability: metrics
envs:
  test:
    platforms:
      metrics:
        service:
          base_url: https://metrics.example.com
          context: test
          auth_scheme: none
        vars: { job: 'example-{svc}' }
        confidence: unverified
```

ci 平台指定构建每个环境的 job。`jenkins-cli` 在每个环境接收一个 job `path`。`github-actions` 同样通过 `gh` 工作：平台以 `OWNER/NAME`（GitHub Enterprise 服务器上为 `HOST/OWNER/NAME`）指定仓库，每个环境指定 workflow 以及计入的运行所属的触发方式，这样 pull request 或手动运行就不会被当作正式构建。环境也可以指定 `branch`；不指定时，`fx release check` 计入正在检查的分支的运行。release check 会把构建检出的提交与分支最新提交比较；GitHub Actions 总会给出这个提交，Jenkins 从 jenkins-cli 0.12.0 起给出。

```yaml
platforms:
  actions:
    provider: github-actions
    capability: ci
    vars: { repository: 'example/{repo}' }
envs:
  prod:
    platforms:
      actions:
        vars: { workflow: ci.yml, event: push }
```

## 在 AGENTS.md 中声明团队 Skill

每个团队 Skill 放在 `skills/<name>/SKILL.md`，frontmatter 提供 `name` 和 `description`。在源 AGENTS.md 中需要目录的位置加入：

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` 自动填入名称、触发说明和源文件链接。新建指南默认带有该区域；已有指南缺少时只提示维护者添加，不自动插入人写内容。源指南使用相对链接，派生到工作区根的指南使用解析后的源路径，不依赖某个宿主的 Skill 链接。源指南中指向源内文件的其他相对链接（例如 `CONTRIBUTING.md`）也同样解析。`fx sync --only docs,skills` 会更新新增、删除及元数据变化。目录帮助发现，不证明宿主已经安装或加载。仅覆盖工作区根，不修改业务仓库指南。

文档写入前会比较规划时的文件快照。`DOCS_WRITE_CONFLICT` 表示并发编辑或不安全路径已被保留；检查路径，父目录为链接时使用真实目录，再预览并重试。文件行的 `action` 表示计划，`result` 为 `planned`、`done`、`skipped`、`failed` 或 `not_started`。非零退出前可能已有文件写入成功，请先读 stdout 中的 `files`（sync 中为 `stage_details.docs.files`，init 中为 `sync.stage_details.docs.files`）；重试会跳过未变化文件。获准替换外来内容时，原文件、目录或链接本身会移动到未占用的同级 `.fx-backup[-N]`，已有备份保持不变。

## 在 AGENTS.md 中放置工作区布局规则

`workspace-layout` 区域告诉 Agent 不属于任何仓库的产物放在哪里：工作区根目录的 `.workbench/`。派生到工作区的指南始终包含该区域，源指南没有标记时追加在末尾。把标记加在其他工作区规则旁边，可以让它出现在那里：

```markdown
<!-- fx:begin workspace-layout -->
<!-- fx:end workspace-layout -->
```

## 在根目录维护 Go 工作区

当多个仓库是互相依赖构建的 Go 模块时，可以让 fx 在工作区根目录维护 `go.work`：

```yaml
schema_version: 2
min_cli: '0.11.0'
go:
  workspace: true
```

`fx init` 和 `fx sync` 会把所有已选择且顶层有 `go.mod` 的 checkout 写入 `go.work`，并使用这些模块要求的最新 `go` 版本。每个模块基于同级仓库的 checkout 构建，而不是 `go.mod` 固定的版本；需要使用固定版本时以 `GOWORK=off` 构建。未选择或尚未克隆的仓库不会列入，因此文件不会指向缺失的模块。`fx sync --only go` 只刷新这个文件。

fx 通过第一行的标记识别自己写的 `go.work`，只替换或删除这一份。个人自己的 `go.work` 只报告、不修改；要交给 fx 维护，请先把它移开。去掉该设置后，下一次 sync 会删除 fx 写的 `go.work`。`go.work` 与 `go.work.sum` 属于工作区，`fx doctor` 不会把它们报告为多余条目。

## 公共服务预设 {#public-service-presets}

fx 0.2.0 支持在工作区 provider、platform 默认值及其环境覆盖项声明可选 `service`；相应文件须设置 `min_cli: '0.2.0'`。环境覆盖继承平台设置。`base_url` 是含部署路径的完整 HTTP(S) URL，SSH 克隆地址单独保留；`context` 指定配套 CLI 的 context。Bitbucket/Confluence 可设置 `flavor`；OpenObserve 必须声明 `org`；这四种配套工具须声明 `auth_scheme`，可选公共凭证获取页面 `credential_url`。`auth_scheme` 决定 fx 如何新建缺失的 context 以及 `fx login` 提供哪种登录方式，不是就绪条件；成员针对同一 `base_url` 的 context 用其他方式登录时同样算就绪。Prometheus 同样须声明 `auth_scheme`，并接受 `none`，用于无需登录的服务：就绪与否取决于服务是否应答，不会要求登录；只有前置网关要求时才使用 `basic` 或 `bearer`。Sentry 只接受 `base_url` 和 `org`。未写 `provider` 的 platform 按其名称推导出的 provider 校验，与 `fx manifest providers` 显示的一致。

相同预设可共享本地目标，同一目标的不同预设会阻止配置。冲突的旧 vars 应删除，避免两个来源。用户名、邮箱、密码、PAT/API Token 值、Cookie 和浏览器会话不可分发；每人通过自己的 CLI 获取并保存凭证。额外 service 字段在非严格模式下也校验失败；URL 中的凭证会被拒绝且不会回显。

预设要求 Bitbucket/Confluence ≥0.20.0、Jenkins ≥0.9.0、OpenObserve ≥0.13.0、Prometheus ≥0.2.0，需在 tools.yaml 设置版本下限。init、显式 sync 和 login 使用受信任命令准备配置；`fx sync --only services --dry-run` 预览。非空冲突不会自动覆盖或切换激活项；Sentry 公共工作区默认值遵循同样的保留原则。

## 成员归属与业务协作 {#member-relationships}

成员 schema 2 需要 fx 0.16.0。先分发并验证 CLI，再启用新版资料。CLI 继续读取 schema 1。迁移时保留人员 ID、账号及其否定状态、负责人、角色和仓库引用。给每个域和域内场景分配稳定 ID。团队和职能词表由清单声明。每条关系关联一个人、团队或职能，多职能可分行登记。域和场景可以有多个责任团队。目录关系可以只记录个人职能。旧 `all` 保留为团队范围未知的集体职责；有范围的集体协作使用 `person: all`，指定团队并可指定职能。 在 `manifest/workspace.yaml` 中同步设置版本下限，旧 CLI 进入工作区时即可提示所需版本。

以下虚构的 `manifest/members.yaml` 可配合工作区清单使用。

```yaml
schema_version: 2
min_cli: '0.16.0'
sensitive: true
people: [{ id: fern, email: fern@example.com }]
teams: [{ id: ink, name: Ink Studio }, { id: clay, name: Clay Studio }]
functions: [{ id: illustrator, name: Illustrator }]
areas: [{ id: atlas, group: Illustrated Atlas, responsible_teams: [ink] }]
memberships:
  - {
      person: fern,
      team: clay,
      function: illustrator,
      status: confirmed,
      source: roster/fern,
      verified_at: '2025-04-02',
    }
assignments:
  - {
      person: fern,
      area: atlas,
      team: ink,
      function: illustrator,
      status: confirmed,
      source: atlas/credits,
      verified_at: '2025-04-02',
    }
```

```sh
fx manifest validate --kind members --strict --format json
fx member show fern --area atlas --format json
fx member list --team ink --function illustrator --area atlas --format json
```

每项筛选只传一个值。日期按 UTC 自然日计算，包含 `valid_from`，不含 `valid_until`，省略的一端开放。`verified_at` 是证据核验日。日期查询只检查当前文件声明的区间。候选关系使用 `status: unverified`。已确认关系须有来源和核验日期。区分没有配置协作部分（`not_configured`）和没有适用关系（`not_covered`）。 只核实业务职能时可省略协作关系的团队。该证据可以确认职能，团队归属仍待补证。

### 导师与最终负责人

人员关系直接放在 `people` 中, 独立于业务域、团队和职能. 成员 schema 1 和 2 均支持可选的 `mentor` 与 `leader` 人员 ID. `mentor` 表示直接导师, `leader` 表示明确指定的最终负责人. 两者都不代表行政汇报关系, 也不继承业务责任.

```yaml
people:
  - { id: learner, mentor: guide, leader: owner }
  - { id: guide, leader: owner }
  - { id: owner }
```

引用必须指向同一文档中的人员. 空值、`all`、自指和任一种关系内的循环均会被拒绝. 最终负责人自己的 `leader` 应省略, 不要指向自己. 字段缺失表示未知, 不代表没有导师或负责人. 不从其他人的关系推断本人的关系.

`member show` 和 `member list` 在结构化及人类可读输出中均返回这两个字段, 值为人员 ID 或 `null`. 业务筛选及 `--as-of` 不改变这些没有有效期的人员事实. 这些字段需要 fx 0.17.0 或更高版本. 先分发并验证兼容 CLI, 再启用字段, 并将 members 和 workspace 文档的 `min_cli` 设为 `0.17.0`. 旧 CLI 在严格模式下拒绝这些字段, 普通读取则会丢弃它们, 不要提前迁移共享清单.
