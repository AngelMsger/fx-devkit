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
  CLAUDE.md
  docs/
  skills/
```

只有 `manifest/workspace.yaml` 必填，儲存儲存庫與工作區 provider。environments 儲存環境和平台座標，tools 覆寫內建工具定義，members 儲存成員資訊且必須標記 `sensitive: true`，harness 宣告 MCP 和規則；這些檔案皆為選用。

AGENTS.md、CLAUDE.md、docs/ 和 skills/ 可以補充團隊規則與文件。未提供環境、成員或 harness 文件時，對應能力保持未設定；未提供 tools.yaml 時仍使用每個工作區都有的內建工具。部分內建工具是按需選用的：版本下限、安裝方式與命令仍由 fx 維護，但只有寫出名字的工作區才會取得它們。寫出名字就是全部宣告，fx 的命令因此保持受信任，無需逐條確認；只在與內建事實不同之處覆寫欄位，被覆寫的欄位歸團隊所有，執行前 fx 會再次確認。憑證屬於工具，不應寫入這些檔案。

內建工具宣告最低版本要求。使用 `fx tool show <tool>` 查看實際要求，透過 `fx tool update <tool> --dry-run` 預覽升級。團隊可在 `manifest/tools.yaml` 中覆寫 `min_version`，以維持適合自身環境的相容性基準。最低版本要求不會將 npm 安裝鎖定至該版本。

## 初始化時安裝團隊工具 {#install-a-team-tool-during-initialization}

fx 0.1.1 起，可以在 `manifest/tools.yaml` 中宣告初始化時安裝工具。

```yaml
schema_version: 2
min_cli: '0.1.1'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

以下套件名稱和執行檔名稱均為虛構範例。Registry 和認證使用本機 npm 設定。`fx init` 只安裝標記了 `install_on_init: true`、已啟用且缺少的工具，並在儲存庫及 Skill 同步前完成安裝。執行前須確認具體的安裝與版本檢查命令。既有工具即使低於最低版本也會保留，升級使用 `fx tool update`。一般 `fx sync` 不安裝套件，初始化也不會登入服務。

初始化成功後可查看 `tool_install` 中的結果。dry-run 不取得或複製來源、不執行安裝器，`tool_install` 和 `sync` 均為 null；唯讀模式禁止安裝。安裝或版本驗證失敗會回報 `INIT_TOOL_INSTALL_FAILED`。此時工作區可能已經註冊，修復 npm 存取或 PATH 後，以相同目錄和來源重試即可。

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

在包含 team-workspace/ 的目錄執行：

```sh
fx init ./work --from ./team-workspace --dry-run
fx init ./work --from ./team-workspace
cd work
fx manifest validate --strict
fx manifest lint
fx manifest providers
fx login --list
fx doctor
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

## 在 AGENTS.md 宣告團隊 Skill

每個團隊 Skill 放在 `skills/<name>/SKILL.md`，frontmatter 提供 `name` 與 `description`。在來源 AGENTS.md 中需要目錄的位置加入：

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` 自動填入名稱、觸發說明與來源連結。新指南預設包含此區域；既有指南缺少時只提示維護者加入，不自動插入人工內容。來源指南使用相對連結，派生至工作區根的指南使用解析後的來源路徑，不依賴宿主的 Skill 連結。`fx sync --only docs,skills` 更新新增、移除及中繼資料變更。目錄協助探索，不代表宿主已安裝或載入。僅涵蓋工作區根，不修改業務儲存庫指南。

## 公共服務預設 {#public-service-presets}

fx 0.2.0 支援在工作區 provider、platform 預設值及環境覆寫項宣告可選的 `service`；對應文件需設定 `min_cli: '0.2.0'`。環境覆寫繼承平台設定。`base_url` 是包含部署路徑的完整 HTTP(S) URL，SSH 複製位址分開保留；`context` 指定配套 CLI 的 context。Bitbucket/Confluence 可設定 `flavor`；OpenObserve 必須宣告 `org`；四種配套工具須宣告 `auth_scheme`，可選公共憑證取得頁面 `credential_url`。Sentry 只接受 `base_url` 與 `org`。未寫 `provider` 的 platform 依其名稱推導出的 provider 驗證，與 `fx manifest providers` 顯示的一致。

相同預設可共用本機目標，同一目標有不同預設時會阻擋設定。衝突的舊 vars 應刪除以避免兩個來源。使用者名稱、電子郵件、密碼、PAT/API Token 值、Cookie 與瀏覽器工作階段不可分發；每人透過自己的 CLI 取得並保存憑證。額外 service 欄位在非嚴格模式也驗證失敗；URL 中的憑證會遭拒且不回顯。

預設要求 Bitbucket/Confluence ≥0.20.0、Jenkins ≥0.9.0、OpenObserve ≥0.13.0，需在 tools.yaml 設定版本下限。init、明確執行的 sync 與 login 使用受信任命令準備設定；`fx sync --only services --dry-run` 可預覽。非空衝突不會自動覆寫或切換啟用項；Sentry 公共工作區預設值遵循相同保留原則。
