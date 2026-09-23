## web リファクタ W-S2c: 旧再生実装の削除（削除のみ）

## 概要
W-S2b で未参照になった旧再生実装と `AppContext.currentPodcast` を削除し、`reorderUpNext` → `moveUpNext` の rename を完結させ、依存方向の eslint ルール（RF19・T-T7b）で再発を防ぐ。3 段分割の ③。本 slice は**削除と、削除の再発防止ルールの追加だけ**を行い、新しい挙動を入れない。正本は Implementation Spec §3.1（`AppContext.currentPodcast` 削除・rename 独立コミット）・§4 CI-T7・§5 naming_decisions / dependency_direction、親 docs web-design §12.2「`AppContext` の解体」行。**検証モード: 再設計しない**。

## 規模（見込み。根拠 = 2026-09-24 実測の削除対象ファイル行数）
- production ≈ 870 行（ほぼ削除）: 削除 7 ファイル 836 行（`AudioPlayerContext.tsx` 218・`useAudioPlayer.ts` 267・`useStartPodcast.ts` 20・`playbackQueue.ts` 106・`audioCache.ts` ≈ 160・`resolvePlayback.ts` 27・`playbackPosition.ts` 38）、`AppContext.tsx` のシンボル削除 ≈ 10、`eslint.config.mjs` ≈ 15、コメント 3 行。
- test ≈ 1,720 行（ほぼ削除）: 削除 9 ファイル 1,711 行（`AudioPlayerContext.*` 393・`useAudioPlayer.test.ts` 663・`audioCache.test.ts` 213・`playbackQueue.{test,conformance.test}.ts` 400・`resolvePlayback.test.ts` 28・`playbackPosition.test.ts` 42）、`AppContext.test.tsx` の 2 件と mock state の修正 ≈ 12。
- 合計 ≈ 2,590 行だが、追加・変更は ≈ 40 行で残りは削除。削除は「参照 0 件」を 1 回の grep で判定してから行う操作であり、半分ずつ消すと途中状態で未参照ファイルが残る（W-S2b の完了条件が壊れる）ため分割しない。レビューはファイル一覧（16 件）と追加・変更 ≈ 40 行を読む。

## 前提・着手条件
- 依存 slice: W-S2b の web PR が main に merge 済み（production から旧 7 ファイルへの import が 0 件であること。W-S2b の完了条件）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b が並行投入されていた場合は W-S1b も merge 済み・ポインタ済み（旧 `lib/audioCache.ts` は W-S1 で gateway を引数注入に変えており、削除に `lib/api.ts` の形は影響しないが、直列の前提を揃える）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e 3 本。
- Selection Gate 依存なし。
- 棄却済み案: なし（削除のみ）。`docs/trial-log/` を最初に読む。
- **TP1（W-S1 の `ApiError` 互換 adapter）は本 slice で削除しない（user 判断 2026-09-23。本体削除は W-S4d3）。** W-S1 order の削除条件（`app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時）は page 側移行（W-S4d1）まで満たせない（2026-09-23 実測: `app/` 7 ファイル・`components/` 3 ファイル・`contexts/AuthContext.tsx` が import。`contexts/AudioPlayerContext.tsx` の import は本 slice の削除で消える）。本 slice が担うのは「再生系からの TP1 参照 0 件」の確認まで。

## 対象（web サブモジュールのみ）
**削除（production 7 ファイル）**
1. `contexts/AudioPlayerContext.tsx` 2. `hooks/useAudioPlayer.ts` 3. `hooks/useStartPodcast.ts` 4. `lib/playbackQueue.ts` 5. `lib/audioCache.ts` 6. `lib/resolvePlayback.ts` 7. `lib/playbackPosition.ts`

**削除（テスト 9 ファイル）**
8. `tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`（3。W-S2b で `PlaybackProvider.*` へ移植済み） 9. `tests/hooks/useAudioPlayer.test.ts` 10. `tests/lib/audioCache.test.ts` 11. `tests/lib/playbackQueue.test.ts` 12. `tests/lib/playbackQueue.conformance.test.ts`（Q-01〜Q-32 は `tests/lib/playback/queue.conformance.test.ts` が担う） 13. `tests/lib/resolvePlayback.test.ts` 14. `tests/lib/playbackPosition.test.ts`

**削除（シンボル）**
15. `contexts/AppContext.tsx`: `AppState.currentPodcast`（`:14`）・`DEFAULT_STATE.currentPodcast`（`:24`）・`Action` の `SET_PODCAST`（`:35`）と reducer の case（`:43-44`）・`import type { Podcast }` が不要になれば併せて。**残すもの**（W-S4b が行き先を持つ。web-design §12.2）: `isRestoring`・`playbackSpeed`・`timeFormat`・`SET_SPEED`・`SET_TIME_FORMAT`・`AppProvider`・`useApp`。
16. `tests/contexts/AppContext.test.tsx` の `currentPodcast` / `SET_PODCAST` を扱う 2 テスト（`:33-35`・`:69-76`）。`tests/hooks/useWebPushSubscription.test.ts:12`・`tests/components/PushNotificationSection.test.tsx:15` の mock state から `currentPodcast: null` を除く（W-0 が追加したテスト `tests/components/PushReregistration.test.tsx` 等に同じ mock state があれば同様に除く。完了条件の grep が集合を数える）。
17. コメント: `app/globals.css:6`・`components/PodcastCard.tsx:12` の `currentPodcast` 言及を `nowPlaying()` に読み替える。`e2e/main-flow.e2e.ts:200` のコメント（`useStartPodcast` / `SET_PODCAST` 言及）を `startEpisode` / session 状態の語へ読み替える（e2e の操作手順・assertion は変えない）。
18. `reorderUpNext` の最終出現: 4・11・12 の削除と `tests/components/AudioPlayerBar.test.tsx:439` のコメント修正を **1 つの独立コミット**にする（Spec naming_decisions「挙動不変の独立コミット」。他の削除と混ぜない）。**コミット順**: 旧 `lib/playbackQueue.ts` を import する `contexts/AudioPlayerContext.tsx`（`:12,188`）の削除（対象 1）を先のコミットに置き、rename コミットは 4・11・12・`AudioPlayerBar.test.tsx:439` の 4 ファイルに閉じたまま typecheck が通る状態で切る（各コミットで `npm run typecheck` green）。

**追加（再発防止ルールのみ。`eslint.config.mjs`）**
19. `no-restricted-properties`: `currentPodcast` の参照を禁止。`no-restricted-imports`: `contexts/**` から `@/components/*` の import を禁止（T-T7b。CI での実行担保は W-S3）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 3 本 green（変更なし）。テスト件数 = 着手前 − 削除分（削除 9 ファイルの件数 ＋ `tests/contexts/AppContext.test.tsx` の 2 件。内訳を PR 説明に記録）。
- 対象 1〜14 の 16 ファイルが存在しない。
- **参照 0 件**（量化する集合と grep）:
  - `currentPodcast`: `grep -rn "currentPodcast" app components hooks contexts lib tests e2e public` が 0 件（除外なし。コメントも含めて 0）。
  - `SET_PODCAST`: 同上の範囲で 0 件。
  - `reorderUpNext`: 同上の範囲で 0 件。
  - 旧 module: `grep -rn "AudioPlayerContext\|useAudioPlayer\b\|useStartPodcast\|lib/audioCache\|lib/playbackQueue\|lib/resolvePlayback\|lib/playbackPosition" app components hooks contexts lib tests e2e` が 0 件（除外なし。コメントも含めて 0: W-S2b の移植コメント「旧 AudioPlayerContext から移植」等は本 slice で消す。`docs/` は範囲外）。
  - 再生系からの TP1 参照: `grep -rln "ApiError" contexts/PlaybackProvider.tsx lib/playback lib/platform` が 0 件（`app/` `components/` `contexts/AuthContext.tsx` の `ApiError` import は W-S4d1 まで残る。本 slice の判定対象に含めない）。
  - `contexts/` → `components/`: `grep -rn "from '@/components" contexts` が 0 件、かつ eslint の `no-restricted-imports` が有効。
- rename の独立コミットが PR 内に 1 つあり、その diff が対象 18 の 4 ファイルに閉じている。
- eslint ルール 2 件を意図的に違反させたローカル検証で `npm run lint` が非ゼロ終了することを確認済み（確認後に混入コードを削除）。

## 禁止事項 / scope 外
- 削除以外の挙動変更をしない。`lib/playback/*`・`contexts/PlaybackProvider.tsx`・`app/` の page を機能面で変えない（コメント修正 17 を除く）。
- TP1 adapter 本体・`lib/api.ts`・`lib/api/*` を変更しない（W-S4d1 / W-S4d3）。
- `AppContext` の `playbackSpeed` / `timeFormat` / `isRestoring` / `AppProvider` / `useApp` を削除しない（W-S4b）。
- `tests/helpers/mockAudio.ts`・`mockCaches.ts`・`tests/public/sw.test.ts`・T-T18 を削除しない。
- `.github/workflows/ci.yml` を変更しない（W-S3）。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx`、`tests/lib/playback/*.test.ts`、`tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/settings/page.test.tsx`、`tests/contexts/AppContext.test.tsx`、e2e 3 本。いずれも本 slice で内容を変えない（16 の 2 テスト削除と mock 修正を除く）。

## 検証
`npm test`（件数の減少分が完了条件の削除分と一致）、上記 grep 6 種、`npm run lint`（ルール有効化の負例確認を含む）、`npm run build`、`npm run test:e2e`。

## 記録
- 削除したファイル・シンボルの一覧と件数を PR 説明に残す。完了後、親 docs web-design §6（AppContext / AudioPlayerContext の記述）・§7・§9 を現状記述へ書き換える対象として README に印を付ける。
- TP1 の削除は W-S4d3 に残ることを README と親 plan の W-S2c 行へ返す（親 plan・web-design §12.3 の「暫定互換 adapter」は本 slice では再生系参照 0 件の確認に留まる）。
