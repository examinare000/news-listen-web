## web リファクタ S3: CI ゲート追加（typecheck:ts7・独立 build・依存方向 eslint）

## 概要
CI（`.github/workflows/ci.yml`）に既に手元で実行済みの検証コマンドを組み込み、依存方向違反（`contexts/` → `components/`、`currentPodcast` 直接参照）を機械検査できるようにする。正本は user 承認済みの Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（§4 CI-T7b・§6 S3 行・§7 R8）。本タスクは**承認済み指示書に従う実装**であり、analyze_order は検証モード（新規設計をしない）。generate_spec の spec.md は Spec の該当契約（CI-T7b）の抜粋で足りる。

着手順 4（S2 に依存。S2 で導入した eslint ルール自体を CI で実行する）。

## 前提・着手条件
- 依存 slice: S2（`PlaybackProvider`・依存方向 eslint ルールの導入）が main に merge 済みであること。
- Selection Gate 依存なし。
- レビュー §8.3 Q8 の決定: `npm audit` は Dependabot と二重のため**入れない**。
- `docs/trial-log/` を最初に読み、棄却済み案を再試行しない。

## 対象（web サブモジュールのみ）
1. **`.github/workflows/ci.yml`**: `lint-test` ジョブに `npm run typecheck:ts7` と、既存 `npm run build`（Next.js ビルド）とは別の**独立 build ステップ**を追加する（`docs/research-reports/2026-09-16-code-design-review/verification-run.md` §6 の現行ジョブ構成: `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test` に追加）。`npm audit` は追加しない（Q8）。
2. **T-T7b の eslint（S2 で導入したルールの CI 実行確認）**: `no-restricted-properties` で `currentPodcast` 参照、`no-restricted-imports` で `contexts/` → `components/` の import を禁止するルールが `npm run lint` の一部として CI で実行されることを確認する。ルール自体の追加は S2 の作業範囲（本 slice は CI での実行確認と、ルールが `lint-test` ジョブでエラーとして扱われることの担保）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T7b | `no-restricted-properties`/`no-restricted-imports` で `currentPodcast` 参照と `contexts/` → `components/` import を禁止し、CI（`lint-test` ジョブ）で実行される | T-T7b: `ci.yml` に `typecheck:ts7` と独立 `npm run build` が追加され、`npm run lint` が `lint-test` ジョブに含まれたままであることの差分レビュー（テストは差分レビューが oracle） |

## 特性テスト（baseline）
なし（この slice はテストコードを増やさず、CI 設定ファイルと eslint 設定の差分を対象とする）。

## 手順
1. baseline: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` をローカルで実行し、すべて成功することを記録。
2. `ci.yml` の `lint-test` ジョブに `npm run typecheck:ts7` ステップを追加。
3. `ci.yml` の `lint-test` ジョブに独立 `npm run build` ステップを追加（既存の `npm run test` の前後いずれでもよいが、既存ステップの削除・順序変更は最小限にする）。
4. `npm audit` は追加しない。
5. S2 で導入した eslint ルール（`no-restricted-properties`/`no-restricted-imports`）が `npm run lint` の対象に含まれ、違反時に非ゼロ終了することを確認する。
6. 1 slice = 1 PR。

## 完了条件
- `ci.yml` の `lint-test` ジョブに `npm run typecheck:ts7` と独立 `npm run build` が含まれる。
- `npm audit` が `ci.yml` に追加されていない。
- `no-restricted-properties`（`currentPodcast`）・`no-restricted-imports`（`contexts/` → `components/`）のルール違反を意図的に混入させたローカル検証で `npm run lint` が非ゼロ終了することを確認済み（確認後は混入コードを削除する）。
- CI 定義の差分がレビュー対象であり、意図しないジョブ順序変更・ステップ削除がない。

## 禁止事項 / scope 外
- `npm audit` の追加はしない（Q8）。
- eslint ルール本体の新規設計・追加はしない（S2 の作業範囲。本 slice は CI 実行の担保のみ）。
- `e2e` ジョブ・`secret-scan` ジョブの変更はしない。
- 仕様にない業務条件を足さない。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §4（CI-T7b）・§6（S3 行）・§7（R8 CI ゲート）
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.3（RF21・Q8）
- 検証コマンド: `docs/research-reports/2026-09-16-code-design-review/verification-run.md` §6（現行 `ci.yml` のジョブ構成）
