# fx を使う

fx をインストールし、チームのマニフェストを接続してリポジトリやツール、エージェントを利用します。

## 0.2.0 への移行 {#migrating-to-020}

`init`、`sync`、`doctor`、`release` の JSON は既定で要約になります。`output_mode: summary` が表示形式を示し、`omitted` が省略した正常行と証拠を数えます。例外と復旧操作はすべて残ります。全行と証拠が必要な場合は `--details` を指定してください。明示的な `--fields` は完全な結果から抽出します。human、NDJSON、および `repo list`、`where`、`can` などの事実照会の既定動作は変わりません。`--verbose` は診断を独立して制御します。

`init/sync` に `operation: preview|apply` と `preparation_complete` を追加しました。プレビューは `null` を返し、登録などの項目は計画を表します。実行では、選択して要求した準備が完了した場合のみ `true` です。未コミット変更や分岐の保護、権限・信頼による停止、失敗、未検証の有効化は `false` になります。未選択や明示的な対象外は完了判定を下げません。準備完了はリモートサービスの正常性を証明しません。doctor/release の `ok`、確認範囲の `complete`、終了コードの意味は維持します。

`agents: []` または空の `FX_AGENTS` は、どの Agent も選択しない指定です。`fx config unset agents` と環境変数の解除で自動検出に戻せます。`FX_HOME` は引き続きグローバル Skill を分離しません。`SKILL_WRITE_DENIED` は権限エラーで終了コードは 5、拒否されたパスと部分結果を保持します。既存ソースの分析を続けるか、対象ワークスペースで `fx sync --only repos,docs --no-refresh-manifest` を実行できます。アクセス条件が変わってから Skill 書き込みを再試行し、既存の信頼境界を守ってください。

Agent はまず `fx self info --format json` を実行し、返された `bundled_skill/SKILL.md` または `fx skill show` を読み、その後 `FX_SKILL_LOADED=1` と `FX_SKILL_VERSION=<bundled_skill_version>` を設定します。真偽値だけでは版の一致を確認できません。未指定や不一致の場合、init を含む業務コマンドは処理を止めない通知を出します。同梱 Skill の読み取りにグローバルインストールは不要です。JSON stdout と診断 stderr を別々に解析し、`head -c` や `tail -c` で JSON を切り詰めず、フィールドを選択してください。

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

ツール定義は内蔵の基線と選択したワークスペースの `tools.yaml` を統合します。選択順は `--workspace`、`FX_WORKSPACE`、現在のディレクトリを含む登録済みルート、`default_workspace` です。解決できない場合は内蔵定義だけを使います。インストール先はパッケージ管理ツールが決め、複数のワークスペースで共有します。

`tool install` と `tool update` は名前か `--all` のいずれか一方を必須とします。install の `--all` は有効で PATH にないツールを補い、update の `--all` は選択したツールチェーンの有効なツールすべてを対象にします。明示した名前では無効なツールも選べます。引数なしの呼び出しはパッケージ操作前にエラーになります。

### ツールのインストール履歴 {#tool-installation-history}

```sh
fx tool history --format json
fx tool history bitbucket-cli --format json
fx tool inventory --format json
```

`init`、`tool install`、`tool update` は `$FX_HOME/tool-history.json`（既定は `~/.fx/tool-history.json`）に操作を記録します。各操作には `started`、任意の `installed`、`finished` があり、ワークスペース、パッケージ管理ツールとパッケージ名、機密情報を除去したコマンド、終了コード、バージョン、操作前後の実行ファイルパスを保持します。`installed` はパッケージ管理ツールの正常終了を意味し、その後のバージョン検証失敗でも残ります。`started` だけでは成功を証明しません。dry-run、手動手順、init がスキップした既存ツールは記録しません。履歴はローカルの操作証拠で、設定のエクスポートには含めません。

`tool inventory` の `installation_origin` は、`tool list/show` が表示するツール定義の出所とは別の情報です。

| installation_origin | 証拠                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fx`                | fx がそれまで存在しなかった実行ファイルを正常にインストールし、現在のパスも記録と一致しています。                          |
| `external`          | fx のインストール記録なしに既知の実行ファイルが存在していました。fx で更新や再インストールをしても、この出所を維持します。 |
| `unknown`           | 旧履歴、未完了の操作、変更または欠落したパスのため、現在の出所を確認できません。                                           |

`external` はインストールした人物を特定せず、人や別の管理ツールによるものを含みます。PATH の観察は過去の所有権を証明せず、同じパスでの外部置換も検出できません。v1 履歴は引き続き読み取れ、新しい操作は v2 で記録します。旧履歴にない出所の証拠は未知のままです。新しい履歴は旧バージョンの fx での読み取りを保証しません。

一覧には内蔵定義、登録済みワークスペースのローカル manifest にある既知のツールと、定義削除後も履歴に残るパッケージを含めます。未記録の PATH 上のツールは `recorded: false` で、管理ツール、パッケージ、バージョン、操作の各項目は推測せず null にします。参照によってインストール記録を補完したり、既存ファイルを管理対象にしたりしません。

依存の確認は同じ FX_HOME の**登録済みワークスペースすべて**を対象とし、有効な任意ツールと内蔵既定値も含めます。同じ実行ファイル、または同じ管理ツールとパッケージが必要なら `required` のままです。内蔵ツールの無効化には `enabled: false` を使います。上書き項目を削除すると既定値が復活します。`fx` 由来で、操作が完了し、パスが一致し、必要とするワークスペースがない場合だけ `unused` になります。外部ツールや出所不明のツールには削除を提案しません。`sync` は `TOOL_UNUSED` と `stage_details.tools.installations` を返し、`doctor` は参考所見を追加します。どちらもアンインストールしません。

読み取れない manifest、隔離された項目、不完全な実行証拠は `unknown`、成功履歴のない試行は `unverified` です。実行ファイルの欠落は `not_on_path`、パスの変更は `changed`、ワークスペース外での操作履歴は `unscoped` です。これらには削除を提案しません。参照するのはローカル manifest で、リモートを更新しません。別の FX_HOME や未登録プロジェクトは依存確認の対象外です。無効な履歴は新しいパッケージ操作を実行前に止めるため、証拠を保存して修復後に再試行します。

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

`status` はインストール状態、版の一致、`FX_SKILL_LOADED=1` のロード済みハンドシェイクを分けて報告します。インストール成功は Agent のロード成功を意味しません。`path` は配置先、`self info` は同梱ソースの場所を示します。`show` はすべての出力形式で SKILL.md の原文を返します。Skill コマンドはローカル処理のみで、更新の通信、マニフェスト取得、連携インストーラーやログイン確認を実行しません。非 TTY の業務コマンドは未ロード時に構造化した探索通知を stderr に出します。self info、skill show などの導入コマンドは通知せず、init は版の未確認を通知し、`FX_SKILL_NOTICE=0` でも無効にできます。

チーム Skill はマニフェストの `skills/` にあり、`init/sync` が選択した Agent のプロジェクトディレクトリへリンクします。Windows では junction を使います。ルート AGENTS.md にも説明とソースへのリンクを列挙し、Agent がタスクに合う Skill を読めるようにします。Agent はワークスペースのルートから起動してください。子リポジトリからの検出は保証しません。`agent skills` で配布状態を確認し、`sync --only docs,skills` で更新します。共有チームリンクへの同梱 Skill のインストールは `SKILL_SOURCE_PROTECTED` で拒否します。ユーザー単位または独立ディレクトリを指定してください。

harness は MCP エントリーとルールへの参照をホストに投影します。秘密の値は環境変数への参照に留めます。`mcp list/show` と `can mcp:<name>` は前提条件を説明しますが、設定の存在だけではホストでの有効化を証明できません。[MCP の契約](user-guide.md#for-coding-agents)を参照してください。

起動フックはキャッシュ済みコンテキストを返し、マニフェスト、文書、Skill をバックグラウンドで更新できます。業務リポジトリの同期や信頼の承認はしません。プロジェクトとフックの信頼はホストが管理します。`hook list/enable/disable` と[ライフサイクルの契約](user-guide.md#for-coding-agents)を使用してください。

### 共有情報への貢献

`source push` は選択したソースファイルの変更をプレビューまたは提出し、ソース checkout の HEAD、インデックス、作業ファイルを保護します。個人フォークと上流の関係を示す根拠が必要です。実行前に `fx source push --help` と[貢献の契約](cli/README.md#fx-source-push)を確認してください。

## 主なコマンド {#commands}

トピックのヘルプは正規コマンドを優先し、互換名との対応を別に表示します。コマンド名の補完と綴りの候補は正規名を使い、入力済みの互換名でもフラグを補完できます。ルートとトピックのヘルプは先頭のグローバルフラグも受け付けます。

`manifest validate/lint/providers/repo-set/render` は、別のソース checkout 内でも明示的な `--workspace` または `FX_WORKSPACE` を優先します。明示した名前が未知ならエラーになり、近くの manifest の編集には切り替えません。明示的な選択がなければ、現在のディレクトリ付近のソース checkout を優先し、単独のソース保守も可能です。`manifest import <dir>` はディレクトリ引数を使い、`manifest record-probe` は選択した登録済みワークスペースを使います。render を含むファイル出力フラグは `-o` と `--out` に対応します。

`agent skills` はワークスペースの Skill 配布を確認し、`skill install/show/path/status/uninstall` は内蔵 companion Skill を独立して管理します。`manifest repo-set` はリポジトリのフィールドを変更します。`manifest record-probe <repo> --env <env> --platform <platform>` は検証済み座標の証拠を記録し、`--dry-run` はプローブせず計画だけを返します。座標の参照は `where` を使います。互換入口の `skill list`、`tool installed`、`hook inject/remove`、`manifest set`、`where --probe --record` も引き続き利用できます。

集合フラグの `--only`、繰り返し可能な `--env`、`--agent` は反復指定とカンマ区切りに対応します。Agent の選択結果は `scope: global` と `affected_workspaces`、リポジトリ／環境の選択は `scope: workspace` と `workspace` を返します。一覧と履歴は `--workspace` を指定しても FX_HOME 全体を対象にします。補完はオプション値、位置引数、否定フラグを認識するため、更新後は補完スクリプトを再生成してください。ルートヘルプはグローバルフラグを受け付けますが、ヘルプ、補完、`skill show`、`manifest schema` は本来のテキスト／成果物形式を返します。

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

`--format json` または `FX_FORMAT=json` を使用します。stdout はデータのみ、通知、進捗、エラーは stderr に出力します。コレクションの形式は `{items, has_more, next?}` で、不明な値は明示されます。

`--fields` は項目を絞り、`--quiet` は通知を抑え、`--no-input` は入力待ちを禁止します。書き込みコマンドは `--dry-run` と読み取り専用設定に対応します。`--allow-writes` は一回の呼び出しだけの明示的な上書きです。

doctor/release は失敗項目があっても終了コード 0 を返します。init/sync も部分成功で 0 を返す場合があります。init では `sync.summary` と `sync.stages`、sync では `summary`、`stages`、失敗項目の `failure` を読みます。`stage_details` に各リソース段階の結果と handoff が残ります。終了コードだけで準備完了と判断せず、認証の捏造やホストの信頼境界の回避をしないでください。

[内蔵 Skill](../skills/fx-workspace/SKILL.md)と[応答ガイド](../skills/fx-workspace/references/commands.md)を読んだ後で `FX_SKILL_LOADED=1` と `FX_SKILL_VERSION=<bundled_skill_version>` を設定します。同梱 Skill のソースは `self info`、インストール先は `skill path` で確認できます。

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

リポジトリ処理中は5秒ごとに stderr へ完了数/総数, 処理中のリポジトリ, 経過時間を出力します. これはハートビートであり, Git のバイト進捗や完了予測ではありません. 人向け出力では未選択リポジトリと長い一覧を要約し, `--verbose` で未選択行, `--format json --details` で全詳細を確認できます. `FIELDS_UNMATCHED` は要求したフィールドが今回の結果にないことを示しますが, 任意フィールドの場合もあります. 投影は許容的なままで, 空のコレクションでは通知しません.

準備状態は `missing_tool`, `outdated_tool`, `disabled_tool` を区別します. Doctor のツール証拠には実行と同じ PATH 規則で解決した `binary_path` を含み, ランタイム管理ツールの shim を指す場合があります. status が正常終了しても `configured=false` なら準備完了ではありません. 設定済みであってもリソース権限やリモートクエリの成功は証明しません. `no_access` は個人の選択範囲外を表し, リモート ACL の拒否ではありません.

個人設定はロック内で読み取りと更新を行い, ファイルを原子的に置換します. `CONFIG_BUSY` では競合する更新の完了後に再試行します. 初期化失敗で残った Git source checkout は同じソースの再試行に使用でき, 異なる upstream やローカル作業は保護されます.

Bitbucket の任意のリポジトリ・ユーザー照会には、それぞれ 5 秒のプロセス実行期限があります。ツールが利用できない場合や照会がタイムアウトした場合も Git 転送は可能です。明示的なリポジトリアクセス拒否やリポジトリ不存在の結果は引き続き有効です。ユーザーのキャンセルと予期しない例外は処理を停止します。進捗は `preflight` の事前確認から始まり、リポジトリ変更時に `apply` へ切り替わります。

Skill ステージが中断すると、`sync.stage_details.skills` に `links`、`fx`、`tools` が残り、ツールのインストール結果は `tool_install` に残ります。項目の `status` は `done`、`failed`、`not_started`、`skipped`、プレビューの `planned` を区別します。失敗時のリソース項目にはディスク上の状態を示す `observed` が付き、観察にも失敗した場合は `unknown` になります。書き込みエラーが起きても、保存先は既に変更されている場合があります。インストーラーの `ran: true` は実行を試みたこと、`code: null` は終了結果を取得できなかったことを示します。`phase: version` の失敗で `code: 0` なら、パッケージのインストール自体は成功しています。失敗した項目を解決してから再試行してください。例外後に後続の書き込みは実行しません。

同じワークスペース名とソースであれば、登録済みルートのシンボリックリンク別名でも再試行できます。登録時には設定ロック内で実体パスを再確認し、実際に異なるディレクトリは競合として拒否します。

### Skill の所有権とホストの有効化

チーム Skill リンクはワークスペースに属します. fx 同梱 Skill はユーザーと選択したホストに属し, ワークスペース間で再利用されます. 初期化と同期では認識済みの新しい版を古い版で置換しません. 更新時はユーザー単位のロック内で所有権とバージョンを再確認し, 外部所有のコピーを保護します. 連携ツールは独自の Skill インストールとバージョン管理を所有するため, 別ワークスペースの同期でもそのインストーラーを呼び出す場合があります. ローカル Skill インストールは必ずしも通信を必要とせず, 呼び出し元の承認待ちと実行中の子プロセスを区別します.

`agent list` は `detected`, `selected`, `selection` (automatic または explicit), `active: null` を返します. 検出は現在の活動を証明しません. 初期化前に `fx config set agents <id,...>` を明示して投影先を限定できます. `FX_HOME` は fx 設定だけを分離し, グローバル Skill は分離しません. 実験では HOME も分離してください.

Grok 1.0.25 は Git ルートでのみプロジェクト hook を発見します. 通常のワークスペースルートでディレクトリを信頼するとガイドと Skill は利用できますが, hook 発見の制限は解消しません. `hook list` は制限を表示します. `fx sync --only docs,skills` を明示的に実行し, ワークスペースルートで Git を初期化しないでください. ホストの実行承認やキャンセルは fx 実行とは別で, auto モードも権限確認を無効にしません. Hook は fail-open を維持し, 生の入力や例外テキストを含まない有界な `HOOK_FAILED_OPEN` 診断を stderr に出力します. ファイル投影だけでは有効化を証明できません.

## 共有サービス設定と個人の認証情報

fx 0.1.3 では manifest の `service` で公開接続設定を配布できます。`fx init` はツールのインストール後、リポジトリへの問い合わせ前に設定を準備します。明示的な `fx sync` でも実行します。`fx sync --only services --dry-run` でこの段階を確認できます。バックグラウンド hook は確認のみで、サービス設定を書き換えません。

準備はオフラインで行い、個人認証と分離します。PAT、API Token、パスワード、ブラウザーセッションは各メンバーが自分で取得し、対応 CLI でローカルに保存します。`auth_scheme` の `pat`、`token`、`basic`、`session` は方式名であり、認証情報の値ではありません。`service` は公開接続フィールドのみを許可し、非 strict モードでも追加フィールドを拒否します。URL や共有ファイルに認証情報を含めないでください。

対応 CLI の `config set-context` に `--activate` や `--overwrite` を自動追加しません。最初の context の有効化は CLI の規約に従います。同じ値は再書き込みせず、競合時は元の値を保持し差分と上書きプレビューを返します。OpenObserve の既存ブラウザーセッションの URL や方式を変更する場合は新しい context が必要です。`session` は `auth login --browser` を使います。sync は個人の認可を実行しません。ログインと確認は宣言した context と URL を明示的に使用します。

Sentry はワークスペースの `.sentryclirc` に URL と組織のデフォルトのみを受け取ります。既存 Token のコピーやグローバル設定の変更は行いません。公開設定が一致すれば再利用し、競合するファイルやリンクは保持します。ログインは `--url` を指定し、fx の問い合わせも同じ URL を使います。認可はメンバー本人が行います。

`stage_details.services.items` の `configured`、`unchanged`、`planned`、`blocked`、`failed` と復旧手順を確認してください。設定成功は認証やリソースへのアクセス成功を意味しません。古い CLI は更新を案内し、自動置換しません。dry-run は設定も信頼記録も書き込みません。`service` のない旧 manifest は従来の設定手順を維持します。

設定の上書き元を調べる際は、対象 context の公開設定とフィールドの出所を表示する CLI 機能を使います。環境変数全体やツールの接頭辞で一括抽出した値を表示しないでください。個人の Token やパスワードが含まれる可能性があります。信頼、読み取り専用モード、ツールの不足で確認できない場合は認証が「未検証」であり、認証情報の欠落や期限切れを示すものではありません。機械処理では JSON stdout と診断 stderr を分けて解析します。
