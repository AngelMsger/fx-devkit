# 建立 manifest 來源

公開安裝的 fx 提供 CLI、預設工具定義和內建 Agent Skill。每個團隊提供自己的工作區宣告。可以使用團隊現有來源、匯入既有 checkout，或從下面的最小宣告開始。私有套件 registry 不是 manifest 格式的一部分。

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

AGENTS.md、CLAUDE.md、docs/ 和 skills/ 可以補充團隊規則與文件。未提供環境、成員或 harness 文件時，對應能力保持未設定；未提供 tools.yaml 時仍使用內建工具目錄。憑證屬於工具，不應寫入這些檔案。

## 從最小宣告開始 {#start-with-a-small-declaration}

使用 Bitbucket 的團隊可以建立 `team-workspace/manifest/workspace.yaml`：

```yaml
schema_version: 2
providers:
  code-host:
    provider: bitbucket-cli
    vars:
      host: ssh://git@git.example.com:12345
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

將虛構的網域、專案、儲存庫和分支替換為已確認的值。範例需要 Bitbucket 配套 CLI 和對應存取權限，並非可連線的示範服務。使用 `fx tool show bitbucket-cli` 查看設定需求。另一個已實作的程式碼託管 provider `local-git` 用於本機 bare 儲存庫目錄，不是任意 Git 託管服務的介接器。

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

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

## 共用與維護來源 {#share-and-maintain-the-source}

目錄來源是快照；本機 Git 來源使用已提交內容，不包含尚未提交的變更。持續共用應將審閱過的來源提交到權限適當的 Git 儲存庫，再把 URL 提供給 `fx init`。

註冊後的來源位於 `~/.fx/workspaces/<name>/source`。`sync` 先更新符合條件的 Git 來源；目錄和 stdin 快照不會持續追蹤原始來源。使用 `fx self info --format json` 定位目前的工作區及來源。再次指定不同來源不會隱含遷移已註冊工作區。

在來源 checkout 維護共用宣告；使用 `repo pick/unpick`、`env pick/unpick` 和 `agent pick/unpick` 管理個人選擇。Agent 選擇影響同一 FX_HOME 的全部工作區。透過已驗證個人 fork 提交變更的流程，請參閱[共用來源貢獻](cli/README.md#fx-source-push)。
