# Contributing

本リポジトリを変更するときの基本的な開発ルールをまとめます。

## 公開スナップショットとしての扱い

本リポジトリは、実運用している非公開の TimeCard リポジトリから切り出した転職活動向けの公開スナップショットです。第二の実運用リポジトリとして継続同期することは前提としていません。

公開版では `main` を基準 branch とし、ポートフォリオ上の説明・検証に必要な変更だけを行います。実運用向け GitHub Actions は誤実行防止のため `.github/workflows-disabled` に移動しています。

## 開発環境

ローカルで使用する Node.js の exact version は `mise.toml`、pnpm version はルート `package.json` の `packageManager` を Source of Truth とします。

依存関係は次でインストールします。

```sh
pnpm install --frozen-lockfile
```

通常の Web 開発サーバーは次で起動します。

```sh
pnpm dev:web
```

実 LINE / LIFF 認証を利用するローカル環境は [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md) を参照してください。

## Branch

通常の変更は `main` を基準に `feature/` branch で行います。

Issue に対応する場合は次の形式を使用します。

```text
feature/<issue-number>-<slug>
```

Issue がない場合は次の形式を使用します。

```text
feature/<slug>
```

## Merge

feature branch は、branch の最終状態を 1 つの squash commit として `main` に取り込み、merge commit は作成しません。

remote に push 済みの作業 branch の履歴は、rebase / squash / amend で書き換えません。

## Validation

repository 全体の標準品質確認は次です。

```sh
pnpm quality
```

個別のテストは必要に応じて次を利用します。

```sh
pnpm test:small
pnpm test:medium
pnpm test:e2e
```

テストの分類と保証責務は [テスト方針](./docs/テスト方針.md) を参照してください。

## Database migration

公開用スナップショットでは、実運用リポジトリの migration 履歴を [`0000_initial_schema.sql`](./packages/db/migrations/0000_initial_schema.sql) に baseline 化しています。

この公開リポジトリ上で DB schema を変更する場合も、先に schema 定義を変更し、意味のある migration 名を指定して正規の生成コマンドを実行します。

```sh
pnpm --filter @repo/db generate -- <migration-name>
```

migration 名は小文字英数字で始め、小文字英数字・`_`・`-` のみを使用します。名前を省略すると migration は生成されずエラーになります。

`packages/db/migrations` の migration ファイルを直接作成・編集してはいけません。

生成結果を変更する必要がある場合は schema 定義を修正し、migration を再生成します。

適用済み migration の内容を書き換えず、schema 変更には新しい migration を追加します。

Codex の repository-local `PreToolUse` hook も migration ファイルの内容変更を制限します。hook を無効化・回避せず、変更は schema 定義と正規の生成コマンドで行います。

migration の適用や実運用側での deployment の考え方は [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md) を参照してください。

## Documentation

要求、設計意図、運用方法を変更した場合は、対応する `docs/` の文書を同じ変更で更新します。

コード、contracts、DB schema、migration、テストコードから直接確認できる詳細を文書へ重複して記載しません。

`docs/` は現在の要求・設計・運用を記載する場所とし、変更履歴は Git を Source of Truth とします。

重要な設計判断について、背景・代替案・トレードオフを将来も残す価値がある場合は ADR として `docs/adr/` に記録します。

ADR は確定した現行の設計判断だけを記録するため、`Status` は持ちません。作成・変更時点は Git 履歴を Source of Truth とし、`Date` も重複して記載しません。

設計判断が変わった場合は ADR を現行の設計に合わせて更新し、判断の変更履歴は Git に委ねます。過去の構成や移行過程を、現行の設計判断を説明するためだけに ADR へ残しません。

## Commit

commit message は Conventional Commits に従います。

scope は付けません。

type は英語、subject は日本語とします。

例:

```text
docs: 公開リポジトリの文書構成を整理する
```

構造ルールは `commitlint.config.mjs`、文章表記ルールは `.textlintrc.json` を Source of Truth とします。

## Issue

Issue は原則として 1 Issue = 1 つの関心事とします。

Issue 本文は、実装手順ではなく次を中心に記載します。

- なぜ必要か
- 何を達成するか
- 何をもって完了とするか

Acceptance Criteria は、ファイル名や関数名等の具体的な実装方法ではなく、確認可能な振る舞い・制約として記載します。

Issue 作成時は `.github/ISSUE_TEMPLATE/` の template を利用できます。
