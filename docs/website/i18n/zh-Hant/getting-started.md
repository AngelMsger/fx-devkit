# 使用 fx

安裝 fx，連接團隊 manifest，並管理儲存庫、工具與編碼 Agent。

各版本的變更見[更新日誌](../CHANGELOG.md)。請查看已安裝版本的 `fx <command> --help` 與隨附 Skill，確認目前執行檔支援的功能。

依任務選擇閱讀入口：

- 新建工作區：[安裝](#install)，再[快速上手](#quick-start)。
- 儲存庫較多：[下載前選擇儲存庫](#choose-repositories-before-downloading)。
- 設定中斷：[判讀結果並復原](#reading-initialization-and-recovery-results)。
- 編碼 Agent：[結構化結果與 bundled Skill](#for-coding-agents)。

## 環境需求 {#requirements}

- Node.js ≥22；開發版本以 package.json 為準。Bun 也可以作為執行環境。
- Git 位於 PATH 中。全域安裝和 `fx self update` 仍需要 npm，包括使用 Bun 時。
- 團隊提供的 manifest，或[自行建立的 manifest](manifest-guide.md)。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行和 Agent 宿主啟用尚未完成驗證；目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。請參閱 [Windows 支援範圍](support.md#platform-support)。

## 安裝 {#install}

<!-- distribution:internal -->

fx 透過團隊的私有 Registry 分發。請向團隊取得 Registry 位址與 npm 存取權限；既有 npm scope 設定可直接重用，`FX_REGISTRY` 僅作為選用覆寫。以下 URL 為虛構範例，安裝前需確認 Registry 已提供該套件。

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
npm install -g @fx/devkit
fx --version
```

`npm login --scope=@fx --registry=...` 會關聯 scope 與 Registry。已設定時只需執行安裝命令。`fx self info --format json` 顯示有效的 `registry` 與 `registry_source`，不修改 npm 設定。

<!-- /distribution -->

<!-- distribution:public -->

### 公開套件

對外分發使用 npmjs 上的 `@angelmsger/fx`，不需團隊私有 Registry。

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

只需要團隊提供的 manifest 來源，以及工作區要放置的目錄。可以直接告訴 Agent：「請用 fx 根據這個 manifest，把工作區準備到這個目錄。」自行操作終端時，先預覽再執行：

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
```

fx 會檢查來源，完成已授權的本機工具與設定準備，複製選取的儲存庫，並準備 Agent 指南和 Skill。工作區名稱自動產生並避開既有註冊，既有檔案與已完成工作會保留。批准新命令前，請檢查顯示的完整參數。

看到 **Ready to work** 即可開始工作。若需要個人登入、權限或批准，fx 會集中列出剩餘事項。處理後使用傳回的繼續命令：

```sh
fx init --resume --workspace work
```

終端輸出會直接列出個人登入命令和繼續命令。在自己的終端完成登入，解決所列前置條件後執行繼續命令即可。

續跑會驗證目前狀態並略過已完成準備，不會重新匯入目錄來源或重建既有儲存庫。無需自行選擇內部階段或組合診斷命令。

新工作區預設選取全部共享儲存庫。需要縮小首次下載範圍時，先[選擇儲存庫](#choose-repositories-before-downloading)，在初始預覽和執行都加上 `--repos`。既有目錄會自動納入管理。日常更新使用 `fx sync`，查看儲存庫狀態使用 `fx status`。

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

僅使用明確 Git URL、未綁定程式碼託管 provider 的 manifest，同步儲存庫不需設定程式碼託管使用者名稱。

尚未下載的儲存庫仍保留在完整目錄中。可以直接讓 Agent 處理該儲存庫的任務，或執行 `fx repo show <name>`：傳回的 `next_steps` 會在正確的工作區補選儲存庫並同步下載，隨後在傳回的路徑繼續工作。

`--all` 持續跟隨團隊完整集合，包括未來新增項目；逐個選中目前全部名稱仍是固定清單。`--none` 選擇空集合。清單與選擇結果顯示目前模式，避免將空選誤認為未設定預設值。

只有這些命令會改變環境選擇。`fx login` 不會詢問它：未設定時涵蓋所有已宣告的環境並說明如何收窄，`--env` 只限定這一次執行，不改變選擇。

儲存庫選擇只控制共用項目；本機另行註冊的儲存庫和 manifest checkout 仍分別管理。`select` 接收以空格分隔的名稱，init 的 `--repos` 接收以逗號分隔的清單。

## 判讀儲存庫狀態 {#read-repository-status}

`fx status` 標明工作區並顯示未追蹤檔案數。`fx status --dirty` 同時查找已追蹤檔案的修改與新建的未追蹤檔案。JSON 保留 `dirty` 表示已追蹤檔案或索引修改，新增 `uncommitted` 表示任一類未提交工作。被忽略檔案不計入未追蹤工作。空結果說明是未選擇儲存庫，還是沒有儲存庫符合篩選。

工作區根目錄不是 Git 儲存庫，因此 `fx status` 還會回傳 `stray_entries`：根目錄下既不是 checkout、派生指南、Agent 或服務設定，也不是工作台的檔案與目錄。`fx doctor` 在 `root` 群組中逐項列出，等級為警告，不影響就緒判定。

sync 保留工作檔案與分支。請查看計畫動作：已追蹤檔案修改可能觸發 `skip_dirty`；checkout 位於其他分支時，只更新被追蹤的分支參照。status 預設不 fetch，需要更新遠端比較時明確加上 `--fetch`。

## 核心概念 {#concepts}

### 工作區和 manifest {#the-workspace-and-the-manifest}

工作區是已註冊的普通目錄，包含獨立 checkout 和受管理的 Agent 資源。manifest 來源位於 `~/.fx/workspaces/<name>/source`，fx 不會在受管理的工作區根目錄執行 Git。同步不會透過切換分支、reset 或 stash 覆蓋未提交變更、分歧狀態或其他分支上的工作。

不屬於任何儲存庫的產出放在工作區根目錄的 `.workbench/` 下：每個任務一個帶日期的目錄，存放報告、計畫與證據；`worktrees/` 放 `git worktree add` 的目標；`tmp/` 放隨時可以捨棄的內容。派生指南向 Agent 說明相同的規則。fx 不會寫入該目錄。

根目錄的 `AGENTS.md` 是 fx 派生的唯一一份指南，各 Agent 會自行讀取。Claude Code 從 2.1.277 起也是如此，前提是工作區根目錄及其上層目錄中沒有 `CLAUDE.md` 或 `CLAUDE.local.md`。一旦存在，Claude Code 會改讀該檔案而不讀指南，因此請在其開頭寫上 `@AGENTS.md`。

workspace、environments、tools 和 members 文件儲存共用資訊；選用的 harness 文件描述 MCP 和規則。使用以下命令查看欄位：

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 個人設定

全域設定記錄工作區和偏好。Agent 選擇在同一 FX_HOME 註冊的工作區間共用；儲存庫與環境選擇屬於各自工作區。`repo add` 登記本機參照，`repo remove` 僅移除參照並保留檔案。設定匯出不會複製憑證、信任記錄或 manifest checkout。

### 能力、提供者與配套工具

capability 表示程式碼託管、CI、日誌、錯誤追蹤等意圖，provider 透過配套 CLI 實作。manifest 繫結能力、提供者和環境座標。`can` 查詢就緒狀態，`where` 查詢座標，`release check` 查詢宣告的發佈檢查項目。

工作區級能力一次繫結：`code-host`、`issue-tracker`、`knowledge-base`、`im`、`calendar`、`meeting`、`task`、`worklog`；環境級能力按平台實例繫結：`error-tracker`、`log-store`、`metrics`、`ci`、`cluster`。不帶目標的 `fx can` 列出這些能力以及目前工作區裡各由誰提供；`fx manifest providers` 列出已繫結的內容和每個能力可選的 provider。`calendar` 是行程與忙閒所在；`meeting` 是承載線上會議及其錄製、紀要的會議系統，在一個產品排行程、在另一個產品開會的團隊兩者都繫結。

`metrics` 由 `prometheus-cli` 提供。它的座標是服務的抓取 job：`where` 輸出一條 `up{job="..."}` 查詢，回傳該服務各抓取目標的標籤集合，可作為撰寫後續選擇器的起點。選擇器比對不到任何序列時查詢仍然成功，因此指標不提供存在性探測，`where --probe` 對它回報 `unknown`，不作猜測。

`tool list/show` 顯示工具需求，`tool install/update` 使用宣告的安裝程式，`login` 引導設定。驗證由各工具負責，包括已儲存的憑證可以送往哪個服務。fx 為內建工具定義的命令無需確認即可執行；團隊 `tools.yaml` 新增或覆寫的命令向量需要信任一次，向量改變後需要重新確認。口頭確認手動步驟不能取代驗證成功。

工具定義由內建目錄與所選工作區的 `tools.yaml` 合併；工作區的工具鏈則是其中它真正使用的部分：被繫結 provider 驅動的工具，加上 tools.yaml 宣告的工具。`fx tool list` 說明每個工具因何在此，`--catalog` 會再列出 fx 知道但沒有被選用的工具。工作區優先順序為 `--workspace`、`FX_WORKSPACE`、目前目錄所屬的已註冊工作區、`default_workspace`；無法確定工作區時沒有繫結可推導，因此列出內建目錄。套件管理器決定安裝位置，工具由多個工作區共用。

`tool install` 和 `tool update` 必須指定名稱或 `--all`，兩者互斥。安裝的 `--all` 補齊已啟用且 PATH 缺少的工具；更新的 `--all` 選擇目前工具表中全部已啟用工具。明確名稱可以選擇已停用的工具。無參數呼叫會在執行套件操作前報錯。

doctor 預設檢查工作區宣告的工具及所選環境中實際啟用的 provider 相依項目。未使用的內建工具仍可透過 `tool list --catalog` 或明確指定 `doctor --tool <name>` 查詢；缺少它們不會導致無關工作區不健康。工具鏈本身涵蓋 manifest 宣告的所有環境（安裝是整機的），而 doctor 的檢查仍依所選環境收窄。活躍 provider 的相依工具若被停用，仍會回報檢查不完整。

init/sync 使用相同的相關工具範圍。缺少選用工具仍會顯示，但不阻斷準備。啟用的 `install_on_init` 工具需要驗證；已停用的選用工具不會僅因這個安裝標記而變成必要工具。

內建 Sentry 工具透過 npm 的 `sentry` 套件安裝；manifest 啟用初始化安裝時也適用。

### 共用服務設定與個人憑證 {#shared-service-settings-and-personal-credentials}

manifest 可宣告 URL、context、組織和驗證方式等公共 `service` 設定。`init`、明確執行的 `sync` 和 `login` 透過配套工具自身的命令準備設定；背景 hook 只檢查。宣告的驗證方式只是 fx 新建 context 時的預設值；你自己的 context 只要已經能存取宣告的服務，無論以哪種方式登入都算就緒。使用 `fx sync --only services --dry-run` 預覽。

設定與身分驗證分開進行。每位成員透過配套 CLI 取得並儲存自己的憑證。既有衝突設定會保留並回報；sync 不執行個人登入。但它每次執行都會把你在同一服務上既有的登入關聯到工作區的 context，在別處登入之後不需要再記著做什麼。Sentry 僅寫入工作區 `.sentryclirc` 的公共預設值，保留外來檔案。

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

`skill status` 報告安裝版本與 `activation: unverified`。檔案已安裝不代表宿主已載入。按需閱讀隨包指南，一般命令無需宣告 Skill 已載入。

團隊 Skill 位於 manifest 的 `skills/`，由 init/sync 連結到所選宿主，並在根 AGENTS.md 產生目錄。請從工作區根啟動，子儲存庫的探索行為沒有保證。使用 `fx sync --only docs,skills` 更新；不要透過團隊共用連結安裝 fx 伴生 Skill，應使用使用者副本或獨立目錄。

### 貢獻共用知識

`source push` 可預覽或提交所選來源檔案，保留來源 checkout 的 HEAD、索引和工作檔案。提交需要個人 fork 及其上游關係的證據。實際提交前閱讀 `fx source push --help` 與[貢獻契約](cli/README.md#fx-source-push)。

## 常用命令 {#commands}

使用 `fx <topic> --help` 查看標準入口與相容別名。集合參數接受重複參數和逗號分隔的值。

| 意圖                   | 命令                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 建立、同步和檢查工作區 | `init`、`sync`、`status`                                                                             |
| 設定存取並檢查就緒     | `login`、`doctor`、`can`                                                                             |
| 查詢環境座標與發佈證據 | `where`、`release check`                                                                             |
| 管理儲存庫             | `repo list/show/pick/unpick/add/remove/fork/open`                                                    |
| 管理環境與 Agent       | `env list/show/pick/unpick`、`agent list/pick/unpick`                                                |
| 管理工具和 Skill       | `tool list/show/install/update/history/inventory`、`agent skills`                                    |
| 管理共用來源           | `manifest validate/lint/explain/schema/providers/repo-set/record-probe/render/import`、`source push` |
| 查詢成員與設定         | `member list/show`、`config list/get/set/unset/export/import`                                        |
| 檢查宿主資源           | `hook list/enable/disable`、`mcp list/show`                                                          |
| CLI 資訊與更新         | `self info/update`、`completion`                                                                     |

完整語法以 `--help` 和[自動產生的 CLI 參考](cli/README.md)為準。

## 給編碼 Agent {#for-coding-agents}

先執行 `fx self info --format json`。初始化任務讀取傳回的 `initialization_guide`，並持續使用同一準確入口；無需宣告已載入 Skill 的環境變數。[完整 Skill](../skills/fx-workspace/SKILL.md) 提供其他任務的路由。

使用 `--format json` 分開保存 stdout 結果與 stderr 進度、通知和錯誤。預設結果保留準備結論及全部阻塞項，`--details` 展開階段證據。human 預設先顯示任務結論與下一步。`release check` 的 human 輸出在每個儲存庫開頭先說明它將發佈的內容：目標分支宣告的版本、兩個分支的最新提交，以及來源分支上尚未合併到目標分支的提交。每個有失敗或警告檢查的儲存庫單獨列一塊，列出它的全部檢查；所有儲存庫共有的問題只在它們上方說明一次；全部檢查都通過的儲存庫在最後各占一行。`--details` 也會列出這些儲存庫的檢查。在終端上還會加上顏色與符號、依寬度收窄表格，並以文字顯示錯誤；管線或檔案取得純文字和 JSON 錯誤信封，`NO_COLOR` 去掉顏色。命令執行期間，終端上還會有一行狀態列，顯示已用時間、可計數工作的進度與正在等待的對象；命令結束後這一行消失，管線、檔案、JSON 輸出與 `--quiet` 都不會收到它。git 或安裝器執行期間可能在同一終端上詢問主機金鑰或密碼片語，這時狀態列不再原地重繪，改為每五秒列印一行。明確的 `--fields` 從完整報告擷取欄位，點路徑保留為扁平鍵，例如 `fx sync --format json --fields operation,preparation.state,items,summary`。

| 結果               | 完成判定                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| `init/sync/doctor` | `preparation.state` 為 `planned`、`ready` 或 `incomplete`，僅針對 `preparation.scope`。 |
| `release check`    | 讀取 `ok`、`complete`、檢查項目與 `repos`；此命令不發佈或部署。                         |
| `can`              | 讀取目標能力的 `status` 和接手指引。                                                    |

準備就緒結束代碼為 0，未完成為 12；預覽只是計畫。設定或執行異常保留原分類結束代碼，也可能傳回部分 stdout。`doctor.coverage` 單獨描述診斷涵蓋範圍；選用宿主啟用未驗證不會阻塞必要工作，檔案存在也不證明啟用。

Init 會自行執行已授權的本地準備。結果保留已完成步驟；認證未完成時，不要重複這些步驟。

若需儲存輸出進行分析，請使用任務授權目錄；唯讀姿態無法控制 shell 重新導向。

先讀 `preparation.next`：審閱預覽、準備完成後繼續原任務、執行 Agent 動作，或等待人工條件補齊。`next_actions` 只包含 Agent 可處理的動作；個人操作保留在阻塞項內並標為 `actor: user`。條件變化後才執行 `resume`。

一次閱讀全部 `preparation.blockers`。`next_actions` 提供準確 argv、cwd、可選 env 座標及批准要求；續跑時保留這些值，`resume` 繼續已註冊工作區。既有授權持續有效，新向量仍須審閱。不要憑註冊或複製推斷成功，不要為取得明細重複寫入，也不要將個人憑據放入 manifest。

檔案衝突的逐項結果保留在 `stage_details.docs.files`（init 中位於 `sync` 下）。取代外來內容需要批准，並保留同層備份。詳見[回應契約](../skills/fx-workspace/references/commands.md)。

## 遷移到 0.4.0 {#migrating-to-040}

- 工具文件使用 `schema_version: 3`。`kind: run` 必須宣告 `phase: prepare`（本機非互動準備）或 `phase: authenticate`（個人登入）。舊格式在產生工作區效果前回報遷移問題，fx 不猜測腳本用途。
- 已移除 Skill 載入握手及 `skill_notice` 設定。`FX_SKILL_LOADED`、`FX_SKILL_VERSION`、`FX_SKILL_NOTICE` 不再使用；請改讀安裝版本和 `activation`，不要再讀取 loaded/version_verified。
- `preparation.state` 取代 `preparation_complete`。doctor 的頂層 `ok/complete` 改為準備結果與診斷 `coverage`；release 保留原契約。準備未完成結束代碼為 12。
- 工作區發現使用 `registration_status: available` 表示註冊可讀，不代表準備完成。
- `init --resume --workspace <name>` 使用託管來源與現有選擇繼續。普通來源指南無需 fx 標記：缺少的區域會補入產生的目標指南，共享來源保持不變。

設定格式見 [manifest 指南](manifest-guide.md)。

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

依結果傳回的繼續操作處理。新來源尚未接受時，使用完整的原始重試命令；否則續跑讀取託管來源與現有選擇。註冊和檔案寫入只是已發生的效果，完成判定看 `preparation.state` 與阻塞項。

本機預覽檢查目錄、stdin 或 Git 已提交內容；新遠端來源在取得前保持 `source_inspected: false`。已知指南衝突與計畫命令會先顯示，預覽不授予信任。普通來源指南會在產生的目標中補齊 fx 區域，保留共享來源正文；模糊標記由維護者修正。

部分失敗會保留已完成儲存庫、本機準備和使用者檔案。補齊列出的前置條件後，依傳回操作繼續；既有安裝與已驗證步驟會略過。相對驗證檔案以工作區根為基準。含空格或 Unicode 的目錄會自動產生名稱，直接使用傳回的身分即可。

遇到 `SKILL_WRITE_DENIED` 先處理被拒絕的路徑；改變 FX_HOME 不會移動全域鎖。可用 `fx sync --only repos,docs --no-refresh-manifest` 繼續允許的工作，但不能宣稱 Skill 已修復。外來檔案置換仍須批准並保留備份。Git 來源刷新保留本機修改，正常重試重新檢查儲存庫可讀性。詳見[支援](support.md#troubleshooting)。

### 人工接手後恢復登入 {#resume-login-after-a-handoff}

`login` 需要人工輸入時，先完成已授權的 handoff，再重跑同一命令。fx 會先檢查目前狀態，再決定是否重複操作；之後重新執行原先的 `can` 或 `doctor` 檢查，繼續原任務。

機器呼叫端在非零結束時，也要同時讀取部分 stdout 與 stderr 錯誤。已完成步驟仍保留；`handoff`、`blocked`、`failed`、`not_started` 區分後續工作。彙總、計畫問題與步驟復原欄位見[登入回應契約](../skills/fx-workspace/references/commands.md#readiness-and-recovery)。

交給人處理的步驟會說明其檢查得到的回答。步驟的 `check` 帶有工具自己的訊息；fx 能讀懂失敗原因時還會給出成因：未能建立驗證、服務拒絕了權限，或連線未能建立。此時步驟的說明會針對該成因提供處理方式，重新登入前請先閱讀。多數檢查不提供成因，這時以工具的訊息和步驟的說明為準。

沒有得到回答的檢查（工具未能啟動，或逾時）不會交給人處理。`can` 與 `where` 將它列在 `unfinished` 中，沒有其他失敗時傳回 `unknown`；`login` 以該錯誤停止，並在 stdout 保留部分結果；`doctor` 將它回報為涵蓋不完整的檢查項。較早版本的 fx 沒有這些欄位；`fx doctor --tool <tool> --env <env>` 可查看單一工具給出的訊息。

### Skill 所有權與宿主啟用 {#skill-ownership-and-host-activation}

使用者層級 fx Skill 跨工作區共用，並由使用者層級鎖保護；團隊連結屬於各工作區，配套安裝器管理自己的版本行為。檔案正確不證明宿主已啟用。

用 `hook list` 查看支援和驗證狀態。已測試的 Grok 1.0.25 僅在 Git 根探索專案 hook，一般目錄信任不能解除此限制。使用明確的 `fx sync --only docs,skills`，維持工作區根為一般目錄；宿主執行核准仍獨立生效。

### 重用現有登入

初始化會保留團隊統一的 context 名稱。相容的配套 CLI 會先比對同一服務的現有登入，重用個人身分，再決定是否需要你登入。Token 繼續保存在原 CLI 的憑證儲存區，目前的 context 與現有身分保持不變。多個身分符合時，可使用原 CLI 的 `auth reuse --from-context` 選擇來源；網路或鑰匙圈問題會與缺少憑證分開回報。
