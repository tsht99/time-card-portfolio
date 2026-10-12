# Tutorial video generation

この文書は、TimeCard の操作説明動画 workspace の setup、scenario、録画・音声・Remotion 合成、生成後レビューを扱います。利用者ガイド本文やスクリーンショット生成・公開は [apps/help/README.md](../../apps/help/README.md) の責務です。

操作説明動画は Remotion 専用 workspace で生成します。通常の Web build / deploy はこの workspace を実行しません。

## Setup

Node.js 24 と pnpm 12 に加え、Python 3.11 または 3.12、[uv](https://docs.astral.sh/uv/) が必要です。

```sh
pnpm install --frozen-lockfile
pnpm --filter @repo/tutorial-video audio:setup
```

`audio:setup` は Python 環境を lockfile から用意し、Supertonic 3 の日本語対応 ONNX モデルを公開 Hugging Face repository の固定 revision から取得します。モデル取得後の音声生成はローカルで行い、API key や有料サービスを使いません。

音声生成時の TTS 初期ノイズは、scenario ID と segment ID から自動導出した seed で固定します。同じシナリオと固定依存関係で生成を繰り返すと、同じ入力音声になります。

## Add a scenario

`src/scenarios/` に `<name>.ts` を追加し、`<name>Scenario` を export します。各 segment の `narration` を字幕と通常の TTS 入力に使います。確認済みの誤読がある場合だけ、該当箇所を最小限補正した `ttsTextOverride` を設定し、その直前に具体的な誤読理由をコメントで残します。将来の誤読を推測して override を追加しません。録画素材を `public/recordings/` に置き、`recording` に相対パスを設定します。

```sh
pnpm --filter @repo/tutorial-video audio:generate -- <name>
pnpm --filter @repo/tutorial-video dev
pnpm --filter @repo/tutorial-video render -- <composition-id> out/<name>.mp4
```

Remotion composition は録画を背景に表示し、segment の開始 frame に同期して音声と日本語字幕を重ねます。追加シナリオは `src/root.tsx` に composition として登録してください。

## Tutorial videos

現在のシナリオは `clock-in`、`clock-out`、`attendance-correction`、`hourly-wage-rule-bulk-edit` です。Web workspace が所有する認証済み browser fixture とローカル PostgreSQL を使い、430x932 viewport で実画面を録画します。録画・音声・MP4 はローカル生成物です。Production / Preview には接続しません。

```sh
pnpm --filter @repo/tutorial-video record:scenarios
pnpm --filter @repo/tutorial-video audio:generate -- clock-in
pnpm --filter @repo/tutorial-video audio:generate -- clock-out
pnpm --filter @repo/tutorial-video audio:generate -- attendance-correction
pnpm --filter @repo/tutorial-video audio:generate -- hourly-wage-rule-bulk-edit
pnpm --filter @repo/tutorial-video render -- tutorial-clock-in out/clock-in.mp4
pnpm --filter @repo/tutorial-video render -- tutorial-clock-out out/clock-out.mp4
pnpm --filter @repo/tutorial-video render -- tutorial-attendance-correction out/attendance-correction.mp4
pnpm --filter @repo/tutorial-video render -- tutorial-hourly-wage-rule-bulk-edit out/hourly-wage-rule-bulk-edit.mp4
```

録画、モデル、音声、MP4、Python 環境は ignored な `public/` / `out/` 以下に保存します。TimeCard の UI を撮影用に変更する必要はありません。

## Review

動画ファイルを正常に生成できたことだけで完了にしません。利用者向けの操作説明として成立しているかまで確認します。

- TimeCard の実画面が想定する再生サイズで読み取れること。
- 字幕が主要な入力欄、ボタン、状態表示を過度に隠さないこと。
- 原則として「説明 → 対応する操作 → 結果確認」の順になっていること。
- reload、debug 表示、テスト都合だけの確認など、利用者に不要な動きが映っていないこと。
- 台本が実際に画面上で見える状態・操作と一致していること。
- 操作完了後の状態が、利用者に分かる時間だけ自然に表示されていること。
- 字幕と音声が同じ説明原稿を Source of Truth としていること。
- 個人情報、実 credential、debug overlay、DevTools 等が映っていないこと。
- 生成した動画、録画、音声、確認用フレーム、キャッシュ等が通常の Git 管理対象に混入していないこと。

生成後は代表フレームだけでなく、字幕・ナレーション開始時点、主要操作の直前・直後、完了状態など、操作との同期を判断できるフレームも抽出して確認します。必要に応じて動画尺、解像度、aspect ratio、映像・音声 stream、音声区間も確認し、コード上の timing と実際の生成結果の両方を確認します。

声質、イントネーション、間の自然さなど主観的な最終品質が重要な場合は、完成動画自体を人が確認します。
