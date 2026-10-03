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
- TypeScript のバージョン制約: root は TS6 固定、TS7 は `typescript7` エイリアスで並置し `npm run typecheck:ts7` で検証する（経緯と根拠は `docs/trial-log/web-typescript7-eslint-coexistence.md`）。
- 文書（Implementation Spec・設計レビュー・takt の order・trial-log）はこのリポジトリに置かない。このリポジトリは public なので、設計判断を含む文書を置かない。正本は親リポの `docs/`（private な docs サブモジュール）で、置き場は `docs/README.md`「module の文書の置き場」に従う（例: Spec は `docs/design/modules/web/`、trial-log は `docs/trial-log/web-<論点>.md`）。本ファイルやコードのコメントに書く `docs/…` は親リポ root からのパス。

## このモジュールで触らないこと
- `next-env.d.ts` 等の自動生成ファイルは手動編集しない。
