## web リファクタ W-S2b: `PlaybackProvider` への入口差し替え（挙動不変＋確定行のみ変更）

## 概要
W-S2a で新設した `lib/playback/*` を `contexts/PlaybackProvider.tsx` で配線し、`app/layout.tsx` の `AudioPlayerProvider` を置き換える。3 段分割の ②。共有仕様 §2・Q-01〜Q-32 の挙動は**不変**（特性テストと e2e 3 本で判定）。変わる挙動は下の「変更行」に列挙した行だけで、準拠テスト（行 ID をテスト名に含む）で判定する。旧実装の削除は W-S2c で行い、本 slice では削除しない。正本は Implementation Spec §3.1・§5 CP4・§6 S2 行（gate 指摘 1: `AudioPlayerBar` を含める）、親 docs web-design §12.2「現在再生中の正本」「再生状態」「速度 2 概念」、共有仕様 §2.11・§4.3・§4.4・§6.4・§6.6。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 規模（見込み。根拠 = 2026-09-24 実測の対象ファイル行数と置換箇所数）
- production ≈ 300 行: `contexts/PlaybackProvider.tsx` 新設 ≈ 180、`components/AudioPlayerBar.tsx`（251 行。置換 8 箇所＋失敗文言の写像）≈ 40、`app/(app)/podcast/page.tsx`（235 行。置換 6 行）≈ 30、`app/(app)/podcast/[id]/page.tsx`（455 行。置換 3 行）≈ 15、`app/(app)/settings/page.tsx`（511 行。置換 2 行＋4 関数）≈ 20、`contexts/AuthContext.tsx` ≈ 8、`app/layout.tsx` 2。
- test ≈ 600 行: 新設 4 ファイル ≈ 430（`tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx` は旧 3 ファイル 393 行の移植 ≈ 400、`tests/public/sw.prefix.test.ts` ≈ 30）、書換 5 ファイル ≈ 170（下記「特性テスト」の分類。mock に触れる行の実測: `AudioPlayerBar.test.tsx` 13・`podcast/page.test.tsx` 16・`podcast/id/page.test.tsx` 12・`settings/page.test.tsx` 22・`app-group-layout.test.tsx` 1、各行の置換に加え PS-08 と `errored(reason)` 文言の準拠行を足す）。
- 合計 ≈ 900 行。入口の切替は 1 PR で行う（旧新 Provider の併存移行は棄却済み。Spec §5）ため分割しない。

## 前提・着手条件
- 依存 slice: W-S2a と W-S2a2 の web PR が main に merge 済み（T-T1〜T11 green）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b が並行投入されていた場合は W-S1b も同様に merge 済み・ポインタ済みであること（W-S2c が旧 `lib/audioCache.ts` を消す前提として `lib/api.ts` の形が確定している必要がある）。
- **W-0（Web Push 再登録。wave 1）が main に merge 済み**であること。理由: 本 slice の対象 8 と W-0 が同じ `contexts/AuthContext.tsx` の `logout` を編集する。W-0 後の `logout` は `detachFromSubject()` → `client().logout()` → `deleteAllAudio()` / `clearManagedServiceWorkerCaches()` の順で、本 slice はそのうち `deleteAllAudio()` の 1 呼出だけを置き換える。
- baseline green: 下記「特性テスト」13 ファイル＋e2e 3 本。1 つでも red なら着手しない。
- 確定済み Selection Gate（共有仕様 §6.7・ADR-103）: **SG-X1** 完聴時に `duration` を 1 回送る。**SG-X2** 末尾 2 秒窓の resume。**SG-X4** 一時停止中は送らない（web 現行どおり。変更なし）。**SG-X5** 8 段（現行どおり）。
- 棄却済み案（再提案しない）: 旧 `AudioPlayerProvider` と新 `PlaybackProvider` の併存移行（Spec §5。本 slice は 1 PR で入口を切り替える。旧ファイルは未参照のまま残し W-S2c で消す）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規**
1. `contexts/PlaybackProvider.tsx`: React 配線のみ。`lib/platform/*` の adapter と、W-S1 が `contexts/AudioPlayerContext.tsx` に置いた gateway 呼出 4 箇所（`getPodcast` / `updatePosition` / `markCompleted`。`Result` を返す）を生成して Coordinator・Session・OfflineLibrary・PositionReporter に注入する。公開 hook は `usePlayback()` 1 つで、公開する値は次の 4 群に固定する: (a) Coordinator の公開操作 9 つ（`startEpisode` / `retry` / `addToQueue` / `playNext` / `removeFromQueue` / `reorder` / `skipToNext` / `nowPlaying()` / `upNext()`。Spec CP4。増やさない）、(b) session 状態と `setSpeed`、(c) `offline: OfflineLibrary`（W-S2a2 CP3 の `save` / `get` / `has` / `remove` / `clear` / `list` / `usage`。`PlaybackProvider` が `lib/platform/cacheStore.ts` の adapter で生成した instance をそのまま公開する）、(d) `savedPosition(id): number | null`（`KeyValueStore` adapter で `podcast_position:{id}` を読む。旧 `getSavedPosition` の代替。カード表示用で、resume の合成には使わない）。`components/` を import しない（失敗は `errored(reason)` の状態として公開する）。
2. `tests/public/sw.prefix.test.ts`（T-T18・**TP2**）: `public/sw.js` と `lib/swCacheCleanup.ts` の prefix 集合（`'shell-'`・`'api-'`）の一致を fs 読み比較で pin。owner: user。導入: W-S2b。削除条件: ビルド時注入か SW の module 化。

**変更**
3. `app/layout.tsx`: `AudioPlayerProvider` → `PlaybackProvider`。
4. `components/AudioPlayerBar.tsx`: `useApp().state.currentPodcast` の DTO 直読み（`:16,28-30,65-66,139,160`）を `nowPlaying()` の view model（`episodeId` `title` `difficulty` `createdAt` `durationSeconds`）へ。速度セレクト（`:236-239`）は `SET_SPEED` の dispatch をやめ session 速度 `setSpeed` を呼ぶ（既定速度は書き換えない: PS-08）。`PLAYBACK_SPEEDS` の import（`:6`）を `@/hooks/useAudioPlayer` から `@/lib/playback/session` へ。失敗文言は session の `errored(reason)` から写像し、`source_unavailable` かつオフラインのときは「オフライン」を含む（§2.11）。
5. `app/(app)/podcast/page.tsx`: `:199` の「再生中」判定を `nowPlaying()?.episodeId === podcast.id` へ。`useStartPodcast`（`:9,49`）の代わりに `usePlayback().startEpisode` を直接呼ぶ。`useAudioPlayerContext()` の `playNextInQueue` / `addToQueue`（`:10,51`）を `usePlayback()` の `playNext` / `addToQueue` へ。`isCached` / `downloadAudio`（`:12,128,143`）を `usePlayback().offline.has(podcast.id)` / `usePlayback().offline.save(podcast)` へ（download の経路 = page → `offline.save(podcast)`。音声本体の取得は `CacheStore` port の `putFromUrl`（W-S2a 対象 1）であり、Coordinator は経由しない。Coordinator の公開操作は Spec CP4 の 9 つのまま増やさない）。`getSavedPosition`（`:7,189`。カード表示用に local `podcast_position:{id}` を読む）を `usePlayback().savedPosition(podcast.id)` へ（表示値は現行と同じ local 値）。
6. `app/(app)/podcast/[id]/page.tsx`: 5 と同じ置換（`useStartPodcast` `:9,40`・`isCached` `:10,85` → `offline.has`・`downloadAudio` `:93` → `offline.save(podcast)`）。
7. `app/(app)/settings/page.tsx`: `listCachedEpisodes` / `estimateUsage` / `deleteAudio` / `deleteAllAudio`（`:17,125,135`）を `usePlayback().offline` の `list` / `usage` / `remove` / `clear` へ。`PLAYBACK_SPEEDS` の import（`:6`）を `@/lib/playback/session` へ。既定速度の保存（`useLocalStorage(KEY_DEFAULT_PLAYBACK_SPEED)` と `SET_SPEED` dispatch `:352`）は現状維持（W-S4b で registry へ）。
8. `contexts/AuthContext.tsx`: logout の `deleteAllAudio()`（`:9` の import）を、`lib/playback/offlineLibrary.ts` の `createOfflineLibrary`（W-S2a2）に `lib/platform/cacheStore.ts` の adapter を渡して**その場で生成**した `OfflineLibrary` の `clear()` へ替える（`usePlayback()` に依存しない: `AuthProvider` は `PlaybackProvider` より外側にあり Provider 順序は変えない。同じ Cache 名 `audio-v1` を消すので `PlaybackProvider` 側の instance と別でも結果は同じ。主体別化は W-S5）。
9. 特性テスト 13 ファイルの移植: oracle を公開 API（`nowPlaying()` / session 状態 / gateway double の呼出列）へ移す。`tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx` は `tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx` として移植し、旧 3 ファイルは残す（W-S2c で削除）。
10. resume の入力合成（Q12=A）: `candidate = server > 0 ? server : local` → 共有仕様の純関数 `resolveResumePosition(candidate, duration)`。合成は Coordinator（W-S2a2）の 1 箇所だけに置き、local（`podcast_position:{id}`）の読出は `PlaybackProvider` が `KeyValueStore` adapter を注入して行う。page・hook で合成しない。Spec §3.1 の `(server, local)` 署名はこの合成を指す。

**暫定互換（owner: user）**
- TP-S2b-1 `AppContext.currentPodcast` / `SET_PODCAST`: 本 slice 後は、参照されない旧ファイル（`contexts/AudioPlayerContext.tsx:90` の `SET_PODCAST` dispatch）を除き production から読み書きされない（残るのは `AppContext.tsx` の定義・旧ファイル内の参照・`tests/contexts/AppContext.test.tsx`）。導入: 既存。削除: W-S2c。
- `AppContext.playbackSpeed` は「既定速度」の置き場として残す（settings が書く。`AudioPlayerBar` は読まない）。W-S4b で `PreferencesRegistry` へ。
- `hooks/useStartPodcast.ts`・`contexts/AudioPlayerContext.tsx`・`hooks/useAudioPlayer.ts`・`lib/{playbackQueue,audioCache,resolvePlayback,playbackPosition}.ts`: 未参照のまま残す。削除: W-S2c。

## 変更行（これ以外の挙動変更は禁止）
| 行 ID | 何が変わるか | 判定 |
|---|---|---|
| PS-01 / PS-02 / PS-03 | advance 後の取得失敗で停止（`errored(fetch_failed | source_unavailable)`・`Queue.current` = 失敗エピソード）、手動 play が再生元解決からの再試行 | `tests/contexts/PlaybackProvider.completion.test.tsx` |
| PS-04 | INV-P1（全操作後 `session.episode.id === Queue.current.id`） | 同上 |
| PS-06（SG-X1） | 完聴時の server 書込が 0 → **`duration`**。順序 = 完聴イベント → `duration` 1 回 → advance | 同上＋ e2e `queue-autoadvance` |
| PS-08 | セッション速度は開始ごとに既定速度で初期化。バーの速度変更は既定速度を書き換えない（現行は `SET_SPEED` で AppContext の値が変わり次のエピソードへ持ち越す） | `tests/components/AudioPlayerBar.test.tsx` |
| RS-03 / RS-04 / RS-05（SG-X2） | 合成後の `candidate` が `duration − 2` 以上なら先頭から（現行は server 位置をそのまま使う。server 0 → local の fallback は現行どおり不変） | W-S2a の `resume.test.ts`（表駆動）＋ e2e `offline-playback` / `main-flow` で UV3 観測 |
| §6.4 送信条件 PS-05 | session が `idle` / `errored` のとき位置同期を送らない | `positionReporter` 経由。`PlaybackProvider.completion` で pin |

**不変として pin する行**: PS-05b（一時停止中は送らない。SG-X4）、RS-01 / RS-02 / RS-06 / RS-07（現行と同値）、server 0 のとき local 位置へ fallback する現行挙動（合成の 1 段目）、Q-01〜Q-32、§2.3〜§2.10 の操作、`AudioPlayerBar` の表示要素、settings のオフライン一覧・削除、e2e 3 本。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e `offline-playback` / `queue-autoadvance` / `main-flow` green。e2e で変更してよいのは上表の行に該当する assertion だけ（例: 完聴時の位置 PATCH 値 0 → `duration`。PS-06）で、それ以外の行・操作手順は変更しない（diff を PR 説明に列挙）。
- `app/layout.tsx` に `AudioPlayerProvider` が無く `PlaybackProvider` がある。
- production（`app/` `components/` `hooks/` `contexts/`）から `@/contexts/AudioPlayerContext`・`@/hooks/useStartPodcast`・`@/hooks/useAudioPlayer`・`@/lib/audioCache`・`@/lib/playbackQueue`・`@/lib/resolvePlayback`・`@/lib/playbackPosition` の import が **0 件**（`grep -rn "@/contexts/AudioPlayerContext\|@/hooks/useStartPodcast\|@/hooks/useAudioPlayer\|@/lib/audioCache\|@/lib/playbackQueue\|@/lib/resolvePlayback\|@/lib/playbackPosition" app components hooks contexts lib | grep -v '^contexts/AudioPlayerContext\.tsx:\|^hooks/useStartPodcast\.ts:\|^hooks/useAudioPlayer\.ts:\|^lib/audioCache\.ts:\|^lib/playbackQueue\.ts:\|^lib/resolvePlayback\.ts:\|^lib/playbackPosition\.ts:'` が 0 件。除外は旧 7 ファイル自身だけ。`tests/` は範囲外）。量化する集合（2026-09-23 実測 12 行。着手時に数え直す）: `app/layout.tsx:6`、`app/(app)/settings/page.tsx:6,17`、`app/(app)/podcast/page.tsx:7,9,10,12`、`app/(app)/podcast/[id]/page.tsx:9,10`、`components/AudioPlayerBar.tsx:5,6`、`contexts/AuthContext.tsx:9`。対象 3〜8 がこの 12 行を全て置き換える。
- `currentPodcast` / `SET_PODCAST` の production 参照が `contexts/AppContext.tsx` の定義（`:14,24,35,43-44`）・`app/globals.css:6`・`components/PodcastCard.tsx:12` のコメント・参照されない旧ファイル `contexts/AudioPlayerContext.tsx:90` だけ（`grep -rn "currentPodcast\|SET_PODCAST" app components hooks contexts lib | grep -v '^contexts/AppContext\.tsx:\|^contexts/AudioPlayerContext\.tsx:\|^app/globals\.css:6:\|^components/PodcastCard\.tsx:12:'` が 0 件。2026-09-24 実測の対象 = `app/(app)/podcast/page.tsx:199`・`components/AudioPlayerBar.tsx:16,28,30,65,66,139,160` の 8 行を対象 4・5 が置き換える）。
- `contexts/PlaybackProvider.tsx` が `@/components` を import しない（0 件）。
- 上表の準拠テストが行 ID をテスト名に含み green。TP2 の T-T18 が green。

## 禁止事項 / scope 外
- 上表以外の挙動を変えない（Queue 操作・表示要素・settings の既定速度保存・localStorage key・Cache 名 `audio-v1`）。
- 旧ファイル・`AppContext.currentPodcast`・`reorderUpNext` を削除・rename しない（W-S2c）。eslint ルールを追加しない（W-S2c）。
- `Episode` の UI 展開（`PodcastCard` の props 分岐。PS-07）は W-S4a。`PreferencesRegistry` は W-S4b。
- 旧新 Provider の併存移行・段階的切替をしない。仕様にない業務条件を足さない。

## 特性テスト（baseline。7 + 6 = 13 ファイル。本 slice での扱いを 3 分類）
| 分類 | ファイル（2026-09-24 実測の行数） | 見込み変更行 |
|---|---|---|
| 不変（8。旧実装のテスト。W-S2c が削除する（許可）） | `tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`（118 / 129 / 146）、`tests/hooks/useAudioPlayer.test.ts`（663）、`tests/lib/audioCache.test.ts`（213）、`tests/lib/playbackQueue.{test,conformance.test}.ts`（122 / 278）、`tests/contexts/AppContext.test.tsx`（238） | 0 |
| 書換（5。mock を `usePlayback()` double へ、oracle は公開 API へ） | `tests/components/AudioPlayerBar.test.tsx`（553）、`tests/app/podcast/page.test.tsx`（389）、`tests/app/podcast/id/page.test.tsx`（840）、`tests/app/app-group-layout.test.tsx`（53）、`tests/app/settings/page.test.tsx`（1,211） | ≈ 60 / 40 / 30 / 5 / 40 |
| 新設（4。baseline 13 本には数えない） | `tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx`（旧 3 本の移植）、`tests/public/sw.prefix.test.ts`（T-T18） | ≈ 400 / 30 |

Spec §6 S2 行の「7 + 5 ファイル」は列挙が 13 本あり数え違い（2026-09-23 点検）。e2e `offline-playback` / `queue-autoadvance` / `main-flow`（不変。PS-06 の assertion 1 箇所を除く）。

## 検証
`npm test`、`npm run test:e2e`（3 本）、上記 grep 3 種、`npm run build`。UV3（resume 再適用・load 後の速度）は e2e（Chromium）で観測し結果を PR 説明に残す。

## 記録
- 完了時、共有仕様 §4.4 PS-01〜PS-08 の web 保留（解除条件 = W-S2b 完了。PS-07 は W-S4a）を解除できる旨を親 docs へ返す。
- UV3 の観測結果と、変更行の表と実装の差があれば `docs/trial-log/` へ。
