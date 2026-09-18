# マニフェストのソースを作成する

fx には CLI、既定のツール定義、内蔵 Agent Skill が含まれます。ワークスペースの宣言は各チームが用意します。既存のソースを使用する、checkout をインポートする、または以下の最小構成から始められます。プライベートレジストリはマニフェスト形式の要件ではありません。

## ディレクトリ構成 {#source-layout}

ソースは業務リポジトリを置くワークスペースの外に置きます。

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

必須なのは `manifest/workspace.yaml` だけで、リポジトリとワークスペースの provider を記述します。environments は環境とプラットフォーム座標、tools は内蔵ツール定義の上書き、members はメンバー情報、harness は MCP とルールです。これらは任意ですが、members には `sensitive: true` が必要です。

AGENTS.md、CLAUDE.md、docs/、skills/ にはチームのガイドや Skill を追加できます。環境、メンバー、harness 文書を省略すると、その能力は未設定になります。tools.yaml がなくても、すべてのワークスペースが持つ内蔵ツールは使用されます。一部の内蔵ツールは任意選択です。最低バージョン、インストール方法、コマンドは fx が維持しますが、名前を書いたワークスペースだけがそれらを得ます。名前を書くことが宣言のすべてで、fx のコマンドは信頼されたままなので確認は不要です。内蔵の事実と異なる場合だけフィールドを上書きしてください。上書きしたフィールドはチームのものとなり、実行前に fx が改めて確認します。資格情報は各ツールが管理し、これらの文書には保存しません。

内蔵ツールには最低バージョンが定義されています。`fx tool show <tool>` で有効な要件を確認し、`fx tool update <tool> --dry-run` で更新を事前確認できます。互換性のために別の基準が必要な場合は、`manifest/tools.yaml` の `min_version` を上書きしてください。最低バージョンは npm のインストール先バージョンを固定するものではありません。

## 初期化時にチームツールをインストールする {#install-a-team-tool-during-initialization}

fx 0.1.1 以降では、`manifest/tools.yaml` で初期化時のインストールを指定できます。

```yaml
schema_version: 2
min_cli: '0.1.1'
tools:
  - name: example-team-tool
    install_on_init: true
    install: [{ via: npm, spec: '@example/team-tool' }]
```

上記のパッケージ名と実行名は架空です。Registry と認証は利用者の npm 設定を使います。`fx init` は `install_on_init: true` の有効なツールが見つからない場合だけ、リポジトリと Skill の同期前にインストールします。実行前にインストールとバージョン確認の正確なコマンドを承認します。既存のツールは最低バージョン未満でも保持され、更新は `fx tool update` で行います。通常の `fx sync` はパッケージをインストールせず、初期化もサービスにログインしません。

成功時の `tool_install` に実行結果が入ります。dry-run はソースを取得・保存せず、インストーラーを実行しないため、`tool_install` と `sync` は null です。読み取り専用ではインストールできません。インストールまたはバージョン確認に失敗すると `INIT_TOOL_INSTALL_FAILED` になります。登録済みの場合もあるため、npm のアクセスや PATH を修復し、同じディレクトリとソースで再実行してください。

## 最小の宣言 {#start-with-a-small-declaration}

Bitbucket を使うチームは `team-workspace/manifest/workspace.yaml` を作成できます。

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

架空のホスト、プロジェクト、リポジトリ、ブランチを確認済みの値に置き換えてください。Git clone には Git のアクセス権が必要で, API 操作には Bitbucket 連携 CLI が必要です。接続できるデモサービスではありません。`fx tool show bitbucket-cli` で要件を確認します。もう一つの実装済み code-host provider、`local-git` はローカルの bare リポジトリ用であり、任意の Git ホスティングサービスのアダプターではありません。

team-workspace/ を含むディレクトリから実行します。

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

init の各同期段階と handoff を確認してください。有効なマニフェストだけではリポジトリへのアクセス、ツールの準備、ホストの有効化は証明できません。

角括弧を含むフィールドパスは引用符で囲み、zsh などによるファイル名展開を防ぎます。

```sh
fx manifest explain 'repos[].upstream'
fx manifest explain --kind tools 'tools[].setup'
fx manifest schema --kind environments
```

## 既存 checkout のインポート {#import-existing-checkouts}

ソースディレクトリを既存ワークスペースの外に用意します。

```sh
fx manifest import ./existing-work --format json
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml --dry-run
fx manifest import ./existing-work -o ./team-workspace/manifest/workspace.yaml
```

書き込み後、init の前に、推定されたブランチ、上流、プロジェクト、未解決項目を確認してください。チームのルールと Skill は別途追加します。Git のメタデータからは復元されません。既存ディレクトリの取り込みは自動で、`--adopt` は互換性のためのフラグです。ガイドや Skill の配置を置き換える場合はレビューとバックアップが必要になることがあります。インポートは checkout を変更せず、submodule の管理情報も削除しません。[インポートの契約](manifest-guide.md#import-existing-checkouts)を参照してください。

Provider の推定には根拠が必要です。検証済みのローカル bare リポジトリからは `local-git` バインディングを生成できます。不明または混在するホスティングは明示的な upstream URL と要確認の注記を保持し、provider を推測しません。code host が回答できなかったプロジェクトは「存在しない」ではなく「未回答」として報告され、該当エントリの要確認の注記またはスキップ理由が、検索が完了しなかったことを示します。認証情報、クエリ、フラグメントを含む HTTP remote は、それらを表示せずにスキップします。

`origin` だけが存在し、その URL が宣言された upstream と完全一致する場合、sync は `upstream` を追加します。`origin`、現在のブランチ、ローカルファイルは保持します。プレビューの `upstream_to_add` と結果の `upstream_added` は予定と実際の効果を区別し、競合する remote は変更しません。

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

`manifest validate/lint/providers/repo-set/render` は、別のソース checkout 内でも明示的な `--workspace` または `FX_WORKSPACE` を優先します。明示した名前が未知ならエラーになり、近くの manifest の編集には切り替えません。明示的な選択がなければ、現在のディレクトリ付近のソース checkout を優先し、単独のソース保守も可能です。`manifest import <dir>` はディレクトリ引数を使い、`manifest record-probe` は選択した登録済みワークスペースを使います。render を含むファイル出力フラグは `-o` と `--out` に対応します。

## ソースの共有と保守 {#share-and-maintain-the-source}

ディレクトリソースはスナップショットです。ローカル Git ソースはコミット済み内容を使い、未コミットの編集を含みません。継続的に共有する場合は、レビュー済みソースを適切なアクセス権を持つ Git リポジトリにコミットし、その URL を `fx init` に渡します。

登録後のソースは `~/.fx/workspaces/<name>/source` にあります。`sync` は条件を満たす Git ソースを先に更新します。ディレクトリや stdin のスナップショットは元のソースの編集を追跡しません。`fx self info --format json` で現在のワークスペースとソースを確認できます。登録済みルートに別のソースを指定しても暗黙の移行は行われません。

`fx workspace rebind <name> --from <source> --dry-run` で明示的なソース変更をプレビューし、ワークスペースの識別情報と個人の選択を保持します。

共有宣言はソース checkout で管理し、個人の選択は `repo pick/unpick`、`env pick/unpick`、`agent pick/unpick` で管理します。エージェント選択は同じ FX_HOME の全ワークスペースに適用されます。検証済み個人フォークからの提案は[ソースへの貢献](cli/README.md#fx-source-push)を参照してください。

## 環境の例

以下の架空の例をそれぞれ `manifest/workspace.yaml` と `manifest/environments.yaml` に置きます。`obs.svc: api` からストリーム名 `example_api_test` が解決されます。確認するまで座標は `unverified` です。宣言だけでは CLI の設定やアクセス権は得られません。

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

## AGENTS.md にチーム Skill を宣言する

各 Skill を `skills/<name>/SKILL.md` に置き、frontmatter に `name` と `description` を記述します。ソースの AGENTS.md の希望する位置に次の領域を追加します。

```markdown
<!-- fx:begin team-skills -->
<!-- fx:end team-skills -->
```

`fx manifest render` が名前、利用条件、ソースへのリンクを生成します。新規ガイドには領域を含めます。既存ガイドにない場合は追加を案内し、人が書いた文章には自動挿入しません。ソースガイドは相対リンク、派生したルートガイドは解決済みソースパスを使うため、特定ホストの Skill リンクに依存しません。`fx sync --only docs,skills` が追加、削除、メタデータ変更を反映します。カタログは探索の補助であり、ネイティブのインストールやロードを証明しません。対象はワークスペースルートのみで、業務リポジトリのガイドは変更しません。

## 公開サービスプリセット {#public-service-presets}

fx 0.2.0 ではワークスペース provider、platform のデフォルト、環境別上書きに任意の `service` を宣言できます。利用するドキュメントに `min_cli: '0.2.0'` を指定します。環境別設定は platform から継承します。`base_url` はデプロイパスを含む完全な HTTP(S) URL です。SSH のクローン先とは分けます。`context` は対応 CLI の名前付き context です。Bitbucket/Confluence は `flavor` を指定でき、OpenObserve は `org` が必須です。4 種の対応 CLI は `auth_scheme` が必須で、公開取得ページ `credential_url` は任意です。Sentry は `base_url` と `org` のみ受け付けます。`provider` を書かない platform は、その名前が示す provider の宣言で検証します（`fx manifest providers` が表示するものと同じです）。

同じプリセットは同じローカル保存先を共有できますが、異なる設定を同じ保存先に宣言すると準備がブロックされます。矛盾する旧 vars は削除して設定元を一つにします。ユーザー名、メールアドレス、パスワード、PAT/API Token の値、Cookie、ブラウザーセッションは配布できません。各メンバーが自分の CLI で取得・保存します。余分な service フィールドは非 strict モードでも検証に失敗し、URL 内の認証情報は値を表示せず拒否します。

必要なバージョンは Bitbucket/Confluence ≥0.20.0、Jenkins ≥0.9.0、OpenObserve ≥0.13.0 です。tools.yaml に下限を指定します。init、明示的 sync、login は信頼済みコマンドで準備し、`fx sync --only services --dry-run` でプレビューできます。空でない既存値の競合は自動上書きせず、有効な context も自動変更しません。Sentry の公開ワークスペース設定にも同じ保持方針を適用します。
