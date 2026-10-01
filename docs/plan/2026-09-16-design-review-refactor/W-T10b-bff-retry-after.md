## web リファクタ W-T10b: BFF が `Retry-After` を中継する（適用 slice。決定 SG-D5）

> **決定（2026-10-01 user 採用）: SG-D5**（新 Spec §10.3 J-W3 の (a)。台帳 = 親 docs `research-reports/2026-09-23-design-docs-mino-audit.md` §5）。BFF は backend の応答の `Retry-After` を中継する。生成の上限到達の文言「（◯◯に可能）」が本番で出るようになる（ADR-042・ADR-073 の意図どおり。現行は BFF が応答の header を作り直すため届かない）。着手前に決める項目は無い。

## 概要
`app/api/backend/[...path]/route.ts` は backend の応答を `Content-Type` だけで作り直し（`:108-111`）、`Set-Cookie` だけを足している（`:116-124`）。そのため web の gateway が読む `Retry-After`（`lib/api/gateway.ts:155`）は BFF 経由では常に未設定になる。本 slice は `Retry-After` を中継する。中継するのは `Retry-After` の 1 つだけ（ほかの header の中継は決定に含まれない）。正本は新 Spec §5.8（BFF）・§8.1 W-T10b 行・§8.2 W-T10b 行・§10.3 J-W3、既存 Spec §4 CI-T14（BFF の fail-closed。変えない）、親 docs ADR-042・ADR-073。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: SG-D5・ADR-042・ADR-073、F-FEED-06（Star の上限の案内）、CI-T14（不変）、TA-R-CT-3（月次の判定の 2 つ目の入力 = 待ち時間が 24 時間を超える、が本番で効くようになる）。

## 種別
適用 slice（SG-D5 で確定）。依存なし（新 Spec §8.1）。W-S4a・W-T4 とはどちらが先でもよい（新 Spec §10.3）。

## 規模（見込み。根拠 = 2026-10-01 実測: `route.ts` 126 行、`tests/app/api/proxy.test.ts` 31 件）
- production ≈ 5 行、test ≈ 40 行（`proxy.test.ts` に 3 件）。合計 ≈ 45 行（10¹ 行）。

## 前提・着手条件
- 依存 slice: 無い（同じ submodule の slice とは直列で投入する。`route.ts` を触る slice はほかに無い）。再開ゲートが満たされていること。
- backend の事実: 429 に `Retry-After`（秒の整数）を付ける（backend `api/routers/articles.py:246,288,319`・`auth.py:108,424`。親 main の backend submodule で着手時に確かめる）。backend は変えない。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、`tests/app/api/proxy.test.ts`（31 件）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 応答の作り直し | `route.ts:107-111`（`new NextResponse(body, { status, headers: { 'Content-Type': 'application/json' } })`）・`:116-124`（`set-cookie` の append） | `sed -n 104,126p 'app/api/backend/[...path]/route.ts'` |
| gateway の読み取り | `lib/api/gateway.ts:96-98`（数字だけを秒として読む）・`:155` | `grep -n "Retry-After\|parseRetryAfterSeconds" lib/api/gateway.ts` |
| 待ち時間の読み手 | `feed/page.tsx:16-17`（W-S4a の後は `lib/catalog/domain/generationLimit.ts` と `feed/page.tsx` の文言）・`lib/format.ts:26-35`（`formatRetryAfter`）。ほかに 0 件 | `grep -rn "retryAfter\|formatRetryAfter" app components hooks contexts lib \| grep -v '^lib/api/'` |

## 対象（web サブモジュールのみ）
1. `app/api/backend/[...path]/route.ts`: backend の応答に `Retry-After` があれば、同じ値で `response.headers.set('Retry-After', value)` する（status に依らない）。無ければ付けない。`Content-Type`・`Set-Cookie`・status・body の扱いは変えない。
2. `tests/app/api/proxy.test.ts`: 3 件を足す（429 ＋ `Retry-After: 3600` → 応答に同じ値、429 で `Retry-After` 無し → 付かない、200 ＋ `Retry-After` → 同じ値）。テスト名に `SG-D5` を含める。

## 変更の責務（層ごと）
adapter（端）`route.ts` だけ。web の application・presentation・gateway は変えない（既に `Retry-After` を読む形になっている）。

## 移行の中間状態
無い。

## 変わる挙動（SG-D5。これ以外の挙動変更は禁止）
| 決定 ID | 変わる挙動 | 現行（本番） | 判定 |
|---|---|---|---|
| SG-D5 | 生成の上限到達（Star・一括 Star の 429）の toast が「今月の生成上限に達しました（約N日後に可能）」「本日の生成上限に達しました（約N時間後に可能）」のように、次回可能の目安を併記する（`formatRetryAfter` の 5 段: まもなく / 約N分後 / 約N時間後 / 約N日後。文言の分岐は既に `feed/page.tsx:15-20`（W-S4a の後は同じ文言を持つ page の写像）にあり、BFF が header を落としていたため本番で出ていなかった） | 併記なし（「…に達しました」だけ） | `proxy.test.ts`（header の中継）。文言の分岐自体の既存テスト（`tests/app/feed/page.test.tsx` は gateway の double で `retryAfterSeconds` を渡しており、期待値は変わらない） |
| SG-D5 | 月次か日次かの判定で、本文に「Monthly」が無くても待ち時間が 24 時間を超えれば月次と判定される分岐（TA-R-CT-3。ADR-073 のフォールバック）が本番で効く | 本文の「Monthly」だけで判定されていた | `tests/lib/catalog/domain/generationLimit.test.ts`（W-S4a。期待値は不変） |

不変として固定する: CI-T14（`BACKEND_API_KEY` 欠落・path 付き `BACKEND_BASE_URL` は 500）、`Set-Cookie` の中継、status・body、timeout（504）・到達不能（502）。

## 契約と検査
CI-T14（`proxy.test.ts` の既存 31 件が不変で green）、SG-D5 の 3 件、TA-V9（web の page テストは不変）。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。`proxy.test.ts` の件数 = 着手前 ＋ 3。既存 31 件の名前と期待値は不変。
- `git diff --name-only` が `app/api/backend/[...path]/route.ts` と `tests/app/api/proxy.test.ts` の 2 行だけ。
- `grep -n "Retry-After" 'app/api/backend/[...path]/route.ts'` が 1 件以上（中継の行）。

## 禁止事項 / scope 外
- `Retry-After` 以外の header を中継しない。backend・gateway・文言・`formatRetryAfter` を変えない。CI-T14 の挙動を変えない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/api/proxy.test.ts`（31 件）・`tests/app/feed/page.test.tsx`・`tests/lib/format.test.ts`。

## 規模・返却事項
規模は上。返却: (1) 新 Spec §5.8・§8.1・§8.2・§9 の W-T10b を「判断待ち」から適用 slice へ（契約: CI-T14・SG-D5）。(2) 本番で上限到達の文言に目安が付くことを確かめた結果（デプロイ後の手動 1 回）を PR 説明に残す。

## 参照
新 Spec §5.8・§8.1・§8.2・§10.3（J-W3 と 2026-10-01 の採用）、既存 Spec §4（CI-T14）、ADR-042・ADR-073、台帳 §5 SG-D5。
