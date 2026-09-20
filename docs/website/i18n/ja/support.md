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

<!-- distribution:internal -->

パッケージ版はチームのプライベート Registry を `FX_REGISTRY` で指定します。

`fx self info --format json` でバージョン、ランタイム、パッケージ更新元を確認できます。ソースからインストールした場合は Git で checkout を更新し、そのディレクトリで `npm ci` と `npm run build` を実行します。

パッケージからインストールし更新元が利用可能な場合は、先に `fx self update --dry-run` を確認します。現在のパッケージ自己更新にはプライベートレジストリの明示的設定が必要です。ソースからの更新にはこのコマンドは不要です。fx 本体とチームのマニフェストの更新は別の操作で、`fx sync` が条件を満たすマニフェストソースを更新します。

### Registry の振り分け

プライベート Registry が fx を返しても、公開依存パッケージのプロキシに失敗する場合があります。まず失敗したパッケージの URL を確認します。チームの方針で npmjs への直接接続が許可されていれば、fx の scope はプライベートのまま、公開依存だけを npmjs に振り分けられます：

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/ --@fx:registry="$FX_REGISTRY"
```

これは一回の呼び出しの設定で、認証情報の変更やプロキシの修復ではありません。`FX_REGISTRY` は引き続き fx の内部メタデータと自己更新の取得先です。

<!-- /distribution -->

<!-- distribution:public -->

公開パッケージは既定で npmjs を更新元に使います。`FX_REGISTRY` でミラーを指定できます。更新前に `fx self update --dry-run` を確認してください。ソース版は Git を更新して再ビルドします。fx 本体の更新と、マニフェストを更新する `fx sync` は別の操作です。
<!-- /distribution -->

`self update --format json` はインストーラーの出力を捕捉し、stdout を解析可能に保ちます。インストーラーの `code` と失敗時の `reason` を確認してください。JSON が返ること自体は更新成功を意味しません。

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
