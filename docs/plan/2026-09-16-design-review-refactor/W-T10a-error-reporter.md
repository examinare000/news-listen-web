## web リファクタ W-T10a: Platform — エラー通報を gateway 経由にする（UC-S3。適用 slice）

## 概要
`lib/reportClientError.ts:22` が `fetch` を直接呼び、CSRF の付与と失敗の正規化を通らない。これを `lib/platform/errorReporter.ts` へ移し、`ApiGateway` を通す。`GatewayRequest` に `keepalive` を足す（ページ遷移・unload 中も送る現行の性質を保つ）。4000 字の切り詰めと「送信失敗は握りつぶす」は adapter に残す。**利用者に見える挙動は変えない**。正本は新 Spec §3.2（`lib/reportClientError.ts` の行）・§5.8（エラー通報）・§8.2 W-T10a 行・§10.1 W-35、既存 Spec §1.2 UC-S3。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (1)、UC-S3、CI-T12（gateway）、TA-D5（`@/lib/reportClientError` の 3 行）、導出 W-35。

## 種別
適用 slice。判断待ちに依存しない。W-T3〜W-T9 とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `lib/reportClientError.ts` 35 行、呼出 3 箇所）
- production ≈ 50 行、test ≈ 60 行（`errorReporter.test.ts` は `tests/lib/reportClientError.test.ts` を移す。gateway のテストに `keepalive` の 1 行）。合計 ≈ 110 行（10¹ 行）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。
- backend の事実（2026-10-01 に backend の実コードで確認。新 Spec §11 の未確認を解いた）: `POST /client-errors` は CSRF 免除（backend `api/main.py:165-167` のコメントと配線）、応答は `202` と `{"status":"ok"}`（`api/routers/client_errors.py:38-54`）、`message` の上限 4000 字（`:33`）。gateway 経由で cookie があるとき `X-CSRF-Token` が付くが、免除なので結果は変わらない。着手時に親 main の backend submodule で再確認する。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 直接の `fetch` | `lib/reportClientError.ts:22`（`credentials: 'include'`・`keepalive: true`・`Content-Type`） | `grep -n "fetch(\|keepalive" lib/reportClientError.ts` |
| 呼出 | `app/global-error.tsx:4,16`・`components/ErrorFallback.tsx:4,19`・`components/ClientErrorReporter.tsx:4,12,18` | `grep -rn "reportClientError" app components hooks contexts lib` |
| `GatewayRequest` | `lib/api/gateway.ts:28-32`（`method`・`body`・`noContent`。`keepalive` は無い） | `sed -n 28,37p lib/api/gateway.ts` |
| gateway の外の `fetch(` | `lib/reportClientError.ts:22` の 1 件（`lib/api/gateway.ts` を除く） | `grep -rn "fetch(" app components hooks contexts lib \| grep -v '^lib/api/gateway\.ts:'` |

## 対象（web サブモジュールのみ）
1. `lib/api/gateway.ts`: `GatewayRequest` に省略可能な `keepalive?: boolean` を足し、`fetch` の init に渡す（加算だけ。既存の field と `ApiFailure` は変えない）。
2. `lib/platform/errorReporter.ts`（新規）: `createErrorReporter(gateway) → (report) => void`。4000 字の切り詰め・`gateway.request('/api/backend/client-errors', { method: 'POST', body, keepalive: true })`・結果は捨てる（`Result` の失敗も throw も握る）。型 `ClientErrorReport` もここ。
3. 呼出 3 箇所: React の中（`ErrorFallback`・`ClientErrorReporter`）は `useApiClient()` の gateway で作った reporter を使う。`app/global-error.tsx`（Provider の外で描画され得る）は `createGateway()` で作る（composition root と同じ扱いの例外として PR 説明に書く）。
4. `lib/reportClientError.ts` を削除。`tests/lib/reportClientError.test.ts` を `tests/lib/platform/errorReporter.test.ts` へ移す（観点 = 切り詰め・握りつぶし・path と method・`keepalive`）。`architecture/boundaries.allowlist.json` の `removeBy: "W-T10a"` の行を消す。

## 変更の責務（層ごと）
adapter `lib/platform/errorReporter.ts` = 通報の request。adapter `lib/api/gateway.ts` = `keepalive` の受け渡し。presentation = 呼ぶだけ。

## 移行の中間状態
無い（TA-D5 の 3 行を消す）。

## 変わる挙動
無い（送る path・method・body・切り詰め・失敗を握ることは不変。`X-CSRF-Token` の付与は backend が免除しているので結果は同じ）。

## 契約と検査
UC-S3（既存の `reportClientError` のテストの観点を移す）、CI-T12（`tests/lib/api/gateway.test.ts` に `keepalive` が `fetch` に渡る 1 行）、TA-V1・V2（TA-D5 の 3 行が 0）。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。
- **gateway の外の `fetch(` 0 件**（集合 = `app components hooks contexts lib` から `lib/api/gateway.ts` を除く）: `grep -rn "fetch(" app components hooks contexts lib | grep -v '^lib/api/gateway\.ts:'` が 0 件（コメントを除く）。
- `lib/reportClientError.ts` が存在せず、`grep -rn "reportClientError" app components hooks contexts lib tests` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T10a"' architecture/boundaries.allowlist.json` が 0。

## 禁止事項 / scope 外
- BFF（W-T10b）・backend を変えない。`ApiFailure` の variant を変えない。通報の body の形を変えない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/reportClientError.test.ts`・`tests/lib/api/gateway.test.ts`・`tests/components/{ErrorFallback,ClientErrorReporter}.test.tsx`（存在するもの）。

## 規模・返却事項
規模は上。返却: 新 Spec §11 の「W-T10a: CSRF と応答の status は未確認」を解いた事実（上の backend の行）を返す。UC-S3 の持ち主が W-T10a になった旨（W-35）を台帳へ。

## 参照
新 Spec §3.2・§5.8・§8.2（W-T10a 行）・§10.1（W-35）・§11、既存 Spec §1.2（UC-S3）。
