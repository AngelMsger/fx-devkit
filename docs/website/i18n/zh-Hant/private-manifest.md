# 你的資料與憑證

團隊 manifest 描述儲存庫、工具和服務座標。請將它保存在存取權限合適的團隊儲存庫中；使用 fx 不要求公開 manifest。

## 本機狀態 {#what-stays-on-your-machine}

fx 預設在 `~/.fx` 儲存工作區註冊、個人選擇、偏好、信任決策和操作狀態。可以使用 `FX_HOME` 更改位置。manifest checkout 與業務儲存庫分開保存。

`fx config export` 匯出受支援的偏好與個人層，不包含憑證、信任記錄和 manifest clone。分享前仍需審閱匯出內容：儲存庫選擇與個人覆寫可能透露團隊上下文。

## 驗證 {#authentication}

服務憑證由配套工具負責。依工具正常流程登入，不要將 token 寫入 manifest 或共用 Agent 指引。缺少存取權限時，fx 會檢查就緒狀態並提供對應的設定步驟。

一台機器選中了某個環境，不代表另一台機器也有權限。使用 `fx can <capability> --env <environment>` 或 `fx doctor` 檢查。

## 團隊知識 {#sharing-team-knowledge}

共用儲存庫資訊、環境座標和團隊 Skill 儲存在受控的 manifest 來源中。成員文件需要 `sensitive: true`，但該標記不能代替儲存庫存取控制。

只有明確執行 `fx source push` 才會提交選定的來源變更。先使用 `--dry-run` 檢查檔案和目標。一般工作區同步不代表發佈團隊來源。

## 問題回報 {#reporting-a-problem}

公開報告只應包含最小化、已去識別化的範例。移除憑證、成員資訊和私有服務位址。請參閱[支援](support.md)。
