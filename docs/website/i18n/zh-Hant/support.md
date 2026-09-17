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

<!-- distribution:internal -->

套件安裝使用團隊透過 `FX_REGISTRY` 指定的私有 Registry。

`fx self info --format json` 顯示版本、執行環境和套件更新來源。原始碼安裝可透過 Git 更新 checkout，再於該目錄執行 `npm ci` 和 `npm run build`。

使用套件安裝且有可用更新來源時，先查看 `fx self update --dry-run`。目前版本的套件自我更新需要明確設定私有 registry；原始碼安裝可依上述方式更新，不需要該命令。更新 fx 與更新團隊 manifest 是不同操作，`fx sync` 會更新符合條件的 manifest 來源。

### Registry 路由

如果私有 Registry 可提供 fx，但代理公共相依套件失敗，先檢查失敗套件的 URL。團隊原則允許直接存取 npmjs 時，可讓 fx scope 維持私有來源，僅將公共相依套件導向 npmjs：

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/ --@fx:registry="$FX_REGISTRY"
```

這是單次命令的路由選擇，不修改憑證，也不表示私有代理已修復。`FX_REGISTRY` 仍指定 fx 的內部中繼資料與自我更新來源。

<!-- /distribution -->

<!-- distribution:public -->

公開套件預設從 npmjs 檢查更新，可透過 `FX_REGISTRY` 指定鏡像。執行前先查看 `fx self update --dry-run`。原始碼安裝透過 Git 更新後重新建置。fx 本體更新與重新整理 manifest 的 `fx sync` 是不同操作。
<!-- /distribution -->

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
