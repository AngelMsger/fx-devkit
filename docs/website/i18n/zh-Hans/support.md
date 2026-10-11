# 支持与更新

## 排查问题 {#troubleshooting}

初始化中断时，先处理结果中列出的阻塞项，再使用返回的继续命令：

```sh
fx init --resume --workspace <name>
```

已经完成的工作会保留。个人登录和操作员文件由对应人员完成。已有工作区可用 `fx doctor --format json` 查看当前准备状态和具体动作；单项能力使用 `fx can <capability>`。

能力未就绪时，重新登录前先看它的检查得到了什么回答。待处理的步骤带有工具的信息；fx 能判断时还会指出是未能建立认证、权限被拒绝，还是连接未能建立。权限被拒绝或连接失败不需要重新登录。没有给出成因时，以工具的信息和步骤的说明为准，不要预设结论。在 `can` 与 `where` 中，没有得到回答的检查返回 `unknown`：修复它指出的工具，或在超时后重新查询。`fx doctor --tool <tool> --env <env>` 可查看单个工具的同一份细节。

`preparation.state` 为 `ready` 或 `incomplete`，未完成退出 12。`doctor.coverage` 单独表示诊断覆盖；release 仍使用 `ok/complete`。非零退出也要解析部分 stdout。

来源错误会标出文件和字段。工具 schema 3 要求 run 步骤明确区分本地准备与个人认证。新输入尚未被接受时，修好来源后使用返回的完整重试命令；已经接受的初始化使用托管来源续跑。`fx workspace list` 和 `fx self info` 可用于发现。目录移动后用 `workspace relocate`；个人凭据始终留在配套工具中。

## 更新 {#updates}

`fx self info --format json` 显示已安装版本、运行时、有效的 `registry` 和 `registry_source`。fx 复用 npm 用户/全局配置，先取包的 scope Registry，再取默认 Registry；`FX_REGISTRY` 是优先级更高的可选覆盖。项目 npmrc 不能重定向全局自更新。普通元数据查询由 npm 处理认证与 `NPM_CONFIG_USERCONFIG`；无效覆盖会报告出来，不会静默忽略。

fx 遵循 npm 的 `@angelmsger:registry` 与默认源；无法读取有效 npm 配置时才默认使用 npmjs。`FX_REGISTRY` 可指定镜像，先用 `fx self update --dry-run` 预览。

源码安装通过 Git 更新，再在 checkout 内执行 `npm ci` 和 `npm run build`。fx 本体更新与刷新 manifest 的 `fx sync` 分开。`self update --format json` 保持 stdout 可解析，请检查安装器 `code` 和失败时的 `reason`，不要仅凭收到 JSON 判断成功。

## 平台支持 {#platform-support}

需要 Node.js 22 或更新版本和 Git。Bun 可作为运行时；npm 安装和自更新仍需要 npm。

支持 macOS 和 Linux。原生 Windows 适配器已实现，但 Windows 实机运行、跨卷 junction 和原生宿主激活尚未验证。目标为本地 NTFS 上的 PowerShell 5.1/7 和 cmd。PowerShell 策略阻止 `.ps1` shim 时可使用 `.cmd` 入口。

各 Agent 宿主对 Skill、hook、MCP 和规则的支持不同。用 `fx agent list`、`fx hook list` 和 `fx mcp list` 查看所选宿主的状态。

## 报告问题 {#report-an-issue}

通过 [GitHub Issue](https://github.com/AngelMsger/fx-devkit/issues) 提供版本、操作系统、命令、预期行为及脱敏后的复现步骤。

## 安全报告 {#security-reports}

请使用[私密漏洞报告](https://github.com/AngelMsger/fx-devkit/security/advisories/new)，不要公开凭证、个人信息或内部连接地址。
