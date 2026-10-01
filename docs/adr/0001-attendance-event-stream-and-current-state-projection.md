# ADR 0001: 勤怠を Event Stream と Current State Projection で管理する

## Context

勤怠では、出勤・退勤だけでなく、管理者による新規作成、訂正、取消と、その変更経緯・操作者を追跡できる必要がある。

現在状態だけを上書きする CRUD でも勤怠機能自体は実現できるが、変更前の状態や変更経緯を別途保持する必要がある。

現在状態のテーブルと監査ログを分けて保持する方式でも要求を満たすことは可能である。一方、本プロジェクトでは、変更履歴を原本として状態を再構成する設計と、Projection の再生成を実装・検証する技術的な目的もある。

## Decision

勤怠の変更を Event として追記し、Event Stream を勤怠履歴の Source of Truth とする。

通常の勤怠操作を理由に Event Stream を削除しない。

現在の勤怠状態は Event Stream から導出し、通常の読み取りでは Current State Projection を利用する。

Current State Projection は派生データとして扱い、Event Store が正常であれば再構築できるようにする。

Projection の readiness や rebuild の失敗を、Event Store 自体の破損と同一視しない。

この方式を本システム全体へ一律に適用しない。ユーザー、セッション、時給ルール等について、勤怠と同じ Event Stream / Projection 構成を必須としない。

## Alternatives

### 現在状態だけを更新する

実装は単純になるが、訂正・取消を含む変更経緯を十分に追跡できないため採用しない。

### 現在状態と監査ログを別々に保存する

業務上必要な変更履歴は実現でき、Event Stream / Projection より単純な構成にできる。

一方、現在状態と履歴の二つを一貫して更新する必要があり、履歴から現在状態を再構成することは主目的にならない。本プロジェクトでは Event replay と Projection rebuild も設計・実装上の検証対象とするため採用しない。

### 読み取り時に毎回 Event Stream を再生する

派生 Projection を持たずに済むが、通常の一覧・詳細取得で毎回 Event Stream の再生が必要になる。

通常の読み取り経路を単純に保つため、Current State Projection を利用する。

## Consequences

利点:

- 勤怠の変更経緯と操作者を履歴として保持できる。
- Event Store が正常であれば Current State Projection を再構築できる。
- 原本データと、読み取り用の派生状態を区別できる。

コスト:

- 現在状態だけを保存する CRUD より実装・運用が複雑になる。
- Event と Projection の整合性、rebuild、readiness を扱う必要がある。
- application rollback、DB restore、Projection rebuild を別の復旧操作として判断する必要がある。
- Event の形式を変更するときは、既存 Event を読み取れる互換性を考慮する必要がある。

この判断は、履歴要件だけから Event Stream が唯一の選択肢だったことを意味しない。要求を満たすより単純な方式も存在するが、本プロジェクトでは上記の技術的な検証価値を含めてこのトレードオフを受け入れる。
