# fx を使う

fx をインストールし、チームのマニフェストを接続してリポジトリやツール、エージェントを利用します。

## 動作環境 {#requirements}

- Node.js ≥22。開発バージョンは package.json に固定されています。Bun もランタイムとして利用できます。
- PATH 上の Git。グローバルインストールと `fx self update` には、Bun を使う場合も npm が必要です。
- チームのマニフェスト、または[自分で作成したマニフェスト](manifest-guide.md)。

macOS と Linux をサポートします。Windows のネイティブアダプターは実装済みですが、実機実行とエージェントホストの有効化は未検証です。対象はローカル NTFS 上の PowerShell 5.1/7 と cmd です。[Windows の検証範囲](support.md#platform-support)を参照してください。

## インストール {#install}

<!-- distribution:internal -->

fx はチームのプライベート Registry で配布します。公開リリースは当面予定していません。チームから Registry の URL と npm のアクセス権を取得し、`FX_REGISTRY` を設定してください。以下は架空の URL です。パッケージが Registry に提供されている必要があります。

```sh
export FX_REGISTRY=https://npm.example.com/
npm login --registry="$FX_REGISTRY"
npm install -g @fx/devkit --registry="$FX_REGISTRY" --@fx:registry="$FX_REGISTRY"
fx --version
```

<!-- /distribution -->

<!-- distribution:public -->

### 公開パッケージ

公開版は npmjs の `@angelmsger/fx` を使用します。チームのプライベート Registry は不要です。公開は現在保留中のため、対象バージョンの提供開始後に実行してください。

```sh
npm install -g @angelmsger/fx --registry=https://registry.npmjs.org/ --@angelmsger:registry=https://registry.npmjs.org/
fx --version
```

<!-- /distribution -->

現在はソースからも実行できます。

```sh
npm ci
npm run build
node bin/fx.js --help
node bin/fx.js --version
```

以下の例をソースから実行するときは、`fx` を `node /absolute/path/to/fx-devkit/bin/fx.js` に置き換えます。ランチャーが `dist/` を読み込むため、事前のビルドが必要です。

PowerShell の実行ポリシーが `.ps1` shim をブロックする場合は、`npm.cmd` と `fx.cmd` を使用します。ポリシーの変更は不要です。

### 更新

ソースからインストールした場合は Git で checkout を更新し、`npm ci` と `npm run build` を実行します。`fx self info --format json` でバージョンとパッケージ更新元を確認できます。[更新ガイド](support.md#updates)を参照してください。

## クイックスタート {#quick-start}

プレースホルダーをチームから提供された実際の値に置き換えてください。

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
cd work
fx login --list
fx login
fx doctor
```

`init` はまず、マニフェストで `install_on_init` を指定した未インストールのツールを、コマンドの承認後にインストールします。その後、リポジトリと選択した Agent リソースを同期します。既存のツールは保持されます。

`init` はリポジトリと選択済みエージェントのリソースも同期します。登録に成功しても、すべての同期段階が成功したとは限りません。失敗した項目を調べ、権限や設定の問題を解消してから該当段階を再実行してください。

既存ディレクトリは自動的に取り込まれます。`--adopt` は互換性のために残っています。不慣れなワークスペースでは、先に `--dry-run` で計画を確認します。

```sh
fx sync --dry-run
fx sync
fx status
fx repo list
fx where <repo> --env <environment>
fx can <capability> --env <environment>
```

`where` は座標とコマンドを表示するだけで、実行しません。`can` と `doctor` は現在の準備状態を確認します。設定、認証、アクセスが不足する場合は handoff に従ってください。レポートの生成成功だけでは準備完了を意味しません。`ok`、`complete`、個々の結果を確認します。

`repo pick/unpick` と `env pick/unpick` でこのマシンの対象を絞れます。`fx config set agents claude-code,codex` でエージェントを選択し、未設定なら自動検出します。`fx sync --only docs,skills` はそのリソースだけを更新します。

## 基本概念 {#concepts}

### ワークスペースとマニフェスト {#the-workspace-and-the-manifest}

ワークスペースは、独立した checkout と管理対象のエージェントリソースを含む登録済みの通常ディレクトリです。マニフェストのソースは `~/.fx/workspaces/<name>/source` にあります。fx は管理対象のルートで Git を実行しません。同期は checkout、reset、stash によって未コミットの変更や分岐した履歴、別ブランチでの作業を上書きしません。

workspace、environments、tools、members の文書に共有情報を記述します。任意の harness 文書では MCP とルールを宣言します。

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 個人設定

グローバル設定はワークスペースと設定値を登録します。エージェント選択は同一 FX_HOME のワークスペース間で共有され、リポジトリと環境の選択はワークスペース単位です。`repo add` はローカル参照を登録し、`repo remove` は参照だけを削除してファイルを残します。設定のエクスポートには資格情報、信頼記録、マニフェスト checkout は含まれません。

### ケイパビリティ、プロバイダー、連携ツール

capability はコードホスト、CI、ログ、エラー追跡などの目的を表し、provider は連携 CLI を通じて実装します。マニフェストが能力、プロバイダー、環境の座標を結び付けます。`can` は準備状態、`where` は座標、`release` は宣言されたリリースチェックを返します。

`tool list/show` は要件を表示し、`tool install/update` は宣言されたインストーラーを使い、`login` は設定を案内します。認証は各ツールの責任です。マニフェストの実行ベクトルには信頼が必要で、変更後は再確認します。手動手順の完了を申告するだけでは検証成功の代わりになりません。

### Skill、MCP、ライフサイクル

選択したエージェントには、チームの Skill ディレクトリへのリンクと、バージョン付き fx Skill のコピーを配布します。fx の所有物でないファイルは保持します。Windows ではチームのディレクトリに junction を使います。`skill list` で状態を確認し、`sync --only skills` で調整します。

harness は MCP エントリーとルールへの参照をホストに投影します。秘密の値は環境変数への参照に留めます。`mcp list/show` と `can mcp:<name>` は前提条件を説明しますが、設定の存在だけではホストでの有効化を証明できません。[MCP の契約](user-guide.md#for-coding-agents)を参照してください。

起動フックはキャッシュ済みコンテキストを返し、マニフェスト、文書、Skill をバックグラウンドで更新できます。業務リポジトリの同期や信頼の承認はしません。プロジェクトとフックの信頼はホストが管理します。`hook list/inject/remove` と[ライフサイクルの契約](user-guide.md#for-coding-agents)を使用してください。

### 共有情報への貢献

`source push` は選択したソースファイルの変更をプレビューまたは提出し、ソース checkout の HEAD、インデックス、作業ファイルを保護します。個人フォークと上流の関係を示す根拠が必要です。実行前に `fx source push --help` と[貢献の契約](cli/README.md#fx-source-push)を確認してください。

## 主なコマンド {#commands}

| 目的                   | コマンド                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------- |
| 作成、同期、状態確認   | `init`、`sync`、`status`                                                           |
| アクセス設定と準備状態 | `login`、`doctor`、`can`                                                           |
| 座標とリリースの根拠   | `where`、`release`                                                                 |
| リポジトリ管理         | `repo list/show/pick/unpick/add/remove/fork/open`                                  |
| 環境とエージェント     | `env list/show/pick/unpick`、`agent list/pick/unpick`                              |
| ツールと Skill         | `tool list/show/install/update`、`skill list`                                      |
| 共有ソース管理         | `manifest validate/lint/explain/schema/providers/set/render/import`、`source push` |
| メンバーと設定         | `member list/show`、`config list/get/set/unset/export/import`                      |
| ホストのリソース       | `hook list/inject/remove`、`mcp list/show`                                         |
| CLI 自体の管理         | `self info/update`、`completion`                                                   |

正確な構文は `--help` と[生成された CLI リファレンス](cli/README.md)が基準です。

## コーディングエージェント向け {#for-coding-agents}

`--format json` または `FX_FORMAT=json` を使用します。stdout はデータのみ、通知、進捗、エラーは stderr に出力します。コレクションの形式は `{items, has_more, next?}` で、不明な値は明示されます。

`--fields` は項目を絞り、`--quiet` は通知を抑え、`--no-input` は入力待ちを禁止します。書き込みコマンドは `--dry-run` と読み取り専用設定に対応します。`--allow-writes` は一回の呼び出しだけの明示的な上書きです。

doctor/release は失敗項目があっても終了コード 0 を返します。init/sync も部分成功で 0 を返す場合があります。init では `sync.summary` と `sync.stages`、sync では `summary`、`stages`、失敗項目の `failure` を読みます。`stage_details` に各リソース段階の結果と handoff が残ります。終了コードだけで準備完了と判断せず、認証の捏造やホストの信頼境界の回避をしないでください。

[内蔵 Skill](../skills/fx-workspace/SKILL.md)と[応答ガイド](../skills/fx-workspace/references/commands.md)を読んだ後で `FX_SKILL_LOADED=1` を設定します。インストール済み Skill の場所は `self info` で確認できます。

## 設定 {#configuration}

`~/.fx` には登録、個人レイヤー、所有権状態、信頼記録、キャッシュがあります。`FX_HOME` は fx の個人ディレクトリのみを変更し、連携ツールの資格情報の場所は変えません。

`config list` はキー、既定値、環境変数名、実効値の出所を示し、`config get <key> --explain` は各レイヤーを説明します。優先順位は明示的フラグ、環境変数、ファイル、組み込み既定値です。`config export/import` で個人設定を移行します。

`format` は出力形式です。`command_shell` は生成されるコマンド文字列だけを変更し、実行方法は変更しません。auto は Windows で PowerShell、それ以外で POSIX を選択します。`--command-shell`、`FX_COMMAND_SHELL`、cmd 設定で変更できます。マニフェストの shell テンプレートはそのままです。

bash、zsh、fish、PowerShell の補完は `fx completion <shell>` で生成し、必要に応じて自分の環境に読み込みます。

## 連携 {#integrations}

マニフェストでワークスペースの provider と連携 CLI を選びます。現在の実装は以下のとおりです。

| 能力                       | プロバイダー                                |
| -------------------------- | ------------------------------------------- |
| コードホスト               | Bitbucket CLI、ローカル bare Git リポジトリ |
| CI                         | Jenkins CLI                                 |
| ログ                       | OpenObserve CLI                             |
| エラー追跡                 | Sentry CLI                                  |
| クラスタの発見             | kubectl、読み取り専用の問い合わせ           |
| 課題と知識                 | Feishu Project、Confluence CLI              |
| コミュニケーションへの入口 | Lark CLI、WeCom CLI                         |

`fx manifest providers` と `fx tool list` で実際のバインディングを確認します。コミュニケーションと知識の入口は連携ツールに引き継ぎ、すべての API を fx が仲介するわけではありません。

Agent の検出には Claude Code、Codex CLI、Cursor などの登録済みホストを含みます。Skill、hook、MCP、ルールの対応はホストによって異なります。`agent list`、`hook list`、`mcp list` と[ホストの契約](user-guide.md#for-coding-agents)で確認してください。
