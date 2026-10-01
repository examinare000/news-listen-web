## web リファクタ W-S2a2: 再生の use case（Coordinator・PositionReporter）と adapter（保存庫・位置・gateway）— 新規コードのみ・既存コードから呼ばない

> **2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正**（新 Spec = `docs/design/2026-09-30-implementation-spec-target-architecture.md`。§8.3 W-S2a2 の 10 項目を本文へ反映した）
> - (1) 置き場: `coordinator.ts`・`positionReporter.ts` → `lib/playback/application/`。`offlineLibrary.ts`・`gatewayFns.ts` → `lib/playback/infrastructure/`。
> - (2) `decodeEpisode`・`isPlayable`・`GeneratingEpisode`・`FailedEpisode` を作らない（W-T2 が `lib/catalog` に置く）。CI-T11 の 16 行を外した（W-T2 が持つ）。依存に **W-T2** を足した。
> - (3) 取得は port `EpisodeSource`（`Result<Episode, ApiFailure>`。W-T2 の `episodeGateway.ts`）で受ける。`gatewayFns.ts` は `updatePosition`・`markCompleted` の 2 関数（`Result<void, ApiFailure>`）。
> - (4) `OfflineLibrary` を port（application）と実装（infrastructure）に分け、`get(id)` は `PlayableEpisode` を返す（W-19。W-1 を改める）。永続 record の型は `offlineRecord.ts`。
> - (5) `keyValueStore` の依存と `JSON.stringify` / `JSON.parse` を port `LocalPositionStore` に替えた（key と形式は不変。W-20）。
> - (6) `addToQueue`・`playNext` の入力を `QueueEntryInput` に。キューの要素は `QueuedEpisode`（W-22・W-17）。
> - (7) `readModels.ts` に 6 型。`nowPlaying()` は 5 field（トランスクリプト・語彙・クイズ・出典を外した）。`queueView()`・`playbackView()`・`savedPosition()` を query に足した。`PlaybackCommands` と `PlaybackQueries` を別の型で export（W-21）。
> - (8) 契約の表に PS-11・PS-12・PS-12b・PS-12c・PS-13 の行 ID を足した。
> - (9) TA-V6（リードモデル）・TA-V7 のテストを足した。
> - (10) 完了条件の grep を TA-V1〜V3 に替え、「W-S2a / W-S2a1 のファイルに差分が無い」の path を `domain/` に直した。
> - 規模: 補正で ≈ 1,180 行 → ≈ 1,550 行に増える。新 Spec §8 は分割を指定していない（§11 は「order を書くときに決める」）ので、1 本のままとし、増分と分けない理由を「規模」に書いた。

## 概要
W-S2a（Session・Queue・source・resume）・W-S2a1（`fail`）・W-T1（層の骨格と不変性）・W-T2（Catalog の `Episode`・`EpisodeSource` の実装）の上に、再生の use case（Coordinator・PositionReporter）と、その port の adapter（保存庫・端末の位置・位置と完聴の送信）と、再生のリードモデル 6 つを置く。3 段分割 ① の後半。**既存コードのどこからも新モジュールを呼ばず**、旧再生実装は 1 行も変えない。入口の差し替えは W-S2b。正本は新 Spec §5.1（TA-M-PB・TA-C-PB・TA-Q-PB・TA-R-PB・port の表・整合性と失敗）・§8.2・§8.3 W-S2a2 行・§10.1 W-17〜W-22・W-26・W-27、既存 Spec §3.1・§4 CI-T5〜T8・T10・§5 CP3〜CP4・CP9、共有仕様 §2.11・§2.12・§4.4・§6.4。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-POD-06・F-POD-08・F-POD-10（PRD §5）、NFR-09 (2)(3)・NFR-10、AQ-2・AQ-4・AQ-6、UC-P1〜UC-P6、CI-T5〜T8・T10、PS-01〜PS-06・PS-08（domain と application の分）・PS-11・PS-12・PS-12b・PS-12c・PS-13、TA-R-PB-4〜7・9・10、TA-V1〜V3・TA-V6・TA-V7、決定 SG-C52〜C55・C61〜C63・C67・C73・SG-X1・X2・X4、導出 W-2〜W-8・W-10〜W-12・W-15・W-17〜W-22・W-26・W-27。

## 種別
適用 slice。判断待ちに依存しない。

> **2026-09-30 の前提点検（W-S2a 完了後）による書き直し**（経緯として残す）: 取得前・開始前の失敗は Session の `fail`（**SG-C52**）、手動で選んだものが開始前に再生できないと分かる場合は状態を変えない（**SG-C62**）、完聴時の順序は送信を始める順（**SG-C61**）、総時間の優先順（**SG-C54**）、一時停止・停止への遷移で位置を 1 回送る（**SG-C53**）、保存は `save(id)`（**SG-C55**）、「次へ送り」の規則（**SG-C63**）、巻き戻した位置も書く（**SG-C67**）、利用者の開始を自動より優先する（**SG-C73**）。点検の記録は親 docs `research-reports/2026-09-30-wave3-order-premise-check.md`（web A1〜A10）。再提案しない。

## 規模（見込み。根拠 = 2026-09-30 実測: 旧 `lib/audioCache.ts` 155 行、`contexts/AudioPlayerContext.tsx` の gateway 呼出 3 箇所 `:61,72,121`。2026-10-01 の補正で増分を足した）
- production ≈ 720 行（新規のみ）: `application/coordinator.ts` ≈ 250、`application/positionReporter.ts` ≈ 110、`application/readModels.ts` ≈ 90（6 型と生成関数）、`application/ports.ts` ≈ 40（`EpisodeSource` は W-T2 が置いた）、`infrastructure/offlineLibrary.ts` ≈ 150、`infrastructure/offlineRecord.ts` ≈ 40、`infrastructure/localPositionStore.ts` ≈ 25、`infrastructure/gatewayFns.ts` ≈ 25、`lib/platform/objectUrl.ts` ≈ 10、`lib/platform/storageEstimate.ts` ≈ 10。
- test ≈ 830 行: `coordinator.test.ts` ≈ 320、`positionReporter.test.ts` ≈ 140、`offlineLibrary.test.ts` ≈ 140、`localPositionStore.test.ts` ≈ 40、`gatewayFns.test.ts` ≈ 30、`readModels.test.ts` ≈ 60、`tests/architecture/immutability.playback.test.ts` への追加 ≈ 40、`tests/architecture/cqrs.playback.test.ts` ≈ 60。
- 合計 ≈ 1,550 行（補正前 ≈ 1,180 行。増分 ≈ 370 = port と実装の分離・リードモデル・TA-V6/V7。減分 = `decodeEpisode` と CI-T11 の 16 行を W-T2 へ）。1,000 行を超えるが分割しない。理由: (a) Coordinator は保存庫・Reporter・位置の port の全部を依存に取り、揃わないと契約テスト（PS-01〜PS-06・PS-11〜PS-13）を書けない。(b) 保存庫（infrastructure）だけを先に出すと、その port の型（application）を決める側が無く、W-19 の `get → PlayableEpisode` を 2 回に分けて固定することになる。(c) すべて新規ファイルで既存の挙動は変わらず、revert は 1 PR で済む。レビューは層ごと（application 4 → infrastructure 4 → platform 2）に読む。

## 前提・着手条件
- 依存 slice: **W-S2a**（PR #146）・**W-T1**・**W-S2a1**・**W-T2** の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b とは対象ファイルが重ならない。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み Selection Gate: **SG-X1** 完聴時に総時間を 1 回送る。**SG-X4** 一時停止中は周期送信しない。**SG-X2** は `resolveResumePosition` を Coordinator が呼ぶ。上の 2026-09-30 の決定と、2026-10-01 の導出 W-17〜W-22・W-26・W-27。
- 棄却済み案（再提案しない。既存 Spec §5）: `Clock` port、汎用 Storage port（`LocalPositionStore` は目的別の port で、汎用ではない: W-20）、旧新 Provider の併存移行。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（投入の直前に数え直す。W-T1・W-S2a1・W-T2 の実物から写す）
| 項目 | 期待 | 数え直す手順 |
|---|---|---|
| Session の公開面 | `state / start / play / pause / seek / seekRelative / setSpeed / setVolume / stop / fail / subscribe`（W-S2a1）。完聴時は `listenCompleted` → `stateChanged(ended)` の順 | `grep -n "^  [a-zA-Z]*(" lib/playback/domain/session.ts` |
| Queue の公開面 | 11 操作。`QueueState<T extends { readonly id: string }>`（W-T1） | `grep -n "^export function\|^export const\|QueueState<" lib/playback/domain/queue.ts` |
| Catalog の公開面 | `PlayableEpisode`・`QueuedEpisode`・`queuedEpisode(...)`・`displayTitle(label, n)`・`isPlayableEpisode`（W-T2・W-S2a1） | `grep -n "^export" lib/catalog/domain/episode.ts lib/playback/domain/session.ts` |
| `EpisodeSource` | `lib/playback/application/ports.ts`（W-T2 が置いた）。実装 `lib/catalog/infrastructure/episodeGateway.ts` | `grep -n "EpisodeSource" lib/playback/application/ports.ts lib/catalog/infrastructure/episodeGateway.ts` |
| 技術 seam | `CacheStore`・`CacheBucket`・`CacheWriteFailure` は `lib/platform/cacheStore.ts`、`KeyValueStore` は `lib/platform/keyValueStore.ts`（W-T1） | `grep -n "^export" lib/platform/*.ts` |
| gateway の呼出（旧） | `contexts/AudioPlayerContext.tsx:61`（`PATCH /api/backend/podcasts/{id}/position`）・`:72`（`POST …/completed`）・`:121`（`GET …/{id}`） | `grep -n "gateway\.\|request(" contexts/AudioPlayerContext.tsx` |
| 位置の保存形式 | key `podcast_position:{id}`（`lib/config.ts` の `podcastPositionKey`）、値は `JSON.stringify(seconds)`（`hooks/useAudioPlayer.ts:60,71`） | `grep -n "podcastPositionKey\|podcast_position" lib/config.ts hooks/useAudioPlayer.ts` |
| 保存庫の entry | Cache `audio-v1`、key `/_audio/{id}`・`/_audio-meta/{id}`・`/_audio-podcast/{id}`（`lib/audioCache.ts:93-99`） | `grep -n "_audio" lib/audioCache.ts` |
| 許可リスト | 行数を記録する（本 slice は増やさない。新規コードは違反 0） | `node -e "console.log(require('./architecture/boundaries.allowlist.json').length)"` |

## 対象（web サブモジュールのみ。すべて新規）
**application（`lib/playback/application/`）**
1. `ports.ts`（W-T2 の `EpisodeSource` に足す）: `PositionSync`（`updatePosition(id, seconds) → Promise<Result<void, ApiFailure>>`・`markCompleted(id) → Promise<Result<void, ApiFailure>>`）、`OfflineLibrary`（`save(id) → Promise<Result<void, SaveFailure>>`・`get(id) → Promise<PlayableEpisode | null>`（`audioHandle` 付き）・`has(id)`・`remove(id)`・`clear()`・`list() → Promise<ReadonlyArray<OfflineEpisodeView>>`・`usage() → Promise<StorageUsageView | null>`）、`LocalPositionStore`（`read(id) → number | null`・`write(id, seconds) → void`。`clearAll() → void` は W-S5 が足す: 対象 8）、`Connectivity`（`() => boolean`）・`DefaultSpeedSource`（`() => PlaybackSpeed`）。`SaveFailure`（`{ kind: 'unsupported' } | { kind: 'storage_full' } | { kind: 'download_failed'; failure: ApiFailure }`）・`QueueEntryInput`（`{ id: string; title: string | null; intro: string }`）・`StartResult`（`{ ok: true } | { ok: false; notice: 'offline_uncached' | 'not_playable' | 'fetch_failed' }`）もここに置く。引数と戻り値は application か domain の型だけ（architecture.md §4.2）。
2. `readModels.ts`（新 Spec §5.1「リードモデルの形」。全部 `readonly`・凍結済み・domain の object と DTO と関数を含まない）: `NowPlaying`（`episodeId`・`title`（`displayTitle(label, 50)`）・`difficulty`・`createdAt`・`durationSeconds` の 5 field。トランスクリプト・語彙・クイズ・出典を持たない: W-12・W-36）、`UpNextItem`（`id`・`title`（`displayTitle(label, 40)`））、`QueueView`（`nowPlaying`・`upNext`・`canSkipNext`）、`PlaybackView`（`status`・`position`・`duration`・`speed`・`primaryAction`・`failure`。導出の式は下の表）、`OfflineEpisodeView`（`episodeId`・`title`・`durationSeconds`・`sizeBytes`・`savedAt`）、`StorageUsageView`（`usage`・`quota`）。それぞれ生成関数を置き、呼ぶたびに新しい凍結済みの値を返す。

   | `PlaybackView` の field | 導出（W-S2b の旧 (b) 群の式を application へ置き直した: TA-Q-PB-4） |
   |---|---|
   | `position` | `loading` は `resumePosition`、`playing` / `paused` / `errored` は `position`、`idle` / `ended` は 0 |
   | `duration` | `playing` / `paused` / `ended` は状態の `duration`。それが 0 のとき、またはほかの状態では `NowPlaying.durationSeconds`（無ければ 0）（TA-R-PB-9・SG-C54） |
   | `speed` | 状態が速度を持てばその値、持たなければ `DefaultSpeedSource()` |
   | `primaryAction` | `playing` → `pause`、`paused` → `play`、`errored` → `retry`、`ended` → `replay`、ほか → `none`（W-14・TA-R-PB-8） |
   | `failure` | `errored` の理由が `media`・`autoplay_blocked` → `media`、`fetch_failed`・`source_unavailable` → `unavailable`、ほか → `null` |
3. `positionReporter.ts`（CP9・TA-R-PB-6）: `createPositionReporter({ sync: PositionSync, local: LocalPositionStore })`。公開操作は `attach(session)` / `detach()` / `lastSyncFailure(): ApiFailure | null`。規則（W-6）:
   - **エピソードごとの基準**: `stateChanged(loading)` で基準を戻す（最後に保存した位置 = `resumePosition`、完聴の送信済みの印を倒す）。
   - **周期**: 状態が `playing` のときの `positionChanged` で、最後に保存した位置から 10 秒以上進んだら `local.write` と `sync.updatePosition`。`paused` での `seek` による `positionChanged` では書かない（SG-X4・PS-05b）。
   - **一時停止・停止への遷移**（SG-C53）: `playing` → `paused`、`playing` / `paused` → `idle` で、最後に分かっている位置を 1 回書く。最後に保存した位置と同じなら書かない。巻き戻した位置もここで書かれる（SG-C67。周期の条件「進んだら」は変えない）。記録時刻の付与と後送り（ADR-109）は入れない（W-T14）。
   - **完聴**（SG-X1・SG-C61・PS-06・W-27）: `listenCompleted` で `sync.markCompleted(id)` → `local.write(id, 0)` → `sync.updatePosition(id, 総時間)` の順に**送り始める**。応答は待たない。同じ再生の中で 2 回目以降は無視する。完聴の記録は backend の first-write-wins に依存する（CI-A12。コメントとテストに書く）。
   - **総時間**（SG-C54）: 直前の状態の `duration` > 0 ならそれ、そうでなければ `episode.durationSeconds` > 0、どちらも無ければ最後に分かっている位置 > 0。すべて 0 なら server への位置の書込を省く。
   - **送らない状態**（PS-05）: `errored` / `idle` では周期の書込をしない。
   - `Result` の `ok: false` は握りつぶさず `lastSyncFailure()` で読める。再送しない（ADR-109 の slice まで）。
4. `coordinator.ts`（CP4・TA-R-PB-5・7・9）: `createPlaybackCoordinator(deps)`。`deps`（W-5 を W-18・W-20 で改めた）= `session`・`offline: OfflineLibrary`・`positionReporter`・`episodes: EpisodeSource`・`localPositions: LocalPositionStore`・`isOnline: Connectivity`・`defaultSpeed: DefaultSpeedSource`。生成時に `positionReporter.attach(session)` を呼び、**その後で**自分が `session.subscribe` する（完聴時に Reporter が先に事象を受ける）。キューは `QueueState<QueuedEpisode>`。
   - 戻り値は `PlaybackCommands & PlaybackQueries & { subscribe }`。型 `PlaybackCommands`（command 7: `startEpisode`・`retry`・`addToQueue`・`playNext`・`removeFromQueue`・`reorder`・`skipToNext`。TA-C-PB-1〜7）と `PlaybackQueries`（query 5: `nowPlaying`・`upNext`・`queueView`・`playbackView`・`savedPosition`。TA-Q-PB-1〜5）を別の型で export する（W-21）。読み取り側の通知 `subscribe(listener) → 解除関数` はどちらにも数えない（W-5）。`play`・`pause`・`seek`・`seekRelative`・`setSpeed`・`setVolume`（TA-C-PB-8）と `offline.*`（TA-C-PB-10・TA-Q-PB-6）は Provider が Session・保存庫から直接配る（W-S2b）。`stopForSubjectLeave`（TA-C-PB-9）は W-S5。
   - **`startEpisode(id) → Promise<StartResult>`**（W-8）: (1) `source = resolvePlaybackSource({ hasCached: await offline.has(id), isOnline: isOnline() })`。(2) `unavailable` なら、キューもセッションも変えず `{ ok: false, notice: 'offline_uncached' }`（SG-C62・PS-11）。(3) `cached` なら `offline.get(id)`、`network` なら `episodes.fetch(id)`。取得に失敗したら、キューもセッションも変えず `{ ok: false, notice: 'fetch_failed' }`（W-26・PS-11）。(4) `Episode` が `PlayableEpisode` でなければ、キューもセッションも変えず `{ ok: false, notice: 'not_playable' }`。(5) 再生可能なら、キューを整える（`jump` 済みならそのまま、無ければ `playNext` → `jump`。要素は `queuedEpisode({ id, title, intro })` で作る）→ `candidate = server > 0 ? server : local`（`server` は `episode.serverPositionSeconds`、`local` は `localPositions.read(id)`。合成はこの 1 箇所: SG-B5・TA-R-PB-5）→ `resume = resolveResumePosition(candidate, episode.durationSeconds)` → `session.start(episode, resume, defaultSpeed())`（PS-08）→ `{ ok: true }`。(6) await の後は、その間に別の開始が始まっていないかを確かめる（後から始めた方を優先。古い方は何も変えず `{ ok: true }`）。**利用者の開始を自動より優先する**（SG-C73・W-15・PS-13）: 利用者の開始（`startEpisode`・`retry`・`skipToNext`・`addToQueue` / `playNext` の即再生）の待ちが残っている間、`onEnded` は次へ進む処理を始めない。`onEnded` の待ちの間に利用者の開始が来たら、`onEnded` の側を捨てる。
   - **`onEnded`**（`stateChanged(ended)` で動く）: `advance` → 次があれば再生元を解決して開始する。この経路ではキューが既に次を現在にしているので、再生できない・取得に失敗した場合は `session.fail({ id }, reason)`（SG-C52・PS-01・PS-03。`offline_uncached` と `not_playable` は `source_unavailable`、取得失敗は `fetch_failed`）。次が無ければ何もしない。応答を待ってから進まない（SG-C61）。
   - **`retry()`**: 状態が `errored` のとき、`current(queue)` の id で再生元の解決からやり直す（PS-02）。失敗は `onEnded` と同じく `fail`。`errored` 以外では何もしない。
   - **`skipToNext()`**（SG-C63・共有仕様 §2.12）: 次があれば次の再生元を**先に**解決し、再生できると分かったら `advance` して開始する（PS-12。今のエピソードは Session の `start` が止め、Reporter が一時停止への遷移で位置を 1 回送る。完聴は送らない）。再生できないと分かったら、キューもセッションも変えず通知を返す（PS-12b）。次が無ければ何もしない（PS-12c）。戻り値は `StartResult`。
   - `addToQueue(input: QueueEntryInput)` / `playNext(input)`（W-22）: `queuedEpisode(input)` で作った値をキューに入れる（呼んだ側の object を保持しない: TA-D10）。何も再生していなければ `startEpisode` と同じ手順で開始する。戻り値は `Promise<StartResult>`（開始を試みなかったら `{ ok: true }`。キューに足したことは開始できなくても残る: W-11）。`removeFromQueue` / `reorder`: `remove` / `moveUpNext`。
   - query: `nowPlaying()`（`current(queue)` の `label` と `session` の episode から `NowPlaying`。何も無ければ `null`）・`upNext()`・`queueView()`・`playbackView()`・`savedPosition(id)`（`localPositions.read(id)` を返すだけ。表示用で、resume の合成には使わない）。どれも状態を変えず、書き込む port を呼ばない。
**infrastructure（`lib/playback/infrastructure/`）**
5. `gatewayFns.ts`（W-4・W-23）: `createPositionSync(gateway: ApiGateway): PositionSync`。2 関数の path・method・body は旧 `contexts/AudioPlayerContext.tsx:61`（`PATCH /api/backend/podcasts/{id}/position`）・`:72`（`POST /api/backend/podcasts/{id}/completed`）と同じ。応答の DTO は捨てる（`Result<void>`）。W-S4d1 の後は `lib/api/podcasts.ts` の関数を呼ぶ形に寄せる（W-S4d1 の補正 (4)）。
6. `offlineRecord.ts`: 永続 record の型（meta と episode の entry の JSON の形。現行と同じ形で、旧実装が書いた entry を読める）と、record ⇄ `PlayableEpisode` の変換（`@/types` を import しない。`Episode` の生成は `lib/catalog/domain/episode.ts` の生成関数を通す）。
7. `offlineLibrary.ts`（CP3・TA-R-PB-10）: `createOfflineLibrary({ cacheStore: CacheStore | null, episodes: EpisodeSource, objectUrl, estimate }): OfflineLibrary`。`Response` と JSON を扱ってよいのはこのファイルと `offlineRecord.ts`。
   - `save(id)`（SG-C55）: `episodes.fetch(id)` で新しい署名付き URL を取り直す → `cacheStore.putFromUrl` で音声 → meta → episode の順に書く。episode の entry は音源の URL を空にして書く。重複 save は収束する。`fetch` の失敗と `putFromUrl` の `download_failed` は `download_failed` に写す。
   - `get(id)`（W-19）: 保存済みなら、record を `PlayableEpisode` に変換し、blob URL と、その URL を revoke する `audioHandle` を付けて返す。
   - `has(id)`（W-3）: episode の entry（`/_audio-podcast/{id}`）があるか（最後に書く entry）。
   - `remove` / `clear` / `list`（列挙中の削除で例外を投げない）/ `usage`（`estimate()` を返す）。
   - `cacheStore` が `null`（W-7）: `save` は `unsupported`、`has` は false、`get` は null、`list` は空、`remove` / `clear` は何もしない、`usage` は `estimate()` のまま。
   - Cache 名 `audio-v1` はこのファイルの定数 1 つ（W-S5 が主体別の名前へ替える）。entry key は旧と同じ。
   - `clearOfflineAudio(cacheStore: CacheStore | null): Promise<void>` も export する（W-10。W-S2b の認証 Provider が Provider の外から logout 時に呼ぶ）。
8. `localPositionStore.ts`（W-20）: `createLocalPositionStore(kv: KeyValueStore): LocalPositionStore`。key は `podcastPositionKey(id)`（`@/lib/config`。TP-A7）、値は `JSON.stringify(seconds)`。`read` は `JSON.parse` して有限の正数だけを返す（それ以外は `null`）。`clearAll()` は本 slice では宣言しない（`KeyValueStore` は `get / set / remove` だけで key を列挙できず、列挙を足すには W-T1 のファイル `lib/platform/keyValueStore.ts` を変える必要がある。`clearAll` と列挙は使い手の W-S5 が足す。新 Spec §5.1 の port の表は `clearAll` を W-S2a2 の時点で持つ形に読めるので、この分担を報告として返す）。
**platform（`lib/platform/`）**
9. `objectUrl.ts`・`storageEstimate.ts`（W-2）: `createBrowserObjectUrl()`（`{ create(blob): string; revoke(url): void }`）・`createBrowserStorageEstimate()`（`() => Promise<{ usage; quota } | null>`）。

**削除・変更**: なし（W-S2a / W-S2a1 / W-T1 / W-T2 のファイルとテスト補助を変えない）。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| application | Coordinator（開始・挿入・失敗の方針・INV-P1・優先・resume の合成）・PositionReporter（位置の送信の規則）・port 5 つ・リードモデル 6 つ | TA-R-PB-5〜9 |
| infrastructure | 保存庫（3 entry の順序と key・record の形）・端末の位置（key と形式）・位置と完聴の request | TA-R-PB-10・W-20・W-23 |
| platform | blob URL・保存領域の見積もり | W-2 |

## 移行の中間状態
- 新しい一時経路は無い。`localPositionStore.ts` が `@/lib/config` の key の定数を旧実装と共有する（TP-A7。W-S4b・W-T15 で外す）。許可リストは増やさない（`lib/playback/infrastructure/` は INFRA なので `@/lib/config` の import は違反ではない）。

## 変わる挙動
無い（新しいコードはどこからも呼ばれない）。

## 契約と検査（RED テストの対応。テスト名に行 ID を含める）
| CI / 検査 | RED テスト（`tests/lib/playback/`） | 行 ID |
|---|---|---|
| CI-T5 / T6 / T7 | `application/coordinator.test.ts`: 関数 double の呼出列。`unavailable` では `episodes.fetch` が呼ばれない。手動の開始で再生できない・取得に失敗した場合はキューとセッションが変わらず `notice` が返る。advance 後の失敗で `current` が失敗エピソード・`errored`・`retry` で再解決。全 command の後に INV-P1。利用者の開始の優先: (1) 手動 B を保留 → a が `ended` → B を解放 → B が始まる（自動は始まらない）、(2) 自動 C を保留 → 手動 B を保留 → C を先に解放 → 何も始まらない → B を解放 → B が始まる | PS-01〜PS-04・PS-11・PS-13 |
| SG-C63 | `coordinator.test.ts`: 次へ送りの 3 場面 | PS-12・PS-12b・PS-12c |
| CI-T8 | `application/positionReporter.test.ts`: 周期・一時停止への遷移で 1 回（巻き戻した位置も）・同じ位置は再送しない・一時停止中の `seek` で書かない・`errored` / `idle` で書かない・完聴の順序・完聴は 1 回・総時間の代替・応答を待たずに次の開始が進む | PS-05・PS-05b・PS-06 |
| CI-T4（Coordinator 側） | `coordinator.test.ts`: 開始ごとに `defaultSpeed()` で `session.start` | PS-08 |
| CI-T10 | `infrastructure/offlineLibrary.test.ts`: deferred-put double（`MockCache.deferPuts` / `flushPuts`）で書込みの途中は `has()` が false・`episodes.fetch` が呼ばれる（SG-C55）・永続化した episode の音源 URL が空・旧形式の entry を `get` で読める・`cacheStore` が `null` のときの 7 操作・`audioHandle.release()` で revoke・`clearOfflineAudio` | — |
| W-20 | `infrastructure/localPositionStore.test.ts`: key と形式が旧と同じ・不正値は `null` | — |
| W-23 | `infrastructure/gatewayFns.test.ts`: `tests/helpers/gatewayDouble.ts` の呼出列（path と method）が旧 2 箇所と一致 | — |
| TA-Q-PB-4・W-14 | `application/readModels.test.ts`: `PlaybackView` の 5 field の表（6 状態 × 各 field）・`NowPlaying` が 5 field だけ | — |
| TA-V6 | `tests/architecture/immutability.playback.test.ts` に新 Spec §7 観点 4 (e): `nowPlaying()`・`upNext()`・`queueView()`・`playbackView()` が観点 2・3 を満たす。`addToQueue(input)` の後で `input` を書き換えても `upNext()` が変わらない | — |
| TA-V7 | `tests/architecture/cqrs.playback.test.ts`: (a) `PlaybackCommands` の名前の集合 = TA-C-PB-1〜7、`PlaybackQueries` = TA-Q-PB-1〜5。(b) `PositionSync`・`LocalPositionStore.write`・`OfflineLibrary` の変更系を記録する double を渡し、query 5 つを全部呼んでも記録 0 件。(c) command の戻り値が `void`・`Promise<StartResult>` で、リードモデルの型でない | — |
| TA-V1〜V3 | `npm run lint`・`tests/architecture/{boundaries,dataModels}.test.ts`（新規コードの違反 0） | — |

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。既存テストは 1 行も変更せず green（件数 = 着手前 ＋ 新規）。
- 新規 10 ファイル（application 4 = `coordinator`・`positionReporter`・`readModels`・`ports`（W-T2 のファイルに追記）、infrastructure 4 = `offlineLibrary`・`offlineRecord`・`localPositionStore`・`gatewayFns`、platform 2）とテスト 8 ファイルが存在し、テストが `verifies: CI-T*` と上表の行 ID をテスト名またはコメントに持つ。
- **既存コードから呼ばれていない**（集合 = `app components hooks contexts lib` から `lib/playback/`・`lib/platform/`・`lib/catalog/` を除いたもの）: `grep -rln "@/lib/playback/\|@/lib/platform/\|@/lib/catalog/" app components hooks contexts lib --include='*.ts' --include='*.tsx' | grep -v '^lib/playback/\|^lib/platform/\|^lib/catalog/'` が 0 件（末尾スラッシュ付き。旧 `@/lib/playbackQueue` に前方一致しない）。
- **依存の向き**: TA-V1（`npm run lint`）・TA-V2・TA-V3 が green。許可リストの行数 = 着手前（増やさない）。`grep -rn "from '@/types\|JSON\.\|Response\|from '@/lib/api\|from '@/lib/platform\|from '@/lib/config" lib/playback/application` が 0 件（コメントを含む。説明では「応答」「保存領域」と書く）。
- **公開面**: `PlaybackCommands` の member が 7、`PlaybackQueries` が 5（TA-V7 (a) で固定）。`coordinator.ts` の `^export` は `createPlaybackCoordinator` と型だけ。`decodeEpisode`・`isPlayable`・`GeneratingEpisode`・`FailedEpisode` が `lib/playback/` に 0 件。
- `'audio-v1'` のリテラルが `lib/playback/infrastructure/offlineLibrary.ts` の 1 箇所だけ（`grep -rn "'audio-v1'" lib/playback lib/platform | wc -l` が 1）。
- **前の slice のファイルに差分が無い**: `git diff --name-only origin/main -- lib/playback/domain lib/platform/audioElement.ts lib/platform/cacheStore.ts lib/platform/keyValueStore.ts lib/catalog lib/shared architecture`（`web/` の中で）が空（`lib/playback/application/ports.ts` への追記を除く）。

## 禁止事項 / scope 外
- W-S2a / W-S2a1 / W-T1 / W-T2 のファイル（`lib/playback/domain/**`・`lib/platform/{audioElement,cacheStore,keyValueStore}.ts`・`lib/catalog/**`・`lib/shared/**`・`architecture/**`）を変更しない（不足があれば実装を止めて報告する）。
- `contexts/` `hooks/` `components/` `app/` を変更しない。旧 4 ファイル・`AppContext.currentPodcast` に触れない。Cache 名を変えない（W-S5）。
- `stopForSubjectLeave`・`LocalPositionStore.clearAll` を作らない（W-S5）。command を 7 より増やさない。
- `Episode` の判別・`displayTitle` の規則を Playback に書かない（W-T2 を呼ぶ）。
- タブを閉じる・隠すときの位置の送信を入れない（共有仕様 §6.4 の web の保留）。応答を待ってから次のエピソードを開始しない（SG-C61）。記録時刻を付けない（W-T14）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
なし（新規コードのみ）。`npm test` 全件と `tests/architecture/*` が baseline。

## 返却事項（記録）
- 完了時、共有仕様 §4.4 の PS-11・PS-12・PS-12b・PS-12c・PS-13 の web の保留（操作の分）と、§6.4 の web の保留のうち一時停止・停止への遷移時の即時 1 回の domain / application の分を満たした旨を親 docs へ返す（入口の接続は W-S2b）。
- 導出 W-17〜W-22・W-26・W-27 を台帳 §5.0 へ登録する旨を返す。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
新 Spec §5.1・§7・§8.2・§8.3（W-S2a2 行）・§10.1・§11、既存 Spec §3.1・§4（CI-T4〜T8・T10）・§5（CP3・CP4・CP9）、共有仕様 §2.11・§2.12・§4.4・§6.4、architecture.md §4.2。
