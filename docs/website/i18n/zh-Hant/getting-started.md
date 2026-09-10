# 使用 fx

安裝 fx，連接團隊 manifest，並管理儲存庫、工具與編碼 Agent。

## 環境需求 {#requirements}

- Node.js ≥22；開發版本以 package.json 為準。Bun 也可以作為執行環境。
- Git 位於 PATH 中。全域安裝和 `fx self update` 仍需要 npm，包括使用 Bun 時。
- 團隊提供的 manifest，或[自行建立的 manifest](manifest-guide.md)。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行和 Agent 宿主啟用尚未完成驗證；目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。請參閱 [Windows 支援範圍](support.md#platform-support)。

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

harness 向所選宿主投射 MCP 項目和規則參照，機密值保持為環境變數參照。`mcp list/show` 和 `can mcp:<name>` 說明先決條件；設定正確不代表宿主已啟用。請參閱 [MCP 契約](user-guide.md#for-coding-agents)。

工作區啟動掛鉤可以傳回快取上下文，並在背景更新 manifest、文件和 Skill；不會同步業務儲存庫或確認信任。宿主仍控制專案與掛鉤的信任。使用 `hook list/inject/remove` 管理，請參閱[生命週期契約](user-guide.md#for-coding-agents)。

### 貢獻共用知識

`source push` 可預覽或提交所選來源檔案，保留來源 checkout 的 HEAD、索引和工作檔案。提交需要個人 fork 及其上游關係的證據。實際提交前閱讀 `fx source push --help` 與[貢獻契約](cli/README.md#fx-source-push)。

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

完整語法以 `--help` 和[自動產生的 CLI 參考](cli/README.md)為準。

## 給編碼 Agent {#for-coding-agents}

使用 `--format json` 或 `FX_FORMAT=json`。stdout 只包含資料；通知、進度和錯誤寫入 stderr。集合格式為 `{items, has_more, next?}`，缺少或未知的值會明確表示。

`--fields` 可選取欄位，`--quiet` 抑制通知，`--no-input` 禁止等待輸入。寫入命令支援 `--dry-run` 和唯讀模式；`--allow-writes` 是單次呼叫的明確覆寫。

doctor/release 即使有失敗檢查也傳回結束代碼零；init/sync 也可能在部分成功時傳回零。init 查看 `sync.summary`、`sync.stages`；sync 查看 `summary`、`stages` 和每個失敗項目的 `failure`。`stage_details` 保留資源階段結果和 handoff。不要把結束代碼當作就緒證據，不要虛構驗證或繞過宿主信任。

先讀[內建 Skill](../skills/fx-workspace/SKILL.md)和[回應指南](../skills/fx-workspace/references/commands.md)，再設定 `FX_SKILL_LOADED=1`。`self info` 可定位安裝後的 Skill。

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
