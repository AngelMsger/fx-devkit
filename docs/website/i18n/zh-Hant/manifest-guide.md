# 建立 manifest 來源

fx 提供 CLI、預設工具定義和內建 Agent Skill。每個團隊提供自己的工作區宣告。可以使用團隊現有來源、匯入既有 checkout，或從下面的最小宣告開始。私有套件 registry 不是 manifest 格式的一部分。

## 來源目錄結構 {#source-layout}

來源目錄應位於業務儲存庫工作區之外：

```text
team-workspace/
  manifest/
    workspace.yaml
    environments.yaml
    tools.yaml
    members.yaml
    harness.yaml
  AGENTS.md
  docs/
  skills/
```

只有 `manifest/workspace.yaml` 必填，儲存儲存庫與工作區 provider。environments 儲存環境和平台座標，tools 覆寫內建工具定義，members 儲存成員資訊且必須標記 `sensitive: true`，harness 宣告 MCP 和規則；這些檔案皆為選用。

AGENTS.md、docs/ 和 skills/ 可以補充團隊規則與文件。未提供環境、成員或 harness 文件時，對應能力保持未設定。憑證屬於工具，不應寫入這些檔案。

fx 不假定任何工具。它內建的 CLI 只是一份目錄，記錄它知道如何驅動哪些工具；工作區的工具鏈由它繫結的 provider 推導而來：把 `ci` 繫結到 `jenkins-cli`，Jenkins 配套工具就進入工具鏈，版本下限、安裝方式與命令仍由 fx 維護。因此多數團隊不需要 tools.yaml。

只有在沒有繫結會帶來該工具時才在 tools.yaml 中宣告它——團隊自用的工具，或 fx 不認識的工具。寫出內建工具的名字同樣就是全部宣告，fx 的命令因此保持受信任，無需逐條確認；只在與內建事實不同之處覆寫欄位，被覆寫的欄位歸團隊所有，執行前 fx 會再次確認。

`fx tool list` 列出本工作區擁有的工具，並說明每個工具因何在此：`binding` 表示由繫結推導而來，`manifest` 表示本檔案宣告；`fx tool list --catalog` 會再列出 fx 知道但本工作區沒有選用的工具。

當本檔案宣告了同名工具時，能力也可以繫結 fx 未實作的 provider：fx 不為它提供入口座標，就緒判定完全來自該工具。

內建工具宣告最低版本要求。使用 `fx tool show <tool>` 查看實際要求，透過 `fx tool update <tool> --dry-run` 預覽升級。團隊可在 `manifest/tools.yaml` 中覆寫 `min_version`，以維持適合自身環境的相容性基準。最低版本要求不會將 npm 安裝鎖定至該版本。

## 初始化時安裝團隊工具 {#install-a-team-tool-during-initialization}

fx 0.4.0 起，可以在 `manifest/tools.yaml` 中宣告初始化時安裝工具。

```yaml
schema_version: 3
min_cli: '0.4.0'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

若團隊希望新機器裝齊全部工具，可在 `defaults` 中寫一次，個別條目仍可覆寫回 `false`：

```yaml
schema_version: 3
defaults:
  install_on_init: true
tools:
  - name: example-optional-tool
    install_on_init: false
```

以下套件名稱和執行檔名稱均為虛構範例。Registry 和認證使用本機 npm 設定。`fx init` 只安裝標記了 `install_on_init: true`、已啟用且缺少的工具，並在儲存庫及 Skill 同步前完成安裝。執行前須確認具體的安裝與版本檢查命令。既有工具即使低於最低版本也會保留，升級使用 `fx tool update`。一般 `fx sync` 不安裝套件，初始化也不會登入服務。

初始化成功後可查看 `tool_install` 中的結果。dry-run 不取得或複製來源、不執行安裝器，`tool_install` 和 `sync` 均為 null；唯讀模式禁止安裝。安裝或版本驗證失敗會回報 `INIT_TOOL_INSTALL_FAILED`。此時工作區可能已經註冊，修復 npm 存取或 PATH 後，以相同目錄和來源重試即可。

## 本機準備與個人登入 {#local-preparation-and-personal-sign-in}

工具文件採用 schema 3，每個 run 步驟明確宣告用途：

```yaml
schema_version: 3
tools:
  - name: example-team-tool
    required: true
    install: [{ via: npm, spec: '@example/team-tool' }]
    install_on_init: true
    setup:
      - id: local
        kind: run
        phase: prepare
        title: Prepare local files
        run: [prepare]
        verify: { file: ~/.example-tool/ready }
```

`prepare` 在準確命令獲准後由初始化非互動執行；`authenticate` 在 init 中只驗證既有登入，缺少時交給使用者。manual/file 步驟只檢查並交接。驗證已通過時略過執行，`init --resume` 繼續剩餘工作。僅宣告自訂執行檔不會自動要求驗證，需要時明確宣告 `auth`。

非法項目會阻止準備，不會悄悄刪除需求。普通來源 AGENTS.md 即可使用；fx 在目標指南中補齊缺少的發現區域，保留作者正文和既有區塊位置。模糊或不完整的標記由維護者修正。

## 從最小宣告開始 {#start-with-a-small-declaration}

使用 Bitbucket 的團隊可以建立 `team-workspace/manifest/workspace.yaml`：

```yaml
schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars:
      host: ssh://git@git.example.com
      web: https://git.example.com
defaults:
  upstream_project: example
  branch: main
projects:
  example:
    label: Example team
    contact: Ask your repository administrator
repos:
  - name: example-api
    desc: Example API service
```

將虛構的網域、專案、儲存庫和分支替換為已確認的值。Git 複製需要 Git 存取權限, API 操作需要 Bitbucket 配套 CLI，並非可連線的示範服務。使用 `fx tool show bitbucket-cli` 查看設定需求。另一個已實作的程式碼託管 provider `local-git` 用於本機 bare 儲存庫目錄，不是任意 Git 託管服務的介接器。

`fx manifest providers` 列出每個能力及其繫結。一個能力可以有多個實作——`issue-tracker` 可選 `feishu-project` 或 `jira-cli`，`knowledge-base` 可選 `confluence` 或 `lark-wiki`；一個配套 CLI 也可以服務多個能力，lark-cli 就同時服務 `im` 與 `knowledge-base`，它仍然只安裝與檢查一次。

在包含 team-workspace/ 的目錄執行：

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx init --resume --workspace work
```

檢查 init 各同步階段並處理 handoff。manifest 有效不代表儲存庫可存取、工具已就緒或 Agent 宿主已啟用。

包含方括號的欄位路徑應加引號，避免被 zsh 等 shell 視為檔案比對模式：

```sh
fx manifest explain 'repos[].upstream'
fx manifest explain --kind tools 'tools[].setup'
fx manifest schema --kind environments
```

## 匯入既有 checkout {#import-existing-checkouts}

使用現有工作區之外的來源目錄：

```sh
fx manifest import ./existing-work --format json
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml --dry-run
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml
```

寫入後、init 前，先審閱候選中的分支、上游、專案和未確定項目。團隊規則與 Skill 需要另外補充，不能從 Git 中繼資料復原。既有目錄自動納入，`--adopt` 僅為相容性保留。替換既有指南或 Skill 位置可能需要審閱並備份。匯入不變更 checkout，不刪除 submodule 中繼資料。請參閱[匯入契約](manifest-guide.md#import-existing-checkouts)。

Provider 推斷需要證據：經驗證的本機 bare 儲存庫可產生 `local-git` 綁定。未知或混合託管保留明確的 upstream URL 和待審閱說明，不猜測 provider。code host 未能作答的專案報告為未作答而非不存在，對應項目的待審閱說明或略過原因會說明這次搜尋並不完整。含憑證、查詢參數或片段的 HTTP remote 會略過且不回顯這些資料。

只有 `origin` 且其 URL 與宣告的 upstream 完全相符時，sync 會新增 `upstream`，保留 `origin`、目前分支和本機檔案。預覽的 `upstream_to_add` 與結果的 `upstream_added` 分別說明計畫和實際效果；衝突的 remote 保持不變。

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

`manifest repo-set` 在持有檔案鎖時核對原文再取代。其他寫入者已修改內容、目標不是一般檔案或 manifest 目錄是符號連結時，會以 `MANIFEST_EDIT_CONFLICT` 保留現有內容。檢查真實來源路徑後以 `--dry-run` 重試；不要刪除鎖或覆寫他人的修改。內容不變的編輯回傳 `written: false`。

`manifest validate/lint/providers/repo-set/render` 優先使用明確指定的 `--workspace` 或 `FX_WORKSPACE`，即使目前目錄位於另一份來源 checkout 內。未知的明確名稱會報錯，不會退回修改附近的 manifest。未明確選擇時，仍優先使用目前目錄附近的來源 checkout，支援獨立維護。`manifest import <dir>` 保留目錄參數語意，`manifest record-probe` 使用所選已註冊工作區。所有檔案輸出參數支援 `-o` 和 `--out`，包括 render。

## 共用與維護來源 {#share-and-maintain-the-source}

目錄來源是快照；本機 Git 來源使用已提交內容，不包含尚未提交的變更。持續共用應將審閱過的來源提交到權限適當的 Git 儲存庫，再把 URL 提供給 `fx init`。

註冊後的來源位於 `~/.fx/workspaces/<name>/source`。`sync` 先更新符合條件的 Git 來源；目錄和 stdin 快照不會持續追蹤原始來源。使用 `fx self info --format json` 定位目前的工作區及來源。再次指定不同來源不會隱含遷移已註冊工作區。

使用 `fx workspace rebind <name> --from <source> --dry-run` 預覽明確換源，並保留工作區身分與個人選擇。

在來源 checkout 維護共用宣告；使用 `repo pick/unpick`、`env pick/unpick` 和 `agent pick/unpick` 管理個人選擇。Agent 選擇影響同一 FX_HOME 的全部工作區。透過已驗證個人 fork 提交變更的流程，請參閱[共用來源貢獻](cli/README.md#fx-source-push)。

## 環境範例

以下虛構範例分別放入 `manifest/workspace.yaml` 和 `manifest/environments.yaml`。`obs.svc: api` 將日誌串流解析為 `example_api_test`。座標在核對前仍為 `unverified`；宣告不會設定 CLI 或授予存取權限。

```yaml
schema_version: 2
defaults: { branch: main }
repos:
  - name: example-api
    upstream: https://git.example.com/team/example-api.git
    obs: { svc: api }
```

```yaml
schema_version: 2
platforms:
  logs:
    provider: openobserve-cli
    capability: log-store
    label: Application logs
    command: openobserve-cli search run --use-context {context} --sql "SELECT * FROM {stream} LIMIT 20" --since 1h
envs:
  test:
    label: Test
    platforms:
      logs:
        vars: { context: test, stream: 'example_{svc}_test' }
        confidence: unverified
```

```sh
fx manifest validate --strict --format json
fx where example-api --env test --format json
fx doctor --tool openobserve-cli --format json
```

指標平台的寫法相同。它的座標變數是 `job`，即服務的抓取 job。只有 job 名稱確實遵循某個模式時才宣告範本；否則把逐一核實過的 job 記在對應儲存庫的 `obs.overrides.<platform>.<env>.vars` 下，沒有登記的儲存庫不會得到命令，而不是一個猜出來的選擇器。

```yaml
platforms:
  metrics:
    provider: prometheus-cli
    capability: metrics
envs:
  test:
    platforms:
      metrics:
        service:
          base_url: https://metrics.example.com
          context: test
          auth_scheme: none
        vars: { job: 'example-{svc}' }
        confidence: unverified
```

## 在 AGENTS.md 宣告團隊 Skill

每個團隊 Skill 放在 `skills/<name>/SKILL.md`，frontmatter 提供 `name` 與 `description`。在來源 AGENTS.md 中需要目錄的位置加入：

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` 自動填入名稱、觸發說明與來源連結。新指南預設包含此區域；既有指南缺少時只提示維護者加入，不自動插入人工內容。來源指南使用相對連結，派生至工作區根的指南使用解析後的來源路徑，不依賴宿主的 Skill 連結。`fx sync --only docs,skills` 更新新增、移除及中繼資料變更。目錄協助探索，不代表宿主已安裝或載入。僅涵蓋工作區根，不修改業務儲存庫指南。

文件寫入前會比較規劃時的快照。`DOCS_WRITE_CONFLICT` 表示並行編輯或不安全路徑已被保留；檢查路徑，父目錄為連結時使用實際目錄，再預覽並重試。檔案列的 `action` 表示計畫，`result` 為 `planned`、`done`、`skipped`、`failed` 或 `not_started`。非零結束前可能已有檔案寫入成功，請先讀取 stdout 的 `files`（sync 中為 `stage_details.docs.files`，init 中為 `sync.stage_details.docs.files`）；重試會略過未變更檔案。獲准取代外來內容時，原檔案、目錄或連結本身會移至未占用的同層 `.fx-backup[-N]`，既有備份保持不變。

## 在 AGENTS.md 放置工作區配置規則

`workspace-layout` 區域告訴 Agent 不屬於任何儲存庫的產出放在哪裡：工作區根目錄的 `.workbench/`。派生至工作區的指南一律包含此區域，來源指南沒有標記時附加在末尾。將標記加在其他工作區規則旁邊，即可讓它出現在該處：

```markdown
<!-- fx:begin workspace-layout -->
<!-- fx:end workspace-layout -->
```

## 公共服務預設 {#public-service-presets}

fx 0.2.0 支援在工作區 provider、platform 預設值及環境覆寫項宣告可選的 `service`；對應文件需設定 `min_cli: '0.2.0'`。環境覆寫繼承平台設定。`base_url` 是包含部署路徑的完整 HTTP(S) URL，SSH 複製位址分開保留；`context` 指定配套 CLI 的 context。Bitbucket/Confluence 可設定 `flavor`；OpenObserve 必須宣告 `org`；四種配套工具須宣告 `auth_scheme`，可選公共憑證取得頁面 `credential_url`。`auth_scheme` 決定 fx 如何新建缺少的 context 以及 `fx login` 提供哪種登入方式，並非就緒條件；成員針對同一 `base_url` 的 context 以其他方式登入時同樣算就緒。Prometheus 同樣須宣告 `auth_scheme`，並接受 `none`，用於無需登入的服務：就緒與否取決於服務是否回應，不會要求登入；只有前置閘道要求時才使用 `basic` 或 `bearer`。Sentry 只接受 `base_url` 與 `org`。未寫 `provider` 的 platform 依其名稱推導出的 provider 驗證，與 `fx manifest providers` 顯示的一致。

相同預設可共用本機目標，同一目標有不同預設時會阻擋設定。衝突的舊 vars 應刪除以避免兩個來源。使用者名稱、電子郵件、密碼、PAT/API Token 值、Cookie 與瀏覽器工作階段不可分發；每人透過自己的 CLI 取得並保存憑證。額外 service 欄位在非嚴格模式也驗證失敗；URL 中的憑證會遭拒且不回顯。

預設要求 Bitbucket/Confluence ≥0.20.0、Jenkins ≥0.9.0、OpenObserve ≥0.13.0、Prometheus ≥0.2.0，需在 tools.yaml 設定版本下限。init、明確執行的 sync 與 login 使用受信任命令準備設定；`fx sync --only services --dry-run` 可預覽。非空衝突不會自動覆寫或切換啟用項；Sentry 公共工作區預設值遵循相同保留原則。
