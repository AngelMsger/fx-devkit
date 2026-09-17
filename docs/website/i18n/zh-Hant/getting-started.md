# 使用 fx

安裝 fx，連接團隊 manifest，並管理儲存庫、工具與編碼 Agent。

## 環境需求 {#requirements}

- Node.js ≥22；開發版本以 package.json 為準。Bun 也可以作為執行環境。
- Git 位於 PATH 中。全域安裝和 `fx self update` 仍需要 npm，包括使用 Bun 時。
- 團隊提供的 manifest，或[自行建立的 manifest](manifest-guide.md)。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行和 Agent 宿主啟用尚未完成驗證；目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。請參閱 [Windows 支援範圍](support.md#platform-support)。

## 安裝 {#install}

<!-- distribution:internal -->

fx 透過團隊的私有 Registry 分發，暫不推進公開發佈。請向團隊取得 Registry 位址和 npm 存取權限，並設定 `FX_REGISTRY`。以下 URL 為虛構範例，安裝前需確認 Registry 已提供該套件。

```sh
export FX_REGISTRY=https://npm.example.com/
npm login --registry="$FX_REGISTRY"
npm install -g @fx/devkit --registry="$FX_REGISTRY" --@fx:registry="$FX_REGISTRY"
fx --version
```

<!-- /distribution -->

<!-- distribution:public -->

### 公開套件

對外分發使用 npmjs 上的 `@angelmsger/fx`，不需團隊私有 Registry。目前公開發佈暫緩，請於目標版本提供後執行。

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

<!-- /distribution -->

也可以從原始碼執行：

```sh
npm ci
npm run build
node bin/fx.js --help
node bin/fx.js --version
```

執行後續範例時，將 `fx` 替換為 `node /absolute/path/to/fx-devkit/bin/fx.js`。啟動器讀取 `dist/`，因此必須先建置。

PowerShell 執行原則阻止 `.ps1` shim 時，可使用 `npm.cmd` 和 `fx.cmd`，不必變更原則。

### 更新

原始碼安裝可透過 Git 更新 checkout，再執行 `npm ci` 和 `npm run build`。使用 `fx self info --format json` 查看目前版本與套件更新來源。請參閱[更新說明](support.md#updates)。

## 快速上手 {#quick-start}

先將預留位置替換為團隊提供的實際來源：

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` 會先在命令信任確認後安裝 manifest 中明確標記 `install_on_init` 的缺少工具，再同步儲存庫和所選 Agent 資源。既有工具安裝會保留。

`init` 會同時同步儲存庫和所選 Agent 資源。註冊成功不代表所有同步階段成功，請檢查失敗項目，並在解決權限或設定問題後重試相關階段。

既有目錄會自動納入管理，`--adopt` 僅為相容性保留。對不熟悉的工作區，先使用 `--dry-run` 查看計畫。

```sh
fx sync --dry-run
fx sync
fx status
fx repo list
fx where <repo> --env <environment>
fx can <capability> --env <environment>
```

`where` 輸出座標和命令，但不會執行這些命令。`can` 和 `doctor` 檢查目前的就緒狀態。缺少設定、驗證或權限時，依 handoff 處理。報告產生成功不等於準備完成：同時閱讀 `ok`、`complete` 和各項結果。

使用 `repo pick/unpick`、`env pick/unpick` 限定本機關注範圍。`fx config set agents claude-code,codex` 選擇 Agent；未設定時自動偵測。`fx sync --only docs,skills` 只更新對應資源。

## 核心概念 {#concepts}

### 工作區和 manifest {#the-workspace-and-the-manifest}

工作區是已註冊的普通目錄，包含獨立 checkout 和受管理的 Agent 資源。manifest 來源位於 `~/.fx/workspaces/<name>/source`，fx 不會在受管理的工作區根目錄執行 Git。同步不會透過切換分支、reset 或 stash 覆蓋未提交變更、分歧狀態或其他分支上的工作。

workspace、environments、tools 和 members 文件儲存共用資訊；選用的 harness 文件描述 MCP 和規則。使用以下命令查看欄位：

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 個人設定

全域設定記錄工作區和偏好。Agent 選擇在同一 FX_HOME 註冊的工作區間共用；儲存庫與環境選擇屬於各自工作區。`repo add` 登記本機參照，`repo remove` 僅移除參照並保留檔案。設定匯出不會複製憑證、信任記錄或 manifest checkout。

### 能力、提供者與配套工具

capability 表示程式碼託管、CI、日誌、錯誤追蹤等意圖，provider 透過配套 CLI 實作。manifest 繫結能力、提供者和環境座標。`can` 查詢就緒狀態，`where` 查詢座標，`release` 查詢宣告的發佈檢查項目。

`tool list/show` 顯示工具需求，`tool install/update` 使用宣告的安裝程式，`login` 引導設定。驗證由各工具負責。manifest 提供的執行向量需要信任；向量改變後需要重新確認。口頭確認手動步驟不能取代驗證成功。

工具定義由內建基線與所選工作區的 `tools.yaml` 合併。工作區優先順序為 `--workspace`、`FX_WORKSPACE`、目前目錄所屬的已註冊工作區、`default_workspace`；無法確定工作區時僅使用內建基線。套件管理器決定安裝位置，工具由多個工作區共用。

`tool install` 和 `tool update` 必須指定名稱或 `--all`，兩者互斥。安裝的 `--all` 補齊已啟用且 PATH 缺少的工具；更新的 `--all` 選擇目前工具表中全部已啟用工具。明確名稱可以選擇已停用的工具。無參數呼叫會在執行套件操作前報錯。

### 工具安裝歷史 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install` 和 `tool update` 將嘗試儲存至 `$FX_HOME/tool-history.json`（預設 `~/.fx/tool-history.json`）。每次嘗試包含 `started`、可選的 `installed` 和 `finished` 檢查點，記錄工作區、套件管理器與套件名稱、遮蔽敏感資訊的命令、結束代碼、版本及操作前後的程式路徑。`installed` 表示套件管理器成功結束，即使之後版本驗證失敗；單獨的 `started` 不代表執行成功。dry-run、手動安裝說明及 init 跳過的既有工具不產生紀錄。歷史屬於本機操作證據，不隨設定匯出。

`tool inventory` 的 `installation_origin` 與 `tool list/show` 顯示的工具定義來源各自表達不同事實：

| installation_origin | 證據                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `fx`                | fx 成功安裝先前不存在的程式，目前路徑仍與紀錄相符。                      |
| `external`          | 已知程式在 fx 安裝紀錄之外已經存在；之後由 fx 更新或重裝，仍保留此來源。 |
| `unknown`           | 舊紀錄、未完成操作或變更／缺少的路徑無法確認目前來源。                   |

`external` 不識別實際安裝者，可能是使用者或其他管理器。PATH 觀察不能證明歷史所有權，也不能辨識外部在同一路徑替換程式。v1 歷史仍可讀取，新操作寫入 v2；舊紀錄缺少的來源證據保持未知。新版紀錄不保證可由舊版 fx 讀取。

清單包含內建定義、已註冊工作區本機 manifest 中的已知工具，以及定義移除後保留在歷史中的套件。沒有紀錄的 PATH 程式顯示 `recorded: false`；套件管理器、套件名稱、版本及操作欄位為 null，不進行猜測。查詢不會補寫安裝憑據或接管既有程式。

依賴檢查涵蓋同一 FX_HOME 下**全部已註冊工作區**，包括啟用的選用工具與內建預設項。任何工作區需要相同程式或套件管理器／套件時維持 `required`。停用內建工具使用 `enabled: false`，刪除覆寫項會恢復預設值。只有來源為 `fx`、執行證據完整、程式路徑相符且所有工作區都不再需要的安裝，才可成為 `unused`。外部工具和未知來源不會收到解除安裝建議。`sync` 輸出 `TOOL_UNUSED` 與 `stage_details.tools.installations`，`doctor` 增加提示；兩者均不執行解除安裝。

無法讀取或含隔離項目的 manifest、執行證據不完整時為 `unknown`；從未成功的嘗試為 `unverified`。程式缺少為 `not_on_path`，路徑變更為 `changed`，有工作區外操作紀錄時為 `unscoped`。這些狀態不建議解除安裝。檢查只讀取本機 manifest，不更新遠端；其他 FX_HOME 和未註冊專案不在依賴涵蓋範圍內。無效歷史檔案會在執行前阻止新的套件操作，應保留並修復後重試。

### fx 伴生 Skill 與團隊 Skill

fx 伴生 Skill 引導 Agent 使用 CLI、初始化工作區及恢復就緒狀態。初始化前即可執行：

```sh
fx skill install
fx skill install --agent codex
fx skill status
fx skill path
fx skill show
```

`install/uninstall` 預設偵測所選作用域的 Agent；`--agent` 可重複或以逗號分隔。`path/status` 預設列出全部支援的 Agent。`--project` 使用目前目錄，`--dir ./custom-skills` 安裝至 `<dir>/fx-workspace`，且與 `--agent`、`--project` 互斥。無需註冊工作區或登入服務。獨立安裝不使用工作區 Agent 選擇；專案偵測使用原生標記，使用者層級偵測也識別 PATH 中的 Agent 程式。

明確執行 `skill install` 會將已識別副本更新為目前 CLI 版本，包括同版修復及覆寫較新副本；`init/sync` 則重用同版且不降級。取代外來路徑需確認及備份。寫入支援 `--dry-run` 與唯讀限制。`skill uninstall` 確認後移除已識別副本，非互動環境使用 `--yes`；外來路徑保留。解除安裝不修改工作區選擇，後續同步可能重新安裝所選宿主的使用者層級副本。

`status` 分別報告安裝狀態、版本一致性與 `FX_SKILL_LOADED=1` 載入握手。安裝成功不等於 Agent 已載入。`path` 查詢安裝目標，`self info` 提供套件內來源路徑。`show` 在所有輸出格式下均輸出 SKILL.md 原文。Skill 命令僅執行本地操作，不檢查線上更新、不重新整理 manifest、不呼叫配套安裝器或登入探測。非 TTY 業務命令在未載入 Skill 時向 stderr 輸出結構化探索提示；setup 與 Skill 命令保持安靜。`FX_SKILL_NOTICE=0` 可關閉提示。

團隊 Skill 存放於 manifest 的 `skills/`，由 `init/sync` 連結至所選 Agent 的 Project Skill 目錄，Windows 使用 junction。工作區根 AGENTS.md 另列出每個 Skill 的觸發說明與來源連結，供 Agent 按任務讀取。請從工作區根啟動 Agent；不保證子儲存庫內啟動時可探索。`agent skills` 檢查工作區分發，`sync --only docs,skills` 更新指南與 Skill。不要經團隊共享連結安裝 fx 伴生 Skill；CLI 會回傳 `SKILL_SOURCE_PROTECTED`。請使用使用者層級安裝或獨立目錄。

harness 向所選宿主投射 MCP 項目和規則參照，機密值保持為環境變數參照。`mcp list/show` 和 `can mcp:<name>` 說明先決條件；設定正確不代表宿主已啟用。請參閱 [MCP 契約](user-guide.md#for-coding-agents)。

工作區啟動掛鉤可以傳回快取上下文，並在背景更新 manifest、文件和 Skill；不會同步業務儲存庫或確認信任。宿主仍控制專案與掛鉤的信任。使用 `hook list/enable/disable` 管理，請參閱[生命週期契約](user-guide.md#for-coding-agents)。

### 貢獻共用知識

`source push` 可預覽或提交所選來源檔案，保留來源 checkout 的 HEAD、索引和工作檔案。提交需要個人 fork 及其上游關係的證據。實際提交前閱讀 `fx source push --help` 與[貢獻契約](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

`agent skills` 檢查工作區 Skill 分發；`skill install/show/path/status/uninstall` 獨立管理內建伴生 Skill。`manifest repo-set` 修改倉庫欄位，`manifest record-probe <repo> --env <env> --platform <platform>` 寫回已驗證的座標證據，`--dry-run` 僅產生計畫且不探測。`where` 用於查詢。相容入口 `skill list`、`tool installed`、`hook inject/remove`、`manifest set` 和 `where --probe --record` 繼續可用。

集合參數（如 `--only`、可重複的 `--env` 和 `--agent`）支援重複傳入或逗號分隔。Agent 選擇跨工作區，結果包含 `scope: global` 與 `affected_workspaces`；倉庫／環境選擇回傳 `scope: workspace` 與 `workspace`。清單及歷史涵蓋整個 FX_HOME，即使傳入 `--workspace` 也相同。補全辨識參數值、位置參數和否定選項，升級後需重新產生補全指令碼。根說明接受全局參數；說明、補全、`skill show` 和 `manifest schema` 保持原生文字／檔案格式。

| 意圖                   | 命令                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 建立、同步和檢查工作區 | `init`、`sync`、`status`                                                                             |
| 設定存取並檢查就緒     | `login`、`doctor`、`can`                                                                             |
| 查詢環境座標與發佈證據 | `where`、`release`                                                                                   |
| 管理儲存庫             | `repo list/show/pick/unpick/add/remove/fork/open`                                                    |
| 管理環境與 Agent       | `env list/show/pick/unpick`、`agent list/pick/unpick`                                                |
| 管理工具和 Skill       | `tool list/show/install/update/history/inventory`、`agent skills`                                    |
| 管理共用來源           | `manifest validate/lint/explain/schema/providers/repo-set/record-probe/render/import`、`source push` |
| 查詢成員與設定         | `member list/show`、`config list/get/set/unset/export/import`                                        |
| 檢查宿主資源           | `hook list/enable/disable`、`mcp list/show`                                                          |
| CLI 資訊與更新         | `self info/update`、`completion`                                                                     |

完整語法以 `--help` 和[自動產生的 CLI 參考](cli/README.md)為準。

## 給編碼 Agent {#for-coding-agents}

使用 `--format json` 或 `FX_FORMAT=json`。stdout 只包含資料；通知、進度和錯誤寫入 stderr。集合格式為 `{items, has_more, next?}`，缺少或未知的值會明確表示。

`--fields` 可選取欄位，`--quiet` 抑制通知，`--no-input` 禁止等待輸入。寫入命令支援 `--dry-run` 和唯讀模式；`--allow-writes` 是單次呼叫的明確覆寫。

doctor/release 即使有失敗檢查也傳回結束代碼零；init/sync 也可能在部分成功時傳回零。init 查看 `sync.summary`、`sync.stages`；sync 查看 `summary`、`stages` 和每個失敗項目的 `failure`。`stage_details` 保留資源階段結果和 handoff。不要把結束代碼當作就緒證據，不要虛構驗證或繞過宿主信任。

先讀[內建 Skill](../skills/fx-workspace/SKILL.md)和[回應指南](../skills/fx-workspace/references/commands.md)，再設定 `FX_SKILL_LOADED=1`。`self info` 定位套件內來源，`skill path` 查詢安裝目標。

## 設定 {#configuration}

`~/.fx` 儲存工作區註冊、個人層、資源擁有權狀態、信任和快取。`FX_HOME` 只改變 fx 的個人目錄，不改變配套工具的憑證位置。

`config list` 顯示設定鍵、預設值、環境變數名稱及實際來源；`config get <key> --explain` 顯示各層。優先順序為明確參數、環境變數、設定檔、內建預設值。使用 `config export/import` 遷移個人設定。

`format` 控制輸出。`command_shell` 只控制產生命令的文字，不改變執行方式；auto 在 Windows 選擇 PowerShell，其他平台選擇 POSIX。可使用 `--command-shell`、`FX_COMMAND_SHELL` 或 cmd 設定覆寫。manifest 中的 shell 範本保持原樣。

自動補齊支援 bash、zsh、fish 和 PowerShell，透過 `fx completion <shell>` 產生，依需求自行載入。

## 整合 {#integrations}

manifest 選擇工作區使用的 provider 和配套 CLI。目前實作包括：

| 能力           | 提供者                              |
| -------------- | ----------------------------------- |
| 程式碼託管     | Bitbucket CLI、本機 bare Git 儲存庫 |
| CI             | Jenkins CLI                         |
| 日誌           | OpenObserve CLI                     |
| 錯誤追蹤       | Sentry CLI                          |
| 叢集探索       | kubectl，唯讀查詢向量               |
| 工作項目與知識 | 飛書專案、Confluence CLI            |
| 通訊入口       | Lark CLI、WeCom CLI                 |

使用 `fx manifest providers` 與 `fx tool list` 查看實際繫結。通訊和知識入口交接給配套工具，不代表 fx 代理了所有服務 API。

Agent 探索包括 Claude Code、Codex CLI、Cursor 等已註冊宿主。Skill、hook、MCP 與規則的支援因宿主而異；使用 `agent list`、`hook list`、`mcp list` 檢查具體能力。請參閱[宿主契約](user-guide.md#for-coding-agents)。

## 判讀初始化與復原結果

位置參數僅來自 argv; 只有明確要求時才讀取 stdin, 例如 `init --from -`. 將多詞命令整體加引號會傳回用法錯誤. Git 複製使用獨立的 Git 憑證, 不強制依賴程式碼託管 API CLI. Git 錯誤區分分支不存在、傳輸驗證、網路與本機衝突, 復原命令保留分支和目標目錄.

來源驗證並註冊後, `INIT_PREPARED` 會在執行工具和複製前顯示安裝命令及 Skill 目標位置. 安裝缺少工具後可能產生額外 Skill 命令, 仍須逐條通過精確信任檢查. 新遠端來源的 `init --dry-run` 不擷取來源, 也不宣稱已知其內容. 取代外來檔案始終需要核准與備份.

後續初始化階段擲出例外時, stdout 保留含 `failed_phase`、`phases`、結構化 `failure`、已完成儲存庫結果和復原步驟的部分結果. 失敗結果中的階段狀態為 `done`、`failed` 或 `not_started`; 成功的同步階段仍使用原有統計計數. stderr 保留原錯誤, 結束代碼非零. 未信任的 Skill 命令單獨標記為 blocked (`tools_blocked`), 獨立的自有本機投影仍可完成. 即使結束代碼為零也應查看 blocked 和 failed 列.

儲存庫操作期間每五秒在 stderr 報告完成數/總數、目前儲存庫和經過時間. 這是心跳, 不是 Git 位元組進度或預計完成時間. 人類輸出彙總未選擇儲存庫和較大清單; `--verbose` 顯示未選擇列, `--format json` 保留完整詳情. `FIELDS_UNMATCHED` 表示要求欄位未出現在本次結果中, 也可能是選用欄位; 投影繼續寬鬆處理, 空集合不會產生此提示.

就緒結果區分 `missing_tool`、`outdated_tool` 與 `disabled_tool`. Doctor 工具證據提供 `binary_path`, 與執行使用相同的 PATH 解析規則, 可能指向執行階段管理器的 shim. 狀態程序成功但 `configured=false` 不代表就緒; 設定完整也不證明資源權限或遠端查詢成功. `no_access` 表示環境不在個人選擇範圍, 並非遠端 ACL 拒絕.

個人設定採用加鎖讀改寫與原子取代. 遇到 `CONFIG_BUSY` 時, 等競爭更新結束再重試. 初始化失敗留下的 Git source checkout 可用於相同來源的重試, 仍保護不相符的 upstream 和本機工作.

Bitbucket 的可選倉庫與使用者探測各有 5 秒程序執行期限. 工具不可用或探測逾時不會阻止 Git 傳輸; 明確的倉庫存取拒絕或缺少倉庫的結論仍然有效. 使用者取消和非預期例外會停止操作. 進度從 `preflight` 預檢查開始, 隨後切換為倉庫變更的 `apply` 階段.

Skill 階段中斷時, `sync.stage_details.skills` 保留 `links`、`fx` 和 `tools`; 工具安裝保留 `tool_install`. 項目 `status` 區分 `done`、`failed`、`not_started`、`skipped` 和預覽的 `planned`. 資源項目在失敗時附帶 `observed` 磁碟狀態, 若觀察也失敗則為 `unknown`. 寫入報錯時目標可能已經改變. 安裝程式 `ran: true` 表示已嘗試執行, `code: null` 表示未取得結束結果. `phase: version` 失敗且 `code: 0` 表示套件安裝已成功. 先處理失敗項目再重試; 擲出例外後不會執行後續寫入.

相同工作區名稱和來源可透過已註冊根目錄的符號連結別名重試. 註冊在設定鎖內重新核對實體路徑, 真正不同的目錄仍會衝突.

### Skill 所有權與宿主啟用

團隊 Skill 連結屬於工作區; fx 內建 Skill 副本屬於使用者和所選宿主, 多工作區共用, 初始化及同步不用舊版覆蓋已識別的新版. 更新在使用者層級鎖內重新核對所有權和版本, 外來副本保留. 第三方工具擁有各自的 Skill 安裝與版本策略, 因此 fx 仍可能在另一工作區同步時再次呼叫其安裝程式. 本機 Skill 安裝不必然需要網路; 應區分呼叫器核准等待與已啟動子程序.

`agent list` 提供 `detected`、`selected`、`selection` (automatic 或 explicit) 和 `active: null`, 因為偵測不能證明目前活躍. 初始化前明確設定 `fx config set agents <id,...>` 可限制投影範圍. `FX_HOME` 只隔離 fx 設定, 不隔離全域 Skill; 實驗還應使用獨立 HOME.

Grok 1.0.25 僅在 Git 根發現專案 hook. 普通工作區根完成正常目錄信任後可以發現指南和 Skill, 但不能因此修復 hook 發現. `hook list` 會說明啟用限制; 需明確執行 `fx sync --only docs,skills`, 不要在工作區根初始化 Git. 宿主執行核准或取消獨立於 fx 執行, auto 模式也不關閉宿主權限檢查. Hook 維持 fail-open, 在 stderr 輸出有界的 `HOOK_FAILED_OPEN` 診斷, 不含原始輸入或例外文字; 檔案投影本身不能證明啟用.
