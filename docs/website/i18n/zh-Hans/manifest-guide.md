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
  CLAUDE.md
  docs/
  skills/
```

只有 `manifest/workspace.yaml` 必填，保存仓库与工作区 provider。environments 保存环境和平台坐标，tools 覆盖内置工具定义，members 保存成员信息且必须标记 `sensitive: true`，harness 声明 MCP 和规则；这些文件均可选。

AGENTS.md、CLAUDE.md、docs/ 和 skills/ 可以补充团队规则与文档。未提供环境、成员或 harness 文档时，相应能力保持未配置。凭据属于工具，不应写入这些文件。

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

将虚构的域名、项目、仓库和分支替换为已确认的值。Git 克隆需要 Git 访问权限, API 操作需要 Bitbucket 配套 CLI，不是可连接的演示服务。使用 `fx tool show bitbucket-cli` 查看设置要求。另一个已实现的代码托管 provider `local-git` 用于本地 bare 仓库目录，不是任意 Git 托管服务的适配器。

`fx manifest providers` 列出每个能力及其绑定。一个能力可以有多个实现——`issue-tracker` 可选 `feishu-project` 或 `jira-cli`，`knowledge-base` 可选 `confluence` 或 `lark-wiki`；一个配套 CLI 也可以服务多个能力，lark-cli 就同时服务 `im` 与 `knowledge-base`，它仍然只安装和检查一次。

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

`manifest repo-set` 在持有文件锁时核对原文再替换。其他写入者已修改内容、目标不是普通文件或 manifest 目录是符号链接时，会以 `MANIFEST_EDIT_CONFLICT` 保留现有内容。检查真实源路径后用 `--dry-run` 重试；不要删除锁或覆盖他人的修改。内容不变的编辑返回 `written: false`。

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

## 在 AGENTS.md 中声明团队 Skill

每个团队 Skill 放在 `skills/<name>/SKILL.md`，frontmatter 提供 `name` 和 `description`。在源 AGENTS.md 中需要目录的位置加入：

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` 自动填入名称、触发说明和源文件链接。新建指南默认带有该区域；已有指南缺少时只提示维护者添加，不自动插入人写内容。源指南使用相对链接，派生到工作区根的指南使用解析后的源路径，不依赖某个宿主的 Skill 链接。`fx sync --only docs,skills` 会更新新增、删除及元数据变化。目录帮助发现，不证明宿主已经安装或加载。仅覆盖工作区根，不修改业务仓库指南。

文档写入前会比较规划时的文件快照。`DOCS_WRITE_CONFLICT` 表示并发编辑或不安全路径已被保留；检查路径，父目录为链接时使用真实目录，再预览并重试。文件行的 `action` 表示计划，`result` 为 `planned`、`done`、`skipped`、`failed` 或 `not_started`。非零退出前可能已有文件写入成功，请先读 stdout 中的 `files`（sync 中为 `stage_details.docs.files`，init 中为 `sync.stage_details.docs.files`）；重试会跳过未变化文件。获准替换外来内容时，原文件、目录或链接本身会移动到未占用的同级 `.fx-backup[-N]`，已有备份保持不变。

## 公共服务预设 {#public-service-presets}

fx 0.2.0 支持在工作区 provider、platform 默认值及其环境覆盖项声明可选 `service`；相应文件须设置 `min_cli: '0.2.0'`。环境覆盖继承平台设置。`base_url` 是含部署路径的完整 HTTP(S) URL，SSH 克隆地址单独保留；`context` 指定配套 CLI 的 context。Bitbucket/Confluence 可设置 `flavor`；OpenObserve 必须声明 `org`；这四种配套工具须声明 `auth_scheme`，可选公共凭证获取页面 `credential_url`。Prometheus 同样须声明 `auth_scheme`，并接受 `none`，用于无需登录的服务：就绪与否取决于服务是否应答，不会要求登录；只有前置网关要求时才使用 `basic` 或 `bearer`。Sentry 只接受 `base_url` 和 `org`。未写 `provider` 的 platform 按其名称推导出的 provider 校验，与 `fx manifest providers` 显示的一致。

相同预设可共享本地目标，同一目标的不同预设会阻止配置。冲突的旧 vars 应删除，避免两个来源。用户名、邮箱、密码、PAT/API Token 值、Cookie 和浏览器会话不可分发；每人通过自己的 CLI 获取并保存凭证。额外 service 字段在非严格模式下也校验失败；URL 中的凭证会被拒绝且不会回显。

预设要求 Bitbucket/Confluence ≥0.20.0、Jenkins ≥0.9.0、OpenObserve ≥0.13.0、Prometheus ≥0.2.0，需在 tools.yaml 设置版本下限。init、显式 sync 和 login 使用受信任命令准备配置；`fx sync --only services --dry-run` 预览。非空冲突不会自动覆盖或切换激活项；Sentry 公共工作区默认值遵循同样的保留原则。
