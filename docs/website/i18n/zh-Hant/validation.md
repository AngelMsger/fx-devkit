# 驗證與支援範圍

本頁說明如何驗證 checkout，以及每類檢查能支持什麼結論。團隊試驗記錄、業務 patch、問題識別碼和機器或帳號狀態應保留在公開儲存庫之外。

## 必要的本機檢查 {#required-local-checks}

使用 package.json 固定的開發版本：

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

單元測試透過注入端口覆蓋領域決策和應用流程。E2e 使用暫存設定與儲存庫 fixture 執行建置後的 CLI。CLI 文件檢查會重新建置並比較產生結果。網站從標準 Markdown 產生，檢查來源是否過期、內部連結和資源是否有效，請參閱[網站指南](website/README.md)。套件掃描覆蓋宣告的發佈路徑，包括內建 Skill 和公開入口文件。

本機檢查通過不能證明實際帳號權限、遠端資源存在、套件已發佈或 Agent 宿主已啟用。私有驗證記錄應保留版本、執行環境和準確命令，不要提交真實憑證、回應或逐字記錄。

## 實際整合 {#live-integrations}

`npm run test:contract` 是選用的唯讀檢查，使用 [README 開發章節](../README.md#development)中的明確座標。缺少輸入時略過；設定後存取失敗則檢查失敗。

驗證屬於配套工具。重複使用支援的本機憑證，不要複製到測試 fixture。宿主專案的信任是獨立界線；正確的 hook/MCP 檔案不證明已啟用。實際 source push 和 PR 還需要已安裝配套工具提供可驗證的 fork 父子關係。

## 平台覆蓋 {#platform-coverage}

POSIX 自動檢查覆蓋程序管理、檔案擁有權與 CLI 行為。Windows 介接器雖已實作，實際執行、跨磁碟區 junction 與宿主啟用需要獨立的 [Windows 驗收](design/windows.md)。不能從 POSIX 執行或注入平台標記推斷 Windows 結果。

Agent 協議各異，使用 `hook list`、`mcp list/show` 區分支援、不支援與未驗證狀態，並在發佈說明中保留區別。

## 獨立 Agent 評估 {#independent-agent-evaluation}

[評估協議](eval/README.md)覆蓋工作區探索、就緒、Skill 選擇、來源追溯和任務品質。使用 fixture 或明確授權的私有 manifest；完整證據留在公開儲存庫外，只發佈審閱過的彙整結論。

## 公開原始碼快照 {#preparing-a-public-source-snapshot}

npm 套件掃描不等於整個 Git 儲存庫審閱。原始碼、測試、範例、文件、patch、忽略檔案和歷史需要分別檢查。虛構範例仍應保留協議語義，避免使用組織真實拓撲和識別碼。

刪除工作樹檔案不能刪除既有提交。公開快照可以不含 `.git`，並建立新的公開歷史；保留私有原件，改寫或公開歷史是獨立操作。本專案已採用 Apache-2.0，發佈審閱仍需檢查第三方聲明與產物中的授權條款文字。公共 npm 發佈不公開團隊 manifest，也不改變配套套件的發佈原則；fx 本身的遷移請參閱[發佈清單](public-release.md)。
