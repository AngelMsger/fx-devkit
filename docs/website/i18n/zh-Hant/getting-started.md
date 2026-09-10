# 開始使用

`fx` 將團隊的共用 manifest 變成多儲存庫工作區：同步儲存庫、準備配套 CLI、為編碼 Agent 設定上下文，並協助你找到服務的調查入口。人可以閱讀預設輸出，Agent 可以使用結構化結果。

專案名稱為 `fx-devkit`，npm 套件名稱為 `@angelmsger/fx`，命令名稱為 `fx`。公共 npm 發佈正在準備中，目前實作仍有[發佈待辦](docs/public-release.md)。

## 為什麼使用 fx {#why}

取得程式碼只是開始。工程師還需要工具、存取權限、服務座標、團隊慣例和 Agent 上下文。fx 讓這些共用資訊可以被探索，同時保留每個儲存庫獨立的建置方式。

- 一次宣告儲存庫、負責人、工具與環境。
- 同步符合條件的乾淨分支，保留未提交、分歧和其他分支上的工作；使用 `--dry-run` 預覽寫入。
- 向 Agent 分發團隊 Skill 和受支援的宿主資源，以結構化結果和明確步驟處理失敗。
- 使用 `can`、`doctor` 檢查就緒，使用 `where` 尋找日誌、建置、錯誤和叢集入口。
- 配套工具繼續管理驗證和協議，個人選擇與信任記錄保留在本機。
- 透過 `source push` 和已驗證的個人 fork 貢獻共用知識。

### 日常工作 {#a-working-session}

初始化後，以下命令是常用入口。`example-api` 和 `test` 需要替換為 manifest 中的項目。

```sh
fx status
fx sync --dry-run
fx can code-host --format json
fx where example-api --env test
fx sync --only docs,skills
fx release --format json
```

官網與儲存庫 URL 是已設定的發佈目標，不代表已經上線。

## 環境需求 {#requirements}

- Node.js ≥22；開發版本以 package.json 為準。Bun 也可以作為執行環境。
- Git 位於 PATH 中。全域安裝和 `fx self update` 仍需要 npm，包括使用 Bun 時。
- 團隊提供的 manifest，或[自行建立的 manifest](docs/manifest-guide.md)。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行和 Agent 宿主啟用尚未完成驗證；目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。請參閱 [Windows 支援範圍](docs/design/windows.md)。

## 安裝 {#install}

公開發佈後的安裝方式不需要私有 registry：

```sh
npm install -g @angelmsger/fx
fx --version
```

這些命令描述預期的公開安裝方式，並不表示套件已經發佈。目前可以從原始碼執行：

```sh
npm ci
npm run build
node bin/fx.js --help
node bin/fx.js --version
```

執行後續範例時，將 `fx` 替換為 `node /absolute/path/to/fx-devkit/bin/fx.js`。啟動器讀取 `dist/`，因此必須先建置。

如果 npm 的 `@angelmsger` scope 仍指向舊 registry，公開版本發佈後可明確選擇公共 npm：

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
```

PowerShell 執行原則阻止 `.ps1` shim 時，可使用 `npm.cmd` 和 `fx.cmd`，不必變更原則。

### 更新

`fx self info --format json` 顯示執行環境和實際更新 registry。公開發佈的目標是預設使用公共 npm；目前自我更新與更新檢查仍需要私有 `FX_REGISTRY`，請參閱 [registry 遷移](docs/design/registry-configuration.md)。原始碼 checkout 應透過 Git 更新，再執行 `npm ci` 和 `npm run build`；`self update` 安裝的是全域 npm 套件。

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

### Skill、MCP 與生命週期

所選 Agent 取得團隊 Skill 目錄連結和附版本的 fx Skill 副本。非 fx 擁有的檔案會被保留；Windows 使用 junction 連結團隊目錄。使用 `skill list` 查看交付狀態，使用 `sync --only skills` 協調資源。

harness 向所選宿主投射 MCP 項目和規則參照，機密值保持為環境變數參照。`mcp list/show` 和 `can mcp:<name>` 說明先決條件；設定正確不代表宿主已啟用。請參閱 [MCP 契約](docs/design/harness.md)。

工作區啟動掛鉤可以傳回快取上下文，並在背景更新 manifest、文件和 Skill；不會同步業務儲存庫或確認信任。宿主仍控制專案與掛鉤的信任。使用 `hook list/inject/remove` 管理，請參閱[生命週期契約](docs/design/lifecycle.md)。

### 貢獻共用知識

`source push` 可預覽或提交所選來源檔案，保留來源 checkout 的 HEAD、索引和工作檔案。提交需要個人 fork 及其上游關係的證據。實際提交前閱讀 `fx source push --help` 與[貢獻契約](docs/design/source-contributions.md)。

## 常用命令 {#commands}

| 意圖                   | 命令                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| 建立、同步和檢查工作區 | `init`、`sync`、`status`                                                           |
| 設定存取並檢查就緒     | `login`、`doctor`、`can`                                                           |
| 查詢環境座標與發佈證據 | `where`、`release`                                                                 |
| 管理儲存庫             | `repo list/show/pick/unpick/add/remove/fork/open`                                  |
| 管理環境與 Agent       | `env list/show/pick/unpick`、`agent list/pick/unpick`                              |
| 管理工具和 Skill       | `tool list/show/install/update`、`skill list`                                      |
| 管理共用來源           | `manifest validate/lint/explain/schema/providers/set/render/import`、`source push` |
| 查詢成員與設定         | `member list/show`、`config list/get/set/unset/export/import`                      |
| 檢查宿主資源           | `hook list/inject/remove`、`mcp list/show`                                         |
| CLI 資訊與更新         | `self info/update`、`completion`                                                   |

完整語法以 `--help` 和[自動產生的 CLI 參考](docs/cli/README.md)為準。

## 給編碼 Agent {#for-coding-agents}

使用 `--format json` 或 `FX_FORMAT=json`。stdout 只包含資料；通知、進度和錯誤寫入 stderr。集合格式為 `{items, has_more, next?}`，缺少或未知的值會明確表示。

`--fields` 可選取欄位，`--quiet` 抑制通知，`--no-input` 禁止等待輸入。寫入命令支援 `--dry-run` 和唯讀模式；`--allow-writes` 是單次呼叫的明確覆寫。

doctor/release 即使有失敗檢查也傳回結束代碼零；init/sync 也可能在部分成功時傳回零。init 查看 `sync.summary`、`sync.stages`；sync 查看 `summary`、`stages` 和每個失敗項目的 `failure`。`stage_details` 保留資源階段結果和 handoff。不要把結束代碼當作就緒證據，不要虛構驗證或繞過宿主信任。

先讀[內建 Skill](skills/fx-workspace/SKILL.md)和[回應指南](skills/fx-workspace/references/commands.md)，再設定 `FX_SKILL_LOADED=1`。`self info` 可定位安裝後的 Skill。

## 設定 {#configuration}

`~/.fx` 儲存工作區註冊、個人層、資源擁有權狀態、信任和快取。`FX_HOME` 只改變 fx 的個人目錄，不改變配套工具的憑證位置。

`config list` 顯示設定鍵、預設值、環境變數名稱及實際來源；`config get <key> --explain` 顯示各層。優先順序為明確參數、環境變數、設定檔、內建預設值。使用 `config export/import` 遷移個人設定。

`format` 控制輸出。`command_shell` 只控制產生命令的文字，不改變執行方式；auto 在 Windows 選擇 PowerShell，其他平台選擇 POSIX。可使用 `--command-shell`、`FX_COMMAND_SHELL` 或 cmd 設定覆寫。manifest 中的 shell 範本保持原樣。

自動補齊支援 bash、zsh、fish 和 PowerShell，透過 `fx completion <shell>` 產生，依需求自行載入。

## 開發與驗證 {#development}

使用 package.json 固定的工具版本。執行 `npm ci` 與 `npm --prefix docs/website ci`，隨後執行 lint、typecheck、Node/Bun 單元測試、e2e、CLI 文件與網站檢查、套件掃描。請參閱[驗證指南](docs/validation.md)和[工程規則](AGENTS.md)。Windows 驗收有獨立的 `npm run check:windows`。

`npm run test:contract` 是選用的唯讀整合檢查，需要明確提供測試座標。Bitbucket 使用 `FX_TEST_BITBUCKET_HOST` 和 `FX_TEST_BITBUCKET_REPO`；Jenkins 使用 `FX_TEST_JENKINS_JOB`，可選 `FX_TEST_JENKINS_CONTEXT`；Sentry 使用 `FX_TEST_SENTRY_HOST`、`FX_TEST_SENTRY_ORG`、`FX_TEST_SENTRY_PROJECT`。缺少座標時略過；已設定但存取失敗時檢查失敗。

公開發佈前須完成[發佈清單](docs/public-release.md)。目前 Jenkins 的版本標籤發佈入口仍受私有 registry 限制。

## 網站與文件 {#documentation}

[靜態網站維護指南](docs/website/README.md)說明多語言內容、GitHub Pages 部署與本機預覽。英語是技術事實的基準；尚未翻譯的深入技術參考會明確標示英文。

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

Agent 探索包括 Claude Code、Codex CLI、Cursor 等已註冊宿主。Skill、hook、MCP 與規則的支援因宿主而異；使用 `agent list`、`hook list`、`mcp list` 檢查具體能力。請參閱[宿主契約](docs/design/harness.md)。

## 常見問題 {#faq}

### 必須採用 monorepo 嗎？

不需要。儲存庫保留各自的分支、歷史、相依套件和建置工具；工作區根目錄為普通目錄。既有 checkout 可以[匯入並納入管理](docs/design/import.md)。

### 團隊必須公開 manifest 嗎？

不需要。工具與團隊維運資料分離。manifest 存放在權限適當的儲存庫，憑證仍由所屬工具管理。請參閱[公開與私有界線](docs/private-manifest.md)。

### 報告結束代碼為零就代表成功嗎？

不代表。doctor/release 可在檢查失敗時傳回零，init/sync 可傳回部分成功。應檢查 `ok`、`complete`、階段結果和失敗復原資訊。請參閱[回應契約](skills/fx-workspace/references/commands.md)。

## 參與貢獻 {#contributing}

歡迎問題回報、聚焦修正、文件改進和翻譯。先閱讀[貢獻指南](https://github.com/AngelMsger/fx-devkit/blob/main/CONTRIBUTING.md)，了解設定、驗證和 PR 要求。較大的行為或 provider 變更應先透過 issue 討論。

功能變更包含文件變更：英文來源文件與對應譯文需要一起更新，網站建置會檢查翻譯是否過期。[路線圖](docs/roadmap.md)明確區分潛在擴充與目前能力。

## 支援與安全 {#support-and-security}

[回報問題](https://github.com/AngelMsger/fx-devkit/issues)時，請提供 `fx --version` 輸出、作業系統、命令、預期行為和去識別化的重現步驟。設定失敗時，附上相關 doctor 結果和 handoff。

疑似弱點請遵循[安全報告指南](https://github.com/AngelMsger/fx-devkit/blob/main/SECURITY.md)。公開報告中不要包含憑證、個人資訊或團隊私有座標。

## 授權條款 {#license}

本專案採用 [Apache License 2.0](https://github.com/AngelMsger/fx-devkit/blob/main/LICENSE)。
