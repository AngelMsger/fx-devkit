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
fx init ./work --name work --from <manifest-repository> --dry-run
fx init ./work --name work --from <manifest-repository>
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

## ワークスペースの確認と管理 {#find-and-manage-workspaces}

`fx workspace list` は任意のディレクトリで使えます。デフォルトが未設定の場合や、登録先のルートまたはマニフェストが失われた場合も利用できます。`fx workspace show <name>` は、マニフェストが正常でなくても、識別情報、ソース、状態、選択の根拠を返します。明示的な選択は `fx status --workspace <name>` を使います。省略時は現在のディレクトリを含むワークスペースが `default_workspace` より優先されます。

```sh
fx workspace list
fx workspace show work
fx status --workspace work
fx config set default_workspace work
```

ディレクトリを移動済みの場合は `workspace relocate <name> <new-dir>` で登録先を更新します。この操作は checkout を移動したり再クローンしたりしません。マニフェストのソース変更には `workspace rebind <name> --from <source>` を使い、ワークスペースの識別情報と個人の選択を保持します。同じ実体のディレクトリを別名で登録する方法は移行になりません。

`workspace unregister <name>` は業務 checkout を残して管理を解除します。ライフサイクル操作は `--dry-run` でプレビューし、管理対象リソースの削除計画と競合を確認してください。外部で作成されたファイルは保持されます。

## ダウンロード前のリポジトリ選択 {#choose-repositories-before-downloading}

初回ダウンロードを絞るには init に `--repos` を指定します。名前は検査済みマニフェストに存在する必要があります。`--no-repos` は空の選択です。既存ワークスペースに対する init で両方とも省略すると、現在の選択を保持します。

```sh
fx init ./work --from <manifest-repository> --repos example-api --dry-run
fx init ./work --from <manifest-repository> --repos example-api
```

既存ワークスペースでは `select` が選択集合を置き換え、`pick` が名前を追加し、`unpick` が除外します。選択の変更でファイルは削除されず、checkout のダウンロードも自動では行いません。取得や更新には続けて sync を実行します。

```sh
fx repo select example-api
fx repo pick example-web
fx sync --dry-run
fx sync
fx repo select --all
fx env select dev
fx env select --none
fx env select --all
```

`--all` は将来追加される項目を含むチームの全体集合に追従します。現在存在する名前をすべて列挙しても、それは固定リストです。`--none` は何も選択しません。一覧と変更結果に現在のモードが表示されるため、空の選択と未設定を区別できます。

リポジトリの選択は共有エントリーだけを対象とし、ローカルで登録したリポジトリと manifest checkout は別途管理されます。`select` は空白区切りの名前、init の `--repos` はカンマ区切りのリストを受け取ります。

## リポジトリ状態の読み方 {#read-repository-status}

`fx status` は対象ワークスペースと未追跡ファイル数を表示します。`fx status --dirty` は追跡済みファイルの変更と新規の未追跡ファイルの両方を検索します。JSON の `dirty` は従来どおり追跡済みファイルまたはインデックスの変更を表し、追加された `uncommitted` はどちらの未コミット作業も表します。無視されたファイルは未追跡作業に含みません。空の結果では、リポジトリ未選択か、フィルターに一致する変更がないかを説明します。

sync は作業ファイルとブランチを保持します。計画された動作を確認してください。追跡済みファイルの変更は `skip_dirty` となる場合があり、別ブランチの checkout では追跡対象ブランチの参照だけを更新できます。status は通常 fetch しません。リモートとの比較を更新する場合は `--fetch` を明示します。

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

ツール定義は内蔵の基線と選択したワークスペースの `tools.yaml` を統合します。選択順は `--workspace`、`FX_WORKSPACE`、現在のディレクトリを含む登録済みルート、`default_workspace` です。解決できない場合は内蔵定義だけを使います。インストール先はパッケージ管理ツールが決め、複数のワークスペースで共有します。

`tool install` と `tool update` は名前か `--all` のいずれか一方を必須とします。install の `--all` は有効で PATH にないツールを補い、update の `--all` は選択したツールチェーンの有効なツールすべてを対象にします。明示した名前では無効なツールも選べます。引数なしの呼び出しはパッケージ操作前にエラーになります。

doctor はワークスペースが宣言したツールと、選択された環境で有効な provider の依存ツールを既定で確認します。未使用の組み込みツールは `tool list` または明示的な `doctor --tool <name>` で確認できます。不在でも無関係なワークスペースの異常にはしません。有効な provider の依存ツールが無効化されている場合は、検査を未完了として報告します。

### 共有サービス設定と個人の認証情報 {#shared-service-settings-and-personal-credentials}

manifest の `service` は URL、context、組織、認証方式などの公開接続設定を宣言します。`init`、明示的な `sync`、`login` が信頼済みの対応 CLI コマンドで準備し、バックグラウンド hook は確認だけを行います。`fx sync --only services --dry-run` でプレビューします。

設定と認証は別です。各メンバーが対応 CLI で自分の認証情報を取得・保存します。競合する既存設定は保持して報告し、sync は個人のログインを行いません。Sentry はワークスペースの `.sentryclirc` に公開デフォルトのみを書き、外部所有のファイルは保持します。

sync の `stages.services` と `stage_details.services.items` が結果を示します。init はこれらを `sync` 配下に返します。要約にはブロック・失敗項目が残り、`--details` では成功項目も確認できます。[サービス設定](manifest-guide.md#public-service-presets)と[復旧リファレンス](../skills/fx-workspace/references/commands.md#service-preparation)を参照してください。

### ツールのインストール履歴 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install`、`tool update` は `$FX_HOME/tool-history.json` に試行を記録します。`installed` はパッケージ管理器の成功を示しますが、その後の版確認は失敗する場合があります。`started` だけでは成功を証明できません。dry-run と init が既存ツールをスキップした場合は記録しません。

`tool inventory` のインストール元と `tool list/show` の定義元は別の事実です：

| installation_origin | 証拠                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fx`                | fx がそれまで存在しなかった実行ファイルを正常にインストールし、現在のパスも記録と一致しています。                          |
| `external`          | fx のインストール記録なしに既知の実行ファイルが存在していました。fx で更新や再インストールをしても、この出所を維持します。 |
| `unknown`           | 旧履歴、未完了の操作、変更または欠落したパスのため、現在の出所を確認できません。                                           |

依存関係の確認は同じ FX_HOME に登録された全ワークスペースを対象とし、有効な任意ツールと内蔵デフォルトを含みます。fx によるインストールが確認でき、残る要求がない場合だけ `unused` になります。他の FX_HOME や未登録プロジェクトは対象外です。削除の提案は参考情報で、sync/doctor はアンインストールしません。読めない manifest や不十分な証拠から削除可能とは判断しません。

照会は PATH ツールを管理下に移したり過去の履歴を再構築したりしません。[一覧のフィールド](../skills/fx-workspace/references/commands.md#installation-audit-and-inventory)と[ローカルデータ](user-privacy.md#what-stays-on-your-machine)を参照してください。

### fx 同梱 Skill とチーム Skill

fx 同梱 Skill は Agent に CLI の使い方を説明します。インストールやワークスペース登録なしでも読めます：

```sh
fx self info --format json
fx skill show
fx skill status
```

ホストにコピーを検出させるには `fx skill install --agent codex` を使います。`--project` は現在のディレクトリ、`--dir ./custom-skills` は独立ディレクトリを対象とし、後者は `--agent`、`--project` と併用できません。単独の Skill コマンドはワークスペースの Agent 選択とは独立しています。検出・置換・削除は [Skill リファレンス](../skills/fx-workspace/references/commands.md#standalone-companion-skill)を参照してください。

明示的な install は認識済みコピーを呼び出した CLI の版に揃え、同版の修復や新しい版の置換も行います。init/sync は同版を再利用し、新しい版を下げません。外部所有の内容の置換には確認とバックアップが必要です。削除しても Agent 選択は変わらず、後の sync で再インストールされる場合があります。

インストール、版の一致、読み込み宣言は別の事実です。bundled Skill を読んでから `FX_SKILL_LOADED=1` と `FX_SKILL_VERSION=<bundled_skill_version>` を設定します。宣言だけでは実際の読了を証明できません。導入用コマンドは通知を出さず、他の非 TTY コマンドは版が一致するまで案内を出します。`FX_SKILL_NOTICE=0` で抑制できます。

チーム Skill は manifest の `skills/` にあり、init/sync が選択ホストへリンクし、ルート AGENTS.md に一覧を生成します。ワークスペースルートから起動してください。子リポジトリでの検出は保証されません。`fx sync --only docs,skills` で更新します。共有リンク経由で fx 同梱 Skill をインストールせず、ユーザー用コピーか独立ディレクトリを使います。

### 共有情報への貢献

`source push` は選択したソースファイルの変更をプレビューまたは提出し、ソース checkout の HEAD、インデックス、作業ファイルを保護します。個人フォークと上流の関係を示す根拠が必要です。実行前に `fx source push --help` と[貢献の契約](cli/README.md#fx-source-push)を確認してください。

## 主なコマンド {#commands}

`fx <topic> --help` で正規コマンドと互換名を確認できます。集合引数は繰り返しとカンマ区切りに対応します。

| 目的                   | コマンド                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 作成、同期、状態確認   | `init`、`sync`、`status`                                                                             |
| アクセス設定と準備状態 | `login`、`doctor`、`can`                                                                             |
| 座標とリリースの根拠   | `where`、`release`                                                                                   |
| リポジトリ管理         | `repo list/show/pick/unpick/add/remove/fork/open`                                                    |
| 環境とエージェント     | `env list/show/pick/unpick`、`agent list/pick/unpick`                                                |
| ツールと Skill         | `tool list/show/install/update/history/inventory`、`agent skills`                                    |
| 共有ソース管理         | `manifest validate/lint/explain/schema/providers/repo-set/record-probe/render/import`、`source push` |
| メンバーと設定         | `member list/show`、`config list/get/set/unset/export/import`                                        |
| ホストのリソース       | `hook list/enable/disable`、`mcp list/show`                                                          |
| CLI 自体の管理         | `self info/update`、`completion`                                                                     |

正確な構文は `--help` と[生成された CLI リファレンス](cli/README.md)が基準です。

## コーディングエージェント向け {#for-coding-agents}

`fx self info --format json` で現在の bundled Skill を特定して読み、`FX_SKILL_LOADED=1` と一致する `FX_SKILL_VERSION` を宣言します。`fx skill show` でも読めます。[同梱 Skill](../skills/fx-workspace/SKILL.md)がタスクの入口を示します。

`--format json` を使い、stdout の結果と stderr の通知・進捗・エラーを分けて解析します。集合は `{items, has_more, next?}` です。`--no-input` は入力待ちを禁止し、`--quiet` は通知と進捗を抑えます。

`init`、`sync`、`doctor`、`release` は要約を既定とし、件数、例外、復旧手順を保持します。`omitted` は省略数です。`--details` は完全な結果、明示的な `--fields` は完全な結果からの抽出で、`--verbose` は別途診断を制御します。human、NDJSON、事実照会の既定は変わりません。

| 結果             | 確認するフィールド                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `init/sync`      | `operation` と `preparation_complete`。プレビューは `null`。実行では今回選択・要求した準備だけを判定します。 |
| `doctor/release` | `ok` は失敗項目なし、`complete` は要求した確認に未確認の範囲なしを意味します。警告も確認します。             |
| `can`            | `status` と `handoff`。準備完了は個別のリモート照会の成功を保証しません。                                    |

終了コード 0 のレポートにも失敗項目があり得ます。init/sync の非ゼロ終了にも部分的な stdout が残る場合があります。未コミットの変更、分岐、ブロック、失敗、未検証の有効化があれば準備は未完了です。未選択の資源は影響しません。`release` は確認用で、パッケージ公開やサービスのデプロイをしません。

書き込み前に出力形式を選びます。承認済みの同期では、一度だけ完全な結果を保存します：

```sh
fx sync --format json --details > sync-result.json
```

その後は同じファイルを解析します。JSON を切り詰めたり、詳細取得のために書き込みを繰り返したりしません。部分結果と stderr のエラーを併せて読みます。[応答の契約](../skills/fx-workspace/references/commands.md)を参照してください。

## 0.2.0 への移行 {#migrating-to-020}

- ワークフローの JSON は要約が既定です。正常項目や証拠が必要なスクリプトは `--details` を追加してください。明示的な `--fields` は完全な結果から抽出します。
- 空の Agent 選択は「選択なし」です。自動検出への復帰は [Agent 選択](#agent-selection)を参照してください。
- 現在の bundled Skill を読んでから `FX_SKILL_VERSION` を宣言します。従来の真偽値だけでは版を確認できません。

結果の解釈は[エージェント向け説明](#for-coding-agents)を参照してください。

## 設定 {#configuration}

`~/.fx` には登録、個人レイヤー、所有権状態、信頼記録、キャッシュがあります。`FX_HOME` は fx の個人ディレクトリのみを変更し、連携ツールの資格情報の場所は変えません。

`config list` はキー、既定値、環境変数名、実効値の出所を示し、`config get <key> --explain` は各レイヤーを説明します。優先順位は明示的フラグ、環境変数、ファイル、組み込み既定値です。`config export/import` で個人設定を移行します。

インポートはワークスペース登録を名前ごとにマージし、profile に含まれない既存登録を保持します。指定された個人レイヤーは置き換えますが、既存ワークスペースのルートやソースは変更しません。先に `workspace relocate` または `workspace rebind` を使ってください。登録解除には `workspace unregister` を明示します。計画は登録と残りの準備作業を示し、失われた manifest checkout は表示された init コマンドで復元できます。エクスポートには manifest checkout、信頼情報、認証情報を含みません。

`format` は出力形式です。`command_shell` は生成されるコマンド文字列だけを変更し、実行方法は変更しません。auto は Windows で PowerShell、それ以外で POSIX を選択します。`--command-shell`、`FX_COMMAND_SHELL`、cmd 設定で変更できます。マニフェストの shell テンプレートはそのままです。

bash、zsh、fish、PowerShell の補完は `fx completion <shell>` で生成し、必要に応じて自分の環境に読み込みます。

### Agent 選択 {#agent-selection}

`fx config set agents codex` は指定ホストを選び、`fx config set agents ''` または空の `FX_AGENTS` は何も選びません。設定と環境変数の上書きを両方解除すると自動検出に戻ります。同じ FX_HOME の全ワークスペースに適用されます。FX_HOME はグローバル Skill や対応 CLI の認証情報を移動しません。

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

## 初期化と復旧結果の読み方 {#reading-initialization-and-recovery-results}

init は登録後に別の段階で失敗することがあります。非ゼロ終了でも部分 stdout を読み、原因を解決してから同じ名前・ソース・ディレクトリで再試行します。同じ実体ディレクトリへのシンボリックリンクは使えますが、別のディレクトリは競合です。

| 証拠                                | 意味                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `registered` / `written`            | 登録が存在するか／今回ローカルに書き込んだか。完了は別途 `preparation_complete` で確認します。  |
| `failed_phase`、`phases`、`failure` | 停止した段階と復旧手順。                                                                        |
| `sync.stages`、`sync.stage_details` | init の同期結果。sync コマンドでは `sync` 接頭辞を外します。                                    |
| `tool_install`                      | インストール試行。`code: null` は成功ではなく、インストール後の版確認が失敗する場合もあります。 |
| `observed`                          | Skill 失敗後のディスク状態。失敗した書き込みが既に変更を加えた可能性があります。                |

`SKILL_WRITE_DENIED` では拒否されたパスを調べます。FX_HOME の変更では共有ロックは移動しません。`fx sync --only repos,docs --no-refresh-manifest` でリポジトリとガイドの作業を続けられますが、Skill の修復ではありません。条件が変わらない失敗を繰り返したり、コマンドの信頼を迂回したりしません。

`INIT_PREPARED` はインストールやクローン前に計画を示します。init の dry-run はローカルディレクトリ、stdin、ローカル Git のコミット済み内容を検査し、リポジトリの操作を実行せずに表示します。新しいリモートソースは取得せず、`source_inspected: false` でその境界を示します。指定したリポジトリ選択も未検証です。先に内容を確認する場合は、プレビューの案内に従いローカル checkout を検査してください。計画と実際の状態は分離され、`registered` は現在の登録状態を示します。予定や今回の新規登録だけを意味しません。stderr の進捗はハートビートであり転送率や ETA ではありません。完全な JSON は `--details` を指定します。

通常の再試行ではリポジトリの読み取り可否を再確認します。以前は存在しなかったリポジトリを古い負のキャッシュで遮断し続けません。

ツール、ログイン、更新の問題は[サポート](support.md#troubleshooting)を参照してください。`no_access` は環境が未選択という意味で、リモート ACL の拒否ではありません。Git 転送の認証情報と任意のコードホスト API 確認は独立しています。

### Skill の所有権とホストの有効化 {#skill-ownership-and-host-activation}

ユーザー用 fx Skill はワークスペース間で共有し、ユーザー単位のロックで保護します。チームリンクは各ワークスペースに属し、対応インストーラーは自らの版を管理します。正しいファイルだけではホストの有効化を証明できません。

`hook list` で対応状況と検証状態を確認します。検証した Grok 1.0.25 は Git ルートでのみプロジェクト hook を検出し、通常のディレクトリ信頼では制限を解消できません。明示的な `fx sync --only docs,skills` を使い、ワークスペースルートは通常のディレクトリのままにします。ホストの実行承認は別途必要です。
