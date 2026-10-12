# ADR 0001: 勤怠を Event Sourcing と Current State Projection で管理する

Status: Accepted

## Context

勤怠では、出退勤だけでなく、管理者による新規作成・訂正・取消の経緯と操作者を追跡できる必要がある。同時に、スタッフの当日状態、勤怠一覧、給与見込みでは多数の勤怠の現在状態を効率的に参照したい。

CRUD + 監査ログでも履歴要件を満たせる。Event Sourcing を選ぶ場合、変更履歴を状態の原本にできる一方、参照時に Event Stream を毎回再生すると一覧・集計の読み取りが履歴の長さに左右される。そのため、本システムでは Event Sourcing 単独ではなく、現在状態を保持する Projection と組み合わせた方式を一つの選択肢として比較する。

## Decision

勤怠には **Event Sourcing + Current State Projection** を採用する。

- 勤怠ごとの変更イベントを順序付き Event Stream に追記し、これを Source of Truth とする。訂正・取消でも既存イベントを上書き・削除せず、新しいイベントを追加する。
- 現在状態は Event Stream から導出し、通常の当日状態・一覧・給与集計には Current State Projection を使用する。
- Event の追記と Projection の更新は **同一 PostgreSQL transaction** で確定させる。片方だけを正常な変更結果として保存しない。
- 同一勤怠への競合更新は event version で検知し、古い状態に基づく上書きを拒否する。
- Projection は Event Stream から決定的に再構築できるようにする。再構築中・失敗時は not-ready とし、成功時だけ ready に戻す。通常読み取りで Projection が失敗しても、Event の再生へ黙って切り替えない。
- この方式をユーザー・セッション・時給ルールには一律に適用しない。

履歴を原本として再構成可能にする設計上の利点に加え、Event の再生と Projection の再構築を実装・検証する技術的な目的もある。ただし、通常の読み取り性能を確保する Projection がなければ、この規模の勤怠管理で Event Sourcing を選ぶ理由は弱く、より単純な CRUD + 監査ログを優先する。

## Alternatives

### CRUD + 監査ログ

現在状態を直接保存し、別の監査ログで変更経緯を追跡する。履歴要件を満たし、読み取り・運用を比較的単純にできるため有力な代替案である。

一方、状態の原本は現在状態となり、履歴から状態を再構築する仕組みは別途設計する必要がある。Event Stream を原本とする価値とその検証を重視して採用しない。

### Event Sourcing + 読み取り時の Event 再生

Projection の保存と更新が不要になる。ただし一覧・集計を含む通常の読み取りがイベント再生に依存するため、本システムでは採用しない。Projection を設けない前提で Event Sourcing 自体を目的化しない。

### Event Sourcing + 非同期 Projection

Event の保存と Projection 更新を分離できるが、読み取りに一時的な遅延が発生する。失敗時の再試行・順序保証・遅延監視も必要となる。現状ではその運用コストを正当化する要件がなく、同期更新を選ぶ。

## Consequences

- 変更経緯と操作者を追跡でき、Event Stream から現在状態を再構築できる。通常読み取りでは毎回のイベント再生を避けられる。
- 同一 transaction により書き込み完了時の Event Stream と Projection の整合性を保証できる一方、Projection 更新の失敗時にはイベント追記も確定できない。
- CRUD + 監査ログより実装・復旧が複雑になる。イベント形式の互換性、再生の決定性、Projection の再構築・readiness を継続して保証する必要がある。
- Event Sourcing が業務要件だけから必須だったわけではない。この追加の複雑さを、履歴を原本とする設計と技術検証の価値を得るために受け入れる。
