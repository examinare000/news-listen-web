## web リファクタ W-S4d2a: Catalog 系 page テスト 5 本の gateway double 移植（テストのみ・production 不変）

> **2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正**（新 Spec = `docs/design/2026-09-30-implementation-spec-target-architecture.md`。§8.3 W-S4d2a）
> - helper の名前 `tests/helpers/fakeGateway.ts`（`createFakeGateway`・`on`）を、W-S1 が置いた実在の `tests/helpers/gatewayDouble.ts`（`createGatewayDouble`・`respond`・`calls`）に直した。新しい helper ファイルは作らない。
> - gateway の double が返す `rate_limited` に `detail` を渡せるようにした（W-S4a で `ApiFailure.rate_limited.detail` が足されている。W-24）。
> - **読み替え**: W-S4d2b・W-S4d3 の order に残る `tests/helpers/fakeGateway.ts`・`createFakeGateway()`・`fake.on(...)` は、本 slice の後は `tests/helpers/gatewayDouble.ts`・`createGatewayDouble()`・`double.respond(...)` を指す（W-S4d2b は §8.3 で「補正なし」のため本文を直していない。W-S4d3 は補正で直した）。

## 概要
旧 W-S4d を 4 PR に分けた 1 つ目（2026-09-24）。`vi.mock('@/lib/api')` で `createApiClient()` の 58 メソッドを差し替えている page テストのうち Catalog 系 5 ファイルを、gateway double（`vi.mock('@/lib/api/gateway')` で `request(path, init) → Result` を fake にする）へ移す。production は 1 行も変えない。移植後のテストは、page が `createApiClient()`（TP1 経由で `gateway.request` を呼ぶ）を使う現状でも、W-S4d1 で `ApiClientProvider` の gateway を使う状態でも同じ oracle で green になる（fake は両経路が共有する `lib/api/gateway.ts` の module にある）。oracle（表示文言・呼出の有無）は変えず、「呼出の有無」の観測点を「メソッド名」から「request の形（HTTP method ＋ path ＋ body）」へ替える。正本は Implementation Spec §4 冒頭（失敗の表現）・§6 S4 行。**検証モード: 再設計しない**。

分割の理由: 21 テストの見込み変更行 ≈ 1,600 行（mock に触れる行の実測。下記）を 1 PR にできないため、Catalog 系（≈ 930 行）と他 context（≈ 690 行）で分けた。W-S4d1（production）はこの 2 つの後。

## 規模（見込み。根拠 = 2026-09-24 実測: mock / `ApiError` / `toHaveBeenCalled` に触れる行数）
- test ≈ 950 行: `tests/app/feed/page.test.tsx` 425、`tests/app/subscriptions/page.test.tsx` 194、`tests/app/podcast/id/page.test.tsx` 197、`tests/app/podcast/page.test.tsx` 95、`tests/components/ui/OnboardingSourcesModal.test.tsx` 16（計 927）＋ 既存 helper `tests/helpers/gatewayDouble.ts` への追加 ≈ 15（呼出順の登録・`detail`）。
- production: 0 行。

## 前提・着手条件
- 依存 slice: **W-S1b**（`lib/api/gateway.ts` の `request` と TP1 経由の `createApiClient()`）・**W-S2c**・**W-S4a**（`tests/app/podcast/*`・`tests/app/feed/` を先に触る。`ApiFailure.rate_limited.detail` を足す）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- 並行可: W-S3・W-S4b・W-S4c・W-S5（対象ファイルが重ならない。2026-09-24 実測: 本 slice は上記 5 テストと `tests/helpers/gatewayDouble.ts` だけを触る）。W-S4d2b は本 slice の helper の使い方に依存するため後。
- Selection Gate 依存なし。
- W-S1b の完了条件「`vi.mock('@/lib/api')` を使う 25 ファイルが 1 行も変更せず green」は W-S1b 完了時点の条件であり、本 slice が更新する（許可。W-S1b order に明記）。
- `docs/trial-log/` を最初に読む。着手前に `grep -rln "vi.mock('@/lib/api'" tests | sort` を記録する（2026-09-24 実測 25。W-S2c 後は 21）。

## 対象（web サブモジュールのみ。テストのみ）
1. **`tests/helpers/gatewayDouble.ts`（W-S1 が置いた既存の helper を使う）**: `createGatewayDouble()` が `{ request, calls, respond }` を返す（`respond(method, path, result)` で `Result` を登録、`request(path, init)` は `${init.method ?? 'GET'} ${path}` で引く、未登録は `{ ok: false, failure: { kind: 'network' } }`、`calls` は `{ method, path, body }` の配列）。移植で「同じ key への複数の応答を呼出順に返す」が要るテストがあれば、既存の `respond` の意味（最後に登録した 1 つを返し続ける）を変えずに、呼出順に消費する登録の関数を 1 つ足す（既存の利用箇所 = `tests/lib/playback/*`・W-S2a2 の `gatewayFns.test.ts` の期待値を変えない）。`rate_limited` の登録は `{ kind: 'rate_limited', retryAfterSeconds, scope: 'unknown', detail }` を書けること（W-24。型が `lib/shared/apiFailure.ts` から来るので、helper の import を `@/lib/shared/{result,apiFailure}` に付け替えてよい）。
2. **5 テストの移植**（`vi.mock('@/lib/api')` を `vi.mock('@/lib/api/gateway', ...)` に替え、W-S1 が export した gateway 生成関数（名前は着手時に `lib/api/gateway.ts` から写す）が `createGatewayDouble()` の instance を返すようにする）:
   - `mockGetFeed.mockResolvedValue(x)` → `double.respond('GET', '/api/backend/feed', ok(x))`（path は `lib/api/<resource>.ts` の該当関数から写す。W-S1b の URL 不変）。
   - `mockRejectedValue(new ApiError(401, ...))` → `double.respond(..., fail({ kind: 'unauthorized' }))`。HTTP status → `kind` の対応は `lib/api/gateway.ts` の写像（W-S1）どおり（0 → `network`、401 → `unauthorized`、403 → `forbidden`、404 → `not_found`、409 → `conflict`、422 → `validation`、429 → `rate_limited`、5xx → `server`）。
   - `expect(mockStar).toHaveBeenCalledWith(id)` → `expect(double.calls).toContainEqual({ method: 'POST', path: '/api/backend/articles/<id>/star', body: undefined })`。
   - 文言の assertion は 1 文字も変えない。
3. 対象ファイル: `tests/app/feed/page.test.tsx`・`tests/app/subscriptions/page.test.tsx`・`tests/app/podcast/page.test.tsx`・`tests/app/podcast/id/page.test.tsx`・`tests/components/ui/OnboardingSourcesModal.test.tsx`。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` 成功。テスト件数が着手前と同数（移植であり増減しない。増減があれば PR 説明に理由）。
- 対象 5 ファイルに `vi.mock('@/lib/api'` と `ApiError` が無い（`grep -ln "vi.mock('@/lib/api'\|ApiError" <5 ファイル>` が 0 件）。`grep -rln "vi.mock('@/lib/api'" tests | wc -l` が着手前 − 5。
- production（`app/` `components/` `hooks/` `contexts/` `lib/`）の diff が 0 行。
- 各テストの文言 assertion（`getByText` / `toHaveTextContent` の引数）が着手前と同一（PR 説明に diff の要約を書く）。

## 禁止事項 / scope 外
- production を変えない。新規ファイルを作らない（`tests/helpers/gatewayDouble.ts` は既存。既存の `respond` の意味を変えない）。
- 文言 assertion・テスト名・テスト数を変えない。skip しない。
- 他の 16 テスト（W-S4d2b）・`tests/lib/api.*.test.ts`（W-S4d3）を触らない。

## 特性テスト（baseline）
対象 5 ファイル自身（移植前 green）。

## 検証
`npm test`、上記 grep 2 種、`git diff --stat -- app components hooks contexts lib` が空。

## 記録
- 棄却・方針転換は `docs/trial-log/` へ。
