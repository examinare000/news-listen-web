# web — CLAUDE.md

> Submodule (`news-listen-web`). 親リポジトリ `news-listen` 配下で作業する場合、
> `../agent-rules/` のルールが正本。本ファイルはこのモジュール固有の補足のみ。

## スタック
- Next.js + TypeScript（`next.config.ts` / `tsconfig.json`）。
- テスト: `npm test`（`vitest run`）／ ウォッチ: `npm run test:watch`。
- Lint: `npm run lint`（eslint）。ビルド: `npm run build`。

## 作業規約
- UI 実装は `agent-rules/15-frontend-design.md` を必ず参照（AIっぽいUIスロップを避ける）。
- TDD 必須（`agent-rules/11-testing-strategy.md`）。コンポーネントもテスト先行。
- 入力検証・XSS 対策は `agent-rules/12-security-guidelines.md` 準拠。
- TypeScript のバージョン制約は `agent-rules/70-typescript-version-policy.md` 準拠（root は TS6 固定・TS7 は typescript7 エイリアス）。

## このモジュールで触らないこと
- `next-env.d.ts` 等の自動生成ファイルは手動編集しない。
