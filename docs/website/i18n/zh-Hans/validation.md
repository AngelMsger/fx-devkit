# 验证与支持边界

本页说明如何验证 checkout，以及每类检查能够支持什么结论。团队试验记录、业务 patch、问题标识和机器或账号状态应保留在公开仓库之外。

## 必需的本地检查 {#required-local-checks}

使用 package.json 固定的开发版本：

```sh
npm ci
npm --prefix docs/website ci
npm run lint
npm run typecheck
npm test
npm run test:bun
npm run test:e2e
npm run docs:check
npm run site:build
npm run site:check
node scripts/check-package.mjs
```

单测通过注入端口覆盖领域决策和应用流程。E2e 用临时配置与仓库 fixture 运行构建后的 CLI。CLI 文档检查会重新构建并比较生成结果。网站从规范 Markdown 生成，检查源码是否过期、内部链接和资源是否有效，见[网站指南](website/README.md)。包扫描覆盖声明的分发路径，包括内置 Skill 和公开入口文档。

本地检查通过不能证明实际账号权限、远端资源存在、包已发布或 Agent 宿主已激活。私有验证记录应保留版本、运行时和准确命令，不要提交真实凭据、响应或逐字记录。

## 实际集成 {#live-integrations}

`npm run test:contract` 是可选只读检查，使用 [README 开发章节](../README.md#development)中的显式坐标。缺少输入时跳过；设置后访问失败则检查失败。

认证属于配套工具。复用支持的本机凭据，不要复制到测试 fixture。宿主项目的信任是独立边界；正确的 hook/MCP 文件不证明已激活。实际 source push 和 PR 还需要已安装配套工具给出可验证的 fork 父子关系。

## 平台覆盖 {#platform-coverage}

POSIX 自动检查覆盖进程管理、文件所有权与 CLI 行为。Windows 适配器虽已实现，实际执行、跨卷 junction 与宿主激活需要独立的 [Windows 验收](design/windows.md)。不能从 POSIX 运行或注入平台标记推断 Windows 结果。

Agent 协议各异，使用 `hook list`、`mcp list/show` 区分支持、不支持与未验证状态，并在发布说明中保留区别。

## 独立 Agent 评估 {#independent-agent-evaluation}

[评估协议](eval/README.md)覆盖工作区发现、就绪、Skill 选择、来源追溯和任务质量。使用 fixture 或明确授权的私有 manifest；完整证据留在公开仓库外，仅发布审阅过的汇总结论。

## 公开源码快照 {#preparing-a-public-source-snapshot}

npm 包扫描不等于整个 Git 仓库审阅。源码、测试、示例、文档、patch、忽略文件和历史需要分别检查。虚构示例仍应保留协议语义，避免使用组织真实拓扑和标识。

删除工作树文件不能删除已有提交。公开快照可以不含 `.git`，并建立新的公开历史；保留私有原件，改写或公开历史是独立操作。本项目已采用 Apache-2.0，发布审阅仍需检查第三方声明与产物中的许可证文本。公共 npm 发布不公开团队 manifest，也不改变配套包的发布策略；fx 自身的迁移见[发布清单](public-release.md)。
