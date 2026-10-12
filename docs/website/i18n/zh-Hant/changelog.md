# 更新日誌

## [Unreleased]

- 將 `fx release` 改名為 `fx release check`，讓名稱表明它檢查發佈而不是執行發佈。`fx release` 作為相容名稱繼續可用。
- 說明每次發佈將交付的內容。`fx release check` 在每個儲存庫開頭列出目標分支宣告的版本、兩個分支的最新提交，以及來源分支上尚未合併到目標分支的提交數和作者人數；全部檢查都通過的儲存庫也在最後各用一行說明同樣的內容。JSON 報告新增包含這些資訊的 `repos[]`，摘要中也有；既有欄位不變。
- CI 結論註明它對照的提交，合併檢查改為「未合併到 main」和「未合併回 dev」，CI 與錯誤訊息使用各平台自己的作業或專案名稱。CI 證據新增 `head`。
- 依 manifest 結構描述的說明，在發佈報告中顯示儲存庫的 `release.note`。

## 0.10.1 (2026-10-12)

- 在 npmjs 發佈公開套件 `@angelmsger/fx`，並為每個版本標籤在 GitHub Release 附上 tarball。內部的 `@fx/devkit` 管道維持不變。
- `fx release` 的 human 輸出依儲存庫分組。每個有失敗或警告檢查的儲存庫單獨列一塊，列出它的全部檢查；所有儲存庫共有的問題（例如沒有人登入的工具）連同解決它的命令只在它們上方說明一次；全部檢查都通過的儲存庫合併在最後一行。`--details` 也會列出這些儲存庫的檢查。JSON 與 NDJSON 輸出維持不變。

## 0.10.0 (2026-10-10)

- 不帶目標的 `fx can` 列出目前工作區可以查詢的能力：manifest 可繫結的每個能力一列，環境級能力按平台實例各一列，包含作用域、provider、配套工具和用途。未繫結的能力保留一列，provider 為空。該清單只讀取繫結；查詢單一能力時仍會檢查就緒狀態。
- 說明就緒檢查失敗時得到的回答。`can`、`where`、`doctor`、`login` 的 handoff 中，每個待處理步驟現在帶有 `check`：工具自己的說法，或該步驟正在等待的另一步驟。fx 能讀懂失敗原因時還會給出成因，步驟的說明隨之改為針對該成因的處理方式。
- 區分叢集未能建立驗證、叢集回答「否」與叢集無法連通三種情況。叢集沒有把請求認作任何人的請求時，步驟現在指向 kubeconfig 及其登入方式，並提供取得新 kubeconfig 的頁面，不再要求向叢集負責人申請角色。
- 不連線叢集即可核對 kubeconfig 是否包含宣告的 context；叢集存取檢查的每個請求限時五秒。
- 檢查沒有得到回答時（工具未能啟動，或逾時），`can` 與 `where` 傳回 `unknown`，並將該檢查列在 `unfinished` 中。`where` 不再因為一個平台沒有回應而讓同一儲存庫的所有平台一起失敗。工具未能啟動時，`doctor` 與 `login` 回報缺少該工具，不再把步驟交給人處理。
- 環境未涵蓋某個平台時，原因統一為 `<env> declares no <platform> platform`。環境備註可能說的是另一個平台，不再充當這個原因。
- `fx login` 不再詢問你平時使用哪些環境。個人環境範圍只由 `fx env select` 設定：未設定時所有已宣告的環境都在範圍內，未以 `--env` 指定環境的登入會說明這一點以及如何收窄。此前即使以 `--env` 指定了環境也會被問；回答「全部」的人每次登入都會再被問；只按手邊這一次要登入的環境作答，則會收窄此後 `fx doctor` 與 `fx sync` 涵蓋的範圍。
- `fx can` 遇到無法識別的目標時，不再提示由 fx 自身接管的內部能力，下一步改為指向 `fx can` 和 `fx tool list`。

## 0.9.1 (2026-10-09)

- `init`、`sync`、`doctor` 未完成時的終端輸出將原因相同、解決命令也相同的檢查合併為一列，並以不同標記區分未能執行的檢查與執行後失敗的檢查。
- 未能完成的檢查不再要求登入。配套工具的檢查逾時後只提示重新檢查。
- 直接引用內建配套工具給出的未就緒原因，例如 `OpenObserve returned HTTP 401`，或對無需登入的服務請求失敗，不再只顯示 `expected authenticated to be true`。
- 對 fx 自己能更新的 Skill 副本提供 `fx doctor --fix`。
- 配套工具的 context 只要能存取宣告的服務，無論其擁有者以哪種方式登入都會被接受。`service` 宣告中的 `auth_scheme` 現在只決定 fx 如何新建 context 以及 `fx login` 提供哪種登入方式；準備、檢查和查詢只核對宣告的 URL、flavor 和組織，不再傳遞 `--auth-scheme`。既有的 context 缺少其中某個欄位時只補上該欄位，不再帶上宣告的登入方式；先前這會與以其他方式登入的 context 衝突。
- 每次明確執行 `fx sync` 都會關聯你既有的登入，不再只在 `fx init` 時進行。sync 現在和 init 一樣執行本機的 prepare 階段設定步驟，可沿用的登入不必再等人執行 `fx doctor --fix`；個人登入仍由本人完成，背景 hook 只檢查。
- 在 fx 知道含義的地方直接說明配套工具檢查未通過代表什麼：`fx doctor --fix` 可以關聯的既有登入顯示 `an existing login can be reused`；企業微信的三項檢查統一依回應中的錯誤碼判斷，未通過時顯示 `the WeCom API returned an error`。

## 0.9.0 (2026-10-09)

- 工作區根目錄只派生 `AGENTS.md`。fx 不再寫入指向它的 `CLAUDE.md`，`fx manifest render` 也不再在 manifest 儲存庫中建立該檔案：Claude Code 2.1.277 及以上版本會自行讀取 `AGENTS.md`，而只要存在 `CLAUDE.md` 就會改讀後者。`fx sync` 會移除早期版本派生的指標檔案；在移除之前，`fx doctor` 回報指南已過期。你自己寫的 `CLAUDE.md` 保持原樣，也不再算作指南衝突；請在其開頭寫上 `@AGENTS.md`，這樣 Claude Code 仍會讀取指南。如果 manifest 儲存庫裡還留有這個指標檔案，請將其刪除。
- manifest 來源的載荷不再包含 `CLAUDE.md`。目錄來源中的該檔案不再被複製到受管理的來源，stdin 套件若列出它，會以 `MANIFEST_SOURCE_INVALID` 拒絕。
- 命令執行期間顯示它仍在工作。超過半秒後，終端上出現一行原地重繪的狀態列：已用時間、可計數工作的進度，以及進行時間最長的那一項，例如 `doctor 23s  checks 69/82  kubectl.access@dev 3s`。所有命令都有這一行，因為 fx 等待的每個外部呼叫都在發起處回報；`doctor`、`sync`、`init`、`status`、`release` 與 `login` 還會統計各自的檢查項目、儲存庫與步驟。結果、通知與各項結局寫在狀態列上方，提問或登入命令在完成前獨占終端，命令結束或被中斷後狀態列消失。git 或安裝器執行期間可能在同一終端上詢問主機金鑰或密碼片語，這時不在它下方重繪，狀態列改為每五秒列印一行。在顯示狀態列的終端上不再列印逐項的 `start` 行與儲存庫心跳，因為狀態列給出同樣的資訊。管線、檔案、CI、`TERM=dumb`、`--quiet` 以及 JSON 或 NDJSON 輸出都不會收到狀態列，讀到的內容與先前完全一致。

## 0.8.0 (2026-10-09)

- fx 為內建工具定義的命令不再詢問信任，包括由 manifest `service` 宣告填入參數的服務準備、登入重用和憑證檢查。只有團隊 `tools.yaml` 修補編寫的命令向量仍需確認；已儲存的憑證可以送往哪裡由配套工具自行決定。
- 重排 `init`、`sync`、`doctor` 未完成時的終端輸出：每個阻擋項目帶上檢查項目 ID，登入命令按工具合併各環境，PATH 上找得到 `fx` 時命令寫作 `fx`，終端上不再於輸出之後附加 `PREPARATION_INCOMPLETE` 錯誤信封。JSON 輸出不變。
- 配套工具的 Skill 安裝進度按工具回報一次，不再每個 Agent 目錄回報一次。
- 團隊編寫的配套工具 Skill 命令只需確認一次。fx 附加的 Agent 名稱或目錄不再讓每個目標成為一條單獨待確認的向量，既有的確認繼續有效。
- 配套工具檢查失敗時以工具自己的說法說明原因：讀取它輸出的錯誤物件中的訊息，略過日誌記錄和警告，保留失敗位置之後的那一行，並寫出 JSON 檢查期望的值，例如 `expected authenticated to be true`。
- 讓 human 輸出在終端上更易讀：標題、狀態詞與為零的計數以顏色區分，檢查清單與進度帶有狀態符號，需要輸入的命令單獨突顯，表格依終端寬度收窄，阻擋項目的長原因在自己那一欄下折行，錯誤以帶提示、後續步驟與交接事項的文字顯示，不再是 JSON 信封。只有終端才帶裝飾，stdout 與 stderr 各自判斷：無論環境變數如何設定，管線、檔案與 CI 取得的都是純文字和 JSON 錯誤信封，JSON 與 NDJSON 輸出不變。`NO_COLOR` 去掉顏色，保留符號。
- human 表格依終端欄寬對齊，含中日韓文字的列不再錯位；清單與其尾部資訊之間空一行；缺少的值之後不再留行尾空格；記錄中的清單只要有一項過長就改為每個欄位一行，並省略空欄位。
- 根說明在終端上重新把常用命令的標題顯示為 `EVERYDAY`，`FIRST WORKSPACE`、`AGENT USAGE` 與 `COMPATIBILITY` 標題與其他標題一樣加粗。

## 0.7.1 (2026-10-09)

- `fx repo show` 回傳 `next_steps`，用於選取並同步尚未下載到本機的共用儲存庫；產生的儲存庫索引同時說明目錄包含這類儲存庫。
- 準備流程的終端輸出將每條個人登入命令只列印一次，隨後提供繼續執行的命令。
- manifest 使用明確的 Git URL 且未綁定程式碼託管時，同步儲存庫不再需要程式碼託管使用者名稱，也不再提示缺少它。
- 內建的 Sentry 工具改為透過 npm（`sentry`）安裝。

## 0.7.0 (2026-10-08)

- 將 `.workbench/` 定為不屬於任何儲存庫的產出的存放位置。派生指南新增 `workspace-layout` 區域說明規則；`fx doctor` 在 `root` 群組回報根目錄下沒有歸屬的項目；`fx status` 以 `stray_entries` 回傳它們；工作階段啟動內容帶出最近一次觀測。fx 不會寫入工作台。

## 0.6.0 (2026-10-08)

- `metrics` 能力有了實作：新增 `prometheus-cli` provider，並將該配套工具加入內建目錄。服務的座標是它的抓取 job；`where` 輸出指向所宣告服務的 `up{job="..."}` 查詢，且不提供探測，因為比對不到任何序列的選擇器同樣會成功。
- service 宣告的 `auth_scheme` 接受 `none` 與 `bearer`。宣告為無需登入的服務以是否回應判定就緒，不會被要求登入。
- 新增工作區能力 `meeting`，指承載線上會議、錄製與紀要的會議系統；提供由 `tmeet` 驅動的 `tencent-meeting` provider，`tmeet` 已加入內建目錄。`calendar` 保留行程與忙閒。

## 0.5.0 (2026-09-24)

- 在要求個人授權前，將已驗證的配套 CLI 登入重用至統一團隊 context；保留原生準備錯誤與驗證細節。配套 CLI 的最低版本要求已更新，需要支援 auth reuse。

## 0.4.0 (2026-09-21)

- 已移除 Skill 載入握手及 `skill_notice` 設定。`FX_SKILL_LOADED`、`FX_SKILL_VERSION`、`FX_SKILL_NOTICE` 不再使用；請改讀安裝版本和 `activation`，不要再讀取 loaded/version_verified。
- 初始化自動完成已授權的本機準備，並集中交接個人驗證；新增 `init --resume`，保留已完成工作。
- 統一 `preparation.state` 與具體復原操作；準備未完成結束代碼為 12，選用宿主啟用單獨回報。
- 寫入前阻止非法 manifest 項目；自動補齊目標指南並保留共享來源。工具 schema 升為 3，run 步驟宣告 prepare/authenticate。
- 自我更新與版本查詢自動重用 npm 的 scope/預設 Registry 與驗證設定，`FX_REGISTRY` 改為選用覆寫；自我更新保留公共相依套件的預設路由。

## 0.3.0 (2026-09-20)

- 保留登入人工接手與例外後的部分結果、彙總及結構化復原資訊；非零結束也可能回傳有效 stdout。
- 保護 manifest 與指南寫入期間的並行編輯；獲准取代時將原物件原子移動至備份，文件失敗保留逐檔案結果。
- 明確顯示初始化與同步的整體準備結論，修復名稱或說明被誤判為階段失敗的問題。
- 避免自我更新安裝器輸出污染 JSON，補充復原流程及原始碼與已發佈功能的區別。

- 新增 `calendar`、`task`、`worklog`、`metrics` 四個能力：前兩個有飛書與企業微信 provider，工時有 Jira provider；`metrics` 只命名未實作，manifest 可以描述它，繫結則要等 provider。`im` 的含義收窄為純訊息。
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

- 相容性說明：`fx skill show` 在 bundled Skill 遺失時回傳 `BUNDLED_SKILL_MISSING`；`SKILL_MISSING` 僅表示面向 Agent 的通知。

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
