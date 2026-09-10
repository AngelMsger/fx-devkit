# 公开工具与私有团队配置

公开 fx-devkit 并不意味着公开团队的工作区。团队成员仍使用组织自己的仓库、服务环境、配套 CLI 和既有访问控制。

## 公开仓库中保留什么 {#keep-in-this-repository}

- CLI 实现、provider 适配器与原生 Agent 协议。
- Schema、通用使用文档和虚构示例。
- 保留真实协议语义的合成数据与离线测试。
- 内置 fx-workspace Skill 和通用贡献指南。

## 团队私有来源中保留什么 {#keep-in-the-teams-private-source}

- 实际仓库 URL、分支、负责人和访问联系人。
- 环境主机、日志流、错误追踪项目、构建任务和集群坐标。
- 跨仓库业务架构与产品特有流程。
- 团队 Skill、获授权的案例定义和适当受限的评估证据。

私有 manifest 可以使用 Git 管理。`init`、`sync`、`manifest`、`member`、`where`、`release` 与 `source push` 的职责不变。Provider 和安装器配置仍由数据驱动；公开源码不能通过删除集成或将私有服务替换为公共服务来改变实际行为。

## 本机保留什么 {#keep-on-each-machine}

凭据由各配套工具负责。FX_HOME 保存选择、偏好、信任与操作状态。导出配置不含秘密、信任记录和 manifest clone。其他机器的检查成功不能证明本机已就绪。

## 示例与兼容性 {#examples-and-compatibility}

包含 example 的名称和 example.com 域名都是虚构示例，不是真实组织的默认配置。仓库标识和服务标识可以不同，必要时明确设置 `obs.svc`。旧 `fx-` 服务命名约定仅为兼容保留，新 manifest 不必采用。

计划中的公共 npm 包不需要私有 registry 权限。团队的私有 manifest、配套包和服务仍可独立管理。fx 自身的发布与自更新还需要完成 [registry 迁移](design/registry-configuration.md)，工具采用 [Apache-2.0](../LICENSE)，该许可证不授予访问私有 manifest 或服务的权限。
