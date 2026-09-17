# 你的数据与凭据

团队 manifest 描述仓库、工具和服务坐标。请将它保存在访问权限合适的团队仓库中；使用 fx 不要求公开 manifest。

## 本机状态 {#what-stays-on-your-machine}

fx 默认在 `~/.fx` 保存工作区注册、个人选择、偏好、信任决策和操作状态。可以用 `FX_HOME` 更改位置。manifest checkout 与业务仓库分开保存。

`fx config export` 导出受支持的偏好与个人层，不包含凭据、信任记录和 manifest clone。分享前仍需审阅导出内容：仓库选择与个人覆盖可能透露团队上下文。

工具安装历史保存在 FX_HOME 下的 `tool-history.json`，不随配置导出。它保存工作区名、包与命令信息、时间、版本和本机程序路径；命令 URL 中的凭据与查询参数、敏感参数会脱敏，不保存安装器原始输出。历史仍可能包含私有包名和 Registry 地址，分享前请审阅。它只记录后续 fx 操作，不补录已有安装；本机账号可以修改该文件，因此它不是防篡改审计服务。

新操作还记录安装来源与操作前的程序路径；查询发现的未记录外部程序不会写成安装凭据。旧记录缺少的来源信息保持未知。

## 认证 {#authentication}

服务凭据由配套工具负责。按工具正常流程登录，不要把 token 写入 manifest 或共享 Agent 指引。缺少访问权限时，fx 会检查就绪状态并提供相应的设置步骤。

一台机器选中了某个环境，不代表另一台机器也有权限。使用 `fx can <capability> --env <environment>` 或 `fx doctor` 检查。

## 团队知识 {#sharing-team-knowledge}

共享仓库信息、环境坐标和团队 Skill 保存在受控的 manifest 来源中。成员文档需要 `sensitive: true`，但该标记不能代替仓库访问控制。

只有明确执行 `fx source push` 才会提交选定的来源变更。先使用 `--dry-run` 检查文件和目标。普通工作区同步并不代表发布团队来源。

## 问题报告 {#reporting-a-problem}

公开报告只应包含最小化、已脱敏的示例。移除凭据、成员信息和私有服务地址。参见[支持](support.md)。
