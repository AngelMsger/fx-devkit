# 更新日誌

## 尚未發佈

- 新增 Jira 工作項 provider 與飛書知識庫 provider，這兩個能力各有了第二種實作；一個配套 CLI 服務多個能力時仍只安裝與檢查一次。
- workspace 的工具鏈改為從其繫結的 provider 推導，內建工具不必再宣告一次；`tool list` 說明每個工具是被繫結帶進來的還是 manifest 宣告的，`--catalog` 列出其餘的。
- manifest 宣告了同名工具時，能力可以繫結 fx 未實作的 provider；僅與內建工具同名的 provider id 會被指出更正，而不是照單全收。
- tools 文件的 `defaults` 區塊支援 `install_on_init`，個別條目仍可覆寫。
- 能力已繫結 provider，但工具文件未宣告該 provider 所用配套工具時回報 `TOOL_UNDECLARED`，不再誤稱該能力沒有 provider。
- platform 的 `service` 依其名稱推導出的 provider 驗證：合法宣告不再被誤報，先前被略過的真實問題也會回報。
- 預先記錄 session-start 背景執行承諾進行的階段，worker 被終止時未執行到的階段會留下 `HOOK_PHASE_UNREPORTED`，不再直接消失。
- session-start 背景執行中某條伴隨命令用盡預算時不再終止整個執行，其後的每個階段照常給出結論；宿主正在等待的前景執行仍在該處結束。
- 分離的背景執行如何結束，記錄為 workspace 的 `run` 觀測，先前其 supervisor 只能寫進無人讀取的串流。

- 修復所有格式的報告欄位投影、復原命令的 workspace 上下文與貢獻鎖內的來源身分驗證。
- 支援經驗證的本機 Git 匯入與相符 upstream 的安全補充，按啟用及必要工具宣告統一準備狀態。
- 接受各類宣告的 setup 驗證形式，並在 manifest 合併時保留可空比較值。

- 新增全域工作區探索、健康診斷、解除管理、重定位與換源；保留業務 checkout，阻止同目錄重複身分。
- 新增 repo/env select 的固定、動態全部與空集合模式；首次 init 可先選擇儲存庫，本機來源預覽顯示實際計畫。
- 修復未追蹤檔案在狀態篩選中被遺漏、必需 manifest 遺失卻驗證通過，以及舊可讀性快取阻擋正常恢復。
- doctor 預設按實際宣告與活躍 provider 檢查工具，保留明確指定工具的檢查。
- 相容性說明：init 的 registered 現在表示實際註冊狀態；預覽動作另列於 plan。config import 按名稱合併並保留未提到的註冊，不再以省略名稱來解除管理。

## 0.2.1 (2026-09-18)

- 精簡儲存庫入口與 bundled Skill，詳細復原步驟集中至命令參考。
- 同步四語言的報告、就緒、Skill 載入與服務版本說明，使其符合目前行為。
- 修正站點發佈狀態與預覽範例，補充公共相依套件的 Registry scope 分流說明。

## 0.2.0 (2026-09-17)

- 不相容變更：四類工作流程報告預設精簡 JSON，完整資料使用 `--details`，明確的 `--fields` 仍從完整結果投影。
- 修正明確的空 Agent 選擇；新增 `FX_SKILL_VERSION` 核對與 `bundled_skill_version`。
- 新增 `operation`、`preparation_complete` 與 `SKILL_WRITE_DENIED`，保留部分結果及具體復原步驟。

- 新增獨立伴生 Skill install、uninstall、path、status 與 show 命令。
- 在工作區指南產生團隊 Skill 的觸發說明與來源連結。
- 區分明確更新與自動維護，並保護團隊共享來源。

- 初始化與明確執行的同步支援公共服務預設、指定服務的個人登入與原生衝突復原。
- 拒絕共用 service 中的個人憑證，保留既有配套工具設定。

- 跨已註冊工作區記錄工具安裝歷史與來源，僅提示不再需要的 fx 安裝套件，不自動解除安裝。
- 說明與補全優先顯示標準資源命令，保留相容別名。

## 0.1.2

已在內部 Registry 提供；公開發佈仍保留。

- 修復明確指定的輸入、就緒狀態、Git 來源復原與設定並行更新。
- 保留初始化部分結果，精簡終端輸出並回報儲存庫進度。
- 隔離等待授權的 Skill 命令，保護使用者共用副本，說明宿主啟用限制。
- 為選用的程式碼託管探測設定期限，在保留取消語意的同時回報事前檢查進度。
- 支援工作區根目錄的路徑別名，中斷後保留逐項安裝結果與資源狀態。

## 0.1.1

已在內部 Registry 發佈, 公開發佈仍暫停. Git tag、套件發佈和本機安裝是獨立狀態.

`fx-devkit` / `fx`; Apache-2.0. `@fx/devkit` / `@angelmsger/fx`.

- `install_on_init` (fx ≥0.1.1).
- 宣告驅動的工作區初始化、同步和儲存庫選擇.
- 結構化設定、探索、就緒與發佈報告.
- 配套工具、Agent Skill、生命週期 hook 和 MCP 投影.
- 保留信任、所有權和復原邊界的原始碼貢獻計畫.
- 已實作 Windows 介面卡; 原生執行與宿主啟用仍未驗證.
