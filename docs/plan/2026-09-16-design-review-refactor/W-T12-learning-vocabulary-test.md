## web リファクタ W-T12: Learning — 単語テストの状態機械を domain へ移す（適用 slice）

## 概要
`app/(app)/vocabulary-test/page.tsx`（480 行）の状態機械（`self-assessment` → `retest` → `submitting` → `result`。ほかに `loading`・`empty`・`error`）と規則（10 語で打ち切る・自己評価で「知らない」と答えた語だけを再テストする・結果の組立て・選択肢は正解と誤答 3 つ）を `lib/learning/domain/vocabularyTest.ts` の純関数にし、表で駆動するテストを書く。出題は query（TA-Q-LN-3）、送信は command（TA-C-LN-2）。**利用者に見える挙動・文言・request の形（`self_known`・`retest_correct`）は変えない**。正本は新 Spec §5.6（L-R06 の行・TA-R-LN-3・7）・§8.2 W-T12 行・§10.3 J-W2（SG-D3）。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-LRN-10・11（PRD §5。学習仕様 L-R06）、UC-L3、TA-R-LN-3・7、TA-V4・TA-V6・TA-V7、ADR-087、SG-D3。

## 種別
適用 slice。W-T11・W-T13 とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `vocabulary-test/page.tsx` 480 行、打ち切りの式 3 箇所 `:59,410,443`）
- production ≈ 300 行: `lib/learning/domain/vocabularyTest.ts` ≈ 120、application への追加 ≈ 50、gateway への追加 ≈ 30、page ≈ −150/+60。
- test ≈ 300 行: `vocabularyTest.test.ts`（遷移の表）≈ 200、command / query ≈ 60、`cqrs`・`immutability` への追加 ≈ 40。
- 合計 ≈ 600 行（10² 行の後半）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-T11 が先なら `lib/learning/application/*`・`learningGateway.ts` に足す。後なら本 slice が新設する（同じファイル名。後から入る側が rebase）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない）: SG-D3（「知っている」と答えた語は `self_known: true`・`retest_correct: null` で送り、次回の期日は backend が決める。ADR-087）。`GET /vocabulary/test-session` は query として扱う（backend 内の間引きは architecture.md §5 の明示の例外）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 状態 | `vocabulary-test/page.tsx:10`（`Phase` 7 値）・`:33-44`（state 9 つ） | `grep -n "type Phase\|useState" 'app/(app)/vocabulary-test/page.tsx'` |
| 打ち切り | `:59,410,443`（`session.items.slice(0, 10)` の 3 箇所） | `grep -n "slice(0, 10)" 'app/(app)/vocabulary-test/page.tsx'` |
| 選択肢 | `:19-29`（正解 ＋ 誤答 `slice(0, 3)`・2 未満ならそのまま・shuffle） | `sed -n 17,30p 'app/(app)/vocabulary-test/page.tsx'` |
| 結果の組立て | `:88-110`（`self_known`・`retest_correct`（既知なら null、無ければ false）・件数） | `grep -n "self_known\|retest_correct" 'app/(app)/vocabulary-test/page.tsx'` |
| request | `lib/api/vocabulary.ts:21,27`（`getVocabularyTestSession`・`submitVocabularyTestResult`） | `grep -n "^export function" lib/api/vocabulary.ts` |
| 許可リストの `removeBy: W-T12` | TA-D4 (a)（`vocabulary-test/page.tsx`）・TA-D5（TP-A6）・TA-V4 の TA-R-LN-3 の行 | `grep -B4 '"removeBy": "W-T12"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
1. `lib/learning/domain/vocabularyTest.ts`（TA-R-LN-3・7）: `VocabularyTestState`（7 状態の判別共用体）と遷移の純関数 `reduce(state, event)`（事象 = 出題の受領・自己評価・再テストの回答・送信の成功・失敗・空）。規則 = `MAX_ITEMS = 10` で打ち切る・「知らない」と答えた語だけを再テストに回す・`choicesFor(item)`（正解 ＋ 誤答 3 つ。shuffle は乱数を引数で受ける）・`buildResult(state)`（既知 → `selfKnown: true`・`retestCorrect: null`。再テストの結果が無ければ false）。語は「自己評価で既知」（「習得」を書かない）。
2. application: query `getVocabularyTestSession()`（TA-Q-LN-3）→ `VocabularyTestView`（出題の一覧。凍結済み）。command `submitVocabularyTest(result)`（TA-C-LN-2）→ `Result<void, ApiFailure>`。
3. `learningGateway.ts`: 2 つの request と DTO の変換（`retest_correct` の名前は gateway が持つ）。
4. `vocabulary-test/page.tsx`: state を `reduce` の 1 つに。フォーカス管理・アニメーション（`exitDirection`）・文言・`playSfx` の呼出（W-T13 まで）は page に残す。
5. `architecture/boundaries.allowlist.json` の `removeBy: "W-T12"` の行を消す。
**テスト**: `tests/lib/learning/domain/vocabularyTest.test.ts`（遷移の表: 全状態 × 全事象。不正な組は状態が変わらない）、application と gateway のテスト、`tests/app/vocabulary-test/page.test.tsx` の mock 置換。テスト名に `L-R06` を含める。

## 変更の責務（層ごと）
domain = 状態機械と 4 規則。application = 出題の query・送信の command。infrastructure = DTO の変換と `retest_correct` の名前。presentation = 文言・フォーカス・演出。

## 移行の中間状態
無い（`@/lib/sfx` の行は W-T13）。

## 変わる挙動
無い（打ち切りの 10 語・選択肢・送る body・文言は不変）。

## 契約と検査
TA-R-LN-3（遷移の表・打ち切り・再テストの対象・結果の組立て）、TA-R-LN-7（`lib/learning/**` に「習得」0 件）、TA-V4（`slice(0, 10)`・`slice(0, 3)` の出現が `vocabularyTest.ts` だけ、`retest_correct` が `vocabularyTest.ts`・`learningGateway.ts` だけ = 新 Spec §7 の表の行）、TA-V6・TA-V7（入口に 2 つを足す）、TA-V9（page テスト）。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "slice(0, 10)\|slice(0, 3)\|retest_correct\|self_known" app components hooks contexts lib` の出現が `lib/learning/domain/vocabularyTest.ts`・`lib/learning/infrastructure/learningGateway.ts` だけ。
- `grep -n "from '@/types\|useState<VocabularyTestItem" 'app/(app)/vocabulary-test/page.tsx'` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T12"' architecture/boundaries.allowlist.json` が 0。
- 文言・request の assertion に diff が無い。

## 禁止事項 / scope 外
- 出題の数・選択肢の数・送る値を変えない（SG-D3 の (a) は web の送る値を変えない）。ダッシュボードが件数のために出題を呼ぶ経路（W-T13）を変えない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/vocabulary-test/page.test.tsx`。

## 規模・返却事項
規模は上。返却: 学習仕様 L-R06 の web の実装の置き場（`vocabularyTest.ts`）を親 docs へ。

## 参照
新 Spec §5.6・§7（TA-V4 の表の TA-R-LN-3）・§8.2（W-T12 行）・§10.3（J-W2）、学習仕様 L-R06、ADR-087、台帳 §5 SG-D3。
