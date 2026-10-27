# 支援與更新

## 排查問題 {#troubleshooting}

初始化中斷時，先處理結果列出的阻塞項，再使用傳回的繼續命令：

```sh
fx init --resume --workspace <name>
```

已完成的工作會保留。個人登入及操作員檔案由對應人員完成。既有工作區可用 `fx doctor --format json` 查看目前準備狀態與具體操作；單項能力使用 `fx can <capability>`。

能力未就緒時，重新登入前先看其檢查得到的回答。待處理的步驟帶有工具的訊息；fx 能判斷時還會指出是未能建立驗證、權限被拒絕，還是連線未能建立。權限被拒絕或連線失敗不需要重新登入。沒有提供成因時，以工具的訊息和步驟的說明為準，不要預設結論。在 `can` 與 `where` 中，沒有得到回答的檢查傳回 `unknown`：修復它指出的工具，或在逾時後重新查詢。`fx doctor --tool <tool> --env <env>` 可查看單一工具的同一份細節。

`preparation.state` 為 `ready` 或 `incomplete`，未完成結束代碼為 12。`doctor.coverage` 單獨表示診斷涵蓋範圍；release 使用 `ok/complete`。非零結束代碼也要解析部分 stdout。

來源錯誤會標示檔案與欄位。工具 schema 3 要求 run 步驟明確區分本機準備與個人驗證。新輸入尚未接受時，修正來源後使用傳回的完整重試命令；已接受的初始化使用託管來源續跑。`fx workspace list` 與 `fx self info` 可用於發現。目錄移動後使用 `workspace relocate`；個人憑據始終留在配套工具中。

## 更新 {#updates}

`fx self info --format json` 顯示已安裝版本、執行環境、有效的 `registry` 與 `registry_source`。fx 重用 npm 使用者/全域設定，先取套件 scope Registry，再取預設 Registry；`FX_REGISTRY` 是較高優先序的選用覆寫。專案 npmrc 不能重新導向全域自我更新。一般中繼資料查詢由 npm 處理驗證與 `NPM_CONFIG_USERCONFIG`；無效覆寫會回報，不會靜默忽略。

<!-- distribution:internal -->

`@fx/devkit` 可直接使用既有的 `@fx:registry` 或私有預設來源。兩者都沒有時，取得團隊位址並一次性關聯 scope：

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
fx self update --dry-run
```

URL 為虛構範例。單次安裝參數不保證保存該關聯，下載用的 tarball URL 也不等於 Registry API 位址。`FX_REGISTRY` 仍可暫時覆寫本次呼叫。

### Registry 路由

自我更新只固定 fx 的 scope，公共相依套件仍遵循 npm 預設來源。若私有預設來源代理公共套件失敗，且團隊允許直接連線 npmjs，可保留已設定的 `@fx` 私有 scope，並在安裝時使用：

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/
```

須先設定 scope。這是單次路由選擇，不修改憑證或修復代理，也不需另設 fx 專用 Registry。

<!-- /distribution -->

<!-- distribution:public -->

公開套件遵循 npm 的 `@angelmsger:registry` 與預設來源；無法讀取有效 npm 設定時才預設使用 npmjs。`FX_REGISTRY` 可指定鏡像，先以 `fx self update --dry-run` 預覽。

<!-- /distribution -->

原始碼安裝透過 Git 更新，再於 checkout 內執行 `npm ci` 與 `npm run build`。fx 本體更新與重新整理 manifest 的 `fx sync` 分開。`self update --format json` 保持 stdout 可解析，請檢查安裝器 `code` 與失敗時的 `reason`，不要僅憑收到 JSON 判定成功。更新成功後，新安裝的 fx 會更新比它舊的自身 Skill 副本；`skill_refresh` 回報這次執行，以及更新的副本數 `refreshed`。

## 平台支援 {#platform-support}

需要 Node.js 22 或更新版本和 Git。Bun 可作為執行環境；npm 安裝和自我更新仍需要 npm。

支援 macOS 和 Linux。原生 Windows 介接器已實作，但 Windows 實機執行、跨磁碟區 junction 和原生宿主啟用尚未驗證。目標為本機 NTFS 上的 PowerShell 5.1/7 和 cmd。PowerShell 原則阻止 `.ps1` shim 時可使用 `.cmd` 入口。

各 Agent 宿主對 Skill、hook、MCP 和規則的支援不同。使用 `fx agent list`、`fx hook list` 和 `fx mcp list` 查看所選宿主的狀態。

<!-- distribution:internal -->

## 回報問題 {#report-an-issue}

透過團隊內部支援管道聯絡 fx 維護者，附上 `fx --version`、作業系統、命令、預期行為及去識別化後的重現步驟。

## 安全報告 {#security-reports}

請私下向維護者回報安全問題。共享報告中不要包含憑證、個人資訊和團隊內部連線位址。
<!-- /distribution -->

<!-- distribution:public -->

## 回報問題 {#report-an-issue}

透過 [GitHub Issue](https://github.com/AngelMsger/fx-devkit/issues) 提供版本、作業系統、命令、預期行為及去識別化後的重現步驟。

## 安全報告 {#security-reports}

請使用[私密弱點回報](https://github.com/AngelMsger/fx-devkit/security/advisories/new)，不要公開憑證、個人資訊或內部連線位址。
<!-- /distribution -->
