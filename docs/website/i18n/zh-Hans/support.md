# 支持与更新

## 排查问题 {#troubleshooting}

先运行 `fx doctor --format json`。针对某项能力，使用 `fx can <capability> --env <environment> --format json`。按报告中的 handoff 处理，不要反复重试缺少访问权限的命令。

- 缺少工具：用 `fx tool show <tool>` 查看安装要求。
- 缺少认证：用 `fx login --list` 查看步骤，然后进入对应登录流程。
- 环境未被选中：检查 `fx env list`，仅在需要时将它纳入工作区。
- manifest 无效：运行 `fx manifest validate --strict`，并用 `fx manifest explain '<field>'` 查询问题字段。
- 同步部分失败：查看仓库条目和资源阶段的错误，解决后用 `fx sync --only <stage>` 重试相关操作。

报告退出码为零不证明已就绪。请阅读 `ok`、`complete`、各项结果和恢复信息。

## 更新 {#updates}

`fx self info --format json` 显示版本、运行时和包更新来源。当前预发布版本可通过 Git 更新源码 checkout，再在该目录执行 `npm ci` 和 `npm run build`。

使用包安装且有可用更新来源时，先查看 `fx self update --dry-run`。当前版本的包式自更新需要显式配置私有 registry；源码安装可按上述方式更新，不需要该命令。更新 fx 与更新团队 manifest 是不同操作，`fx sync` 会刷新符合条件的 manifest 来源。

## 平台支持 {#platform-support}

需要 Node.js 22 或更新版本和 Git。Bun 可作为运行时；npm 安装和自更新仍需要 npm。

支持 macOS 和 Linux。原生 Windows 适配器已实现，但 Windows 实机运行、跨卷 junction 和原生宿主激活尚未验证。目标为本地 NTFS 上的 PowerShell 5.1/7 和 cmd。PowerShell 策略阻止 `.ps1` shim 时可使用 `.cmd` 入口。

各 Agent 宿主对 Skill、hook、MCP 和规则的支持不同。用 `fx agent list`、`fx hook list` 和 `fx mcp list` 查看所选宿主的状态。

## 报告问题 {#report-an-issue}

[创建 issue](https://github.com/AngelMsger/fx-devkit/issues) 时，提供 `fx --version` 输出、操作系统、命令、预期行为和脱敏复现。设置问题请附相关检查项和 handoff。

## 安全报告 {#security-reports}

优先使用可用的[私有漏洞报告](https://github.com/AngelMsger/fx-devkit/security/advisories/new)。如果该入口不可用，可以在 issue 中请求私有联系渠道，不要公开敏感细节。报告中不要包含凭据、个人信息和团队私有坐标。
