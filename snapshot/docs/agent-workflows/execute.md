# AI エージェントによる実行

確定済みの実装計画を本リポジトリへ反映するための実行契約を定義する。

この workflow の責務は確定済み計画の実行である。計画の具体性判定、妥当性確認、再計画、Task 分割、Task 境界の再設計は通常の実行責務に含めない。

## 入力と停止条件

入力は [計画 workflow](./plan.md) の完了条件を満たす確定済み実装計画とする。

実行中に、確定済み計画から安全に決められない重要な仕様、設計、Scope 判断が必要になった場合、その Run は実行可能な状態ではない。親エージェントは独自に再計画して続行せず、不足している判断を明示して停止する。

## Run の不変条件

- Run は確定済み計画の範囲を扱う。関心事と変更単位の原則は [開発標準](../開発標準.md) に従う。
- Task の完了は、実装済みであることだけでなく独立 review が PASS していることを必要とする。
- Run の internal PASS は、すべての Task review、実行全体 review、標準品質確認が PASS している状態を指す。
- ファイル変更を伴う実装と独立 review は、サブエージェントを利用できる環境では親エージェントから分離する。必要なサブエージェントを利用できない環境では、親エージェントが黙って役割を兼任しない。
- remote に存在する履歴や repository-local validation を、実行を通すためだけに迂回しない。

## 役割

### 親エージェント

親エージェントは orchestration と、エスカレーションされた判断に責任を持つ。

責務には Task の進行状態、サブエージェントの割り当て、Git state / SHA の確認、repair の振り分け、遷移条件の判定を含む。通常の実装、通常の Task review、実行全体 review、validation failure の通常調査は担当しない。意味的判断を伴わない機械的な Git 状態確認は直接行ってよい。

### 実装サブエージェント

実装サブエージェントは、割り当てられた Task を完了状態へ到達させる責任を持つ。担当 Task に必要な局所調査、実装、関連 tests / docs、必要な validation、commit 作成までを担当する。

担当 Task を超える仕様・Scope 判断は行わない。

### Task reviewer

Task reviewer は実装担当から独立し、Run 内の各 Task の要求、diff、validation を順に確認して PASS / BLOCKING を判定する。Run 内では同じ reviewer セッションを継続利用し、Task 間の整合性や前段 Task からの影響も確認できる状態を保つ。

PASS は、その Task が計画上の完了状態を満たし、必要な検証がその境界を実際に保証している状態を意味する。安全に判定できない場合は親エージェントへエスカレーションする。

### 実行全体 reviewer

実行全体 reviewer は、個別 Task ではなく Run 全体の整合性と internal PASS 判定に責任を持つ。それまで実装や Task review を担当していない独立したセッションを使用する。

確定済み計画、Run 開始時の基準 state、現在の HEAD、Run 全体の diff、各 Task の検証結果を根拠に、要求漏れ、Task 間不整合、不要変更、tests / docs の不足を確認する。

## セッション境界

ファイル変更を伴う各 Task の実装担当は原則として新しいセッションとする。同じ Task の repair は、その Task の実装担当へ戻す。後続 Task での再利用は、実装計画または実行入力で明示されている場合だけ許容する。

Task reviewer は実装担当と別のセッションを Run ごとに 1 つ作成し、Run 内の全 Task review で継続利用する。同じ Task の repair 再 review も同じ reviewer が担当する。別 Run へは使い回さない。

実行全体 reviewer は Task 実装・Task review に使用していない新しい clean なセッションとし、全体 review の repair cycle では同じ reviewer を継続利用する。

新しいサブエージェントが受け取るコンテキストは、その責務に必要な Task、前提 commit、関連ファイル、制約、review 対象に限定する。過去 Task の会話ログや Run 全体の調査結果を既定で継承しない。

サブエージェントから親エージェントへの途中連絡は、エスカレーションされた判断が必要な場合、または別 Task / agent の進行に即時共有が必要な場合に限定する。通常の進捗、局所調査結果、validation 結果、commit 完了は、親の判断に途中共有が必要でない限り各担当の最終応答へ集約する。

## Task の状態遷移

Task は、計画で定めた前提 Task が PASS している場合にだけ実装可能な状態になる。計画上の順序が定められている場合、前の Task の PASS を後の Task の開始条件とする。

実装 commit が存在するだけでは Task は完了しない。Task reviewer の PASS により完了状態へ遷移する。

BLOCKING の場合、修正可能な finding は同じ Task の実装担当へ戻し、repair 後も同じ Task reviewer が判定する。repair に独立した別 concern を混ぜない。

reviewer が要求解釈、設計判断、影響範囲、検証結果を安全に決められない場合は、親エージェントへのエスカレーション状態とする。既存の確定要求・計画・repository state から親が解決できない場合は、Run を停止する。

## Run の完了条件

すべての Task が PASS した状態だけが実行全体 review へ進める。

実行全体 reviewer に未解決の BLOCKING がある間、Run は標準品質確認の完了状態へ進めない。finding が既存 Task に帰属する場合はその実装担当へ、自然に帰属しない場合は新しい実装担当へ repair を委譲する。実行全体 reviewer 自身は編集・commit しない。

意味的な BLOCKING がない状態で、実行全体 reviewer が `CONTRIBUTING.md` の標準品質確認を実行する。validation failure の切り分けと repair 方針も同じ reviewer の責務とする。

validation の再試行と workaround の原則は [開発標準](../開発標準.md) に従う。

次がすべて成立した状態を internal PASS とする。

- 確定済み計画の全 Task が Task review PASS
- Run 全体に未解決の review finding がない
- 必要な tests / docs が含まれている
- 標準品質確認が PASS
- 対象変更に必要な追加 review 条件を満たしている

## Database migration

schema migration の生成方法、命名、適用済み migration、validation は [CONTRIBUTING.md](../../CONTRIBUTING.md) を Source of Truth とする。

通常の生成器で再現できない custom migration、data migration / backfill、手書き SQL が必要な Run は、人による判断が必要な状態とする。AI エージェントは独自実装や migration validation の迂回でこの状態を解消しない。

## 順序・利用者向け品質の review

順序・遷移を伴う振る舞いと利用者向け成果物の品質確認は [開発標準](../開発標準.md) に従う。必要な品質を materially 判断できない場合、その Run は internal PASS の条件を満たさない。

## 実ブラウザ確認

実ブラウザ確認の対象と一時生成物の扱いは [開発標準](../開発標準.md) に従う。

認証フロー自体が確認対象でない staff / admin 画面では、既存の Web Playwright Test 環境と認証 fixture を利用できる場合はそれを優先する。対象画面を既存 setup で表示できず、必要な確認を代替できない場合は完了扱いにしない。

## AI 利用量

AI 利用量は品質・安全性と並ぶ実行最適化対象とし、必要な review / validation を減らす理由にはしない。

正確な token 数を取得できる場合だけ token 数として記録する。利用枠残量等の別指標は token 数へ換算せず補助指標として扱う。

不要なコンテキスト継承、関係のない文書読込、通常 review や validation failure 調査の重複、実装担当の別 Task 間でのセッション使い回しを避ける。Task reviewer は Run 内で共有することで、独立 review を維持しつつ Task ごとのコンテキスト再読込を抑える。継続的に利用量が大きい場合は、Task 分割、渡すコンテキスト、文書構成、重複作業を改善対象とする。
