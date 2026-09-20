# 支援與更新

## 排查問題 {#troubleshooting}

先執行 `fx doctor --format json`。針對某項能力，使用 `fx can <capability> --env <environment> --format json`。依報告中的 handoff 處理，不要反覆重試缺少存取權限的命令。

- 缺少工具：使用 `fx tool show <tool>` 查看安裝需求。
- 缺少驗證：使用 `fx login --list` 查看步驟，再進入對應登入流程。
- 環境未被選取：檢查 `fx env list`，只在需要時將它納入工作區。
- manifest 無效：執行 `fx manifest validate --strict`，並使用 `fx manifest explain '<field>'` 查詢問題欄位。
- 同步部分失敗：查看儲存庫項目和資源階段的錯誤，解決後使用 `fx sync --only <stage>` 重試相關操作。

報告結束代碼為零不代表已就緒。請閱讀 `ok`、`complete`、各項結果和復原資訊。

工作區解析或 manifest 載入失敗時，先執行 `fx workspace list`、`fx workspace show <name>` 與 `fx self info`，保留查看註冊與安裝事實的能力。目錄移動後使用 `workspace relocate` 修正根路徑；manifest 遺失時依記錄來源重新準備。必需工作區文件遺失或無效時，`manifest validate --strict` 會判定失敗；選用且未宣告的文件允許不存在。

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

原始碼安裝透過 Git 更新，再於 checkout 內執行 `npm ci` 與 `npm run build`。fx 本體更新與重新整理 manifest 的 `fx sync` 分開。`self update --format json` 保持 stdout 可解析，請檢查安裝器 `code` 與失敗時的 `reason`，不要僅憑收到 JSON 判定成功。

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
