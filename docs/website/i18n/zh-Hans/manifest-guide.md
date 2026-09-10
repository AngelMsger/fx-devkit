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

将虚构的域名、项目、仓库和分支替换为已确认的值。示例需要 Bitbucket 配套 CLI 和相应访问权限，不是可连接的演示服务。使用 `fx tool show bitbucket-cli` 查看设置要求。另一个已实现的代码托管 provider `local-git` 用于本地 bare 仓库目录，不是任意 Git 托管服务的适配器。

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
