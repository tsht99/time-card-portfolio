# Help screenshots

この workspace は利用者ガイド画像の Playwright 撮影シナリオ、設定、fixture support を所有します。ガイド本文・画像の配信は [apps/help/README.md](../../apps/help/README.md)、動画生成は [tutorial-video](../tutorial-video/README.md) を参照してください。

`scenarios/` は画面・状態・role・fixture・日時や入力・viewport・zoom・device scale factor・locale・timezone・Chromium language・画像名を再現可能に定義します。撮影は local PostgreSQL の専用 test DB と認証 fixture を利用し、生成画像は `apps/help/public/images/generated/` に保存します。

repository root から次を実行します。

```sh
pnpm --filter @repo/help-screenshots record
```
