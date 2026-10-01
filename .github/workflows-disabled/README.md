# Disabled GitHub Actions

このディレクトリには、スナップショット元の実運用リポジトリで使用している GitHub Actions の定義を、ポートフォリオ上で確認できるように残しています。

公開用リポジトリから Preview / Production deployment や Production DB backup が誤って実行されないよう、workflow は意図的に `.github/workflows` ではなく `.github/workflows-disabled` に配置しています。

- `quality.yml`: Quality、Preview deployment、Production deployment
- `backup-production-db.yml`: Production DB backup
- `backup-production-db-scheduler.yml`: Production DB backup の定期 dispatch

これらは実運用時の CI/CD・運用設計を示す資料として保持しているもので、この公開リポジトリでの実行を目的としていません。Production の credential や実データは本リポジトリに含まれません。
