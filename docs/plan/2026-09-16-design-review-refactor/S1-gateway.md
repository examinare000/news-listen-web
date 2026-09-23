## web リファクタ S1: ApiGateway と最小注入点（SG5）

## 概要
再生系の失敗表現を `throw ApiError` から `Result<T, ApiFailure>` へ切り替えるための port を導入する。ただし SG5「最小注入点」に厳密に従い、既存 `createApiClient()` の関数群・context 別分割・page 側 15 ファイルの移行は**行わない**。正本は user 承認済みの Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（§2 port 一覧・§4 CI-T12/T13・§6 S1 行）。本タスクは**承認済み指示書に従う実装**であり、analyze_order は検証モード（新規設計をしない）。generate_spec の spec.md は Spec の該当契約（CI-T12 / T13）の抜粋で足り、契約 ID は Spec のものを再利用する。

着手順 2（S0 の PR が main に merge 済みであること。S2 はこの S1 に依存）。

## 前提・着手条件
- 依存 slice: S0（BFF fail-closed・失効時 cleanup・admin gate）が main に merge 済みであること。
- Selection Gate 依存なし。
- SG5 の決定（レビュー §8.2）: 「Provider が 1 つの API client を保持し context/hook から取る最小注入点。まず再生系 4 箇所（AudioPlayerContext）を移行、page 15 ファイルは順次」。この決定を超えて分割・移行を広げない。
- 棄却済み案（再提案しない、Spec §5 rejected_overdesign）: `createApiClient` factory の階層化（RO1）、`lib/api` の context 別 6 分割を S1 で行うこと（SG5 超過。S4 以降へ送る）。
- `docs/trial-log/` を最初に読み、棄却済み案を再試行しない。

## 対象（web サブモジュールのみ）
1. **`lib/api/gateway.ts`（新規）**: `request<T>(path, init) → Promise<Result<T, ApiFailure>>` を核とする `ApiGateway`。`Result` は `{ ok: true, value: T } | { ok: false, failure: ApiFailure }` の判別共用体（Spec §4 冒頭）。`ApiFailure` は `kind` で判別（network / timeout / unauthorized / forbidden / not_found(subject) / conflict / rate_limited(retryAfterSeconds, scope) / validation(detail) / server(status) / unknown(status)）。CSRF 付与・deadline 30 秒（CI-T13）・204 は `Result<void>` をこの capsule が持つ（CP6、Spec §5）。既存 `lib/api.ts request()`（`lib/api.ts:124` 付近の定義）を土台に書き換える。
2. **`ApiClientProvider`（新規）**: 1 つの gateway インスタンスを保持し context/hook から取得させる React Provider。SG5「最小注入点」であり、context 別の 6 分割（Playback / Catalog / Account / …）はこの slice では作らない（rejected_overdesign）。
3. **Provider 経由に切り替えるのは再生系 4 箇所のみ**: `contexts/AudioPlayerContext.tsx` 内の `createApiClient()` 呼出 4 箇所（`docs/research-reports/2026-09-16-code-design-review/verification-run.md` の erratum 記載どおり `contexts/AudioPlayerContext.tsx: 4`）を `ApiClientProvider` から取得した gateway 呼出へ置換する。
4. **`lib/audioCache.ts:20` の import 解消**: `lib/playback ↛ lib/api` の依存禁止（Spec §2 prohibited_structures）に備え、`lib/audioCache.ts` が `lib/api` を直接 import している箇所を解消し、gateway 関数を呼出側から引数で受け取る形にする。
5. **既存 `createApiClient()` の関数群はそのまま維持**する（内部で新 `gateway` を使うよう書き換えて良いが、公開シグネチャと、**`contexts/AudioPlayerContext.tsx` 以外のすべての呼出箇所**は変更しない）。リソース別分割は **W-S1b**、page 側移行は W-S4。

   **呼出箇所の数え方**（指示書に固定値を書かない。2026-09-23 時点の実測は参考値であり、着手時に数え直す）:
   ```
   grep -rn 'createApiClient()' app components hooks contexts lib | wc -l   # 2026-09-23 実測: 38
   grep -rln 'createApiClient()' app components hooks contexts lib | wc -l  # 2026-09-23 実測: 20 ファイル
   grep -c 'createApiClient()' contexts/AudioPlayerContext.tsx              # 2026-09-23 実測: 4（本 slice の置換対象）
   ```
   着手前にこの 3 つを実行して記録し、完了時に「`AudioPlayerContext.tsx` が 0、他は着手前と同数」であることを示す。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T12 | 失敗は `Result` の `ApiFailure`。`rate_limited` は `retryAfterSeconds` と `scope` を持つ。204 は `Result<void>` | T-T12: 既存 `tests/lib/api.*.test`（378 件）を Result 形式へ移植 |
| CI-T13 | 有限 deadline（30 秒）で `timeout` になる | T-T13: fake timer で 30 秒経過後 `ApiFailure{kind:'timeout'}` を観測 |

## 特性テスト（baseline。着手前に green を確認）
`tests/lib/api.*.test`（378 件）、`tests/contexts/AudioPlayerContext.*.test.tsx`、`tests/lib/audioCache.test.ts`。

## 手順
1. baseline: `npm test` green と `npm run lint` / `npm run typecheck` を記録。
2. T-T12 → RED → `lib/api/gateway.ts` の `request<T>` と `Result`/`ApiFailure` 型を実装 → GREEN（既存 378 件を Result 形式へ移植）。
3. T-T13 → RED → deadline 30 秒の timeout 実装 → GREEN。
4. `ApiClientProvider` を実装し、`contexts/AudioPlayerContext.tsx` の 4 呼出を Provider 経由の gateway 呼出へ置換。
5. `lib/audioCache.ts:20` の import を解消し、gateway 関数を引数注入に変更。呼出元（`AudioPlayerContext`）から渡す。
6. **TP1（temporary path）を導入する**: 既存 `createApiClient()` の関数群（page 側 15 ファイル・37 箇所が呼ぶ）が `throw ApiError` の契約のままで動けるよう、`ApiFailure` から `ApiError` 相当の例外を生成して throw する薄い互換 adapter を残す。owner: user。導入: S1。削除条件: `app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時（grep 0）。
7. 1 slice = 1 PR。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` すべて成功。
- T-T12 / T-T13 が `verifies: CI-T12/T13` をテスト名またはコメントに持つ。
- `contexts/AudioPlayerContext.tsx` の 4 呼出が `ApiClientProvider` 経由の gateway 呼出に置き換わっている。
- `lib/audioCache.ts` が `lib/api`（旧関数群）を直接 import していない（gateway は引数で受ける）。
- `contexts/AudioPlayerContext.tsx` 以外の `createApiClient()` 呼出数が着手前と同数であり、既存テストが green のまま（数え方は対象 5 のコマンド）。
- TP1 adapter の owner・導入日・削除条件がコード内コメントまたは PR 説明に明記されている。

## 禁止事項 / scope 外
- `lib/api` のリソース別分割はこの slice で行わない（**W-S1b**。[投入計画](../../../../docs/plan/2026-09-16-design-review-refactor.md)）。
- page 側の注入点移行（W-S4）は行わない。
- `PlaybackProvider` / `lib/playback/*`（S2）、`Queue.create` gate、状態 union は作らない。
- 仕様にない業務条件を足さない。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §2（port 一覧・prohibited_structures）・§4（CI-T12・CI-T13）・§5（CP6・rejected_overdesign）・§6（S1 行）
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.2（SG5）
- 検証コマンド: `docs/research-reports/2026-09-16-code-design-review/verification-run.md`（`createApiClient` 呼出箇所の erratum: 37 箇所 / 19 ファイル）
