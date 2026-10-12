# Contributing

本リポジトリを変更するときの基本的な開発ルールをまとめます。

## Repository の配置と責務

- `apps/` は実行可能なアプリケーションと、そのアプリが所有する支援機能・基盤を置く。
- `modules/` は業務上の責務境界を所有する機能を置く。
- `packages/` は特定アプリケーションに所有されない共有ライブラリと技術基盤を置く。利用 workspace 数は配置条件にしない。
- `tools/` は保守、生成、test runner など、実行を主な責務とする repository のツールを置く。
- `scripts/` は独立した workspace を必要としない repository 全体の orchestration を置く。
- `docs/` は要求・設計・開発・運用に関する文書を置く。

配置先は workspace の利用者数ではなく、機能の責務、ライフサイクル、所有者を基準にする。

## 開発環境

ローカルで使用する Node.js / Python の exact version は `mise.toml`、pnpm version はルート `package.json` の `packageManager` を Source of Truth とします。GitHub Actions の Quality workflow も同じ Python version を setup-python で provision します。

Migration validation は `mise.toml` で指定する Python の標準ライブラリ PTY を使うため、ローカル実行環境は macOS または Linux とします。Windows では WSL 上で実行します。

mise で Node.js、pnpm、Python の exact version を取得し、依存関係を次でインストールします。

```sh
mise install
pnpm install --frozen-lockfile
```

通常の Web 開発サーバーは次で起動します。

```sh
pnpm dev:web
```

実 LINE / LIFF 認証を利用するローカル環境は [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md) を参照してください。

## Branch

通常の変更は `develop` を基準に `feature/` branch で行います。

Issue に対応する場合は次の形式を使用します。

```text
feature/<issue-number>-<slug>
```

Issue がない場合は次の形式を使用します。

```text
feature/<slug>
```

Production release は、`develop` から `release/<version>` branch を作成して行います。release branch ではルート `package.json` の `version` を対象の SemVer へ更新し、必要な release 固有の調整だけを行います。

`hotfix/` は、`main` の Production に対する緊急修正として通常の `develop` 経由では間に合わない場合だけ使用します。

## Merge

通常の feature branch を `develop` に取り込むときは、branch の最終状態を 1 つの squash commit として取り込み、merge commit は作成しません。

release branch はこの feature branch の squash ルールの対象外とします。対象 release branch を `main` に merge して Production release とし、同じ release branch を `develop` にも merge して version を含む release 状態を同期します。release branch の取り込みでは、どの release を取り込んだかを履歴上で識別できる merge commit を使用します。

remote に push 済みの作業 branch の履歴は、rebase / squash / amend で書き換えません。

## Validation

通常の標準品質確認は次です。

```sh
pnpm quality:affected
```

`quality:affected` は変更影響範囲へ安全に限定できる場合だけ実行範囲を限定し、限定できない場合は repository 全体の品質確認へ fallback します。runtime 非影響変更だけの場合は runtime 関連 stage を省略します。affected 判定、fallback、実行対象の詳細は `package.json` と関連 script を Source of Truth とします。

repository 全体を明示的に確認する場合は次を利用します。

```sh
pnpm quality
```

環境値が未設定のまま root build を検証する場合は `pnpm build:verify` を利用できます。この command はテスト用 Help URL / media URL を注入します。通常の `pnpm build` と Help workspace の build は実環境向けの必須設定を引き続き要求します。

個別のテストは必要に応じて次を利用します。

```sh
pnpm test:small
pnpm test:medium
```

テストの設計原則、分類、保証責務は [開発標準](./docs/開発標準.md) の「テスト」を参照してください。

branch、hook、CI ごとの品質確認の正確な実行条件は `lefthook.yml`、`.github/workflows/`、`package.json` と関連 script を Source of Truth とします。文書へ実行順や cache 条件を複製しません。

## Database migration

`pnpm dev:web:liff`、`pnpm db:migrate`、Drizzle schema / migration generation は root `.env.local` を Local 設定の唯一の入力とします。shell から継承した DB 設定は root file の値で上書きし、root file がない、DB 設定が不足している、または PostgreSQL URL が不正な場合は migration / generation 前に失敗します。`packages/db/.env.local` は使用しません。

DB schema を変更する場合は、先に schema 定義を変更し、変更内容を表す意味のある migration 名を決めて正規の生成コマンドを実行します。生成器が出力したランダムな名前をそのまま採用してはいけません。

```sh
pnpm --filter @repo/db generate:migration -- <migration-name>
```

migration 名は小文字英数字で始め、小文字英数字・`_`・`-` のみを使用します。名前を省略すると migration は生成されずエラーになります。

通常の schema migration は、schema 定義から正規の生成コマンドで作成します。生成後の migration 名が変更内容を適切に表すことを確認します。名前の意味を機械的に判定する hook や lint は設けません。
1 つの migration / commit で許容する Drizzle の対話的な schema 判断は最大 1 回です。2 回目の判断が必要な変更は、schema 変更と migration を分けて別の migration / commit とします。

通常の生成器では再現できない custom migration、data migration / backfill、手書き SQL は通常の schema migration と区別し、意図と理由がレビュー可能な状態にします。

適用済み migration の内容を書き換えず、schema 変更には新しい migration を追加します。

pre-commit では、通常の schema migration の staged artifact を検証します。通常の生成器で作成できる migration は、`--no-verify` や Git hook の除外によって検証を回避してはいけません。

通常の生成器で再現できない custom migration、data migration / backfill、手書き SQL については、内容・必要性・適用時の影響を確認した場合に限り、`staged-migrations` の検証だけを除外して commit できます。他の Git hook は省略しません。

```sh
LEFTHOOK_EXCLUDE=staged-migrations git commit -m "chore: 手書き migration を追加する"
```

migration の適用、Preview / Production の接続先、deployment 時の扱いは [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md) を参照してください。

## Documentation

要求、設計意図、運用方法を変更した場合は、責務を持つ文書を同じ変更で更新します。コード、contracts、DB schema、migration、テストコードから直接確認できる詳細は文書へ重複して記載しません。

各文書の責務と入口は [ドキュメント一覧](./docs/README.md) を Source of Truth とします。

現在の要求・設計・運用の変更履歴は Git を Source of Truth とします。

ルール、責務、設計方針、workflow の契約は、原則として「誰が何に責任を持つか」「どの条件が成立している必要があるか」「どの状態をもって完了とするか」を宣言的に記載します。特定の実行順序そのものが安全性・正しさ・再現性に影響する操作だけは、必要な順序を手続きとして明示します。単に現在の実装方法を説明するためだけの手順列は避け、責務・不変条件・前提条件・遷移条件・完了条件として表現できる内容はそちらを優先します。

重要な設計判断について、背景・代替案・トレードオフを将来も残す価値がある場合は ADR として `docs/adr/` に記録します。ADR は `Status` を持ち、確定した ADR の判断内容を後から現在の設計へ書き換えません。判断を変更する場合は新しい ADR を作成し、旧 ADR の Status を新 ADR から supersede されたことが分かる状態へ更新します。リンク修正や誤記訂正など、判断の意味を変えない保守は許容します。作成時点は Git 履歴を Source of Truth とし、日付を重複して持つことは必須としません。

## Commit

commit message は Conventional Commits に従います。

scope は付けません。

type は英語とします。

subject には漢字・ひらがな・カタカナを少なくとも 1 文字含めます。英字・数字との混在は可能ですが、日本語文字を含まない subject（英字のみ、数字のみ、英字＋数字のみ）は不可とします。subject の大文字・小文字は制限しません。

例:

```text
docs: 文書構成を整理する
refactor: Payroll の契約を共有 contracts に統一する
```

構造ルールは `commitlint.config.mjs`、日本語と半角英字・数字や code 前後の間隔などの文章表記ルールは `.textlintrc.json` を Source of Truth とします。

## Issue

Issue は原則として 1 Issue = 1 つの関心事とします。

Issue 本文は、実装手順ではなく次を中心に記載します。

- なぜ必要か
- 何を達成するか
- 何をもって完了とするか

Acceptance Criteria は、ファイル名や関数名等の具体的な実装方法ではなく、確認可能な振る舞い・制約として記載します。

Issue 作成時は `.github/ISSUE_TEMPLATE/` の template を利用できます。
