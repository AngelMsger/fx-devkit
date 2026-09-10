# 公開工具與私有團隊設定

公開 fx-devkit 不代表公開團隊的工作區。團隊成員仍使用組織自己的儲存庫、服務環境、配套 CLI 和既有存取控制。

## 公開儲存庫中保留什麼 {#keep-in-this-repository}

- CLI 實作、provider 介接器與原生 Agent 協議。
- Schema、一般使用文件和虛構範例。
- 保留真實協議語義的合成資料與離線測試。
- 內建 fx-workspace Skill 和一般貢獻指南。

## 團隊私有來源中保留什麼 {#keep-in-the-teams-private-source}

- 實際儲存庫 URL、分支、負責人和存取聯絡人。
- 環境主機、日誌流、錯誤追蹤專案、建置工作和叢集座標。
- 跨儲存庫業務架構與產品特有流程。
- 團隊 Skill、已授權的案例定義和適當受限的評估證據。

私有 manifest 可以使用 Git 管理。`init`、`sync`、`manifest`、`member`、`where`、`release` 與 `source push` 的職責不變。Provider 和安裝程式設定仍由資料驅動；公開原始碼不能透過刪除整合或將私有服務替換為公共服務而改變實際行為。

## 本機保留什麼 {#keep-on-each-machine}

憑證由各配套工具負責。FX_HOME 儲存選擇、偏好、信任與操作狀態。匯出設定不含機密、信任記錄和 manifest clone。其他機器的檢查成功不能證明本機已就緒。

## 範例與相容性 {#examples-and-compatibility}

包含 example 的名稱和 example.com 網域都是虛構範例，不是真實組織的預設設定。儲存庫識別碼和服務識別碼可以不同，必要時明確設定 `obs.svc`。舊 `fx-` 服務命名慣例僅為相容性保留，新 manifest 不必採用。

計畫中的公共 npm 套件不需要私有 registry 權限。團隊的私有 manifest、配套套件和服務仍可獨立管理。fx 本身的發佈與自我更新還需要完成 [registry 遷移](design/registry-configuration.md)，工具採用 [Apache-2.0](../LICENSE)，該授權條款不授予存取私有 manifest 或服務的權限。
