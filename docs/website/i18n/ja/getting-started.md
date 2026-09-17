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

### ツールのインストール履歴 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool installed --format json
```

`init`、`tool install`、`tool update` はインストールの試行を `$FX_HOME/tool-history.json`（既定値は `~/.fx/tool-history.json`）に保存します。時刻、操作 ID、ワークスペース、パッケージマネージャーとパッケージ、機密情報を除いた実行コマンド、終了コード、確認したバージョンと実行ファイルのパスを記録します。各試行には `started`、任意の `installed`、`finished` のチェックポイントがあります。`installed` はパッケージマネージャーが正常終了したことを示し、後続のバージョン検証が失敗しても残ります。`started` だけでは実行や成功を証明できません。dry-run、手動インストールの案内、実行前の信頼拒否、init がスキップした既存ツールは記録しません。PATH から過去のインストールを補完しません。履歴はローカルの操作証跡であり、改ざん防止機能はなく、`config export` にも含まれません。

`tool installed` はパッケージマネージャーとパッケージごとに最新の証拠をまとめ、同じ FX_HOME に登録されたすべてのワークスペースの現在のローカルマニフェストを確認します。有効な任意ツールと内蔵既定値も対象です。同じ実行ファイルまたはパッケージを必要とするワークスペースがあれば `required` です。内蔵ツールの無効化には `enabled: false` を使います。パッチを削除すると既定値に戻ります。最後の要件が消え、実行ファイルのパスが記録と一致すると `unused` になり、手動削除を検討できます。`sync` の tools ステージは `TOOL_UNUSED` と `stage_details.tools.installations` を出力し、`doctor` は参考情報を追加します。どちらもパッケージを削除しません。

読み取れないマニフェスト、隔離されたツール項目、不完全な実行記録があると `unknown`、成功記録のない失敗した試行は `unverified` です。`not_on_path` は削除済みの証明ではなく、`changed` は実行ファイルのパス変更を示します。ワークスペース外でインストールした記録のあるパッケージは `unscoped` です。これらの状態では削除を提案しません。別の FX_HOME、未登録のプロジェクト、外部でインストールしたパッケージは対象外なので、パッケージマネージャーで削除する前にそれらの用途を確認してください。マニフェスト項目の削除や手動アンインストール後も履歴は残ります。履歴ファイルが無効または読み取れない場合、新しいインストール操作は実行前に止まります。証拠を保持して修復してから再試行してください。

### fx 同梱 Skill とチーム Skill

fx 同梱 Skill は CLI の操作、ワークスペースの初期化、準備状態の復旧を案内します。初期化前から利用できます。

```sh
fx skill install
fx skill install --agent codex
fx skill status
fx skill path
fx skill show
```

`install/uninstall` は指定スコープの Agent を検出します。`--agent` は繰り返し指定またはカンマ区切りに対応します。`path/status` は既定で全対応 Agent を列挙します。`--project` は現在のディレクトリを使い、`--dir ./custom-skills` は `<dir>/fx-workspace` を指定します。`--dir` は `--agent`、`--project` と併用できません。ワークスペースの登録やサービスへのログインは不要です。単独インストールはワークスペースの Agent 選択を使いません。プロジェクト検出はネイティブのマーカーを使い、ユーザー単位の検出では PATH 上の Agent 実行ファイルも認識します。

明示的な `skill install` は認識済みコピーを現在の CLI の版に更新します。同じ版の修復や新しい版からの置換も含みます。`init/sync` は同じ版を再利用し、新しい版をダウングレードしません。外部所有パスの置換には確認とバックアップが必要です。書き込みは `--dry-run` と読み取り専用設定に従います。`skill uninstall` は確認後に認識済みコピーのみを削除します。非対話実行では `--yes` を使い、外部所有パスは保持します。Agent 選択は変更しないため、後続の同期でユーザー単位のコピーが再インストールされる場合があります。

`status` はインストール状態、版の一致、`FX_SKILL_LOADED=1` のロード済みハンドシェイクを分けて報告します。インストール成功は Agent のロード成功を意味しません。`path` は配置先、`self info` は同梱ソースの場所を示します。`show` はすべての出力形式で SKILL.md の原文を返します。Skill コマンドはローカル処理のみで、更新の通信、マニフェスト取得、連携インストーラーやログイン確認を実行しません。非 TTY の業務コマンドは未ロード時に構造化した探索通知を stderr に出します。setup と Skill コマンドは通知せず、`FX_SKILL_NOTICE=0` でも無効にできます。

チーム Skill はマニフェストの `skills/` にあり、`init/sync` が選択した Agent のプロジェクトディレクトリへリンクします。Windows では junction を使います。ルート AGENTS.md にも説明とソースへのリンクを列挙し、Agent がタスクに合う Skill を読めるようにします。Agent はワークスペースのルートから起動してください。子リポジトリからの検出は保証しません。`skill list` で配布状態を確認し、`sync --only docs,skills` で更新します。共有チームリンクへの同梱 Skill のインストールは `SKILL_SOURCE_PROTECTED` で拒否します。ユーザー単位または独立ディレクトリを指定してください。

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
| ツールと Skill         | `tool list/show/install/update/history/installed`、`skill list`                    |
| 共有ソース管理         | `manifest validate/lint/explain/schema/providers/set/render/import`、`source push` |
| メンバーと設定         | `member list/show`、`config list/get/set/unset/export/import`                      |
| ホストのリソース       | `hook list/inject/remove`、`mcp list/show`                                         |
| CLI 自体の管理         | `self info/update`、`completion`                                                   |

正確な構文は `--help` と[生成された CLI リファレンス](cli/README.md)が基準です。

## コーディングエージェント向け {#for-coding-agents}

`--format json` または `FX_FORMAT=json` を使用します。stdout はデータのみ、通知、進捗、エラーは stderr に出力します。コレクションの形式は `{items, has_more, next?}` で、不明な値は明示されます。

`--fields` は項目を絞り、`--quiet` は通知を抑え、`--no-input` は入力待ちを禁止します。書き込みコマンドは `--dry-run` と読み取り専用設定に対応します。`--allow-writes` は一回の呼び出しだけの明示的な上書きです。

doctor/release は失敗項目があっても終了コード 0 を返します。init/sync も部分成功で 0 を返す場合があります。init では `sync.summary` と `sync.stages`、sync では `summary`、`stages`、失敗項目の `failure` を読みます。`stage_details` に各リソース段階の結果と handoff が残ります。終了コードだけで準備完了と判断せず、認証の捏造やホストの信頼境界の回避をしないでください。

[内蔵 Skill](../skills/fx-workspace/SKILL.md)と[応答ガイド](../skills/fx-workspace/references/commands.md)を読んだ後で `FX_SKILL_LOADED=1` を設定します。同梱 Skill のソースは `self info`、インストール先は `skill path` で確認できます。

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

## 初期化と復旧結果の読み方

位置引数は argv のみから取得します. stdin は `init --from -` などの明示的な指定時だけ読みます. 複数語のコマンド全体を引用符で囲むと使用法エラーになります. Git clone は独立した Git 認証情報を使用し, コードホスト API CLI を必須としません. Git エラーは存在しないブランチ, 転送認証, 接続, ローカル競合を区別し, 復旧コマンドにはブランチと保存先を残します.

ソースの検証と登録後, `INIT_PREPARED` はツール実行や clone の前にインストールコマンドと Skill 保存先を表示します. 不足ツールのインストール後に追加の Skill コマンドが現れる場合も, 正確なコマンドの承認が必要です. 新規リモートソースの `init --dry-run` はソースを取得せず, 内容を把握済みとは扱いません. 外部所有ファイルの置換には常に承認とバックアップが必要です.

後続フェーズで例外が発生すると, stdout に `failed_phase`, `phases`, 構造化された `failure`, 完了済みリポジトリの結果と復旧手順を残します. 失敗結果のフェーズは `done`, `failed`, `not_started` で表し, 成功した同期ステージは通常の集計を維持します. stderr には元のエラーを出力し, 終了コードは非ゼロです. 未承認の Skill コマンドは blocked 行 (`tools_blocked`) となり, 独立した所有済みローカル投影は完了できます. 終了コードがゼロでも blocked と failed 行を確認してください.

リポジトリ処理中は5秒ごとに stderr へ完了数/総数, 処理中のリポジトリ, 経過時間を出力します. これはハートビートであり, Git のバイト進捗や完了予測ではありません. 人向け出力では未選択リポジトリと長い一覧を要約し, `--verbose` で未選択行, `--format json` で全詳細を確認できます. `FIELDS_UNMATCHED` は要求したフィールドが今回の結果にないことを示しますが, 任意フィールドの場合もあります. 投影は許容的なままで, 空のコレクションでは通知しません.

準備状態は `missing_tool`, `outdated_tool`, `disabled_tool` を区別します. Doctor のツール証拠には実行と同じ PATH 規則で解決した `binary_path` を含み, ランタイム管理ツールの shim を指す場合があります. status が正常終了しても `configured=false` なら準備完了ではありません. 設定済みであってもリソース権限やリモートクエリの成功は証明しません. `no_access` は個人の選択範囲外を表し, リモート ACL の拒否ではありません.

個人設定はロック内で読み取りと更新を行い, ファイルを原子的に置換します. `CONFIG_BUSY` では競合する更新の完了後に再試行します. 初期化失敗で残った Git source checkout は同じソースの再試行に使用でき, 異なる upstream やローカル作業は保護されます.

Bitbucket の任意のリポジトリ・ユーザー照会には、それぞれ 5 秒のプロセス実行期限があります。ツールが利用できない場合や照会がタイムアウトした場合も Git 転送は可能です。明示的なリポジトリアクセス拒否やリポジトリ不存在の結果は引き続き有効です。ユーザーのキャンセルと予期しない例外は処理を停止します。進捗は `preflight` の事前確認から始まり、リポジトリ変更時に `apply` へ切り替わります。

Skill ステージが中断すると、`sync.stage_details.skills` に `links`、`fx`、`tools` が残り、ツールのインストール結果は `tool_install` に残ります。項目の `status` は `done`、`failed`、`not_started`、`skipped`、プレビューの `planned` を区別します。失敗時のリソース項目にはディスク上の状態を示す `observed` が付き、観察にも失敗した場合は `unknown` になります。書き込みエラーが起きても、保存先は既に変更されている場合があります。インストーラーの `ran: true` は実行を試みたこと、`code: null` は終了結果を取得できなかったことを示します。`phase: version` の失敗で `code: 0` なら、パッケージのインストール自体は成功しています。失敗した項目を解決してから再試行してください。例外後に後続の書き込みは実行しません。

同じワークスペース名とソースであれば、登録済みルートのシンボリックリンク別名でも再試行できます。登録時には設定ロック内で実体パスを再確認し、実際に異なるディレクトリは競合として拒否します。

### Skill の所有権とホストの有効化

チーム Skill リンクはワークスペースに属します. fx 同梱 Skill はユーザーと選択したホストに属し, ワークスペース間で再利用されます. 初期化と同期では認識済みの新しい版を古い版で置換しません. 更新時はユーザー単位のロック内で所有権とバージョンを再確認し, 外部所有のコピーを保護します. 連携ツールは独自の Skill インストールとバージョン管理を所有するため, 別ワークスペースの同期でもそのインストーラーを呼び出す場合があります. ローカル Skill インストールは必ずしも通信を必要とせず, 呼び出し元の承認待ちと実行中の子プロセスを区別します.

`agent list` は `detected`, `selected`, `selection` (automatic または explicit), `active: null` を返します. 検出は現在の活動を証明しません. 初期化前に `fx config set agents <id,...>` を明示して投影先を限定できます. `FX_HOME` は fx 設定だけを分離し, グローバル Skill は分離しません. 実験では HOME も分離してください.

Grok 1.0.25 は Git ルートでのみプロジェクト hook を発見します. 通常のワークスペースルートでディレクトリを信頼するとガイドと Skill は利用できますが, hook 発見の制限は解消しません. `hook list` は制限を表示します. `fx sync --only docs,skills` を明示的に実行し, ワークスペースルートで Git を初期化しないでください. ホストの実行承認やキャンセルは fx 実行とは別で, auto モードも権限確認を無効にしません. Hook は fail-open を維持し, 生の入力や例外テキストを含まない有界な `HOOK_FAILED_OPEN` 診断を stderr に出力します. ファイル投影だけでは有効化を証明できません.
