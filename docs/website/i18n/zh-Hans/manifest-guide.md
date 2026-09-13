# 创建 manifest 来源

公开安装的 fx 提供 CLI、默认工具定义和内置 Agent Skill。每个团队提供自己的工作区声明。可以使用团队现有来源、导入已有 checkout，或从下面的最小声明开始。私有包 registry 不是 manifest 格式的一部分。

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

AGENTS.md、CLAUDE.md、docs/ 和 skills/ 可以补充团队规则与文档。未提供环境、成员或 harness 文档时，相应能力保持未配置；未提供 tools.yaml 时仍使用内置工具目录。凭据属于工具，不应写入这些文件。

内置工具声明最低版本要求。使用 `fx tool show <tool>` 查看实际要求，通过 `fx tool update <tool> --dry-run` 预览升级。团队可在 `manifest/tools.yaml` 中覆盖 `min_version`，以维持适合自身环境的兼容性基线。最低版本要求不会将 npm 安装锁定到该版本。

## 初始化时安装团队工具 {#install-a-team-tool-during-initialization}

fx 0.1.1 起，可以在 `manifest/tools.yaml` 中声明初始化时安装工具。

```yaml
schema_version: 2
min_cli: '0.1.1'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

以下包名和可执行文件名均为虚构示例。Registry 和认证使用本机 npm 配置。`fx init` 只安装标记了 `install_on_init: true`、已启用且缺失的工具，并在仓库及 Skill 同步前完成安装。执行前须确认具体的安装与版本检查命令。已有工具即使低于最低版本也会保留，升级使用 `fx tool update`。普通 `fx sync` 不安装包，初始化也不会登录服务。

初始化成功后可查看 `tool_install` 中的结果。dry-run 不物化来源、不运行安装器，`tool_install` 和 `sync` 均为 null；只读模式禁止安装。安装或版本验证失败会报告 `INIT_TOOL_INSTALL_FAILED`。此时工作区可能已经注册，修复 npm 访问或 PATH 后，用相同目录和来源重试即可。

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

在包含 team-workspace/ 的目录执行：

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx login --list
fx doctor
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

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

## 共享与维护来源 {#share-and-maintain-the-source}

目录来源是快照；本地 Git 来源使用已提交内容，不包含未提交修改。持续共享应把审阅过的来源提交到权限适当的 Git 仓库，然后将 URL 提供给 `fx init`。

注册后的来源位于 `~/.fx/workspaces/<name>/source`。`sync` 先刷新符合条件的 Git 来源；目录和 stdin 快照不会持续跟踪原始来源。用 `fx self info --format json` 定位当前工作区及来源。再次指定不同来源不会隐式迁移已注册工作区。

在来源 checkout 维护共享声明；使用 `repo pick/unpick`、`env pick/unpick` 和 `agent pick/unpick` 管理个人选择。Agent 选择影响同一 FX_HOME 的全部工作区。通过已验证个人 fork 提交变更的流程见[共享源贡献](cli/README.md#fx-source-push)。

## 环境示例

以下使用虚构值展示真实源结构. 第一段放入 manifest/workspace.yaml, 第二段放入 manifest/environments.yaml. obs.svc=api 将流名推导为 example_api_test. unverified 坐标与 CLI 配置、资源权限分别判断. JSON 是初始化失败结果的节选, 不代表引导成功.

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
    command: openobserve-cli search run --use-context {context} --stream {stream}
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

```json
{
  "registered": true,
  "failed_phase": "sync",
  "phases": { "registration": "done", "tools": "done", "sync": "failed" },
  "sync": {
    "stages": {
      "docs": { "created": 2 },
      "skills": { "status": "failed" },
      "hooks": { "status": "not_started" }
    }
  }
}
```
