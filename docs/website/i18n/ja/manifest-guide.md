# マニフェストのソースを作成する

fx の公開パッケージには CLI、既定のツール定義、内蔵 Agent Skill が含まれます。ワークスペースの宣言は各チームが用意します。既存のソースを使用する、checkout をインポートする、または以下の最小構成から始められます。プライベートレジストリはマニフェスト形式の要件ではありません。

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

AGENTS.md、CLAUDE.md、docs/、skills/ にはチームのガイドや Skill を追加できます。環境、メンバー、harness 文書を省略すると、その能力は未設定になります。tools.yaml がなくても内蔵ツール一覧は使用されます。資格情報は各ツールが管理し、これらの文書には保存しません。

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

架空のホスト、プロジェクト、リポジトリ、ブランチを確認済みの値に置き換えてください。この例には Bitbucket 連携 CLI とアクセス権が必要です。接続できるデモサービスではありません。`fx tool show bitbucket-cli` で要件を確認します。もう一つの実装済み code-host provider、`local-git` はローカルの bare リポジトリ用であり、任意の Git ホスティングサービスのアダプターではありません。

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

```sh
fx init ./existing-work --from ./team-workspace --dry-run
fx init ./existing-work --from ./team-workspace
```

## ソースの共有と保守 {#share-and-maintain-the-source}

ディレクトリソースはスナップショットです。ローカル Git ソースはコミット済み内容を使い、未コミットの編集を含みません。継続的に共有する場合は、レビュー済みソースを適切なアクセス権を持つ Git リポジトリにコミットし、その URL を `fx init` に渡します。

登録後のソースは `~/.fx/workspaces/<name>/source` にあります。`sync` は条件を満たす Git ソースを先に更新します。ディレクトリや stdin のスナップショットは元のソースの編集を追跡しません。`fx self info --format json` で現在のワークスペースとソースを確認できます。登録済みルートに別のソースを指定しても暗黙の移行は行われません。

共有宣言はソース checkout で管理し、個人の選択は `repo pick/unpick`、`env pick/unpick`、`agent pick/unpick` で管理します。エージェント選択は同じ FX_HOME の全ワークスペースに適用されます。検証済み個人フォークからの提案は[ソースへの貢献](cli/README.md#fx-source-push)を参照してください。
