# 支援與更新

## 排查問題 {#troubleshooting}

先執行 `fx doctor --format json`。針對某項能力，使用 `fx can <capability> --env <environment> --format json`。依報告中的 handoff 處理，不要反覆重試缺少存取權限的命令。

- 缺少工具：使用 `fx tool show <tool>` 查看安裝需求。
- 缺少驗證：使用 `fx login --list` 查看步驟，再進入對應登入流程。
- 環境未被選取：檢查 `fx env list`，只在需要時將它納入工作區。
- manifest 無效：執行 `fx manifest validate --strict`，並使用 `fx manifest explain '<field>'` 查詢問題欄位。
- 同步部分失敗：查看儲存庫項目和資源階段的錯誤，解決後使用 `fx sync --only <stage>` 重試相關操作。

報告結束代碼為零不代表已就緒。請閱讀 `ok`、`complete`、各項結果和復原資訊。

## 更新 {#updates}

`fx self info --format json` 顯示版本、執行環境和套件更新來源。目前預發佈版本可透過 Git 更新原始碼 checkout，再於該目錄執行 `npm ci` 和 `npm run build`。

使用套件安裝且有可用更新來源時，先查看 `fx self update --dry-run`。目前版本的套件自我更新需要明確設定私有 registry；原始碼安裝可依上述方式更新，不需要該命令。更新 fx 與更新團隊 manifest 是不同操作，`fx sync` 會更新符合條件的 manifest 來源。

## 平台支援 {#platform-support}

需要 Node.js 22 或更新版本和 Git。Bun 可作為執行環境；npm 安裝和自我更新仍需要 npm。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行、跨磁碟區 junction 和原生宿主啟用尚未驗證。目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。PowerShell 原則阻止 `.ps1` shim 時可使用 `.cmd` 入口。

各 Agent 宿主對 Skill、hook、MCP 和規則的支援不同。使用 `fx agent list`、`fx hook list` 和 `fx mcp list` 查看所選宿主的狀態。

## 回報問題 {#report-an-issue}

[建立 issue](https://github.com/AngelMsger/fx-devkit/issues) 時，提供 `fx --version` 輸出、作業系統、命令、預期行為和去識別化重現步驟。設定問題請附相關檢查項目和 handoff。

## 安全報告 {#security-reports}

優先使用可用的[私有弱點回報](https://github.com/AngelMsger/fx-devkit/security/advisories/new)。若該入口不可用，可在 issue 中請求私有聯絡管道，不要公開敏感細節。報告中不要包含憑證、個人資訊和團隊私有座標。
