# 支持与更新

## 排查问题 {#troubleshooting}

先运行 `fx doctor --format json`。针对某项能力，使用 `fx can <capability> --env <environment> --format json`。按报告中的 handoff 处理，不要反复重试缺少访问权限的命令。

- 缺少工具：用 `fx tool show <tool>` 查看安装要求。
- 缺少认证：用 `fx login --list` 查看步骤，然后进入对应登录流程。
- 环境未被选中：检查 `fx env list`，仅在需要时将它纳入工作区。
- manifest 无效：运行 `fx manifest validate --strict`，并用 `fx manifest explain '<field>'` 查询问题字段。
- 同步部分失败：查看仓库条目和资源阶段的错误，解决后用 `fx sync --only <stage>` 重试相关操作。

报告退出码为零不证明已就绪。请阅读 `ok`、`complete`、各项结果和恢复信息。

工作区解析或 manifest 加载失败时，先运行 `fx workspace list`、`fx workspace show <name>` 和 `fx self info`，保留查看注册与安装事实的能力。目录移动后使用 `workspace relocate` 修正根路径；manifest 缺失时按记录来源重新准备。必需工作区文档缺失或无效时，`manifest validate --strict` 会判定失败；可选且未声明的文档允许缺失。

## 更新 {#updates}

<!-- distribution:internal -->

包安装使用团队通过 `FX_REGISTRY` 指定的私有 Registry。

`fx self info --format json` 显示版本、运行时和包更新来源。源码安装可通过 Git 更新 checkout，再在该目录执行 `npm ci` 和 `npm run build`。

使用包安装且有可用更新来源时，先查看 `fx self update --dry-run`。当前版本的包式自更新需要显式配置私有 registry；源码安装可按上述方式更新，不需要该命令。更新 fx 与更新团队 manifest 是不同操作，`fx sync` 会刷新符合条件的 manifest 来源。

### Registry 路由

如果私有 Registry 能提供 fx，但代理公共依赖失败，先检查失败包的 URL。团队策略允许直接访问 npmjs 时，可保持 fx scope 使用私有源，仅让公共依赖走 npmjs：

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/ --@fx:registry="$FX_REGISTRY"
```

这是单次命令的路由选择，不修改凭证，也不表示私有代理已修复。`FX_REGISTRY` 仍指定 fx 的内部元信息及自更新来源。

<!-- /distribution -->

<!-- distribution:public -->

公开包默认从 npmjs 检查更新，可通过 `FX_REGISTRY` 指定镜像。执行前先查看 `fx self update --dry-run`。源码安装通过 Git 更新后重新构建。fx 本体更新与刷新 manifest 的 `fx sync` 是不同操作。
<!-- /distribution -->

## 平台支持 {#platform-support}

需要 Node.js 22 或更新版本和 Git。Bun 可作为运行时；npm 安装和自更新仍需要 npm。

支持 macOS 和 Linux。原生 Windows 适配器已实现，但 Windows 实机运行、跨卷 junction 和原生宿主激活尚未验证。目标为本地 NTFS 上的 PowerShell 5.1/7 和 cmd。PowerShell 策略阻止 `.ps1` shim 时可使用 `.cmd` 入口。

各 Agent 宿主对 Skill、hook、MCP 和规则的支持不同。用 `fx agent list`、`fx hook list` 和 `fx mcp list` 查看所选宿主的状态。

<!-- distribution:internal -->

## 报告问题 {#report-an-issue}

通过团队内部支持渠道联系 fx 维护者，附上 `fx --version`、操作系统、命令、预期行为和脱敏后的复现步骤。

## 安全报告 {#security-reports}

请私下向维护者报告安全问题。共享报告中不要包含凭证、个人信息和团队内部连接地址。
<!-- /distribution -->

<!-- distribution:public -->

## 报告问题 {#report-an-issue}

通过 [GitHub Issue](https://github.com/AngelMsger/fx-devkit/issues) 提供版本、操作系统、命令、预期行为及脱敏后的复现步骤。

## 安全报告 {#security-reports}

请使用[私密漏洞报告](https://github.com/AngelMsger/fx-devkit/security/advisories/new)，不要公开凭证、个人信息或内部连接地址。
<!-- /distribution -->
