## web リファクタ W-S2b: `PlaybackProvider` への入口差し替え（挙動不変＋確定行のみ変更）

## 概要
W-S2a・W-S2a1・W-S2a2 で新設した `lib/playback/*` を `contexts/PlaybackProvider.tsx` で配線し、`app/layout.tsx` の `AudioPlayerProvider` を置き換える。3 段分割の ②。共有仕様 §2・Q-01〜Q-33 の挙動は**不変**（特性テストと e2e 3 本で判定）。変わる挙動は下の「変わる挙動」の表だけで、準拠テスト（行 ID をテスト名に含む）で判定する。旧実装の削除は W-S2c で行い、本 slice では削除しない。

正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（冒頭の追記と §3.1・§5 CP4・§6 S2 行）、W-S2a1・W-S2a2 の order が固定した宣言、親 docs `design/web-design.md` §12.2・§12.6、共有仕様 §2.11・§2.12・§4.3・§4.4・§6.4・§6.6。**検証モード: 再設計しない**。新しい契約 ID は作らない。

> **2026-09-30 の前提点検による書き直し**: 読み取り専用のレビュー役の指摘 B1〜B15（親 docs `research-reports/2026-09-30-wave3-order-premise-check/web.md`）と、user が確定した決定（親 docs 監査レポート §5）を反映した: 一時停止・停止への遷移で位置を 1 回送る（**SG-C53**）、保存は `save(id)`（**SG-C55**）、再生失敗の通知は toast を維持し、出す部品を `components/` 側に置く（**SG-C56**）、音量は新 Provider が持つ（**SG-C57**）、手動で選んだものが開始前に再生できないと分かる場合は状態を変えない（**SG-C62**）、次へ送り（**SG-C63**）。order を書く側が決定から導いた宣言は **W-10〜W-14**（監査レポート §5.0）。再提案しない。

## 規模（見込み。根拠 = 2026-09-30 実測の行数。W-S1b の merge でずれるので着手時に数え直す）
- production ≈ 420 行: `contexts/PlaybackProvider.tsx` 新設 ≈ 220、`components/PlaybackToasts.tsx` 新設 ≈ 60、`components/AudioPlayerBar.tsx`（251 行）≈ 50、`app/(app)/podcast/page.tsx`（235 行）≈ 30、`app/(app)/podcast/[id]/page.tsx`（455 行）≈ 15、`app/(app)/settings/page.tsx`（511 行）≈ 20、`contexts/AuthContext.tsx`（164 行）≈ 6、`app/layout.tsx` ≈ 4。
- test ≈ 800 行: 新設 5 ファイル ≈ 560（`tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx` ≈ 470、`tests/components/PlaybackToasts.test.tsx` ≈ 60、`tests/public/sw.prefix.test.ts` ≈ 30）、書換 8 ファイル ≈ 240。
- 合計 ≈ 1,220 行。入口の切替は 1 PR で行う（旧新 Provider の併存移行は棄却済み。Spec §5）ため分割しない。旧ファイルは未参照のまま残るので、巻き戻しは本 PR の revert だけで済む。

## 前提・着手条件
- 依存 slice: **W-S2a・W-S2a1・W-S2a2・W-S1b・W-0** の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
  - W-S1b を必須にする理由: 本 slice が変える page 2 本（`podcast/page.tsx`・`podcast/[id]/page.tsx`）は `createApiClient` を import しており、W-S1b が `lib/api` の形を変える。先に形を確定させる。
  - W-0 を必須にする理由: 対象 8 と W-0 が同じ `contexts/AuthContext.tsx` の `logout` を編集する。
- baseline green: 下記「特性テスト」19 ファイル＋e2e 3 本。1 つでも red なら着手しない。
- 確定済み Selection Gate（共有仕様 §6.7・ADR-103）: **SG-X1** 完聴時に総時間を 1 回送る。**SG-X2** 末尾 2 秒窓の resume。**SG-X4** 一時停止中は周期送信しない。**SG-X5** 8 段。
- 棄却済み案（再提案しない）: 旧 `AudioPlayerProvider` と新 `PlaybackProvider` の併存移行、再生失敗の表示を再生バーの中へ移す案（SG-C56）、page が保存の前に署名付き URL を取り直す案（SG-C55）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## W-S2a2 の公開面（本 slice が使うもの。実物で確認する）
- `createPlaybackCoordinator(deps)`: 9 操作 `startEpisode(id)` / `retry()` / `addToQueue(podcast)` / `playNext(podcast)` / `removeFromQueue(id)` / `reorder(from, to)` / `skipToNext()` / `nowPlaying()` / `upNext()` と、通知 `subscribe`。`startEpisode`・`addToQueue`・`playNext`・`skipToNext` は `Promise<StartResult>` を返す（`{ ok: true } | { ok: false; notice: 'offline_uncached' | 'not_playable' | 'fetch_failed' }`）。
- `nowPlaying()` の値: `episodeId`・`title`（表示用。`podcastTitle` を通した後の文字列）・`difficulty`・`createdAt`・`durationSeconds` と、トランスクリプト・語彙・クイズ・出典。`upNext()` は `{ id, title }` の配列。
- `createOfflineLibrary(deps)`: `save(id)` / `get(id)` / `has(id)` / `remove(id)` / `clear()` / `list()` / `usage()`。`save` は `Result<void, SaveFailure>` を返す（throw しない）。`clearOfflineAudio(cacheStore)`: Provider の外から Cache を消す関数。
- `createPositionReporter(deps)`・`createPlaybackGatewayFns(gateway)`・`lib/platform/{audioElement,cacheStore,keyValueStore,objectUrl,storageEstimate}.ts` の生成関数。
- Session（W-S2a・W-S2a1）: `state / start / play / pause / seek / seekRelative / setSpeed / setVolume / stop / fail / subscribe`。

## 対象（web サブモジュールのみ）
**新規（production 2 本）**
1. `contexts/PlaybackProvider.tsx`: React の配線だけを持つ。`components/` を import しない。
   - **生成**（クライアントで 1 回だけ。再描画で作り直さない）: `createBrowserAudioElement()` → `createPlaybackSession` → `createPlaybackGatewayFns(useApiClient())` → `createOfflineLibrary` → `createPositionReporter` → `createPlaybackCoordinator`。Reporter の attach と購読の順序は Coordinator が行う（W-S2a2）。Provider は `session.subscribe` と `coordinator.subscribe` で再描画する。
   - **Coordinator へ渡す依存**: `isOnline` は `navigator.onLine`（`navigator` が無ければ true。旧実装と同じ）。`defaultSpeed` は `useApp().state.playbackSpeed` の最新値を返す関数（PS-08。8 段に無い値は Session が 1.0 に丸める）。`keyValueStore` は `lib/platform/keyValueStore.ts` の adapter。
   - **公開 hook は `usePlayback()` 1 つ**。返す値は次の 5 群に固定する。

     | 群 | 値 |
     |---|---|
     | (a) Coordinator | 9 操作をそのまま（増やさない） |
     | (b) Session の状態 | `session`（`PlaybackState`）と、その派生 `isPlaying`（`status === 'playing'`）・`position`（`loading` は `resumePosition`、`playing` / `paused` / `errored` は `position`、`idle` / `ended` は 0）・`duration`（`playing` / `paused` / `ended` は `duration`、ほかは 0）・`speed`（状態が速度を持てばその値、持たなければ既定速度） |
     | (c) Session の操作 | `play` / `pause` / `seek` / `seekRelative` / `setSpeed` / `setVolume` |
     | (d) 音量（SG-C57） | `volume`（0〜1）。初期値は `KEY_PLAYER_VOLUME` を `JSON.parse` した 0〜1 の数値（それ以外は 1.0。旧 `readSavedVolume` と同じ）で、生成の直後に 1 回 `session.setVolume` する。(c) の `setVolume(v)` は、Session への設定・値の更新・`JSON.stringify(v)` での保存を行う |
     | (e) 保存庫と位置 | `offline`（`OfflineLibrary` をそのまま）と `savedPosition(id): number \| null`（`podcastPositionKey(id)` を `JSON.parse` し、有限の正数だけ返す。それ以外は `null`。カードの表示用で、resume の合成には使わない） |
   - Provider は toast を出さない。
2. `components/PlaybackToasts.tsx`（SG-C56。導出 W-13）: 再生の知らせを toast に写す部品。
   - `PlaybackErrorToaster`（描画は `null`）: `usePlayback().session` を見て、**`errored` に入ったときに 1 回** toast（error）を出す。文言は現行の 2 種類: 理由が `media`・`autoplay_blocked` なら「音声を再生できません」、`fetch_failed`・`source_unavailable` なら「再生できませんでした」。`errored` のまま再描画されても出し直さない。
   - `usePlaybackActions()`: `startEpisode` / `addToQueue` / `playNext` / `skipToNext` を包み、戻り値が `{ ok: false }` のとき「再生できませんでした」の toast（error）を出す。page と再生バーは、この 4 操作をこの hook から呼ぶ。

**新規（test 用の固定）**
3. `tests/public/sw.prefix.test.ts`（T-T18・**TP2**）: `public/sw.js` と `lib/swCacheCleanup.ts` の prefix 集合（`'shell-'`・`'api-'`）の一致を fs の読み比べで固定する。owner: user。導入: W-S2b。削除条件: ビルド時注入か SW の module 化。

**変更（production 6 本）**
4. `app/layout.tsx`: `AudioPlayerProvider`（`:7` の import と `:88,94` の要素。2026-09-30 実測）を `PlaybackProvider` に替え、その内側に `<PlaybackErrorToaster />` を置く。Provider の並び順は変えない。
5. `components/AudioPlayerBar.tsx`:
   - `useApp().state.currentPodcast` の直読み（`:16,28,30,65,66,139,160`）を `nowPlaying()` の値へ替える。`nowPlaying()` が `null` なら描画しない。題は `nowPlaying().title` をそのまま出す。
   - `useAudioPlayerContext()`（`:5,18`）を `usePlayback()` と `usePlaybackActions()` へ替える。`currentTime` → `position`、`duration` → `duration`（0 なら `nowPlaying().durationSeconds`）、`upNext` → `upNext()`（題は `title` をそのまま）、`reorderQueue` → `reorder`、`skipToNext` → `usePlaybackActions().skipToNext`。
   - **再生ボタン**（`:32-40`）:

     | `session.status` | 押したとき |
     |---|---|
     | `playing` | `pause()` |
     | `paused` | `play()` |
     | `errored` | `retry()`（再生元の解決からやり直す。PS-02） |
     | `ended` | `usePlaybackActions().startEpisode(nowPlaying().episodeId)`（先頭から。完聴時に位置が総時間で書かれているので、末尾 2 秒窓が 0 に写す） |
     | `loading`・`idle` | 何もしない |
   - **速度**: 既定速度を player へ同期する effect（`:22-26`）を消す。セレクト（`:233-247`）の `value` は `usePlayback().speed`、`onChange` は `setSpeed` を呼ぶ（`SET_SPEED` を dispatch しない。既定速度は書き換えない: PS-08）。`PLAYBACK_SPEEDS` の import（`:6`）を `@/lib/playback/session` へ。
   - 音量（`:223-231`）は `usePlayback().volume` と `setVolume`。
6. `app/(app)/podcast/page.tsx`: `useStartPodcast`（`:9,49,162`）を `usePlaybackActions().startEpisode` へ。`playNextInQueue` / `addToQueue`（`:10,51,195,196`）を `usePlaybackActions()` の `playNext` / `addToQueue` へ。`:199` の「再生中」判定を `nowPlaying()?.episodeId === podcast.id` へ。`isCached`（`:12,128`）を `offline.has(id)` へ。`downloadAudio`（`:143`）を `offline.save(podcast.id)` へ替え、戻り値が `{ ok: false }` なら現行と同じ toast「オフライン保存に失敗しました」を出す（現行は throw を catch している。`:146`）。`getSavedPosition`（`:7,189`）を `savedPosition(podcast.id)` へ（`null` は現行の 0 と同じ扱い = 表示しない）。
7. `app/(app)/podcast/[id]/page.tsx`: 6 と同じ置換（`useStartPodcast` `:9,40,76`・`isCached` `:10,85`・`downloadAudio` `:93,96`）。
8. `app/(app)/settings/page.tsx`: `listCachedEpisodes` / `estimateUsage` / `deleteAudio` / `deleteAllAudio`（`:17,125,135,140`）を `usePlayback().offline` の `list` / `usage` / `remove` / `clear` へ。型 `CachedEpisodeMeta`・`StorageEstimate` の import を `@/lib/playback/offlineLibrary` へ。`PLAYBACK_SPEEDS` の import（`:6`）を `@/lib/playback/session` へ。既定速度の保存（`SET_SPEED` の dispatch `:352`）は現状維持（W-S4b で登録簿へ）。
9. `contexts/AuthContext.tsx`: logout の `deleteAllAudio()`（`:9` の import と `:124` の呼出）を `clearOfflineAudio(createBrowserCacheStore())`（W-S2a2。導出 W-10）へ替える。`Promise.all` の形と、失敗しても logout が完了する扱いは変えない。`usePlayback()` に依存しない（`AuthProvider` は `PlaybackProvider` の外側にある）。

**resume の入力合成**（Q12=A）は Coordinator（W-S2a2）の 1 箇所だけにある。page・hook・Provider で合成しない。

**暫定互換（owner: user）**
- TP-S2b-1 `AppContext.currentPodcast` / `SET_PODCAST`: 本 slice の後は、参照されない旧ファイルを除いて production から読み書きされない。導入: 既存。削除: W-S2c。
- `AppContext.playbackSpeed` は「既定速度」の置き場として残す（settings が書き、`PlaybackProvider` が読む。`AudioPlayerBar` は読まない）。W-S4b で `PreferencesRegistry` へ。
- `hooks/useStartPodcast.ts`・`contexts/AudioPlayerContext.tsx`・`hooks/useAudioPlayer.ts`・`lib/{playbackQueue,audioCache,resolvePlayback,playbackPosition}.ts`: 未参照のまま残す。削除: W-S2c。

## 変わる挙動（これ以外の挙動変更は禁止）
| 行 ID | 変わる挙動 | 現行 | 判定 |
|---|---|---|---|
| PS-01 / PS-02 / PS-03 | 自動で次へ進んだ先が再生できないと、そこで止まる（`errored`）。失敗したエピソードが現在のまま残り、再生ボタンが再試行になる。toast「再生できませんでした」は現行どおり 1 回出る | toast だけで、状態は「終了」のまま。再生ボタンは終わったエピソードを鳴らす | `PlaybackProvider.completion.test.tsx`・`PlaybackToasts.test.tsx` |
| PS-04 | INV-P1（全操作の後、セッションが `idle` でないとき `session.episode.id === Queue.current.id`） | 2 つの正本（キューと `currentPodcast`）を UI が合成 | `PlaybackProvider.queue.test.tsx` |
| PS-06（SG-X1） | 完聴時に server へ書く位置が 0 → **総時間**。順序 = 完聴の記録 → 総時間の位置 1 回。次の開始は応答を待たない | 完聴の記録 → 位置 0 | 同上 |
| PS-08 | エピソードの開始ごとに、速度を既定速度に戻す。再生バーの速度変更は既定速度を書き換えない | バーの変更が `SET_SPEED` で既定速度を書き換え、次のエピソードへ持ち越す | `AudioPlayerBar.test.tsx`・`PlaybackProvider.queue.test.tsx` |
| RS-03 / RS-04 / RS-05（SG-X2） | 合成した候補が「総時間 − 2」以上なら先頭から | server の位置をそのまま使う | W-S2a の `resume.test.ts` ＋ `PlaybackProvider.offline.test.tsx` |
| —（SG-C53） | 一時停止したとき・別のエピソードへ切り替えたときに、位置を 1 回（local と server へ）書く。同じ再生の中で、書いた値より小さい位置（巻き戻し）は server へ送らない | 周期（10 秒進むごと）だけ。巻き戻した位置も周期で送る | `PlaybackProvider.completion.test.tsx` |
| —（SG-C63） | 「次へ」で、次が再生できないと分かったら、キューも再生も変えずに toast を出す | キューを先に進めてから取得し、失敗すると進んだまま残る | `PlaybackProvider.queue.test.tsx` |
| —（導出 W-14） | 聴き終えた後に再生ボタンを押すと、再生元の解決からやり直して先頭から始まる | 読み込み済みの音源を先頭から再生する（取得しない） | `AudioPlayerBar.test.tsx` |

**不変として固定する行**: PS-05（`idle`・`errored` では位置を送らない。現行も送る契機が無い。`PlaybackProvider.completion.test.tsx` で行 ID 付きで固定する）、PS-05b（一時停止中は周期送信しない。SG-X4）、RS-01 / RS-02 / RS-06 / RS-07、server が 0 のとき local の位置へ戻る合成、Q-01〜Q-33、§2.3〜§2.10 の操作、手動の開始が再生できないときに何も変えず toast だけ出すこと（SG-C62。現行と同じ）、toast の文言 2 種類と `role="alert"`、`AudioPlayerBar` の表示要素と題の切り詰め（50 字・待機列 40 字）、音量の保存形式と初期値、settings のオフライン一覧・削除、オフライン保存の失敗の toast、logout で音声キャッシュが消えること、e2e 3 本。OS やブラウザが外から再生を止めた場合に状態へ反映しないのも現行と同じ（`AudioElement` は `pause` の事象を持たない）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e `offline-playback` / `queue-autoadvance` / `main-flow` が**手順・assertion とも無変更で** green（e2e に位置同期の assertion は無い。2026-09-30 実測: `grep -n "/position\|PATCH\|/completed" e2e/*.ts` は 0 件）。
- `app/layout.tsx` に `AudioPlayerProvider` が無く、`PlaybackProvider` と `PlaybackErrorToaster` がある。
- production から旧 7 モジュールの import が **0 件**: `grep -rn "@/contexts/AudioPlayerContext\|@/hooks/useStartPodcast\|@/hooks/useAudioPlayer\|@/lib/audioCache\|@/lib/playbackQueue\|@/lib/resolvePlayback\|@/lib/playbackPosition" app components hooks contexts lib | grep -v '^contexts/AudioPlayerContext\.tsx:\|^hooks/useStartPodcast\.ts:\|^hooks/useAudioPlayer\.ts:\|^lib/audioCache\.ts:\|^lib/playbackQueue\.ts:\|^lib/resolvePlayback\.ts:\|^lib/playbackPosition\.ts:'` が 0 件（除外は旧 7 ファイル自身だけ。2026-09-30 実測 12 行: `app/layout.tsx:7`、`app/(app)/settings/page.tsx:6,17`、`app/(app)/podcast/page.tsx:7,9,10,12`、`app/(app)/podcast/[id]/page.tsx:9,10`、`components/AudioPlayerBar.tsx:5,6`、`contexts/AuthContext.tsx:9`。対象 4〜9 がこの 12 行を全て置き換える）。
- `currentPodcast` / `SET_PODCAST` の production 参照が定義と旧ファイルだけ: `grep -rn "currentPodcast\|SET_PODCAST" app components hooks contexts lib | grep -v '^contexts/AppContext\.tsx:\|^contexts/AudioPlayerContext\.tsx:\|^app/globals\.css:6:\|^components/PodcastCard\.tsx:12:'` が 0 件（2026-09-30 実測 8 行: `app/(app)/podcast/page.tsx:199`・`components/AudioPlayerBar.tsx:16,28,30,65,66,139,160`）。
- Provider が `components/` を import しない: `test -f contexts/PlaybackProvider.tsx && grep -c "@/components" contexts/PlaybackProvider.tsx` が 0（`test -f` を付ける。ファイルが無いと grep が 0 件で通ってしまう）。
- toast を出すのは `components/PlaybackToasts.tsx` と page だけ: `grep -rn "showToast\|useToast" contexts/PlaybackProvider.tsx lib/playback lib/platform` が 0 件。
- 上表の準拠テストが行 ID をテスト名に含み green。TP2 の T-T18 が green。

## 禁止事項 / scope 外
- 上表以外の挙動を変えない（Queue 操作・表示要素・settings の既定速度保存・localStorage の key と値の形式・Cache 名 `audio-v1`）。
- `lib/playback/*`・`lib/platform/*` を変えない（不足が見つかったら、実装を止めて報告する）。
- 旧ファイル・`AppContext.currentPodcast`・`reorderUpNext` を削除・rename しない（W-S2c）。eslint ルールを追加しない（W-S2c）。
- `Episode` の UI 展開（`PodcastCard` の props 分岐。PS-07）は W-S4a。`PreferencesRegistry` は W-S4b。主体別のキャッシュ名と `stopForSubjectLeave` は W-S5。
- タブを閉じる・隠すときの位置の送信を入れない（共有仕様 §6.4 の web の保留）。
- 再生失敗の表示を再生バーの中へ移さない。toast の文言を変えない・増やさない（SG-C56）。
- 旧新 Provider の併存移行・段階的切替をしない。仕様にない業務条件を足さない。

## 特性テスト（baseline。19 ファイル。2026-09-30 実測: `grep -rln "@/contexts/AudioPlayerContext\|@/hooks/useStartPodcast\|@/hooks/useAudioPlayer\|@/lib/audioCache\|@/lib/playbackQueue\|@/lib/resolvePlayback\|@/lib/playbackPosition\|AudioPlayerProvider\|useAudioPlayerContext" tests`）
| 分類 | ファイル（行数） | 扱い |
|---|---|---|
| 不変（11。旧実装のテスト。W-S2c が削除する） | `tests/contexts/AudioPlayerContext.{queue,offline,completion,gateway}.test.tsx`（214 / 112 / 143 / 84）、`tests/hooks/useAudioPlayer.test.ts`（663）、`tests/lib/audioCache.test.ts`（210）、`tests/lib/playbackQueue.{test,conformance.test}.ts`（122 / 278）、`tests/lib/playbackPosition.test.ts`（42）、`tests/lib/resolvePlayback.test.ts`（28）、`tests/contexts/AppContext.test.tsx`（238） | 1 行も変えない。旧ファイルが残るので green のまま |
| 書換（8） | `tests/components/AudioPlayerBar.test.tsx`（564）、`tests/app/podcast/page.test.tsx`（402）、`tests/app/podcast/id/page.test.tsx`（854）、`tests/app/app-group-layout.test.tsx`（56）、`tests/app/settings/page.test.tsx`（1,211）、`tests/contexts/AuthContext.test.tsx`（197）、`tests/contexts/AuthContext.push.test.tsx`（218）、`tests/contexts/AuthContext.expiry.test.tsx`（176） | mock を `usePlayback()` の double へ替え、oracle を公開 API へ移す。期待値を変えてよいのは「変わる挙動」に当たる行だけ。AuthContext の 3 本は `vi.mock('@/lib/audioCache', …)` を `vi.mock('@/lib/playback/offlineLibrary', …)`（`clearOfflineAudio` の double）へ替える（`AuthContext.test.tsx:26-29,72,127,148`・`AuthContext.push.test.tsx:27-30,98,143`。`expiry` はコメント `:11` だけ）。「消去が失敗しても logout が完了する」ケース（`AuthContext.test.tsx:148`）は保つ |
| 新設（5。baseline に数えない） | `tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx`（旧 3 本と同じ観点を新 Provider に対して書く）、`tests/components/PlaybackToasts.test.tsx`、`tests/public/sw.prefix.test.ts` | — |

新設のテストで固定するもの（旧 3 本の観点に加えて）: toast が `errored` に入ったとき 1 回だけ出て、`role="alert"` であること（旧 `AudioPlayerContext.queue.test.tsx:151,169,210`・`AudioPlayerBar.test.tsx:130-140` と同じ観測）。`usePlaybackActions()` が `{ ok: false }` で toast を出すこと。音量の初期値が保存値になること（旧 `AudioPlayerBar.test.tsx:214` の観点）。再生ボタンの 6 状態の表。`AudioPlayerBar.test.tsx:130-140` の「音声要素の error で toast」のテストは、toast を出す部品が変わるので `PlaybackToasts.test.tsx` へ移す（観測と文言は同じ。`AudioPlayerBar.test.tsx` からは消してよい）。

## 検証
`npm test`、`npm run test:e2e`（3 本）、上記 grep 4 種、`npm run build`。UV3（resume の再適用・読み込み後の速度・toast の表示）は e2e（Chromium）で観測し、結果を PR 説明に残す。

## 記録
- 完了時、共有仕様 §4.4 の PS-01〜PS-08 の web の保留（解除条件 = W-S2b の完了。PS-07 は W-S4a）と、§6.4 の web の保留のうち「一時停止・停止への遷移時の即時 1 回」を解除できる旨を親 docs へ返す。
- 共有仕様 §2.11 の「オフライン起因は『オフライン』と分かる文言にする」は、web では満たさないまま残る（SG-C56 が文言を現行の 2 種類と決めた）。親 docs へ返す（保留として記載する）。
- UV3 の観測結果と、表と実装の差があれば `docs/trial-log/` へ。
