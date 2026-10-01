## web リファクタ W-T13: Learning — ダッシュボード・ストリーク・実績・効果音を Learning へ移す（適用 slice）

## 概要
読む操作と書く操作が混ざった 2 箇所（`app/(app)/dashboard/page.tsx:40-69` の `loadDashboard` = 読む ＋ 既読の id を書く ＋ 効果音 ＋ toast、`contexts/StreakContext.tsx:41-52` の `refresh` = 読む ＋ 効果音 ＋ pulse）を query と command に分ける。ストリークの取り直しの間隔（5 分）・増えたときだけ演出・未読の解錠の検知・週の目標の進捗・難易度の提案の有無を `lib/learning/domain/` へ。既読の id の保存は `seenAchievementsStore.ts`（key は registry の宣言）。`lib/sfx.ts` を `lib/platform/sfx.ts` へ移し、`contexts/SfxProvider.tsx` が作って `useSfx()` で配る。`StreakContext.tsx` は `StreakProvider.tsx`（配線だけ）にする。**利用者に見える挙動・文言・request は変えない**（ダッシュボードが期限の来た語の件数のために出題を呼ぶ現行の呼び方も変えない）。正本は新 Spec §5.6（L-R01・02・04・09・10・17・20・21 と実績・効果音の行・TA-C-LN-4・TA-Q-LN-1・4・5・TA-R-LN-1・5・6・「読む操作に付いた書込み」）・§5.8（効果音）・§6・§8.2 W-T13 行・§10.1 W-33。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-LRN-01・02・09（PRD §5。学習仕様 L-R01・02・04・09・10・17・20・21）、UC-L4・UC-L5、ADR-086（実績）・ADR-088（効果音）・ADR-071（難易度の提案）、TA-R-LN-1・5・6、TA-V4・TA-V6・TA-V7、architecture.md §5 の明示の例外（学習ダッシュボード・単語テストの出題）、導出 W-33。

## 種別
適用 slice。W-T11・W-T12 とは順序を問わない。`settings/page.tsx`（提案のバナー）を触るので W-T6・W-T7a・W-T7b の後に置く（後から入る側が rebase）。

## 規模（見込み。根拠 = 2026-10-01 実測: `dashboard/page.tsx` 387 行、`StreakContext.tsx` 80 行超、`lib/sfx.ts` 131 行、`settings/page.tsx:90-117`）
- production ≈ 450 行: `lib/learning/domain/{streak,achievements,weeklyGoal,difficultySuggestion}.ts` ≈ 80、application への追加（`getStreak`・`getDashboard`・`getDifficultySuggestion`・`markAchievementsSeen`・`StreakView`・`DashboardView`・`SuggestionView`）≈ 140、`seenAchievementsStore.ts` ≈ 30、`learningGateway.ts` への追加 ≈ 50、`StreakProvider.tsx`・`SfxProvider.tsx` ≈ 80、`lib/platform/sfx.ts`（移動）、page 3 本・`NavigationBar` ≈ 70。
- test ≈ 400 行: domain 4 ≈ 120、application ≈ 120、store・gateway ≈ 50、Provider 2 ≈ 60、`cqrs`・`immutability` ≈ 50。
- 合計 ≈ 850 行（10² 行の後半）。

## 前提・着手条件
- 依存 slice: **W-S4d3** と **W-S4b**（registry が `seenAchievementIds`・`sfxEnabled` を宣言し、`lib/sfx.ts` は有効かどうかを関数で受ける）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-T11・W-T12 の `lib/learning/application/*` があれば足し、無ければ新設する。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow`。
- 確定済み（再提案しない）: ダッシュボードの読み取りに付いた backend の書込みは backend の中で起き、web からは query（architecture.md §5）。`getVocabularyTestSession` を件数のために呼ぶ現行の呼び方は変えない（新 Spec §5.6・§11）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4b・W-S4d1 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| `loadDashboard` | `dashboard/page.tsx:38-84`（`getLearningDashboard`・`getVocabulary`・`getVocabularyTestSession` `:43`・既読の読み書き `:48,65`（W-S4b の後は registry）・`playSfx('achievement')` `:56`・toast `:60`） | `grep -n "loadDashboard\|seen_achievement\|seenAchievement\|playSfx\|showToast" 'app/(app)/dashboard/page.tsx'` |
| ストリーク | `StreakContext.tsx:8`（`STALE_AFTER_MS = 5 * 60 * 1000`）・`:26-60`（`refresh`・増えたら `playSfx('streak')` と 300ms の pulse） | `grep -n "STALE_AFTER_MS\|playSfx\|setIsPulsing\|current_streak_days" contexts/StreakContext.tsx` |
| ストリークの表示の文 | `dashboard/page.tsx:91-100` | `sed -n 88,102p 'app/(app)/dashboard/page.tsx'` |
| 難易度の提案 | `settings/page.tsx:90-117`（`has_suggestion=false` と取得失敗は非表示。適用は `handleDifficultyChange` = W-T7a の `setDefaultDifficulty`） | `grep -n "suggestion" 'app/(app)/settings/page.tsx'` |
| 効果音の利用 | `@/lib/sfx` を import する: `dashboard`・`feed`・`podcast/[id]`・`vocabulary-test`・`StreakContext`・`settings`（`isSfxEnabled`・`setSfxEnabled`。W-S4b の後の形を確かめる） | `grep -rn "@/lib/sfx" app components hooks contexts lib` |
| 許可リストの `removeBy: W-T13` | TA-D4 (a)（`dashboard/page.tsx`・`StreakContext.tsx`・`settings/page.tsx`）・TA-D5（`@/lib/sfx` 4 行・TP-A6 の `dashboard`）・TA-V4 の TA-R-LN-1（`5 * 60 * 1000`） | `grep -B4 '"removeBy": "W-T13"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
1. domain（`lib/learning/domain/`）: `streak.ts`（TA-R-LN-1: `isStale(fetchedAt, now)` 5 分・`increased(prev, next)`）、`achievements.ts`（TA-R-LN-5: `newlyUnlocked(unlocked, seenIds)`・実績の id の集合）、`weeklyGoal.ts`（`progress(listened, goal)`。値域は Preferences）、`difficultySuggestion.ts`（TA-R-LN-6: 提案なし・取得失敗はどちらも「提案なし」）。`Clock` port は作らない（`now` は引数）。
2. application: query `getStreak()`（TA-Q-LN-1）→ `StreakView`（`days`・`todayListened`・`justIncreased`）、`getDifficultySuggestion()`（TA-Q-LN-4）→ `SuggestionView | null`、`getDashboard()`（TA-Q-LN-5）→ `DashboardView`（`streak`・`weeklyGoal`・`monthly`・`quiz`・`vocabularyCount`・`dueTestCount`・`achievements`・`newlyUnlocked`。読むだけで既読を書かない）。command `markAchievementsSeen(ids)`（TA-C-LN-4）→ `void`。port `SeenAchievementsStore`。
3. `lib/learning/infrastructure/seenAchievementsStore.ts`: registry の `seenAchievementIds` を `KeyValueStore` で読み書きする（key と codec は registry。TA-D11）。`learningGateway.ts` に `getListeningStreak`・`getLearningDashboard`・`getVocabulary`（件数）・`getVocabularyTestSession`（件数）・`getDifficultySuggestion`。
4. `lib/sfx.ts` → `lib/platform/sfx.ts`（`git mv`。有効かどうかは関数で受ける形を保つ）。`contexts/SfxProvider.tsx`（新規）が registry の `sfxEnabled` を渡して作り、`useSfx()` で `play`・`prepare` を配る。
5. `contexts/StreakContext.tsx` → `contexts/StreakProvider.tsx`: `getStreak()` を呼び、`justIncreased` のとき `useSfx().play('streak')` と 300ms の pulse（演出は Provider に残してよいが、判断は `StreakView.justIncreased` だけ）。`useStreak()` の名前と公開面（`streak`・`refresh`・`isPulsing`）は変えない。`app/(app)/layout.tsx` の import を付け替える。
6. `dashboard/page.tsx`: `getDashboard()` → 結果の `newlyUnlocked` を見て効果音・toast → `markAchievementsSeen`（新 Spec §5.6「分け方」の順）。`settings/page.tsx`: 提案のバナーは `getDifficultySuggestion()`。`feed`・`podcast/[id]`・`vocabulary-test`・`settings` の `@/lib/sfx` を `useSfx()` へ。
7. `architecture/boundaries.allowlist.json` の `removeBy: "W-T13"` の行を消す。
**テスト**: domain 4・application・store・gateway・`tests/contexts/{StreakProvider,SfxProvider}.test.tsx`（`StreakContext.test.tsx` を移す）・`tests/lib/platform/sfx.test.ts`（`tests/lib/sfx.test.ts` を移す）・`cqrs.learning`・`immutability.learning` への追加、page テストの mock 置換。テスト名に L-R の ID を含める。

## 変更の責務（層ごと）
domain = 4 規則。application = 3 query・1 command・3 リードモデル・port。infrastructure = DTO の変換・既読の保存。adapter `lib/platform/sfx.ts` = WebAudio。composition root = `StreakProvider`・`SfxProvider`（配線と演出の契機だけ）。presentation = 文言・toast・表示の文。

## 移行の中間状態
TA-D5 の `@/lib/sfx` の 4 行・TA-D4 の 3 ファイル・TP-A6 の dashboard を消す。新しい一時経路は無い。

## 変わる挙動
無い（効果音の契機・toast の文言・pulse の 300ms・5 分の取り直し・既読の保存形式・request（件数のための出題の呼出を含む）は不変）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-LN-1（L-R01・02・17） | `streak.test.ts`（4:59 は取り直さない・5:00 で取り直す・減少と同値は演出しない） |
| TA-R-LN-5（ADR-086） | `achievements.test.ts`（解錠済み − 既読。順序不問） |
| TA-R-LN-6（L-R20） | `difficultySuggestion.test.ts`、`settings/page.test.tsx`（非表示の 2 経路） |
| architecture.md §5 の例外 | `queries.test.ts`: `getDashboard()` が書き込む port（`SeenAchievementsStore.write`）を呼ばない。`markAchievementsSeen` は page が `newlyUnlocked` の後に呼ぶ（呼出の順を page テストで pin） |
| TA-V4 | `5 * 60 * 1000` の出現が `lib/learning/domain/streak.ts` だけ |
| TA-V6・TA-V7 | 入口に本 slice の 4 つを足す。query 全部を呼んで書込 0 件 |
| TA-V9 | dashboard・settings・NavigationBar・feed・podcast/[id]・vocabulary-test のテスト、e2e `main-flow` |

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e -- main-flow`。

## 完了条件
- 上のコマンドが成功。
- `lib/sfx.ts`・`contexts/StreakContext.tsx` が存在しない。`grep -rn "@/lib/sfx'\|@/contexts/StreakContext" app components hooks contexts lib tests` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "5 \* 60 \* 1000\|has_suggestion\|seen_achievement_ids" app components hooks contexts lib` の出現が `lib/learning/`（`has_suggestion` は gateway だけ）と `lib/preferences/`（key の宣言）だけ。
- `dashboard/page.tsx`・`StreakProvider.tsx` に `localStorage`・`JSON.` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T13"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- 文言・request の assertion に diff が無い。

## 禁止事項 / scope 外
- 件数のための出題の呼出を別の経路に替えない（backend の契約の話。新 Spec §11）。効果音の音・音量・契機を変えない。Preferences の registry の宣言（W-S4b）・既定速度（W-T7b）を変えない。`Clock` port を作らない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/dashboard/page.test.tsx`・`tests/contexts/StreakContext.test.tsx`・`tests/lib/sfx.test.ts`・`tests/app/settings/page.test.tsx`・`tests/components/NavigationBar.test.tsx`、e2e `main-flow`。

## 規模・返却事項
規模は上。返却: SG-A5 の web の分（学習機能の model の対応の保留）を W-T11〜W-T13 で解いた旨を親 docs へ（導出 W-33）。既存 Spec §3.5 の OB-L1 の 3 ルールの置き場を返す。

## 参照
新 Spec §5.6・§5.8・§6・§7・§8.2（W-T13 行）・§10.1（W-33）・§11、architecture.md §5、ADR-071・ADR-086・ADR-088。
