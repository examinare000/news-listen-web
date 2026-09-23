## web リファクタ W-S2c: 旧再生実装の削除（削除のみ）

## 概要
W-S2b で未参照になった旧再生実装と `AppContext.currentPodcast` を削除し、`reorderUpNext` → `moveUpNext` の rename を完結させ、依存方向の eslint ルール（RF19・T-T7b）で再発を防ぐ。3 段分割の ③。本 slice は**削除と、削除の再発防止ルールの追加だけ**を行い、新しい挙動を入れない。正本は Implementation Spec §3.1（`AppContext.currentPodcast` 削除・rename 独立コミット）・§4 CI-T7・§5 naming_decisions / dependency_direction、親 docs web-design §12.2「`AppContext` の解体」行。**検証モード: 再設計しない**。

## 前提・着手条件
- 依存 slice: W-S2b が main に merge 済み（production から旧 7 ファイルへの import が 0 件であること。W-S2b の完了条件）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e 3 本。
- Selection Gate 依存なし。
- 棄却済み案: なし（削除のみ）。`docs/trial-log/` を最初に読む。
- **TP1（W-S1 の `ApiError` 互換 adapter）は本 slice で削除しない（user 判断 2026-09-23。本体削除は W-S4）。** W-S1 order の削除条件（`app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時）は page 側移行（W-S4）まで満たせない（2026-09-23 実測: `app/` 7 ファイル・`components/` 3 ファイルが import）。本 slice が担うのは「再生系からの TP1 参照 0 件」の確認まで。

## 対象（web サブモジュールのみ）
**削除（production 7 ファイル）**
1. `contexts/AudioPlayerContext.tsx` 2. `hooks/useAudioPlayer.ts` 3. `hooks/useStartPodcast.ts` 4. `lib/playbackQueue.ts` 5. `lib/audioCache.ts` 6. `lib/resolvePlayback.ts` 7. `lib/playbackPosition.ts`

**削除（テスト 9 ファイル）**
8. `tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`（3。W-S2b で `PlaybackProvider.*` へ移植済み） 9. `tests/hooks/useAudioPlayer.test.ts` 10. `tests/lib/audioCache.test.ts` 11. `tests/lib/playbackQueue.test.ts` 12. `tests/lib/playbackQueue.conformance.test.ts`（Q-01〜Q-32 は `tests/lib/playback/queue.conformance.test.ts` が担う） 13. `tests/lib/resolvePlayback.test.ts` 14. `tests/lib/playbackPosition.test.ts`

**削除（シンボル）**
15. `contexts/AppContext.tsx`: `AppState.currentPodcast`（`:14`）・`DEFAULT_STATE.currentPodcast`（`:24`）・`Action` の `SET_PODCAST` と reducer の case（`:36,44`）・`import type { Podcast }` が不要になれば併せて。**残すもの**（W-S4 が行き先を持つ。web-design §12.2）: `isRestoring`・`playbackSpeed`・`timeFormat`・`SET_SPEED`・`SET_TIME_FORMAT`・`AppProvider`・`useApp`。
16. `tests/contexts/AppContext.test.tsx` の `currentPodcast` / `SET_PODCAST` を扱う 2 テスト（`:33-35`・`:69-76`）。`tests/hooks/useWebPushSubscription.test.ts:12`・`tests/components/PushNotificationSection.test.tsx:15` の mock state から `currentPodcast: null` を除く。
17. コメント: `app/globals.css:6`・`components/PodcastCard.tsx:12` の `currentPodcast` 言及を `nowPlaying()` に読み替える。
18. `reorderUpNext` の最終出現: 4・11・12 の削除と `tests/components/AudioPlayerBar.test.tsx:439` のコメント修正を **1 つの独立コミット**にする（Spec naming_decisions「挙動不変の独立コミット」。他の削除と混ぜない）。

**追加（再発防止ルールのみ。`eslint.config.mjs`）**
19. `no-restricted-properties`: `currentPodcast` の参照を禁止。`no-restricted-imports`: `contexts/**` から `@/components/*` の import を禁止（T-T7b。CI での実行担保は W-S3）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 3 本 green（変更なし）。テスト件数 = 着手前 − 削除分（削除 9 ファイルの件数 ＋ `tests/contexts/AppContext.test.tsx` の 2 件。内訳を PR 説明に記録）。
- 対象 1〜14 の 16 ファイルが存在しない。
- **参照 0 件**（量化する集合と grep）:
  - `currentPodcast`: `grep -rn "currentPodcast" app components hooks contexts lib tests e2e public` が 0 件（除外なし。コメントも含めて 0）。
  - `SET_PODCAST`: 同上の範囲で 0 件。
  - `reorderUpNext`: 同上の範囲で 0 件。
  - 旧 module: `grep -rn "AudioPlayerContext\|useAudioPlayer\b\|useStartPodcast\|lib/audioCache\|lib/playbackQueue\|lib/resolvePlayback\|lib/playbackPosition" app components hooks contexts lib tests e2e` が 0 件（除外: `docs/`）。
  - 再生系からの TP1 参照: `grep -rln "ApiError" contexts/PlaybackProvider.tsx lib/playback lib/platform` が 0 件（`app/` `components/` の `ApiError` import は W-S4 まで残る。本 slice の判定対象に含めない）。
  - `contexts/` → `components/`: `grep -rn "from '@/components" contexts` が 0 件、かつ eslint の `no-restricted-imports` が有効。
- rename の独立コミットが PR 内に 1 つあり、その diff が対象 18 の 4 ファイルに閉じている。
- eslint ルール 2 件を意図的に違反させたローカル検証で `npm run lint` が非ゼロ終了することを確認済み（確認後に混入コードを削除）。

## 禁止事項 / scope 外
- 削除以外の挙動変更をしない。`lib/playback/*`・`contexts/PlaybackProvider.tsx`・`app/` の page を機能面で変えない（コメント修正 17 を除く）。
- TP1 adapter 本体・`lib/api.ts`・`lib/api/*` を変更しない（W-S4）。
- `AppContext` の `playbackSpeed` / `timeFormat` / `isRestoring` / `AppProvider` / `useApp` を削除しない（W-S4）。
- `tests/helpers/mockAudio.ts`・`mockCaches.ts`・`tests/public/sw.test.ts`・T-T18 を削除しない。
- `.github/workflows/ci.yml` を変更しない（W-S3）。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx`、`tests/lib/playback/*.test.ts`、`tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/settings/page.test.tsx`、`tests/contexts/AppContext.test.tsx`、e2e 3 本。いずれも本 slice で内容を変えない（16 の 2 テスト削除と mock 修正を除く）。

## 検証
`npm test`（件数の減少分が完了条件の削除分と一致）、上記 grep 6 種、`npm run lint`（ルール有効化の負例確認を含む）、`npm run build`、`npm run test:e2e`。

## 記録
- 削除したファイル・シンボルの一覧と件数を PR 説明に残す。完了後、親 docs web-design §6（AppContext / AudioPlayerContext の記述）・§7・§9 を現状記述へ書き換える対象として README に印を付ける。
- TP1 の削除は W-S4 に残ることを README と親 plan の W-S2c 行へ返す（親 plan・web-design §12.3 の「暫定互換 adapter」は本 slice では再生系参照 0 件の確認に留まる）。
