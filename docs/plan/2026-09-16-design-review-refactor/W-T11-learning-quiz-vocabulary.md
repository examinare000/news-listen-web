## web リファクタ W-T11: Learning — クイズと語彙の登録を Learning へ移す（適用 slice）

## 概要
`app/(app)/podcast/[id]/page.tsx` が持つ理解度クイズ（全問に回答したら送信できる・正答率 0.5 以上で正解の音。L-R19）と語彙グロッサリの登録（登録済みの判定・登録。L-R05・L-R18）を `lib/learning/{domain,application,infrastructure}` へ移す。採点結果は command の receipt（`QuizResultView`）。グロッサリの表示は Catalog の `EpisodeDetailView` の語彙と、Learning の登録済みの集合を合成した `GlossaryView`。**利用者に見える挙動・文言・request は変えない**（ボタンのラベル「習得」は presentation のまま。domain の語は「登録」: TA-R-LN-7・SG-D3）。正本は新 Spec §5.6（L-R との対応の L-R05・L-R18・L-R19 の行・TA-C-LN-1・3・TA-Q-LN-2・TA-R-LN-2・4・7）・§8.2 W-T11 行・§10.1 W-33・§10.3 J-W2。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-LRN-04・05・06（PRD §5。学習仕様 L-R05・L-R18・L-R19）、UC-L2・UC-L3、TA-R-LN-2・4・7、TA-V4・TA-V6・TA-V7、ADR-070（正解キーはクライアントに無い）、SG-D3（J-W2 の (a)。2026-10-01 採用）、導出 W-33。

## 種別
適用 slice。SG-D3 は確定済みで、web が送る値は (a)(b) のどちらでも変わらない（新 Spec §5.6）。W-T12・W-T13 とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `podcast/[id]/page.tsx` 455 行（クイズ `:101-144,285-370`・語彙 `:107-161,240-283`））
- production ≈ 250 行: `lib/learning/domain/{quiz,vocabulary}.ts` ≈ 50、`lib/learning/application/{commands,queries,readModels,ports}.ts` ≈ 110、`lib/learning/infrastructure/learningGateway.ts` ≈ 50、page ≈ −60/+40。
- test ≈ 250 行: domain 2 ≈ 70、command / query ≈ 100、gateway ≈ 40、`cqrs.learning.test.ts`・`immutability.learning.test.ts` ≈ 40。
- 合計 ≈ 500 行（10² 行）。

## 前提・着手条件
- 依存 slice: **W-T3**（詳細 page が `EpisodeDetailView` を持つ）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow`。
- 確定済み（再提案しない）: SG-D3（語を「登録 / 既知 / 定着」に分け、実装と ADR-087 を正とする。学習仕様 L-R06 の文面は親 docs が直す）。採点は backend（ADR-070）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-T3・W-S4d1 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 登録済みの取得と判定 | `podcast/[id]/page.tsx:107-119`（`getVocabulary` → `term` の集合）・`:255`（`registeredTerms.has(entry.term)`） | `grep -n "registeredTerms\|getVocabulary" 'app/(app)/podcast/[id]/page.tsx'` |
| 登録 | `:146-161`（`saveVocabulary(podcast.id, term)`・`savingTerms`）、ラベル「習得」`:261-265` | `grep -n "saveVocabulary\|savingTerms\|習得" 'app/(app)/podcast/[id]/page.tsx'` |
| クイズ | `:104-105`（state）・`:126-127`（全問回答）・`:131-144`（送信）・`:138`（`>= 0.5` で正解の音） | `grep -n "quizAllAnswered\|submitQuizAnswers\|>= 0.5" 'app/(app)/podcast/[id]/page.tsx'` |
| request | `lib/api/podcasts.ts:43`（`submitQuizAnswers`）・`lib/api/vocabulary.ts:10,17`（`saveVocabulary`・`getVocabulary`） | `grep -n "^export function" lib/api/podcasts.ts lib/api/vocabulary.ts` |
| 許可リスト | TA-D4 (a) の `podcast/[id]/page.tsx` は W-T3 で消えている。`@/lib/sfx`（`removeBy: W-T13`）は残す。TA-V4 の TA-R-LN-2（`>= 0.5`）の行が `removeBy: W-T11` | `grep -B4 '"removeBy": "W-T11"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
1. `lib/learning/domain/quiz.ts`（TA-R-LN-2）: `QuizAttempt`（設問数と回答）・`canSubmit(attempt)`（全問に回答）・`passed(result)`（正答率 0.5 以上）。
2. `lib/learning/domain/vocabulary.ts`（TA-R-LN-4・7）: `isRegistered(term, registered)`。語は「登録」。「習得」を domain に書かない。
3. `lib/learning/application/`: command `registerTerm(episodeId, term)`（TA-C-LN-1）→ `Result<void, ApiFailure>`、`submitQuiz(episodeId, answers)`（TA-C-LN-3）→ `Result<QuizResultView, ApiFailure>`（receipt。`passed` を持つ）。query `getRegisteredTerms()`（TA-Q-LN-2）→ 登録済みの語の集合。`readModels.ts` に `QuizResultView`・`GlossaryView`（`term`・`meaning`・`example`・`registered`）と、`EpisodeDetailView` の語彙と登録済みの集合から `GlossaryView` の配列を作る関数。`ports.ts` に `LearningGateway`。
4. `lib/learning/infrastructure/learningGateway.ts`: 3 つの request を呼び、DTO（`QuizAnswerResponse`・`VocabularyListResponse`）を application の型へ。
5. `podcast/[id]/page.tsx`: クイズと語彙の state と handler を command / query へ。効果音の選択は `QuizResultView.passed` を見る（`playSfx` の呼出は W-T13 まで残す）。文言とラベルは不変。
6. `architecture/boundaries.allowlist.json` の `removeBy: "W-T11"` の行を消す。
**テスト**: `tests/lib/learning/domain/{quiz,vocabulary}.test.ts`・`tests/lib/learning/application/*.test.ts`・`tests/lib/learning/infrastructure/learningGateway.test.ts`・`tests/architecture/{cqrs,immutability}.learning.test.ts`、`tests/app/podcast/id/page.test.tsx` の mock 置換。テスト名に L-R の ID を含める。

## 変更の責務（層ごと）
domain = 全問回答・合格の閾値・登録済みの判定。application = 2 command・1 query・`QuizResultView`・`GlossaryView`。infrastructure = DTO の変換。presentation = ラベル「習得」・文言・効果音の契機。

## 移行の中間状態
無い（`@/lib/sfx` の行は W-T13）。

## 変わる挙動
無い。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-LN-2（L-R19） | `quiz.test.ts`（未回答 1 問で送れない・0.5 ちょうどで合格・0.49 で不合格） |
| TA-R-LN-4（L-R05・L-R18） | `vocabulary.test.ts`、`queries.test.ts`（`GlossaryView.registered`） |
| TA-R-LN-7（SG-D3） | `rules.test.ts`: `lib/learning/**` に「習得」が 0 件 |
| TA-V4 | `>= 0.5` の出現が `lib/learning/domain/quiz.ts` だけ |
| TA-V6・TA-V7 | `immutability.learning.test.ts`（`getRegisteredTerms` の観点 2・3）、`cqrs.learning.test.ts`（本 slice の入口 3 つ。`submitQuiz` の receipt は採点結果だけ） |
| TA-V9 | `tests/app/podcast/id/page.test.tsx`、e2e `main-flow` |

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e -- main-flow`。

## 完了条件
- 上のコマンドが成功。
- **page が直接呼ばない**（集合 = `podcast/[id]/page.tsx`）: `grep -n "submitQuizAnswers\|saveVocabulary\|getVocabulary\|>= 0.5\|QuizAnswerResponse" 'app/(app)/podcast/[id]/page.tsx'` が 0 件。
- `grep -rn "習得" lib` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T11"' architecture/boundaries.allowlist.json` が 0。
- 文言・ラベル・request の assertion に diff が無い。

## 禁止事項 / scope 外
- ラベル「習得」を変えない（SG-D3 の (a) は presentation を変えない）。単語テスト（W-T12）・ダッシュボード（W-T13）・Catalog の詳細の query（W-T3）を変えない。正解キーをクライアントに持たせない（ADR-070）。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/podcast/id/page.test.tsx`、e2e `main-flow`。

## 規模・返却事項
規模は上。返却: SG-D3 に従い、学習仕様 L-R06 の文面を直す作業は親 docs（本 slice は web の語を「登録」で揃えたことを返す）。導出 W-33 を台帳へ。

## 参照
新 Spec §5.6・§7・§8.2（W-T11 行）・§10.1（W-33）・§10.3（J-W2）、学習仕様 L-R05・L-R18・L-R19、ADR-070・ADR-087、台帳 §5 SG-D3。
