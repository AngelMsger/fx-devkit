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
fx init ./work --name work --from <manifest-repository> --dry-run
fx init ./work --name work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` 會先在命令信任確認後安裝 manifest 中明確標記 `install_on_init`、已啟用且缺少的工具，再同步儲存庫和所選 Agent 資源。既有工具安裝會保留。

註冊成功不代表所有同步階段成功，請檢查失敗項目，並在解決權限或設定問題後重試相關階段。

既有目錄會自動納入管理，`--adopt` 僅為相容性保留。對不熟悉的工作區，先使用 `--dry-run` 查看計畫。

只有 `origin` 且其 URL 與宣告的 upstream 完全相符時，sync 會新增 `upstream`，保留 `origin`、目前分支和本機檔案。預覽的 `upstream_to_add` 與結果的 `upstream_added` 分別說明計畫和實際效果；衝突的 remote 保持不變。

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

## 探索與管理工作區 {#find-and-manage-workspaces}

`fx workspace list` 可在任意目錄執行，即使沒有預設工作區，或某項註冊的根目錄、manifest 已遺失。`fx workspace show <name>` 回傳身分、來源、健康狀態與選擇脈絡，不要求 manifest 完整。使用 `fx status --workspace <name>` 明確選擇；未指定時，目前目錄所屬工作區優先於 `default_workspace`。

```sh
fx workspace list
fx workspace show work
fx status --workspace work
fx config set default_workspace work
```

目錄已移動時，使用 `workspace relocate <name> <new-dir>` 更新註冊；它不會移動或重新複製 checkout。使用 `workspace rebind <name> --from <source>` 更換 manifest 來源，同時保留工作區身分和個人選擇。將同一實體目錄註冊為第二個名稱不等於遷移。

`workspace unregister <name>` 解除管理並保留業務 checkout。先使用 `--dry-run` 預覽生命週期操作，檢查受管資源清理與衝突；外來檔案會保留。

## 下載前選擇儲存庫 {#choose-repositories-before-downloading}

初始化時使用 `--repos` 限制首次下載，名稱必須存在於已檢查的 manifest；`--no-repos` 表示空儲存庫集合。重複 init 時不帶這兩個參數會保留既有選擇。

```sh
fx init ./work --from <manifest-repository> --repos example-api --dry-run
fx init ./work --from <manifest-repository> --repos example-api
```

既有工作區中，`select` 取代集合，`pick` 加入名稱，`unpick` 移除名稱。選擇操作不刪除檔案，也不會自行下載 checkout；隨後執行 sync 取得或更新已選儲存庫。

```sh
fx repo select example-api
fx repo pick example-web
fx sync --dry-run
fx sync
fx repo select --all
fx env select dev
fx env select --none
fx env select --all
```

`--all` 持續跟隨團隊完整集合，包括未來新增項目；逐個選中目前全部名稱仍是固定清單。`--none` 選擇空集合。清單與選擇結果顯示目前模式，避免將空選誤認為未設定預設值。

儲存庫選擇只控制共用項目；本機另行註冊的儲存庫和 manifest checkout 仍分別管理。`select` 接收以空格分隔的名稱，init 的 `--repos` 接收以逗號分隔的清單。

## 判讀儲存庫狀態 {#read-repository-status}

`fx status` 標明工作區並顯示未追蹤檔案數。`fx status --dirty` 同時查找已追蹤檔案的修改與新建的未追蹤檔案。JSON 保留 `dirty` 表示已追蹤檔案或索引修改，新增 `uncommitted` 表示任一類未提交工作。被忽略檔案不計入未追蹤工作。空結果說明是未選擇儲存庫，還是沒有儲存庫符合篩選。

sync 保留工作檔案與分支。請查看計畫動作：已追蹤檔案修改可能觸發 `skip_dirty`；checkout 位於其他分支時，只更新被追蹤的分支參照。status 預設不 fetch，需要更新遠端比較時明確加上 `--fetch`。

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

工具定義由內建目錄與所選工作區的 `tools.yaml` 合併；工作區的工具鏈則是其中它真正使用的部分：被繫結 provider 驅動的工具，加上 tools.yaml 宣告的工具。`fx tool list` 說明每個工具因何在此，`--catalog` 會再列出 fx 知道但沒有被選用的工具。工作區優先順序為 `--workspace`、`FX_WORKSPACE`、目前目錄所屬的已註冊工作區、`default_workspace`；無法確定工作區時沒有繫結可推導，因此列出內建目錄。套件管理器決定安裝位置，工具由多個工作區共用。

`tool install` 和 `tool update` 必須指定名稱或 `--all`，兩者互斥。安裝的 `--all` 補齊已啟用且 PATH 缺少的工具；更新的 `--all` 選擇目前工具表中全部已啟用工具。明確名稱可以選擇已停用的工具。無參數呼叫會在執行套件操作前報錯。

doctor 預設檢查工作區宣告的工具及所選環境中實際啟用的 provider 相依項目。未使用的內建工具仍可透過 `tool list --catalog` 或明確指定 `doctor --tool <name>` 查詢；缺少它們不會導致無關工作區不健康。工具鏈本身涵蓋 manifest 宣告的所有環境（安裝是整機的），而 doctor 的檢查仍依所選環境收窄。活躍 provider 的相依工具若被停用，仍會回報檢查不完整。

init/sync 使用相同的相關工具範圍。缺少選用工具仍會顯示，但不阻斷準備。啟用的 `install_on_init` 工具需要驗證；已停用的選用工具不會僅因這個安裝標記而變成必要工具。

### 共用服務設定與個人憑證 {#shared-service-settings-and-personal-credentials}

manifest 可宣告 URL、context、組織和驗證方式等公共 `service` 設定。`init`、明確執行的 `sync` 和 `login` 透過受信任的配套命令準備設定；背景 hook 只檢查。使用 `fx sync --only services --dry-run` 預覽。

設定與身分驗證分開進行。每位成員透過配套 CLI 取得並儲存自己的憑證。既有衝突設定會保留並回報；sync 不執行個人登入。Sentry 僅寫入工作區 `.sentryclirc` 的公共預設值，保留外來檔案。

sync 的 `stages.services` 和 `stage_details.services.items` 表示階段結果；init 將這些欄位放在 `sync` 下。摘要保留阻塞與失敗，`--details` 也包含成功項目。參閱[服務預設](manifest-guide.md#public-service-presets)與[復原參考](../skills/fx-workspace/references/commands.md#service-preparation)。

### 工具安裝歷史 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install` 和 `tool update` 在 `$FX_HOME/tool-history.json` 記錄嘗試。`installed` 表示套件管理器成功，但後續版本核對仍可能失敗；單獨的 `started` 不證明成功。dry-run 和 init 略過的既有工具不產生記錄。

`tool inventory` 的安裝來源與 `tool list/show` 的定義來源分別表達不同事實：

| installation_origin | 證據                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `fx`                | fx 成功安裝先前不存在的程式，目前路徑仍與紀錄相符。                      |
| `external`          | 已知程式在 fx 安裝紀錄之外已經存在；之後由 fx 更新或重裝，仍保留此來源。 |
| `unknown`           | 舊紀錄、未完成操作或變更／缺少的路徑無法確認目前來源。                   |

相依檢查涵蓋同一 FX_HOME 的全部已註冊工作區，包括啟用的選用工具與內建預設項目。只有已確認由 fx 安裝且沒有剩餘需求的工具才可成為 `unused`；其他 FX_HOME 和未註冊專案不在範圍內。建議供人工判斷，sync/doctor 從不解除安裝。讀取失敗或證據不足不能證明可以移除。

查詢不會接管 PATH 中的工具，也不重建舊安裝歷史。完整欄位見[安裝清單參考](../skills/fx-workspace/references/commands.md#installation-audit-and-inventory)，資料範圍見[本機資料](user-privacy.md#what-stays-on-your-machine)。

### fx 伴生 Skill 與團隊 Skill

fx 伴生 Skill 引導 Agent 使用 CLI。無需安裝或註冊工作區即可讀取：

```sh
fx self info --format json
fx skill show
fx skill status
```

希望宿主自動探索副本時，使用 `fx skill install --agent codex`。`--project` 面向目前目錄；`--dir ./custom-skills` 面向獨立目錄，不能與 `--agent`、`--project` 同用。獨立 Skill 命令的目標選擇不依賴工作區 Agent 設定。偵測、取代與解除安裝規則見[Skill 參考](../skills/fx-workspace/references/commands.md#standalone-companion-skill)。

明確執行 install 會將已識別副本更新為呼叫 CLI 的版本，包括同版修復和取代較新副本；init/sync 同版重用且不降級。取代外來內容需要確認和備份。解除安裝不改變 Agent 選擇，後續 sync 可能再次安裝。

安裝、版本符合與宣告載入是不同事實。讀取 bundled Skill 後設定 `FX_SKILL_LOADED=1` 和 `FX_SKILL_VERSION=<bundled_skill_version>`；宣告本身不能證明實際閱讀。引導命令保持安靜，其餘非 TTY 命令在版本不符時提供非阻斷提示，可用 `FX_SKILL_NOTICE=0` 關閉。

團隊 Skill 位於 manifest 的 `skills/`，由 init/sync 連結到所選宿主，並在根 AGENTS.md 產生目錄。請從工作區根啟動，子儲存庫的探索行為沒有保證。使用 `fx sync --only docs,skills` 更新；不要透過團隊共用連結安裝 fx 伴生 Skill，應使用使用者副本或獨立目錄。

### 貢獻共用知識

`source push` 可預覽或提交所選來源檔案，保留來源 checkout 的 HEAD、索引和工作檔案。提交需要個人 fork 及其上游關係的證據。實際提交前閱讀 `fx source push --help` 與[貢獻契約](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

使用 `fx <topic> --help` 查看標準入口與相容別名。集合參數接受重複參數和逗號分隔的值。

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

先執行 `fx self info --format json`，讀取傳回的 bundled Skill 或 `fx skill show`，再宣告 `FX_SKILL_LOADED=1` 和符合版本的 `FX_SKILL_VERSION`。[內建 Skill](../skills/fx-workspace/SKILL.md) 提供任務路由。

使用 `--format json`，分開解析 stdout 結果與 stderr 通知、進度和錯誤。集合採用 `{items, has_more, next?}`；`--no-input` 不等待輸入，`--quiet` 抑制通知和進度。

`init`、`sync`、`doctor`、`release` 預設輸出摘要，保留計數、異常與復原操作，`omitted` 統計省略項目。`--details` 傳回完整結果，明確的 `--fields` 從完整結果投影；`--verbose` 獨立控制診斷。明確的 `--fields` 在所有格式中均投影完整報告：JSON/NDJSON 輸出一個物件，human 輸出選取的鍵值。點路徑保留為扁平鍵。例如 `fx sync --fields operation,preparation_complete,items,summary` 不包含階段明細。未指定欄位時，human/NDJSON 預設行為不變；事實查詢仍按項目投影並保留集合中繼資料。

| 結果             | 判讀欄位                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `init/sync`      | `operation` 與 `preparation_complete`。預覽為 `null`；執行只判斷本次選擇並請求的準備工作。 |
| `doctor/release` | `ok` 表示沒有失敗項目；`complete` 表示沒有缺少涵蓋的請求項目。仍需查看警告。               |
| `can`            | `status` 與 `handoff`。準備就緒不保證某次遠端查詢成功。                                    |

報告可能結束代碼為零卻仍有失敗項目，init/sync 的非零結束也可能伴隨部分 stdout。未提交的變更、分叉、阻塞、失敗或未驗證的啟用會使準備不完整；未選資源不影響判定。`release` 只檢查儲存庫，不發佈套件或部署服務。

寫入前先選擇輸出檢視。對已授權的同步，一次儲存完整結果：

```sh
fx sync --format json --details > sync-result.json
```

之後解析同一檔案，不截斷 JSON，也不為取得明細重複寫入。一起判讀部分結果與 stderr 錯誤，詳見[回應契約](../skills/fx-workspace/references/commands.md)。

## 遷移至 0.2.0 {#migrating-to-020}

- 工作流 JSON 預設輸出摘要；需要正常項目或證據的腳本請加 `--details`，明確指定的 `--fields` 仍從完整結果投影。
- 明確的空 Agent 選擇表示不選取宿主；恢復偵測見[Agent 選擇](#agent-selection)。
- 讀取目前 bundled Skill 後宣告 `FX_SKILL_VERSION`，只有舊布林變數不足以核對版本。

判讀方式見[給編碼 Agent](#for-coding-agents)。

## 設定 {#configuration}

`~/.fx` 儲存工作區註冊、個人層、資源擁有權狀態、信任和快取。`FX_HOME` 只改變 fx 的個人目錄，不改變配套工具的憑證位置。

`config list` 顯示設定鍵、預設值、環境變數名稱及實際來源；`config get <key> --explain` 顯示各層。優先順序為明確參數、環境變數、設定檔、內建預設值。使用 `config export/import` 遷移個人設定。

匯入按名稱合併工作區註冊，保留 profile 中未提到的工作區；明確列出的個人層會被取代。匯入不會改變既有工作區的根目錄或來源，請先使用 `workspace relocate` 或 `workspace rebind`。使用 `workspace unregister` 明確解除管理。計畫會列出註冊情況與仍需完成的準備步驟；遺失的 manifest checkout 可透過輸出的 init 命令恢復。匯出不複製 manifest checkout、信任或憑證。

`format` 控制輸出。`command_shell` 只控制產生命令的文字，不改變執行方式；auto 在 Windows 選擇 PowerShell，其他平台選擇 POSIX。可使用 `--command-shell`、`FX_COMMAND_SHELL` 或 cmd 設定覆寫。manifest 中的 shell 範本保持原樣。

自動補齊支援 bash、zsh、fish 和 PowerShell，透過 `fx completion <shell>` 產生，依需求自行載入。

### Agent 選擇 {#agent-selection}

`fx config set agents codex` 選擇指定宿主，`fx config set agents ''` 或空 `FX_AGENTS` 選擇無宿主。取消設定和環境覆寫後恢復偵測。Agent 選擇影響同一 FX_HOME 的全部工作區；FX_HOME 不移動全域 Skill 或配套工具憑證。

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

## 判讀初始化與復原結果 {#reading-initialization-and-recovery-results}

init 可能先完成註冊，再在後續階段失敗。即使結束代碼非零，也要讀取部分 stdout；解決原因後，以相同名稱、來源和目錄重試。同一實體目錄的符號連結別名可接受，不同目錄仍屬衝突。

| 證據                                | 含義                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `registered` / `written`            | 註冊是否存在／本次是否寫入本機狀態；仍須另行檢查 `preparation_complete`。 |
| `failed_phase`、`phases`、`failure` | 初始化停止的位置與復原步驟。                                              |
| `sync.stages`、`sync.stage_details` | init 的同步結果；sync 命令去掉 `sync` 前綴。                              |
| `tool_install`                      | 安裝嘗試；`code: null` 不代表成功，安裝成功後也可能版本檢查失敗。         |
| `observed`                          | Skill 失敗後的磁碟狀態，失敗寫入也可能已改變目標。                        |

遇到 `SKILL_WRITE_DENIED` 應先檢查被拒絕的路徑；修改 FX_HOME 不會移動共用鎖。可用 `fx sync --only repos,docs --no-refresh-manifest` 繼續本機儲存庫與指南工作，但不代表 Skill 已修復。存取條件未改變時不要重試，也不要繞過命令信任。

`INIT_PREPARED` 在安裝與複製前展示計畫。init 的 dry-run 會檢查本機目錄、stdin 與本機 Git 已提交的內容，並列出儲存庫動作而不執行。新的遠端來源不會在 dry-run 中擷取；`source_inspected: false` 表明此邊界，要求的儲存庫選擇仍未驗證。需要先查看來源內容時，依預覽提示檢查本機 checkout。計畫與實際狀態分別回報，`registered` 表示註冊目前確實存在，不再表示計畫註冊或本次新增。stderr 進度是心跳，不是傳輸百分比或 ETA；完整 JSON 使用 `--details`。

Git manifest 的更新與預覽會保留已修改、未追蹤，以及雖被 Git 忽略但 fx 會讀取的來源檔案。此來源保護規則不改變業務 checkout 的同步策略。

正常重試會重新探測儲存庫可讀性；先前遺失的儲存庫不會被舊的負快取持續阻擋。

工具、登入與更新問題見[支援](support.md#troubleshooting)。`no_access` 表示環境未被選取，不是遠端 ACL 拒絕。Git 傳輸憑證與選用的程式碼託管 API 檢查互相獨立。

### Skill 所有權與宿主啟用 {#skill-ownership-and-host-activation}

使用者層級 fx Skill 跨工作區共用，並由使用者層級鎖保護；團隊連結屬於各工作區，配套安裝器管理自己的版本行為。檔案正確不證明宿主已啟用。

用 `hook list` 查看支援和驗證狀態。已測試的 Grok 1.0.25 僅在 Git 根探索專案 hook，一般目錄信任不能解除此限制。使用明確的 `fx sync --only docs,skills`，維持工作區根為一般目錄；宿主執行核准仍獨立生效。
