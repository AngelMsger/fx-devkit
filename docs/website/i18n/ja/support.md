# サポートと更新

## トラブルシューティング {#troubleshooting}

初期化が中断したら、表示された障害へ対応し、返された再開コマンドを使います。

```sh
fx init --resume --workspace <name>
```

完了済みの作業は保持されます。個人のログインや操作員のファイルは、その担当者が用意します。既存のワークスペースでは `fx doctor --format json` が現在の準備状態と具体的な操作を返します。個別の能力は `fx can <capability>` で確認します。

能力が準備できていない場合は、サインインし直す前に、そのチェックが何と答えたかを確認します。保留中のステップにはツールのメッセージが入り、fx が判断できる場合は、認証が確立されなかったのか、権限が拒否されたのか、接続を確立できなかったのかも示します。権限の拒否や接続の失敗では、サインインし直す必要はありません。原因が示されない場合は、どちらとも決めつけず、ツールのメッセージとステップの手順に従ってください。`can` と `where` では、答えが得られなかったチェックは `unknown` を返します。示されたツールを修復するか、タイムアウトの場合はクエリを再実行してください。`fx doctor --tool <tool> --env <env>` で、1 つのツールについて同じ詳細を確認できます。

`preparation.state` は `ready` または `incomplete` で、未完了は終了コード 12 です。`doctor.coverage` は診断の確認範囲を別に示します。release は `ok/complete` を使い続けます。非ゼロ終了でも部分的な stdout を読み取ってください。

ソースのエラーにはファイルとフィールドが示されます。ツール schema 3 では、run 手順をローカル準備と個人認証に分類します。新しい入力がまだ受理されていない場合は、ソース修正後に完全な再試行コマンドを使います。受理済みの初期化は管理済みソースで再開します。`fx workspace list` と `fx self info` も利用できます。ルートを移動した場合は `workspace relocate` を使い、認証情報は各連携ツールに保持します。

## 更新 {#updates}

`fx self info --format json` はバージョン、ランタイム、有効な `registry` と `registry_source` を表示します。fx は npm のユーザー/グローバル設定を再利用し、パッケージの scope Registry、既定 Registry の順に解決します。`FX_REGISTRY` は優先度の高い任意の上書きです。プロジェクトの npmrc はグローバル自己更新を変更できません。通常のメタデータ取得は npm の認証と `NPM_CONFIG_USERCONFIG` に従い、無効な上書きは黙って無視せず報告します。

<!-- distribution:internal -->

`@fx/devkit` は既存の `@fx:registry` またはプライベートの既定 Registry を利用できます。どちらも未設定なら、チームの URL を取得して scope を一度関連付けてください：

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
fx self update --dry-run
```

URL は架空です。一回限りのインストール引数はこの関連付けを保存するとは限らず、tarball URL も Registry API のアドレスとは限りません。`FX_REGISTRY` は一回の呼び出しの上書きに引き続き使えます。

### Registry の振り分け

自己更新は fx の scope のみを固定し、公開依存パッケージには npm の既定 Registry を使います。プライベートの既定 Registry が公開依存のプロキシに失敗し、チームの方針で npmjs への直接接続が許可されていれば、設定済みの `@fx` scope を維持して次を実行できます：

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/
```

先に scope を設定してください。一回の経路選択であり、認証情報を変更したりプロキシを修復したりするものではありません。fx 専用の Registry 設定は不要です。

<!-- /distribution -->

<!-- distribution:public -->

公開パッケージは npm の `@angelmsger:registry` と既定 Registry に従います。有効な npm 設定を取得できない場合は npmjs にフォールバックします。`FX_REGISTRY` でミラーを指定できます。先に `fx self update --dry-run` を確認してください。

<!-- /distribution -->

ソース版は Git を更新し、checkout で `npm ci` と `npm run build` を実行します。fx 本体の更新と manifest を更新する `fx sync` は別の操作です。`self update --format json` は stdout を解析可能に保ちます。JSON が返るだけで成功とせず、インストーラーの `code` と失敗時の `reason` を確認してください。

## 対応プラットフォーム {#platform-support}

Node.js 22 以上と Git が必要です。Bun もランタイムとして利用できますが、npm によるインストールと自己更新には npm が必要です。

macOS と Linux をサポートします。Windows のネイティブアダプターは実装済みですが、実行、ボリューム間 junction、ホスト有効化は未検証です。対象はローカル NTFS 上の PowerShell 5.1/7 と cmd です。実行ポリシーが `.ps1` shim をブロックする場合は `.cmd` を使えます。

Skill、hook、MCP、ルールの対応はホストごとに異なります。`fx agent list`、`fx hook list`、`fx mcp list` で選択中のホストを確認してください。

<!-- distribution:internal -->

## 問題を報告する {#report-an-issue}

チームの内部サポート窓口で fx のメンテナーに連絡してください。`fx --version`、OS、コマンド、期待する動作、機密情報を除いた再現手順を添えてください。

## セキュリティ報告 {#security-reports}

セキュリティ上の問題はメンテナーに非公開で報告してください。認証情報、個人情報、内部接続先を共有レポートに含めないでください。
<!-- /distribution -->

<!-- distribution:public -->

## 問題を報告する {#report-an-issue}

[GitHub Issue](https://github.com/AngelMsger/fx-devkit/issues) にバージョン、OS、コマンド、期待する動作、機密情報を除いた再現手順を添えて報告してください。

## セキュリティ報告 {#security-reports}

[非公開の脆弱性報告](https://github.com/AngelMsger/fx-devkit/security/advisories/new)を使ってください。認証情報や個人情報を公開しないでください。
<!-- /distribution -->
