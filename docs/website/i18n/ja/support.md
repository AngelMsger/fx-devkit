# サポートと更新

## トラブルシューティング {#troubleshooting}

まず `fx doctor --format json` を実行します。特定の能力については `fx can <capability> --env <environment> --format json` を使ってください。アクセス不足のまま繰り返さず、結果の handoff に従います。

- ツールがない場合：`fx tool show <tool>` でインストール要件を確認します。
- 認証が不足する場合：`fx login --list` で手順を確認し、対応するログインを行います。
- 環境が未選択の場合：`fx env list` を確認し、必要な環境だけを選びます。
- マニフェストが無効な場合：`fx manifest validate --strict` と `fx manifest explain '<field>'` で問題のフィールドを確認します。
- 同期が部分的に失敗した場合：リポジトリとリソース段階のエラーを解消し、`fx sync --only <stage>` で該当操作を再実行します。

レポートの終了コード 0 は準備完了の証明ではありません。`ok`、`complete`、個々の結果、復旧情報を確認してください。

ワークスペースの解決や manifest の読み込みに失敗した場合は、`fx workspace list`、`fx workspace show <name>`、`fx self info` から始めます。正常でなくても登録とインストールの既知情報を確認できます。移動後のルートは `workspace relocate` で修正し、manifest がない場合は記録されたソースから準備し直します。必須の workspace 文書がない、または無効な場合は `manifest validate --strict` が検証失敗を報告します。未宣言の任意文書はなくても構いません。

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
