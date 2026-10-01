# TimeCard

TimeCard は、小規模店舗向けの勤怠管理 Web アプリケーションです。

スタッフは LINE Login / LIFF で認証し、出勤・退勤、当日の勤務状態、自身の勤怠履歴を確認できます。管理者はユーザー管理、勤怠の新規作成・訂正・取消、変更履歴、時給履歴、月次の給与見込みを扱います。

## 主な機能

- LINE Login / LIFF を利用したスタッフ認証
- 出勤・退勤と勤怠履歴の確認
- 管理者による勤怠の新規作成・訂正・取消
- 勤怠変更履歴の保持
- 曜日・祝日・昼夜区分を考慮した時給管理
- 月次の勤務時間・給与見込みの集計
- ユーザーの承認・利用停止・表示名管理

## 技術構成

| 領域           | 主な技術                                                |
| -------------- | ------------------------------------------------------- |
| Web            | Next.js、React、TypeScript                              |
| Server         | Next.js Server Components / Server Actions、TypeScript  |
| Database       | PostgreSQL、Neon、Drizzle ORM                           |
| Authentication | LINE Login / LIFF                                       |
| Test           | Vitest、Node.js Test Runner、Playwright、Testcontainers |
| Monitoring     | Sentry                                                  |
| Monorepo       | pnpm workspace、Turborepo                               |

本リポジトリは、業務境界を基準とする DDD + Clean Architecture の Modular Monolith として構成しています。現在の配置は下記のリポジトリ構成、責務境界は [設計書](./docs/設計書.md)、設計判断の背景は [ADR 0002](./docs/adr/0002-modular-monolith-with-domain-boundaries.md) を参照してください。

## 現在のリポジトリ構成

- `apps/web`: staff、`/admin`、Server Components、Server Actions と Composition Root を提供する Next.js アプリ
- `apps/e2e`: Playwright E2E
- `packages/users`: Users / Access の Domain、Application、Infrastructure、schema と LINE 認証 adapter
- `packages/attendance`: Attendance の Domain、Application、Infrastructure、schema
- `packages/payroll`: Payroll Estimate / Hourly Wage の Domain、Application、Infrastructure、schema
- `packages/contracts`: 複数業務と Web で共有する入力 schema と型
- `packages/db`: 各業務 schema の合成、Drizzle database、migration
- `packages/platform`: schema に依存しない PostgreSQL 接続基盤
- `packages/server`: server runtime の環境設定と運用 CLI
- `packages/ui`: 共有 UI

Users / Access、Attendance、Payroll Estimate / Hourly Wage は、それぞれ `packages/users`、`packages/attendance`、`packages/payroll` が Domain、Application、Infrastructure と業務固有 schema を所有します。`apps/web` が Composition Root として具体実装を組み立て、`packages/db` は各業務 schema の合成と物理 migration を担います。

## 開発

依存関係をインストールします。

```sh
pnpm install --frozen-lockfile
```

通常の Web 開発サーバーを起動します。

```sh
pnpm dev:web
```

標準の品質確認は次を実行します。

```sh
pnpm quality
```

開発ルール、テスト、DB migration、ドキュメント更新等の詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

実 LINE / LIFF 認証を含むローカル環境の構築方法は [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md) を参照してください。

## ドキュメント

| 文書                                                                                | 役割                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [要件定義書](./docs/要件定義書.md)                                                  | 利用者・業務・システムが満たす要求                                       |
| [設計書](./docs/設計書.md)                                                          | システム方式、主要コンポーネント、責務・境界、主要フロー、重要な設計制約 |
| [用語集](./docs/用語集.md)                                                          | 主要な業務境界ごとの業務用語と意味                                       |
| [テスト方針](./docs/テスト方針.md)                                                  | テスト戦略、分類、品質保証の考え方、実行方法                             |
| [環境構築・デプロイ手順書](./docs/環境構築・デプロイ手順書.md)                      | ローカル環境、Vercel、Neon、migration、リリース手順                      |
| [運用保守手順書](./docs/運用保守手順書.md)                                          | 定常確認、障害対応、データ保全、保守作業                                 |
| [利用者マニュアル](./docs/利用者マニュアル.md)                                      | staff / admin の利用方法                                                 |
| [ADR 0001](./docs/adr/0001-attendance-event-stream-and-current-state-projection.md) | 勤怠の Event Stream と Current State Projection を採用した設計判断       |
| [ADR 0002](./docs/adr/0002-modular-monolith-with-domain-boundaries.md)              | 業務境界を基準とする Modular Monolith の設計判断                         |

AI エージェント向けの作業ルールは [AGENTS.md](./AGENTS.md) を入口として参照してください。

詳細な実装仕様は、ソースコード、共有 contracts、DB schema、migration、テストコードを Source of Truth とします。
