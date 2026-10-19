# 更新日志

## [Unreleased]

- 可以在 GitHub 上创建 pull request。`fx source push` 对托管在 GitHub 上的 manifest 源与对 Bitbucket 一样工作：通过 `gh` 把所选文件推送到经过验证的个人 fork，并针对其上游创建、复用或结束 pull request；`--pr` 接受 pull request 编号或它在 GitHub 上的页面。
- `fx import` 能识别通过 HTTPS 或 SSH 从 github.com 克隆的 checkout，并以相应的克隆前缀为主机绑定代码托管 `github`。仍不会根据远程推测 GitHub Enterprise 服务器。
- 将 `wecom-calendar-cli` 加入工具目录并作为 `calendar` provider。它是你自己企业微信日历的本地镜像，可连同历史一起搜索。`fx can` 检查每位成员的登录状态，并把 `wecom-calendar-cli event list` 交给 Agent；是否用 `wecom-calendar-cli sync` 填充镜像由成员自己决定。
- 平台给出 CI 构建检出的提交时，按该提交判定构建。`fx release check` 认为成功构建了分支最新提交的构建通过，构建了其他提交的构建失败，不再比较构建开始时间与最新提交的写入时间。GitHub Actions 会给出提交，Jenkins 从 jenkins-cli 0.12.0 起给出；没有提交时仍按时间判定。CI 证据新增 `commit`。
- `github-actions` 的 ci 环境可以省略 `branch`。此时 `fx release check` 在每一侧计入正在检查的分支的运行。
- `init`、`sync`、`doctor` 的 JSON 报告摘要保留状态为 `untrusted`、`missing_variables`、`invalid` 或 `busy` 的 MCP、rules 和 hook 行。此前这些行只计入 `omitted`，而同一阶段的 `foreign` 或 `conflict` 行会显示出来。
- 配套工具查询、`sentry` 和 `git` 只有在可执行文件无法启动时才报告 `TOOL_MISSING`。工具已启动但自身以 127 退出时，现在如实报告为失败的查询或 Git 操作，不再要求安装一个已经装好的工具。
- `fx can mcp:<name>` 的 `--agent` 无法识别时，与 `fx agent pick`、`fx skill install` 一样提示 `"<id>" is not an agent fx knows`。`fx release check` 遇到未知仓库时采用其他仓库命令的说法，没有相近名称时列出已知名称，并在下一步中保留工作区。
- 错误里建议的命令会给需要引号的目录、工具或仓库名加上引号：`IMPORT_INSIDE_ROOT` 中被导入的目录、被暂缓安装的工具或准备其 Skill 时缺失的配套工具，以及 `PROBE_RECORD_INPUT_REQUIRED` 的仓库。带空格的路径可以原样粘贴执行。
- 以下场景给出的命令按配置的 `command_shell` 加引号：工作区 `relocate`、`rebind` 之后的命令，`fx init` 无法接受或继续的注册，工作区已变化的 profile 导入或源码贡献，未能记录的探测，目标位于被描述目录之内的 manifest 导入，以及 `--workspace` 指向未注册的名称。此前无论如何设置都按 POSIX 方式加引号。
- 读取 manifest 仓库或 `local-git` 代码托管时，git 与仓库同步一样在 C locale 下运行。在其他 locale 下，分支上不存在的文件曾被报告为查询失败，因为 git 的本地化消息无法识别。在这些场景中 git 无法启动时现在报告 `TOOL_MISSING`。
- `fx sync` 和 `fx init` 在结论之前按阶段各给一行结论：已更新、已是最新、已跳过和失败的仓库（带名称），manifest 刷新的结果，以及其他阶段报告的计数。在终端里，成功的行不再逐行打印而由状态行计数，结尾视图会重复的 `SYNC_PARTIAL` notice 也同样处理；`--verbose` 会打印它们，管道或 JSON 仍会收到全部记录。Git 调用期间的状态行在其他行持续输出时不再重复出现。
- 按解决方式分组 sync 和 init 的阻塞项：登录或凭据、被拒绝的访问，或本机连不上的服务器；后者现在给出重新检查的命令而不是 `fx login`，不响应的 Prometheus 服务器算作连不上。直接或间接等待其他阻塞项的检查列在其下方而不再单独计数，companion 的错误码跟在消息后面；companion 表示重试也无济于事的准备步骤不再建议 `fx doctor --fix`，而是显示 companion 自己的建议。准备检查新增 `cause` 和 `waits_on`。
- `fx login` 与 init 和 sync 一样，不询问、不占用终端地运行复用已有登录的内置步骤，带 `--no-input` 时也会运行。它失败时保留 companion 的消息和错误码而不是 `exit 3`，终端会在 `LOGIN_STEP_FAILED` notice 中显示 companion 的建议，companion 的 JSON 也不再打到终端；只有登录前才会询问。
- 人读的 `fx login` 表格下方只显示非零计数，不再显示空的 `problems`；重复这些计数的 `LOGIN_SUMMARY` notice 留给 JSON 和管道。通过的检查不再重复其命令，而是说明确认了什么，例如 `authenticated is true`。
- 拒绝记录中带有任意大小写的 `.git` 段或删除字符的 harness 路径与贡献路径。harness 所有权元数据此前接受 `.GIT/...`，在不区分大小写的卷上它会解析到仓库自身的目录；两个存储现在都按 `fx source push` 对所选文件使用的规则校验记录的路径。
- fx 安装在名称含空格或非 ASCII 字符的目录下，或在 Windows 上时，`fx self info` 的 `bundled_tools` 给出文件系统可用的路径。此前该值是经过百分号编码的 URL 路径。
- `fx init --resume` 继续一个没有记录 manifest 源的注册时保持其原样。此前继续执行会把 `source: "-"` 写入 `config.yaml`：之后 `fx sync` 把该工作区当作从 stdin 准备的工作区，不再提示没有可刷新的源，`fx init <dir> --from <source>` 则以 `SOURCE_MISMATCH` 拒绝该目录，而不是记录这个源。
- upstream 仍为空的仓库（例如在首次 push 之前用 `fx repo add` 登记的仓库）会被跳过，不再让整个 sync 失败。fx 在判定分支不存在之前会先询问远端：空的 upstream 是 outcome 为 `empty_remote` 的跳过，不影响就绪判定；有其他分支但没有被跟踪分支的 upstream 是 outcome 为 `no_remote_branch` 的跳过，仍然影响就绪判定，因为 manifest 可能写错了分支。尚无提交的本地分支会在 upstream 有提交后 fast-forward，处于这两种状态的 manifest checkout 都保持原样。
- `fx login` 登录某个环境后，立即让之前的环境跟上：该工具之前失败的步骤会重新检查，等待的步骤若其前置步骤现在通过则会执行，因此共享已保存登录的环境不会再在汇总里停留为 failed 或 blocked。不会有设置操作运行第二次；仍然失败的检查保持原结果，并在 `recheck` 中记录发现的内容。
- manifest checkout 的 sync 行不再总写 "refreshed"，而是说明实际结果：已刷新、已是最新，或带原因地保留；保留所在分支的提交已经在 upstream 时也会说明。
- 失败的检查在前缀之后以 JSON 对象给出原因时（例如 kubectl 的 `Error from server (Forbidden): {…}`），读取其中的原因，而不是原样引用整个对象。

## 0.11.0 (2026-10-12)

- manifest 设置 `go.workspace: true` 时，在工作区根目录维护 `go.work`。`fx init` 和 `fx sync` 会以这些模块要求的最新 `go` 版本，列出所有已选择且顶层有 `go.mod` 的 checkout，使每个模块基于同级仓库的 checkout 构建。尚未克隆的仓库不会列入，fx 只替换或删除自己写的 `go.work`，`fx sync --only go` 只刷新这个文件。在这样的工作区中，`go.work` 与 `go.work.sum` 不再算作多余的根目录条目。
- 工作区可以绑定 GitHub。代码托管 provider `github` 和 ci provider `github-actions` 都通过 GitHub CLI `gh` 工作；`gh` 加入工具目录，两者在每个主机上共用一次登录。`fx release check` 像对 Bitbucket 和 Jenkins 一样，从 GitHub 读取分支、提交、文件以及某个分支最近一次 workflow 运行；ci 环境可以把计入的运行限定为一个分支和一种触发方式。在 GitHub 上暂时还不能通过 fx 创建 pull request。
- 将 `fx release` 改名为 `fx release check`，让名字表明它检查发布而不是执行发布。`fx release` 作为兼容名称继续可用。
- 说明每次发布将交付的内容。`fx release check` 在每个仓库开头列出目标分支声明的版本、两个分支的最新提交，以及源分支上尚未合并到目标分支的提交数和作者人数；全部检查都通过的仓库也在最后各用一行说明同样的内容。JSON 报告新增包含这些信息的 `repos[]`，摘要中也有；已有字段不变。
- CI 结论注明它对照的提交，合并检查改为“未合并到 main”和“未合并回 dev”，CI 和错误消息使用各平台自己的作业或项目名称。CI 证据新增 `head`。
- 按 manifest 模式的说明，在发布报告中显示仓库的 `release.note`。
- 源 AGENTS.md 中指向 manifest 源内文件的相对链接（例如 `CONTRIBUTING.md`），在派生到工作区根目录的指南中全部解析为源文件路径。此前只解析指向 `README.md`、`docs/` 和 `skills/` 的链接，其余链接会指向根目录中不存在的文件。
- 当所有仓库都写明 `upstream` 时，`fx manifest lint` 不再要求声明代码托管 provider，因为这样的工作区不会用到代码托管。
- Windows 通过批处理文件（npm、Scoop、Chocolatey 安装的 `.cmd`）启动配套 CLI 时，所有参数都原样传入。cmd.exe 不再解释参数中的 `&`、`|`、`%`、`^` 等字符。
- 以 Windows 路径给出的本地 Git 远程（如 `C:\host\fx\api.git`）会被读取为项目和名称，因此导入、接管、派生和 `fx source push` 都能使用它。在 stdin 包和源贡献中，manifest 文档在所有平台上都以正斜杠命名，导入写入的仓库路径也使用正斜杠。
- PowerShell hook 不再把任务结果写入 Agent 的上下文，不再把带字节顺序标记的输入交给 fx，也不再把进度记录写到 stderr。
- 在 Windows 上派生的指南中，指向源文件的链接也使用正斜杠。`fx self info` 将内置工具目录显示为文件路径，安装路径包含空格时也是如此。

## 0.10.1 (2026-10-12)

- 在 npmjs 发布公开包 `@angelmsger/fx`，并为每个版本标签在 GitHub Release 附上 tarball。内部的 `@fx/devkit` 渠道保持不变。
- `fx release` 的 human 输出按仓库分组。每个有失败或警告检查的仓库单独列一块，列出它的全部检查；所有仓库共有的问题（例如没有人登录的工具）连同解决它的命令只在它们上方说明一次；全部检查都通过的仓库合并在最后一行。`--details` 也会列出这些仓库的检查。JSON 和 NDJSON 输出保持不变。

## 0.10.0 (2026-10-10)

- 不带目标的 `fx can` 列出当前工作区可以查询的能力：manifest 可绑定的每个能力一行，环境级能力按平台实例各一行，包含作用域、provider、配套工具和用途。未绑定的能力保留一行，provider 为空。该列表只读取绑定；查询单个能力时仍会检查就绪状态。
- 说明就绪检查失败时得到的回答。`can`、`where`、`doctor`、`login` 的 handoff 中，每个待处理步骤现在带有 `check`：工具自己的说法，或该步骤正在等待的另一步骤。fx 能读懂失败原因时还会给出成因，步骤的说明随之改为针对该成因的处理办法。
- 区分集群未能建立认证、集群回答“否”和集群无法连通三种情况。集群没有把请求认作任何人的请求时，步骤现在指向 kubeconfig 及其登录方式，并给出获取新 kubeconfig 的页面，不再要求向集群负责人申请角色。
- 不连接集群即可核对 kubeconfig 是否包含声明的 context；集群访问检查的每个请求限时五秒。
- 检查没有得到回答时（工具没能启动，或超时），`can` 与 `where` 返回 `unknown`，并把该检查列在 `unfinished` 中。`where` 不再因为一个平台没有应答而让同一仓库的所有平台一起失败。工具没能启动时，`doctor` 与 `login` 报告缺少该工具，不再把步骤交给人处理。
- 环境未覆盖某个平台时，原因统一为 `<env> declares no <platform> platform`。环境备注可能说的是另一个平台，不再充当这个原因。
- `fx login` 不再询问你平时使用哪些环境。个人环境范围只由 `fx env select` 设置：未设置时所有已声明的环境都在范围内，未用 `--env` 指定环境的登录会说明这一点以及如何收窄。此前即使用 `--env` 指定了环境也会被问；回答“全部”的人每次登录都会再被问；只按手头这一次要登录的环境作答，则会收窄此后 `fx doctor` 与 `fx sync` 覆盖的范围。
- `fx can` 遇到无法识别的目标时，不再提示由 fx 自身接管的内部能力，下一步改为指向 `fx can` 和 `fx tool list`。

## 0.9.1 (2026-10-09)

- `init`、`sync`、`doctor` 未完成时的终端输出把原因相同、解决命令也相同的检查合并成一行，并把没能执行的检查与执行后失败的检查用不同标记区分开。
- 没能完成的检查不再要求登录。配套工具的检查超时后只提示重新检查。
- 直接引用内置配套工具给出的未就绪原因，例如 `OpenObserve returned HTTP 401`，或对无需登录的服务请求失败，不再只显示 `expected authenticated to be true`。
- 对 fx 自己能更新的 Skill 副本给出 `fx doctor --fix`。
- 配套工具的 context 只要能访问声明的服务，无论其所有者用哪种方式登录都被接受。`service` 声明里的 `auth_scheme` 现在只决定 fx 如何新建 context 以及 `fx login` 提供哪种登录方式；准备、检查和查询只核对声明的 URL、flavor 和组织，不再传递 `--auth-scheme`。已有的 context 缺少其中某个字段时只补上该字段，不再带上声明的登录方式；此前这会与用其他方式登录的 context 冲突。
- 每次显式执行 `fx sync` 都会关联你已有的登录，不再只在 `fx init` 时做。sync 现在和 init 一样执行本地的 prepare 阶段设置步骤，可沿用的登录不必再等人运行 `fx doctor --fix`；个人登录仍由本人完成，后台 hook 只检查。
- 在 fx 知道含义的地方直接说明配套工具检查未通过意味着什么：`fx doctor --fix` 可以关联的已有登录显示 `an existing login can be reused`；企业微信的三项检查统一按响应里的错误码判断，未通过时显示 `the WeCom API returned an error`。

## 0.9.0 (2026-10-09)

- 工作区根目录只派生 `AGENTS.md`。fx 不再写入指向它的 `CLAUDE.md`，`fx manifest render` 也不再在 manifest 仓库中创建该文件：Claude Code 2.1.277 及以上版本会自行读取 `AGENTS.md`，而只要存在 `CLAUDE.md` 就会改读后者。`fx sync` 会移除早期版本派生的指针文件；在移除之前，`fx doctor` 报告指南已过期。你自己写的 `CLAUDE.md` 保持原样，也不再算作指南冲突；请在其开头写上 `@AGENTS.md`，这样 Claude Code 仍会读取指南。如果 manifest 仓库里还留有这个指针文件，请将其删除。
- manifest 源的载荷不再包含 `CLAUDE.md`。目录源中的该文件不再被复制到受管理的源，stdin 包里若列出它，会以 `MANIFEST_SOURCE_INVALID` 拒绝。
- 命令执行期间显示它仍在工作。超过半秒后，终端上出现一行原地刷新的状态行：已用时间、可计数工作的进度，以及进行时间最长的那一项，例如 `doctor 23s  checks 69/82  kubectl.access@dev 3s`。所有命令都有这一行，因为 fx 等待的每个外部调用都在发起处上报；`doctor`、`sync`、`init`、`status`、`release` 和 `login` 还会统计各自的检查项、仓库和步骤。结果、通知和各项结局写在状态行上方，提问或登录命令在完成前独占终端，命令结束或被中断后状态行消失。git 或安装器运行期间可能在同一终端上询问主机密钥或口令，这时不在它下面重绘，状态行改为每五秒打印一行。在显示状态行的终端上不再打印逐项的 `start` 行和仓库心跳，因为状态行给出同样的信息。管道、文件、CI、`TERM=dumb`、`--quiet` 以及 JSON 或 NDJSON 输出都不会收到状态行，读到的内容与此前完全一致。

## 0.8.0 (2026-10-09)

- fx 为内置工具定义的命令不再询问信任，包括由 manifest `service` 声明填入参数的服务准备、登录复用和凭据检查。只有团队 `tools.yaml` 补丁编写的命令向量仍需确认；已保存的凭据可以发往哪里由配套工具自己决定。
- 重排 `init`、`sync`、`doctor` 未完成时的终端输出：每个阻塞项带上检查项 ID，登录命令按工具合并各环境，PATH 上能找到 `fx` 时命令写作 `fx`，终端上不再在输出之后追加 `PREPARATION_INCOMPLETE` 错误信封。JSON 输出不变。
- 配套工具的 Skill 安装进度按工具报告一次，不再每个 Agent 目录报告一次。
- 团队编写的配套工具 Skill 命令只需确认一次。fx 追加的 Agent 名称或目录不再让每个目标成为一条单独待确认的向量，已有的确认继续有效。
- 配套工具检查失败时用工具自己的话说明原因：读取它输出的错误对象里的消息，略过日志记录和警告，保留失败位置之后的那一行，并写出 JSON 检查期望的值，例如 `expected authenticated to be true`。
- 让 human 输出在终端上更易读：标题、状态词和为零的计数用颜色区分，检查清单和进度带状态符号，需要输入的命令单独突出，表格按终端宽度收窄，阻塞项的长原因在自己那一列下折行，错误以带提示、后续步骤和交接事项的文本显示，不再是 JSON 信封。只有终端才带装饰，stdout 与 stderr 各自判断：无论环境变量如何设置，管道、文件和 CI 得到的都是纯文本和 JSON 错误信封，JSON 与 NDJSON 输出不变。`NO_COLOR` 去掉颜色，保留符号。
- human 表格按终端列宽对齐，含中日韩文字的行不再错位；列表与其尾部信息之间空一行；缺省值之后不再留行尾空格；记录中的列表只要有一项过长就改为每个字段一行，并省略空字段。
- 根帮助在终端上重新把常用命令的标题显示为 `EVERYDAY`，`FIRST WORKSPACE`、`AGENT USAGE` 和 `COMPATIBILITY` 标题与其他标题一样加粗。

## 0.7.1 (2026-10-09)

- `fx repo show` 返回 `next_steps`，用于选中并同步尚未下载到本机的共享仓库；生成的仓库索引同时说明目录包含这类仓库。
- 准备流程的终端输出把每条个人登录命令只打印一次，随后给出继续执行的命令。
- manifest 使用显式 Git URL 且未绑定代码托管时，同步仓库不再需要代码托管用户名，也不再提示缺少它。
- 内置的 Sentry 工具改为通过 npm（`sentry`）安装。

## 0.7.0 (2026-10-08)

- 把 `.workbench/` 定为不属于任何仓库的产物的落点。派生指南新增 `workspace-layout` 区域说明规则；`fx doctor` 在 `root` 组报告根目录下没有归属的条目；`fx status` 以 `stray_entries` 返回它们；会话启动上下文带出最近一次观测。fx 不会写入工作台。

## 0.6.0 (2026-10-08)

- `metrics` 能力有了实现：新增 `prometheus-cli` provider，并把该配套工具加入内置目录。服务的坐标是它的抓取 job；`where` 输出指向所声明服务的 `up{job="..."}` 查询，且不提供探测，因为匹配不到任何序列的选择器同样会成功。
- service 声明的 `auth_scheme` 接受 `none` 与 `bearer`。声明为无需登录的服务以是否应答判定就绪，不会被要求登录。
- 新增工作区能力 `meeting`，指承载在线会议、录制与纪要的会议系统；提供由 `tmeet` 驱动的 `tencent-meeting` provider，`tmeet` 已加入内置目录。`calendar` 保留日程与忙闲。

## 0.5.0 (2026-09-24)

- 在请求个人授权前，将已验证的配套 CLI 登录复用到统一团队 context；保留原生准备错误和验证细节。配套 CLI 的最低版本要求已更新，需要支持 auth reuse。

## 0.4.0 (2026-09-21)

- 已移除 Skill 加载握手及 `skill_notice` 配置。`FX_SKILL_LOADED`、`FX_SKILL_VERSION`、`FX_SKILL_NOTICE` 不再使用；请改读安装版本和 `activation`，不要再读取 loaded/version_verified。
- 初始化自动完成已授权的本地准备，并集中交接个人认证；新增 `init --resume`，保留已完成工作。
- 统一 `preparation.state` 与具体恢复动作；准备未完成退出 12，可选宿主激活单独报告。
- 写入前阻断非法 manifest 条目；自动补齐目标指南并保留共享源。工具 schema 升为 3，run 步骤声明 prepare/authenticate。
- 自更新与版本查询自动复用 npm 的 scope/默认 Registry 和认证配置，`FX_REGISTRY` 改为可选覆盖；自更新保留公共依赖的默认路由。

## 0.3.0 (2026-09-20)

- 保留登录人工接手及异常后的部分结果、汇总和结构化恢复信息；非零退出也可能返回有效 stdout。
- 保护 manifest 与指南写入期间的并发编辑；获准替换时原子移动原对象到备份，文档失败保留逐文件结果。
- 明确初始化和同步的整体准备结论，修复名称或说明被误判为阶段失败的问题。
- 保证自更新安装器输出不污染 JSON，补充恢复流程与源码/已发布功能的区别。

- 新增 `calendar`、`task`、`worklog`、`metrics` 四个能力：前两个有飞书与企业微信 provider，工时有 Jira provider；`metrics` 只命名未实现，manifest 可以描述它，绑定则要等 provider。`im` 的含义收窄为纯消息。
- 新增 Jira 工作项 provider 与飞书知识库 provider，这两个能力各有了第二种实现；一个配套 CLI 服务多个能力时仍只安装和检查一次。
- workspace 的工具链改为从其绑定的 provider 推导，内置工具不必再声明一遍；`tool list` 说明每个工具是被绑定带进来的还是 manifest 声明的，`--catalog` 列出其余的。
- manifest 声明了同名工具时，能力可以绑定 fx 未实现的 provider；仅与内置工具重名的 provider id 会被指出更正，而不是照单全收。
- tools 文档的 `defaults` 块支持 `install_on_init`，单个条目仍可覆盖。
- 能力已绑定 provider、但工具文档未声明该 provider 所用配套工具时报告 `TOOL_UNDECLARED`，不再误称该能力没有 provider。
- platform 的 `service` 按其名称推导出的 provider 校验：合法声明不再被误报，此前被跳过的真实问题也会报出。
- 预先记录 session-start 后台运行承诺执行的阶段，worker 被终止时未执行到的阶段留下 `HOOK_PHASE_UNREPORTED`，不再直接消失。
- session-start 后台运行中某条伴随命令用尽预算时不再终止整个运行，其后的每个阶段照常给出结论；宿主正在等待的前台运行仍在该处结束。
- 分离的后台运行如何结束，记录为 workspace 的 `run` 观测，此前其 supervisor 只能写进无人读取的流。

- 修复所有格式的报告字段投影、恢复命令的 workspace 上下文和贡献锁内的来源身份校验。
- 支持经验证的本地 Git 导入与匹配 upstream 的安全补充，按启用和必需工具声明统一准备状态。
- 接受各类声明的 setup 验证形式，并在 manifest 合并时保留可空比较值。

- 增加全局工作区发现、健康诊断、解除托管、重定位与换源；保留业务 checkout，阻止同目录重复身份。
- 增加 repo/env select 的固定、动态全部和空集合模式；首次 init 可先选择仓库，本地来源预览显示实际计划。
- 修复未跟踪文件在状态筛选中被遗漏、必需 manifest 缺失却验证通过，以及旧可读性缓存阻断正常恢复。
- doctor 默认按实际声明和活跃 provider 检查工具，保留显式工具检查。
- 兼容性说明：init 的 registered 现在表示实际注册状态；预览动作另列于 plan。config import 按名称合并并保留未提到的注册，不再用省略名称来取消托管。

- 兼容性说明：`fx skill show` 在 bundled Skill 缺失时返回 `BUNDLED_SKILL_MISSING`；`SKILL_MISSING` 仅表示面向 Agent 的通知。

## 0.2.1 (2026-09-18)

- 精简仓库入口与 bundled Skill，详细恢复步骤集中到命令参考。
- 同步四语言的报告、就绪、Skill 加载与服务版本说明，使其符合当前行为。
- 修正站点发布状态与预览示例，补充公共依赖的 Registry scope 分流说明。

## 0.2.0 (2026-09-17)

- 破坏性变更：四类工作流报告默认精简 JSON，完整数据使用 `--details`，显式 `--fields` 仍从完整结果投影。
- 修复显式空 Agent 选择；增加 `FX_SKILL_VERSION` 核对和 `bundled_skill_version`。
- 增加 `operation`、`preparation_complete` 与 `SKILL_WRITE_DENIED`，保留部分结果和具体恢复步骤。

- 新增独立的伴生 Skill install、uninstall、path、status 和 show 命令。
- 在工作区指南生成团队 Skill 的触发说明和源文件链接。
- 区分显式刷新与自动维护，并保护团队共享源。

- 初始化与显式同步支持公共服务预设、明确选定服务的个人登录和原生冲突恢复。
- 拒绝共享 service 中的个人凭证，保留既有配套工具配置。

- 跨已注册工作区记录工具安装历史与来源，仅提示不再需要的 fx 安装包，不自动卸载。
- 帮助与补全优先展示标准资源命令，保留兼容别名。

## 0.1.2

已在内部 Registry 提供；公共发布仍暂停。

- 修复显式输入、就绪状态、Git 源恢复和配置并发更新。
- 保留初始化部分结果，精简终端输出并报告仓库进度。
- 隔离等待授权的 Skill 命令，保护用户共享副本，明确宿主激活限制。
- 为可选代码托管探测设置期限，在保留取消语义的同时报告预检查进度。
- 支持工作区根目录的路径别名，中断后保留逐项安装结果和资源状态。

## 0.1.1

已在内部 Registry 发布, 公共发布仍暂停. Git tag、包发布和本机安装是独立状态.

`fx-devkit` / `fx`; Apache-2.0. `@fx/devkit` / `@angelmsger/fx`.

- `install_on_init` (fx ≥0.1.1).
- 声明驱动的工作区初始化、同步和仓库选择.
- 结构化配置、发现、就绪与发布报告.
- 配套工具、Agent Skill、生命周期 hook 和 MCP 投影.
- 保留信任、所有权和恢复边界的源码贡献计划.
- 已实现 Windows 适配器; 原生执行与宿主激活仍未验证.
