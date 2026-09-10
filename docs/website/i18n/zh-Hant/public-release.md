# 公開發佈準備

專案為 `fx-devkit`，npm 套件為 `@angelmsger/fx`，可執行命令為 `fx`。儲存庫的版本號不是套件已經發佈的證據。

## 發佈目標 {#distribution-target}

在公共 npm 以 public access 發佈。安裝 fx 不應依賴私有 registry、團隊帳號或 manifest checkout。團隊 manifest 和連接服務仍遵循各自的存取控制。

## 已設定的公開位址 {#configured-publication-coordinates}

參考 oa-cli 的公開套件慣例，使用以下推斷位址：

- 儲存庫：[AngelMsger/fx-devkit](https://github.com/AngelMsger/fx-devkit)。
- 官網：[fx-devkit](https://angelmsger.github.io/fx-devkit/)。
- 問題回報：[GitHub Issues](https://github.com/AngelMsger/fx-devkit/issues)。
- 套件存取層級：`public`；授權條款：[Apache-2.0](../LICENSE)。

這些是設定的發佈目標，不代表遠端、官網或 npm 版本已經存在。網站原始碼位於 `docs/website/`。README 使用公開文件位址，讓 npm 使用者不需要原始碼樹；網站建置會將自身公開連結轉換為目前語言的站內連結。

## 實作待辦與發佈決策 {#remaining-implementation-and-release-decisions}

- 一併遷移 registry 原則、中繼資料查詢、自我更新、發佈 wrapper/guard 及測試。目前它們拒絕公共 npm 或要求私有位址，位置請參閱 [registry 遷移](design/registry-configuration.md)。
- 建立公共儲存庫時核對已設定的儲存庫、官網和問題回報位址；發佈前確認套件名稱、版本及 `@angelmsger` scope 權限。
- 審閱實際發佈涉及的第三方聲明。Apache-2.0 已選定，套件內包含完整授權條款文字。
- 靜態網站已有 GitHub Pages 工作流程，獨立於 npm 發佈。套件 CI 的一般檢查仍需移除私有憑證與 manifest 的要求。現有 Jenkins 在整個流程繫結 `npm-token`，並在 `v*` 標籤上發佈；npm 上線前要調整驗證和標籤原則。
- 儲存庫和官網上線後核對推斷的公開連結。npm 套件刻意排除文件原始碼和網站工具鏈，README 連結指向公開網站或原始碼儲存庫。
- 保留私有整合檢查與 Windows 實機驗收範圍，不能把離線測試視為宿主實測。

## 原始碼與產物審閱 {#source-and-artifact-review}

審閱候選檔案和路徑，包括測試、指令碼、patch、符號連結和非文字資源。只掃描 npm 套件並不充分。組織專屬偵測字典和原始結果留在私有位置；審閱合成安全案例，不應直接刪除有效測試。

公開前檢查全部擬發佈的 Git ref、提交訊息及作者身分。不要合併或鏡像私有前身歷史；遷移對照與原始證據應另外封存。

執行[驗證指南](validation.md)的檢查，檢查實際 npm tarball（包括 source map 和隱含檔案），在隔離環境驗證安裝。授權條款、metadata、registry 或 CI 改變後，重新執行發佈檢查。

## 私有資料界線 {#private-data-boundary}

manifest 來源管理共用座標、人員和團隊規則。歷史業務 patch、原始試驗日誌和調查報告應放在適當受限的證據儲存空間，不應自動進入全體成員可讀的 manifest。憑證留在其所屬工具中。
