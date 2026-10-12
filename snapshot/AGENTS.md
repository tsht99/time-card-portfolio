# Agent routing

本リポジトリを変更する場合は、実装前に `CONTRIBUTING.md` と `README.md` を確認する。

`README.md` を入口として、変更内容に関係する文書だけを追加で確認する。関連しない文書を一律に読み込まない。

変更対象の workspace または directory に `README.md` がある場合は、その変更に関係するものだけを追加で確認する。

AI エージェントで変更作業を行う場合は、目的に応じて次のワークフローを確認する。

- 実装計画を作る: `docs/agent-workflows/plan.md`
- 確定済みの実装計画を実行する: `docs/agent-workflows/execute.md`
- 計画から実行まで連続して行う: `docs/agent-workflows/plan-and-execute.md`

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
