# ADR 0002: 業務境界を基準とする Modular Monolith を採用する

## Context

本システムは、スタッフ向けと管理者向けの機能を単一の Next.js アプリで提供し、ユーザー・認証、勤怠、時給・給与のデータを単一の PostgreSQL に保持する。

機能を追加・変更するときに、Users / Access、Attendance、Payroll Estimate / Hourly Wage それぞれの業務責務と依存方向を明確にし、業務ルールを UI、ORM、外部サービス等の技術詳細から分離して保守できる構成が必要である。

一方、この規模と運用要件では、業務境界ごとに独立した deploy、DB、サービス間通信を持たせる必要はない。勤怠の Event Stream / Current State Projection に関する判断は [ADR 0001](./0001-attendance-event-stream-and-current-state-projection.md) に従う。

## Decision

DDD と Clean Architecture に基づく Modular Monolith として構成する。package 分割の第一基準は技術層ではなく業務境界とし、主要境界を Users / Access、Attendance、Payroll Estimate / Hourly Wage とする。

- `packages/users` は Users / Access の Domain、Application、Infrastructure、業務固有 schema を所有する。
- `packages/attendance` は Attendance の Domain、Application、Infrastructure、業務固有 schema を所有する。
- `packages/payroll` は Payroll Estimate / Hourly Wage の Domain、Application、Infrastructure、業務固有 schema を所有する。
- Domain は業務上の不変条件と振る舞いを所有し、Next.js、Drizzle、PostgreSQL、LINE などの外部技術に依存しない。
- Application は use case と必要な Port を所有し、具体的な Infrastructure、ORM、DB、Web framework に依存しない。
- 各モジュールの Infrastructure はその Application の Port を実装し、必要に応じて共通 Platform を利用する。業務別 Repository、Store、外部連携 Adapter を共通 Infrastructure package へ集約しない。
- `packages/platform` は DB 接続、設定等の業務知識を持たない横断的な技術責務だけを所有する。特定の user、勤怠、時給、給与の schema や業務ルールを置かない。
- `packages/db` は各業務 schema の合成、物理 DB の migration、database の組み立てを担う。
- `packages/contracts` は Server Action 用の入力 schema や Delivery 固有の共有型を担い、業務 Domain / Application の Source of Truth にはしない。
- `apps/web` の Next.js は Delivery Adapter と Composition Root とし、Server Components / Server Actions から use case を呼び出して必要な実装を外側で組み立てる。

業務モジュール間の連携は公開 boundary を通じて行い、別モジュールの内部実装へ直接依存しない。

単一の Next.js application と単一の PostgreSQL を維持する。業務モジュールはアプリ内の境界であり、独立した deploy 単位や DB を意味しない。Clean Architecture のためだけの NestJS、独立 Backend API、汎用 REST API、Microservices、複数 DB は追加しない。

Value Object や Aggregate などの DDD 概念は、業務上の不変条件や整合性境界を表す必要がある箇所に導入する。形式を整えるためだけに増やさない。

## Alternatives

### 技術層別の package 構成

Domain、Application、Infrastructure といった技術層を repository 全体で横断する package に分ける方法は、同じ業務に関する変更が複数 package に分散しやすく、業務境界ごとの所有責務と依存方向を追いにくい。そのため採用しない。

### 業務モジュールを Microservices として分離する

独立した deploy や DB、サービス間通信を追加すると、この規模で必要な業務境界の明確化に対して運用と整合性の負担が増す。単一アプリ内のモジュール境界で目的を達成できるため採用しない。

### 独立 Backend API を設ける

Next.js Server Components / Server Actions からの内部呼び出しに追加の HTTP 境界を必要としない。Delivery Adapter としての Next.js から Application を呼び出せるため採用しない。

## Consequences

利点:

- 業務ごとの変更範囲、責務、依存方向を追いやすくなる。
- Domain と Application を外部技術から独立させて検証できる。
- 単一 application / 単一 DB の運用の単純さを維持しながら、業務境界をコード構造で表現できる。
- schema ownership とモジュール間連携の責務を明確にできる。

コスト:

- 各モジュールに Domain、Application、Infrastructure が存在するため、単純な技術層別構成より package 境界が増える。
- 共通 Platform、Delivery 固有 contracts、業務モジュールの責務を継続して区別する必要がある。
- モジュール間の直接依存を避けるため、公開 boundary と Composition Root の設計を維持する必要がある。
