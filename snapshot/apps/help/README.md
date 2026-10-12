# TimeCard help

この文書は、利用者ガイドの編集、ローカル確認、ガイド用スクリーンショット生成、ガイド用メディア公開を扱います。

利用者向け操作説明の正本は `content/docs/` です。業務ルールの正式な要求は [要件定義書](../../docs/要件定義書.md)、システム内部の方式は [設計書](../../docs/設計書.md) を Source of Truth とし、利用者ガイドで独自の仕様を定義しません。操作説明動画の生成・レビューは [tools/tutorial-video/README.md](../../tools/tutorial-video/README.md) を参照します。

## Local development

repository root から次を実行します。

```sh
pnpm dev:help
```

利用者が実際の画面で目的の操作を完了できるよう、ガイドは task-oriented な操作説明を中心にします。同じ業務ルールを複数ページで独立に定義せず、共通ケースから個別操作ページへ案内できる内容はリンクでつなぎます。

## Screenshot generation

利用者ガイド用画像は [tools/help-screenshots](../../tools/help-screenshots/README.md) workspace の Playwright 撮影シナリオから生成します。Production / Preview や実データ・個人情報を使用せず、ローカル PostgreSQL の専用 test DB と認証 fixture を利用します。

```sh
pnpm --filter @repo/help-screenshots record
```

撮影シナリオは `tools/help-screenshots/scenarios/` を Source of Truth とし、対象画面、状態、role、fixture、固定日時・入力、viewport、browser zoom、device scale factor、locale、timezone、Chromium language、保存先を再現可能な形で定義します。撮影都合だけで TimeCard の UI、DOM、CSS、JavaScript を変更しません。

native な date / time control は browser、OS、locale 等で表示が変わり得るため、想定と異なる場合は先に撮影環境を確認します。完成画像では development overlay や debug UI を避け、原則としてローカルの production-like runtime を使用します。

### Screenshot review

生成 command の成功だけで完了にせず、生成した PNG 自体を確認します。

- 想定した利用者・状態・値が表示されていること
- viewport、画像寸法、locale 依存表示が想定どおりであること
- レイアウト崩れ、overflow、文字切れがないこと
- loading、不要な toast、focus ring、caret、cursor、debug overlay 等が残っていないこと
- 実データ、個人情報、secret が写っていないこと
- 撮影対象外の生成物を意図せず変更していないこと

画面が viewport より長い場合は、主要情報が自然に伝わるスクロール位置を選び、1 枚へ無理に詰め込みません。

## Publish help media

画像と動画の生成・内容確認が終わった後、対象 Neon branch の環境変数を設定し、明示的に次を実行します。

```sh
pnpm publish:help-media
```

publish command は `apps/help/public/images/generated/` と `tools/tutorial-video/out/` の対応形式の画像・動画だけを `time-card-help` bucket へ PUT します。bucket の作成、削除、アクセス設定は行いません。

対象 branch には事前に `time-card-help` bucket を作成し、アクセスを `public_read` に設定します。環境から `AWS_ENDPOINT_URL_S3`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` を渡します。Preview / Production の公開先は選択した branch の endpoint で決まり、秘密情報や branch 固有 endpoint は repository に保存しません。

公開後も、ガイド側では安定したメディア識別子を参照し、Storage の実 URL や保存先をページ編集時に都度判断しません。
