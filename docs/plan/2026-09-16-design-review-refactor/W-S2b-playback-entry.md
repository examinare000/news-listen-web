## web リファクタ W-S2b: `PlaybackProvider` への入口差し替え（挙動不変＋確定行のみ変更）

## 概要
W-S2a で新設した `lib/playback/*` を `contexts/PlaybackProvider.tsx` で配線し、`app/layout.tsx` の `AudioPlayerProvider` を置き換える。3 段分割の ②。共有仕様 §2・Q-01〜Q-32 の挙動は**不変**（特性テストと e2e 3 本で判定）。変わる挙動は下の「変更行」に列挙した行だけで、準拠テスト（行 ID をテスト名に含む）で判定する。旧実装の削除は W-S2c で行い、本 slice では削除しない。正本は Implementation Spec §3.1・§5 CP4・§6 S2 行（gate 指摘 1: `AudioPlayerBar` を含める）、親 docs web-design §12.2「現在再生中の正本」「再生状態」「速度 2 概念」、共有仕様 §2.11・§4.3・§4.4・§6.4・§6.6。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 前提・着手条件
- 依存 slice: W-S2a が main に merge 済み（T-T1〜T11 green）。
- baseline green: 下記「特性テスト」12 ファイル＋e2e 3 本。1 つでも red なら着手しない。
- 確定済み Selection Gate（共有仕様 §6.7・ADR-103）: **SG-X1** 完聴時に `duration` を 1 回送る。**SG-X2** 末尾 2 秒窓の resume。**SG-X4** 一時停止中は送らない（web 現行どおり。変更なし）。**SG-X5** 8 段（現行どおり）。
- 棄却済み案（再提案しない）: 旧 `AudioPlayerProvider` と新 `PlaybackProvider` の併存移行（Spec §5。本 slice は 1 PR で入口を切り替える。旧ファイルは未参照のまま残し W-S2c で消す）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規**
1. `contexts/PlaybackProvider.tsx`: React 配線のみ。`lib/platform/*` の adapter と、W-S1 が `contexts/AudioPlayerContext.tsx` に置いた gateway 呼出 4 箇所（`getPodcast` / `updatePosition` / `markCompleted`。`Result` を返す）を生成して Coordinator・Session・OfflineLibrary・PositionReporter に注入する。公開 hook は `usePlayback()` 1 つ（Coordinator の公開操作・`nowPlaying()`・`upNext()`・session 状態・OfflineLibrary）。`components/` を import しない（失敗は `errored(reason)` の状態として公開する）。
2. `tests/public/sw.prefix.test.ts`（T-T18・**TP2**）: `public/sw.js` と `lib/swCacheCleanup.ts` の prefix 集合（`'shell-'`・`'api-'`）の一致を fs 読み比較で pin。owner: user。導入: W-S2b。削除条件: ビルド時注入か SW の module 化。

**変更**
3. `app/layout.tsx`: `AudioPlayerProvider` → `PlaybackProvider`。
4. `components/AudioPlayerBar.tsx`: `useApp().state.currentPodcast` の DTO 直読み（`:16,28-30,65-66,139,160`）を `nowPlaying()` の view model（`episodeId` `title` `difficulty` `createdAt` `durationSeconds`）へ。速度セレクト（`:236-239`）は `SET_SPEED` の dispatch をやめ session 速度 `setSpeed` を呼ぶ（既定速度は書き換えない: PS-08）。失敗文言は session の `errored(reason)` から写像し、`source_unavailable` かつオフラインのときは「オフライン」を含む（§2.11）。
5. `app/(app)/podcast/page.tsx`: `:199` の「再生中」判定を `nowPlaying()?.episodeId === podcast.id` へ。`useStartPodcast` の代わりに `usePlayback().startEpisode` を直接呼ぶ。`isCached` / `downloadAudio` を `OfflineLibrary.has` / Coordinator 経由の取得＋`save` へ。
6. `app/(app)/podcast/[id]/page.tsx`: 5 と同じ置換（`useStartPodcast`・`isCached`・`downloadAudio`）。
7. `app/(app)/settings/page.tsx`: `listCachedEpisodes` / `estimateUsage` / `deleteAudio` / `deleteAllAudio` を `OfflineLibrary.list` / `usage` / `remove` / `clear` へ。既定速度の保存（`useLocalStorage(KEY_DEFAULT_PLAYBACK_SPEED)` と `SET_SPEED` dispatch）は現状維持（W-S4 で registry へ）。
8. `contexts/AuthContext.tsx`: logout の `deleteAllAudio()` を `OfflineLibrary.clear()` へ（同じ Cache 名 `audio-v1`。主体別化は W-S5）。
9. 特性テスト 12 ファイルの移植: oracle を公開 API（`nowPlaying()` / session 状態 / gateway double の呼出列）へ移す。`tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx` は `tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx` として移植し、旧 3 ファイルは残す（W-S2c で削除）。
10. resume の入力合成（Q12=A）: `candidate = server > 0 ? server : local` → 共有仕様の純関数 `resolveResumePosition(candidate, duration)`。合成は Coordinator（W-S2a）の 1 箇所だけに置き、local（`podcast_position:{id}`）の読出は `PlaybackProvider` が `KeyValueStore` adapter を注入して行う。page・hook で合成しない。Spec §3.1 の `(server, local)` 署名はこの合成を指す。

**暫定互換（owner: user）**
- TP-S2b-1 `AppContext.currentPodcast` / `SET_PODCAST`: 本 slice 後は production から読み書きされない（`AppContext.tsx` の定義と `tests/contexts/AppContext.test.tsx` だけが残る）。導入: 既存。削除: W-S2c。
- `AppContext.playbackSpeed` は「既定速度」の置き場として残す（settings が書く。`AudioPlayerBar` は読まない）。W-S4 で `PreferencesRegistry` へ。
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
- production（`app/` `components/` `hooks/` `contexts/`）から `@/contexts/AudioPlayerContext`・`@/hooks/useStartPodcast`・`@/hooks/useAudioPlayer`・`@/lib/audioCache`・`@/lib/playbackQueue`・`@/lib/resolvePlayback`・`@/lib/playbackPosition` の import が **0 件**（grep。除外: 旧ファイル自身と `tests/`）。
- `currentPodcast` の production 参照が `contexts/AppContext.tsx` の定義（`:14,24,44`）と `app/globals.css:6`・`components/PodcastCard.tsx:12` のコメントだけ（grep。それ以外 0 件）。
- `contexts/PlaybackProvider.tsx` が `@/components` を import しない（0 件）。
- 上表の準拠テストが行 ID をテスト名に含み green。TP2 の T-T18 が green。

## 禁止事項 / scope 外
- 上表以外の挙動を変えない（Queue 操作・表示要素・settings の既定速度保存・localStorage key・Cache 名 `audio-v1`）。
- 旧ファイル・`AppContext.currentPodcast`・`reorderUpNext` を削除・rename しない（W-S2c）。eslint ルールを追加しない（W-S2c）。
- `Episode` の UI 展開（`PodcastCard` の props 分岐。PS-07）は W-S4。`PreferencesRegistry` は W-S4。
- 旧新 Provider の併存移行・段階的切替をしない。仕様にない業務条件を足さない。

## 特性テスト（baseline。7 + 5 = 12 ファイル）
`tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`、`tests/hooks/useAudioPlayer.test.ts`、`tests/lib/audioCache.test.ts`、`tests/lib/playbackQueue.{test,conformance.test}.ts`、`tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/app-group-layout.test.tsx`、`tests/contexts/AppContext.test.tsx`、`tests/app/settings/page.test.tsx`。e2e `offline-playback` / `queue-autoadvance` / `main-flow`。

## 検証
`npm test`、`npm run test:e2e`（3 本）、上記 grep 4 種、`npm run build`。UV3（resume 再適用・load 後の速度）は e2e（Chromium）で観測し結果を PR 説明に残す。

## 記録
- 完了時、共有仕様 §4.4 PS-01〜PS-08 の web 保留（解除条件 = W-S2b 完了。PS-07 は W-S4）を解除できる旨を親 docs へ返す。
- UV3 の観測結果と、変更行の表と実装の差があれば `docs/trial-log/` へ。
