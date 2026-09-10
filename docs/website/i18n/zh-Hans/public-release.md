# 公开发布准备

项目为 `fx-devkit`，npm 包为 `@angelmsger/fx`，可执行命令为 `fx`。本仓库的版本号不是包已经发布的证据。

## 发布目标 {#distribution-target}

在公共 npm 以 public access 发布。安装 fx 不应依赖私有 registry、团队账号或 manifest checkout。团队 manifest 和连接服务仍遵循各自的访问控制。

## 已配置的公开地址 {#configured-publication-coordinates}

参考 oa-cli 的公开包约定，使用以下推断地址：

- 仓库：[AngelMsger/fx-devkit](https://github.com/AngelMsger/fx-devkit)。
- 官网：[fx-devkit](https://angelmsger.github.io/fx-devkit/)。
- 问题反馈：[GitHub Issues](https://github.com/AngelMsger/fx-devkit/issues)。
- 包访问级别：`public`；许可证：[Apache-2.0](../LICENSE)。

这些是配置的发布目标，不代表远端、官网或 npm 版本已经存在。网站源码位于 `docs/website/`。README 使用公开文档地址，使 npm 用户无需源码树；网站构建会将自身公开链接转换为当前语言的站内链接。

## 实现待办与发布决策 {#remaining-implementation-and-release-decisions}

- 共同迁移 registry 策略、元信息查询、自更新、发布 wrapper/guard 及测试。目前它们拒绝公共 npm 或要求私有地址，位置见 [registry 迁移](design/registry-configuration.md)。
- 创建公共仓库时核对已配置的仓库、官网和问题反馈地址；发布前确认包名、版本及 `@angelmsger` scope 权限。
- 审阅实际分发涉及的第三方声明。Apache-2.0 已选定，包内包含完整许可证文本。
- 静态网站已有 GitHub Pages 工作流，独立于 npm 发布。包 CI 的普通检查仍需移除对私有凭据和 manifest 的要求。现有 Jenkins 在整个流水线绑定 `npm-token`，并在 `v*` 标签上发布；npm 上线前要调整认证和标签策略。
- 仓库和官网上线后核对推断的公开链接。npm 包有意排除文档源码和网站工具链，README 链接指向公开网站或源码仓库。
- 保留私有集成检查与 Windows 实机验收范围，不能把离线测试说成宿主实测。

## 源码与产物审阅 {#source-and-artifact-review}

审阅候选文件和路径，包括测试、脚本、patch、符号链接和非文本资源。只扫描 npm 包并不充分。组织专属检测字典和原始结果留在私有位置；审阅合成安全用例，不应简单删除有效测试。

公开前检查全部拟发布 Git ref、提交信息及作者身份。不要合并或镜像私有前身历史；迁移映射与原始证据应单独存档。

执行[验证指南](validation.md)中的检查，检查实际 npm tarball（包括 source map 和隐式文件），在隔离环境验证安装。许可证、metadata、registry 或 CI 改变后，重新执行发布检查。

## 私有数据边界 {#private-data-boundary}

manifest 来源管理共享坐标、人员和团队规则。历史业务 patch、原始试验日志和调查报告应放在适当受限的证据存储中，不应自动进入全体成员可读的 manifest。凭据留在其所属工具中。
