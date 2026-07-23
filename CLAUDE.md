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

## このモジュールで触らないこと
- `next-env.d.ts` 等の自動生成ファイルは手動編集しない。

## typescript 併用構成（暫定）
- root の `typescript`（typescript-eslint / Next.js / エディタが使う）は `^6.0.3` に固定している。
  typescript-eslint@8.65 系の peerDependencies が `>=4.8.4 <6.1.0` までしか許容せず、TS7 を
  ロードさせると `ts-api-utils` が TS 内部 API の形状差異で実行時クラッシュするため
  （npm overrides によるサブツリー限定固定は peerDependency のみの関係では物理的なネスト
  インストールを作れず不可能と確認済み）。
- TS7 を試すための別名依存 `typescript7`（`npm:typescript@7.0.2`）を並置し、
  `npm run typecheck:ts7` で直接パス呼び出し（`node node_modules/typescript7/bin/tsc`）
  して動かす。`node_modules/.bin/tsc` は TS6 側にのみリンクされる。
- **撤去条件**: typescript-eslint が TS7 に対応した時点で、root の `typescript` を `^7.x` へ
  上げ、`typescript7` エイリアスと `typecheck:ts7` スクリプトを削除する。
