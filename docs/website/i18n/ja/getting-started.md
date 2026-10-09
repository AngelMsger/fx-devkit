# fx を使う

fx をインストールし、チームのマニフェストを接続してリポジトリやツール、エージェントを利用します。

リリースごとの変更は[変更履歴](../CHANGELOG.md)を参照してください。インストール済みの実行ファイルが対応する機能は、`fx <command> --help` と同梱の Skill で確認できます。

目的に合わせて読み始めてください：

- 新規ワークスペース：[インストール](#install)、次に[クイックスタート](#quick-start)。
- リポジトリが多い場合：[ダウンロード前に選択](#choose-repositories-before-downloading)。
- セットアップが中断した場合：[結果の確認と復旧](#reading-initialization-and-recovery-results)。
- コーディング Agent：[構造化結果と bundled Skill](#for-coding-agents)。

## 動作環境 {#requirements}

- Node.js ≥22。開発バージョンは package.json に固定されています。Bun もランタイムとして利用できます。
- PATH 上の Git。グローバルインストールと `fx self update` には、Bun を使う場合も npm が必要です。
- チームのマニフェスト、または[自分で作成したマニフェスト](manifest-guide.md)。

macOS と Linux をサポートします。Windows のネイティブアダプターは実装済みですが、実機実行とエージェントホストの有効化は未検証です。対象はローカル NTFS 上の PowerShell 5.1/7 と cmd です。[Windows の検証範囲](support.md#platform-support)を参照してください。

## インストール {#install}

<!-- distribution:internal -->

fx はチームのプライベート Registry で配布し、公開リリースは保留中です。チームから Registry URL と npm のアクセス権を取得してください。既存の npm scope 設定を再利用でき、`FX_REGISTRY` は任意の上書きです。以下の URL は架空で、パッケージが Registry に存在する必要があります。

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
npm install -g @fx/devkit
fx --version
```

`npm login --scope=@fx --registry=...` は scope と Registry を関連付けます。設定済みならインストールだけで構いません。`fx self info --format json` は有効な `registry` と `registry_source` を表示し、npm 設定を変更しません。

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

必要なのは、チームから渡されたマニフェストの場所と、ワークスペースを作るディレクトリです。Agent に「fx を使い、このマニフェストからこのディレクトリにワークスペースを準備して」と依頼できます。自分で操作する場合は、まず計画を確認して実行します。

```sh
fx init ./work --from <manifest-repository> --dry-run
fx init ./work --from <manifest-repository>
```

fx はソースを検証し、承認済みのローカルツールと設定を準備して、選択したリポジトリと Agent 用のガイド・Skill を配置します。名前は既存の登録と重複しないよう自動で決まり、既存のファイルと完了済みの作業は保持されます。新しいコマンドを承認する前に、表示された引数を確認してください。

**Ready to work** と表示されたら作業を始められます。個人のログイン、権限、承認が必要な場合は、残る対応がまとめて表示されます。対応後は、返された再開コマンドを使います。

```sh
fx init --resume --workspace work
```

ターミナル出力には、個人のログインコマンドと再開コマンドが表示されます。自分のターミナルでログインを完了し、表示された前提条件を解決してから再開してください。

再開時は現在の状態を検証し、完了済みの準備を省略します。ディレクトリのソースを再取り込みしたり、既存の checkout を作り直したりしません。内部ステージや診断コマンドの組み合わせを覚える必要はありません。

新しいワークスペースでは共有リポジトリをすべて選択します。初回のダウンロードを絞る場合は[リポジトリを選び](#choose-repositories-before-downloading)、初回のプレビューと実行に `--repos` を加えます。既存ディレクトリも自動で採用されます。日常の更新は `fx sync`、リポジトリの状態確認は `fx status` を使います。

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

明示的な Git URL を使い code-host を結び付けていない manifest では、リポジトリの同期にコードホストのユーザー名は不要です。

未取得のリポジトリも一覧に残ります。Agent にそのリポジトリの作業を依頼するか、`fx repo show <name>` を実行してください。返された `next_steps` で対象のワークスペースにリポジトリを追加選択して同期し、表示されたパスで元の作業を続けられます。

`--all` は将来追加される項目を含むチームの全体集合に追従します。現在存在する名前をすべて列挙しても、それは固定リストです。`--none` は何も選択しません。一覧と変更結果に現在のモードが表示されるため、空の選択と未設定を区別できます。

リポジトリの選択は共有エントリーだけを対象とし、ローカルで登録したリポジトリと manifest checkout は別途管理されます。`select` は空白区切りの名前、init の `--repos` はカンマ区切りのリストを受け取ります。

## リポジトリ状態の読み方 {#read-repository-status}

`fx status` は対象ワークスペースと未追跡ファイル数を表示します。`fx status --dirty` は追跡済みファイルの変更と新規の未追跡ファイルの両方を検索します。JSON の `dirty` は従来どおり追跡済みファイルまたはインデックスの変更を表し、追加された `uncommitted` はどちらの未コミット作業も表します。無視されたファイルは未追跡作業に含みません。空の結果では、リポジトリ未選択か、フィルターに一致する変更がないかを説明します。

ワークスペースのルートは Git リポジトリではないため、`fx status` は `stray_entries` も返します。これはルートにあるファイルやディレクトリのうち、checkout、派生ガイド、エージェントやサービスの設定、ワークベンチのいずれでもないものです。`fx doctor` は `root` グループで 1 件ずつ警告として表示し、準備状態の判定には影響しません。

sync は作業ファイルとブランチを保持します。計画された動作を確認してください。追跡済みファイルの変更は `skip_dirty` となる場合があり、別ブランチの checkout では追跡対象ブランチの参照だけを更新できます。status は通常 fetch しません。リモートとの比較を更新する場合は `--fetch` を明示します。

## 基本概念 {#concepts}

### ワークスペースとマニフェスト {#the-workspace-and-the-manifest}

ワークスペースは、独立した checkout と管理対象のエージェントリソースを含む登録済みの通常ディレクトリです。マニフェストのソースは `~/.fx/workspaces/<name>/source` にあります。fx は管理対象のルートで Git を実行しません。同期は checkout、reset、stash によって未コミットの変更や分岐した履歴、別ブランチでの作業を上書きしません。

どのリポジトリにも属さない成果物は、ワークスペースルートの `.workbench/` に置きます。タスクごとに日付付きのディレクトリを 1 つ作ってレポート、計画、証拠を入れ、`worktrees/` は `git worktree add` の作成先、`tmp/` はいつでも破棄できるものに使います。派生ガイドがエージェントに同じ規則を伝えます。fx はこのディレクトリに書き込みません。

workspace、environments、tools、members の文書に共有情報を記述します。任意の harness 文書では MCP とルールを宣言します。

```sh
fx manifest explain 'repos[].upstream'
fx manifest schema --kind tools
```

### 個人設定

グローバル設定はワークスペースと設定値を登録します。エージェント選択は同一 FX_HOME のワークスペース間で共有され、リポジトリと環境の選択はワークスペース単位です。`repo add` はローカル参照を登録し、`repo remove` は参照だけを削除してファイルを残します。設定のエクスポートには資格情報、信頼記録、マニフェスト checkout は含まれません。

### ケイパビリティ、プロバイダー、連携ツール

capability はコードホスト、CI、ログ、エラー追跡などの目的を表し、provider は連携 CLI を通じて実装します。マニフェストが能力、プロバイダー、環境の座標を結び付けます。`can` は準備状態、`where` は座標、`release` は宣言されたリリースチェックを返します。

ワークスペース単位で結び付ける能力は `code-host`、`issue-tracker`、`knowledge-base`、`im`、`calendar`、`meeting`、`task`、`worklog` です。環境単位で platform ごとに結び付ける能力は `error-tracker`、`log-store`、`metrics`、`ci`、`cluster` です。`fx manifest providers` は結び付けの内容と、各能力が受け付ける provider を一覧します。`calendar` は予定と空き時間の所在です。`meeting` はオンライン会議とその録画・議事録を保持する会議システムで、予定の管理と会議の開催を別の製品で行うチームは両方を結び付けます。

`metrics` は `prometheus-cli` が提供します。座標はサービスの scrape job です。`where` は `up{job="..."}` クエリを出力し、そのサービスのターゲットのラベル集合を返すので、以降のセレクターを書く出発点になります。何にも一致しないセレクターでもクエリは成功するため、メトリクスには存在確認の probe がなく、`where --probe` は推測せず `unknown` を報告します。

`tool list/show` は要件を表示し、`tool install/update` は宣言されたインストーラーを使い、`login` は設定を案内します。認証は各ツールの責任で、保存済みの認証情報をどのサービスへ送れるかの判断も含みます。fx が同梱ツール向けに定義するコマンドは確認なしで実行されます。チームの `tools.yaml` が追加または上書きした実行ベクトルには一度の信頼が必要で、変更後は再確認します。手動手順の完了を申告するだけでは検証成功の代わりになりません。

ツール定義は内蔵の目録と選択したワークスペースの `tools.yaml` を統合します。ワークスペースのツールチェーンはそのうち実際に使う部分、つまり結び付けた provider が動かすツールと tools.yaml が宣言したツールです。`fx tool list` は各ツールがなぜそこにあるかを示し、`--catalog` は fx が知っていて選ばれていないツールも表示します。選択順は `--workspace`、`FX_WORKSPACE`、現在のディレクトリを含む登録済みルート、`default_workspace` です。解決できない場合は読み取る結び付けがないため、内蔵の目録を表示します。インストール先はパッケージ管理ツールが決め、複数のワークスペースで共有します。

`tool install` と `tool update` は名前か `--all` のいずれか一方を必須とします。install の `--all` は有効で PATH にないツールを補い、update の `--all` は選択したツールチェーンの有効なツールすべてを対象にします。明示した名前では無効なツールも選べます。引数なしの呼び出しはパッケージ操作前にエラーになります。

doctor はワークスペースが宣言したツールと、選択された環境で有効な provider の依存ツールを既定で確認します。未使用の組み込みツールは `tool list --catalog` または明示的な `doctor --tool <name>` で確認できます。不在でも無関係なワークスペースの異常にはしません。インストールはマシン単位なので、ツールチェーン自体は manifest が宣言する全環境にまたがり、doctor の検査だけが対象環境に絞られます。有効な provider の依存ツールが無効化されている場合は、検査を未完了として報告します。

init/sync も同じ関連ツールを対象とします。任意ツールの不在は表示しますが、準備を妨げません。有効な `install_on_init` ツールは検証が必要です。無効な任意ツールは、このインストール指定だけで必須にはなりません。

組み込みの Sentry ツールは npm の `sentry` パッケージからインストールできます。manifest で指定すれば init 中も対象になります。

### 共有サービス設定と個人の認証情報 {#shared-service-settings-and-personal-credentials}

manifest の `service` は URL、context、組織、認証方式などの公開接続設定を宣言します。`init`、明示的な `sync`、`login` が対応 CLI 自身のコマンドで準備し、バックグラウンド hook は確認だけを行います。`fx sync --only services --dry-run` でプレビューします。

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

`skill status` はインストール版と `activation: unverified` を返します。ファイルの存在だけではホストによる読み込みを証明できません。必要なときに同梱ガイドを読み、通常のコマンドでは Skill の読み込み宣言は不要です。

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

## コーディング Agent 向け {#for-coding-agents}

`fx self info --format json` から始めます。初期化では返された `initialization_guide` を読み、同じ実行ファイルを使い続けます。Skill 読み込み済みの環境変数は不要です。[完全な Skill](../skills/fx-workspace/SKILL.md) はその他のタスクを説明します。

`--format json` を使い、stdout の結果と stderr の進捗・通知・エラーを分けて保存します。既定の結果は準備の判定とすべての障害を保持し、`--details` で各段階の証拠を展開します。human ではタスクの結果と次の操作を先に表示します。明示的な `--fields` は完全な結果から抽出し、ドットパスは平坦なキーになります。例：`fx sync --format json --fields operation,preparation.state,items,summary`。

| 結果               | 完了の判定                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `init/sync/doctor` | `preparation.state` は `planned`、`ready`、`incomplete`。対象は `preparation.scope` の範囲です。 |
| `release`          | `ok`、`complete` と確認項目を読みます。公開やデプロイは行いません。                              |
| `can`              | 対象能力の `status` と引き継ぎを読みます。                                                       |

準備完了の終了コードは 0、未完了は 12 です。プレビューは計画だけです。設定や実行のエラーは元の分類コードを保持し、部分的な stdout を返す場合もあります。`doctor.coverage` は診断の確認範囲を別に示します。任意のホスト機能の有効化が未検証でも必須作業は阻害しません。ファイルの存在だけでは有効化を証明できません。

Init は承認済みのローカル準備を実行し、完了した手順も結果に保持します。認証が未完了でも、準備を繰り返さないでください。

`--workspace` は登録名または登録済みのルートディレクトリを受け付けます。`--details` はどのコマンドでも使え、情報照会はもともと完全な結果を返します。出力を保存して解析する場合は、タスクで許可されたディレクトリを使ってください。読み取り専用設定はシェルのリダイレクトを制御しません。

まず `preparation.next` を読み、プレビューの確認、準備完了後の元タスクの続行、Agent の操作、または前提条件の引き継ぎを選びます。`next_actions` は Agent の操作のみです。個人の操作はブロッカー内の `actor: user` に残り、条件が変わってから `resume` を実行します。

`preparation.blockers` をまとめて確認します。`next_actions` には正確な argv、cwd、任意の env 座標、承認条件があり、再開時にこれらを保持します。`resume` は登録済みワークスペースを再開します。既存の承認は維持され、新しい引数列は確認が必要です。登録や clone だけで成功と判断したり、詳細を得るため書き込みを繰り返したり、個人の認証情報をマニフェストへコピーしたりしないでください。

ファイル競合の結果は `stage_details.docs.files`（init では `sync` 配下）に残ります。外部ファイルの置換は承認を必要とし、同じ階層にバックアップを保持します。[応答契約](../skills/fx-workspace/references/commands.md)も参照してください。

## 0.4.0 への移行 {#migrating-to-040}

- ツール文書は `schema_version: 3` を使います。`kind: run` に `phase: prepare`（非対話のローカル準備）または `phase: authenticate`（個人のログイン）を宣言します。旧形式はワークスペースへの変更前に移行エラーを返し、スクリプトの目的を推測しません。
- Skill 読み込みハンドシェイクと `skill_notice` 設定を廃止しました。`FX_SKILL_LOADED`、`FX_SKILL_VERSION`、`FX_SKILL_NOTICE` は使用しません。loaded/version_verified の代わりにインストール版と `activation` を確認してください。
- `preparation.state` が `preparation_complete` に代わります。doctor の最上位 `ok/complete` は準備結果と診断 `coverage` に置き換わり、release は従来の契約を保持します。準備未完了は終了コード 12 です。
- ワークスペースの一覧は、登録を読み取れることを `registration_status: available` で示します。準備完了の判定ではありません。
- `init --resume --workspace <name>` は管理済みソースと既存の選択を使います。通常のソースガイドに fx マーカーは不要です。不足領域を生成先へ補い、共有ソースは保持します。

形式は[マニフェストガイド](manifest-guide.md)を参照してください。

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

結果に含まれる再開操作に従います。新しいソースが未受理なら完全な再試行コマンドを使い、受理済みなら管理済みソースと既存の選択で再開します。登録やファイルの書き込みは実行済みの効果であり、完了は `preparation.state` と障害項目で判断します。

ローカルのプレビューはディレクトリ、stdin、Git のコミット済み内容を調べます。新しいリモートソースは取得まで `source_inspected: false` です。既知のガイド競合と予定コマンドを先に表示し、プレビューだけでは信頼を付与しません。通常のソースガイドから生成先へ不足領域を補い、共有本文は保持します。曖昧なマーカーは管理者が修正します。

部分失敗でも、完了済みのリポジトリ、ローカル準備、利用者のファイルは保持されます。前提条件へ対応してから返された操作で続けます。既存のインストールと検証済みの手順は省略します。相対ファイルはワークスペースのルートを基準とします。空白や Unicode を含むディレクトリにも名前を自動生成するため、返された識別子を使ってください。

`SKILL_WRITE_DENIED` では対象パスを確認します。FX_HOME を変えても共通ロックは移動しません。`fx sync --only repos,docs --no-refresh-manifest` で可能な作業を続けられますが、Skill の修復完了とは別です。外部ファイルの置換には承認とバックアップが必要です。Git ソースの更新はローカル変更を保護し、通常の再試行はリポジトリの可読性を再確認します。[サポート](support.md#troubleshooting)も参照してください。

### 人の操作後にログインを再開する {#resume-login-after-a-handoff}

`login` が人の入力を必要とする場合は、許可された handoff を完了して同じコマンドを再実行します。fx は操作の前に現在の状態を確認します。その後、元の `can` または `doctor` を再実行し、元のタスクを続けてください。

機械から呼び出す場合、非ゼロ終了でも部分的な stdout と stderr のエラーを両方確認します。完了済みのステップは保持され、`handoff`、`blocked`、`failed`、`not_started` が残る作業を区別します。集計、計画上の問題、復旧フィールドは[ログイン応答契約](../skills/fx-workspace/references/commands.md#readiness-and-recovery)を参照してください。

### Skill の所有権とホストの有効化 {#skill-ownership-and-host-activation}

ユーザー用 fx Skill はワークスペース間で共有し、ユーザー単位のロックで保護します。チームリンクは各ワークスペースに属し、対応インストーラーは自らの版を管理します。正しいファイルだけではホストの有効化を証明できません。

`hook list` で対応状況と検証状態を確認します。検証した Grok 1.0.25 は Git ルートでのみプロジェクト hook を検出し、通常のディレクトリ信頼では制限を解消できません。明示的な `fx sync --only docs,skills` を使い、ワークスペースルートは通常のディレクトリのままにします。ホストの実行承認は別途必要です。

### 既存のログインを再利用する

初期化ではチーム共通の context 名を維持します。対応する CLI は同じサービスの既存ログインを照合し、個人の認証情報を再利用してから、再ログインが必要かを判断します。トークンは元の CLI の認証ストアに残り、現在の context と既存の ID は変更されません。複数の候補がある場合は、元の CLI の `auth reuse --from-context` で選択できます。ネットワークやキーチェーンの問題は、認証情報の不足とは別に報告されます。
