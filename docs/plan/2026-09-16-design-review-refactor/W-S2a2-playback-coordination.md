## web リファクタ W-S2a2: `lib/playback/*` ドメイン層の新設 その 2 — OfflineLibrary・Coordinator・PositionReporter（新規コードのみ・既存コードから呼ばない）

## 概要
W-S2a（port・Session・Queue・source・resume）と W-S2a1（Session の `fail`）の上に、オフライン保存庫・Coordinator・PositionReporter を新設する。3 段分割 ① の後半（2026-09-24 に W-S2a から分けた）。**既存コードのどこからも新モジュールを呼ばず**、旧再生実装は 1 行も変えない。入口の差し替えは W-S2b。正本は Implementation Spec §3.1・§4 CI-T5〜T8・T10・T11・§5 CP3〜CP5 / CP9 と、Spec 冒頭の追記 3 つ（本文を上書きする。必ず読む）。**検証モード: 再設計しない**。新しい契約 ID は作らない。

> **2026-09-30 の前提点検（W-S2a 完了後）による書き直し**: W-S2a の実装済みの公開面と照合し、起票時の本 order に欠けていた宣言と規則を埋めた。user が確定した決定（親 docs 監査レポート §5）: 取得前・開始前の失敗は Session の `fail` で表す（**SG-C52**。W-S2a1 が入口を足す）、手動で選んだものが開始前に再生できないと分かる場合は状態を変えない（**SG-C62**）、完聴時の順序は送信を始める順（**SG-C61**）、総時間の優先順（**SG-C54**）、一時停止・停止への遷移で位置を 1 回送る（**SG-C53**）、保存は `save(id)`（**SG-C55**）、「次へ送り」の規則（**SG-C63**）。決定から導いた宣言（依存の形・戻り値・規則の細部）は、同レポート §5 の「導出（2026-09-30）」W-1〜W-8 に記録した。点検の記録は親 docs `research-reports/2026-09-30-wave3-order-premise-check.md`（web A1〜A10）。再提案しない。

## 規模（見込み。根拠 = 2026-09-30 実測: 旧 `lib/audioCache.ts` 155 行、`contexts/AudioPlayerContext.tsx` の gateway 呼出 3 箇所 `:61,72,121`）
- production ≈ 560 行（新規のみ）: `offlineLibrary.ts` ≈ 170、`coordinator.ts` ≈ 230、`positionReporter.ts` ≈ 110、`gatewayFns.ts` ≈ 30、`lib/platform/objectUrl.ts` ≈ 10、`lib/platform/storageEstimate.ts` ≈ 10。
- test ≈ 620 行: `offlineLibrary.test.ts` ≈ 140、`coordinator.test.ts` ≈ 300、`positionReporter.test.ts` ≈ 140、`gatewayFns.test.ts` ≈ 40。
- 合計 ≈ 1,180 行。1,000 行を超えるが分割しない。理由: Coordinator は OfflineLibrary と PositionReporter の両方を依存に取り、3 つが揃わないと契約テスト（PS-01〜PS-06）を書けない。すべて新規ファイルで、既存の挙動は変わらない。レビューは「対象」の 6 ファイルを順に読めば足りる。

## 前提・着手条件
- 依存 slice: **W-S2a**（web PR #146）と **W-S2a1**（Session の `fail` と `EpisodeRef`・`isPlayableEpisode`）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b とは対象ファイルが重ならない。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み Selection Gate: **SG-X1** 完聴時に `duration` を 1 回送る。**SG-X4** 一時停止中は周期送信しない。**SG-X2** は W-S2a の `resolveResumePosition` を Coordinator が呼ぶ。上の 2026-09-30 の決定。
- 棄却済み案（再提案しない。Spec §5）: `Clock` port、汎用 Storage port、旧新 Provider の併存移行。
- コマンドはすべて `web/` で実行する。
- `docs/trial-log/`（web・親）を最初に読む。

## W-S2a / W-S2a1 の公開面（本 slice が使うもの。実物で確認する）
- `session.ts`: `createPlaybackSession(audio)`、`PlaybackSession`（`state / start / play / pause / seek / seekRelative / setSpeed / setVolume / stop / fail / subscribe`）、`PlaybackState`、`PlaybackEvent`（`stateChanged` / `positionChanged` / `listenCompleted`）、`PlayableEpisode`、`EpisodeRef`、`AudioHandle`、`PlaybackErrorReason`、`PlaybackSpeed`、`isPlayableEpisode`。Session は完聴時に `listenCompleted` → `stateChanged(ended)` の順で emit する。`paused` の状態で `seek` しても `positionChanged` を emit する。
- `ports.ts`: `CacheStore`（`open / delete / has / keys / putFromUrl`）、`CacheBucket`、`CacheWriteFailure`、`KeyValueStore`（`get / set / remove`。値は文字列）。
- `queue.ts`: `emptyQueue / current / upNext / start / setQueue / add / playNext / jump / advance / remove / moveUpNext`。不変条件を破った `QueueState` を渡すと throw する（正常な操作の結果からは起きない）。
- `source.ts`: `resolvePlaybackSource({ hasCached, isOnline })`。`resume.ts`: `resolveResumePosition(candidate, duration)`。
- `lib/platform/cacheStore.ts`: `createBrowserCacheStore()` は Cache Storage が無い環境で `null` を返す。

## 対象（web サブモジュールのみ。すべて新規）
**新規（production）**
1. `lib/playback/gatewayFns.ts`（導出 W-4）: `createPlaybackGatewayFns(gateway: ApiGateway)` を export する（`import type { ApiGateway, Result, ApiFailure } from '@/lib/api/gateway'` のみ）。返す関数は 3 つで、どれも `Result` を返す。パス・method・body は旧 `contexts/AudioPlayerContext.tsx` の gateway 呼出 3 箇所（`:61` 位置の `PATCH /api/backend/podcasts/{id}/position`、`:72` 完聴の `POST /api/backend/podcasts/{id}/completed`、`:121` 取得の `GET /api/backend/podcasts/{id}`。2026-09-30 実測）と同じにする。
   - `fetchEpisode(id) → Promise<Result<Podcast, ApiFailure>>`
   - `updatePosition(id, seconds) → Promise<Result<Podcast, ApiFailure>>`
   - `markCompleted(id) → Promise<Result<void, ApiFailure>>`
2. `lib/platform/objectUrl.ts`・`lib/platform/storageEstimate.ts`（導出 W-2）: `createBrowserObjectUrl()` は `{ create(blob): string, revoke(url): void }`（`URL.createObjectURL` / `URL.revokeObjectURL`）。`createBrowserStorageEstimate()` は `() => Promise<{ usage: number; quota: number } | null>`（`navigator.storage.estimate`。未対応なら `null`）。`lib/playback` はこれらのグローバルを直接使わない。
3. `lib/playback/offlineLibrary.ts`（CP3）: `createOfflineLibrary(deps)` を export する。
   - `deps`: `cacheStore: CacheStore | null`、`fetchEpisode`（対象 1 と同じ型）、`objectUrl`、`estimate`（対象 2 の型）。
   - 公開操作は 7 つ。旧 `lib/audioCache.ts` の 8 関数との対応は次のとおり。

     | 新 | 旧 | 規則 |
     |---|---|---|
     | `save(id) → Promise<Result<void, SaveFailure>>` | `downloadAudio` | `fetchEpisode(id)` で新しい署名付き URL を取り直す（SG-C55）→ `cacheStore.putFromUrl` で音声 → meta → podcast の順に書く。podcast は `audio_url` を空にして書く（期限切れする値を残さない）。重複 save は収束する |
     | `get(id) → Promise<{ podcast: Podcast; audioUrl: string; handle: AudioHandle } \| null>` | `getCachedPodcast` ＋ `getCachedAudioUrl` | 保存済みなら、podcast・blob URL・その URL を revoke する `handle` を返す（導出 W-1。`PlayableEpisode` への変換は Coordinator が行う。保存庫が Coordinator を import しないため） |
     | `has(id) → Promise<boolean>` | `isCached` | **podcast の entry（`/_audio-podcast/{id}`）があるか**で判定する（導出 W-3。最後に書く entry なので、書込みの途中は false） |
     | `remove(id)` | `deleteAudio` | 3 entry を消す |
     | `clear()` | `deleteAllAudio` | Cache ごと消す |
     | `list() → Promise<CachedEpisodeMeta[]>` | `listCachedEpisodes` | 列挙中の削除で例外を投げない |
     | `usage() → Promise<StorageEstimate \| null>` | `estimateUsage` | `deps.estimate()` を返す |

   - `SaveFailure` は `{ kind: 'unsupported' } | { kind: 'storage_full' } | { kind: 'download_failed'; failure: ApiFailure }`。`fetchEpisode` の失敗と `putFromUrl` の `download_failed` は `download_failed` に写す。旧実装の throw は使わない。
   - `cacheStore` が `null` のとき（導出 W-7）: `save` は `unsupported`、`has` は false、`get` は null、`list` は空、`remove` / `clear` は何もしない。`usage` は `deps.estimate()` のまま。
   - Cache 名 `audio-v1` は、このファイルの定数 1 つに置く（W-S5 が主体別の名前へ替える）。entry key は旧と同じ `/_audio/{id}`・`/_audio-meta/{id}`・`/_audio-podcast/{id}`。
   - 型 `CachedEpisodeMeta`・`StorageEstimate`・`SaveFailure` はこのファイルから export する（W-S2b の設定画面が使う）。
4. `lib/playback/positionReporter.ts`（CP9）: `createPositionReporter(deps)` を export する。`deps`: `updatePosition`・`markCompleted`（対象 1 の型）、`keyValueStore: KeyValueStore`。公開操作は `attach(session)` / `detach()`。規則は次のとおり（導出 W-6）。
   - **local の形式**: `podcastPositionKey(id)`（`@/lib/config`）へ `JSON.stringify(seconds)` で書く（旧 `hooks/useAudioPlayer.ts` と同じ形式。W-S2c まで旧実装と key を共有する）。
   - **エピソードごとの基準**: `stateChanged(loading)` を受けたら、そのエピソードの基準を戻す（最後に保存した位置 = `resumePosition`、完聴の送信済みの印を倒す）。
   - **周期**: 状態が `playing` のときの `positionChanged` で、最後に保存した位置から 10 秒以上進んだら local と server へ書く（旧実装と同じ、位置の進みによる間引き）。`paused` での `seek` による `positionChanged` では周期の書込みをしない（SG-X4・PS-05b）。
   - **一時停止・停止への遷移**（SG-C53）: `playing` から `paused` へ変わったとき、および `playing` / `paused` から `idle` へ変わったとき（`stop`）に、最後に分かっている位置を 1 回 local と server へ書く。最後に保存した位置と同じなら書かない。
   - **単調非減少**: 同じエピソードの 1 回の再生（`loading` から次の `loading` まで）の中で、最後に server へ書いた位置より小さい位置は server へ送らない（共有仕様 §6.4）。完聴時の書込みは例外。
   - **完聴**（SG-X1・SG-C61・PS-06）: `listenCompleted` を受けたら、`markCompleted(id)` → local に 0 → server へ総時間、の順で**送り始める**。応答は待たない。同じ再生の中で 2 回目以降の `listenCompleted` は無視する。
   - **完聴時に送る総時間**（SG-C54）: 直前の状態の `duration` が 0 より大きければその値、そうでなければ `episode.durationSeconds`（0 より大きい場合）、どちらも無ければ最後に分かっている位置（0 より大きい場合）。すべて 0 なら server への位置の書込みを省く。
   - **送らない状態**（PS-05）: 状態が `errored` / `idle` のとき、周期の書込みはしない。
   - 失敗（`Result` の `ok: false`）は握りつぶさず、`lastSyncFailure(): ApiFailure | null` で読めるようにする（Spec §3.1）。
5. `lib/playback/coordinator.ts`（CP4＋CP5）: `createPlaybackCoordinator(deps)` を export する。
   - `deps`（導出 W-5）: `session: PlaybackSession`、`offline`（対象 3 の戻り値）、`positionReporter`（対象 4 の戻り値）、`fetchEpisode`（対象 1 の型）、`keyValueStore: KeyValueStore`、`isOnline: () => boolean`、`defaultSpeed: () => PlaybackSpeed`。
   - 生成時に `positionReporter.attach(session)` を呼び、**その後で**自分が `session.subscribe` する（完聴時に Reporter が先に事象を受ける順序を固定する）。
   - 公開操作は **9 つ**（増やさない）: `startEpisode(id)` / `retry()` / `addToQueue(podcast)` / `playNext(podcast)` / `removeFromQueue(id)` / `reorder(from, to)` / `skipToNext()` / `nowPlaying()` / `upNext()`。これとは別に、読み取り側の通知 `subscribe(listener) → 解除関数` を持つ（9 には数えない。キューが `onEnded` 由来で変わったときに Provider が再描画できるようにする）。
   - **`startEpisode(id) → Promise<StartResult>`**（導出 W-8。`StartResult` は `{ ok: true } | { ok: false; notice: 'offline_uncached' | 'not_playable' | 'fetch_failed' }`）。手順は次のとおり。
     1. `source = resolvePlaybackSource({ hasCached: await offline.has(id), isOnline: isOnline() })`。
     2. `unavailable` なら、**キューもセッションも変えず** `{ ok: false, notice: 'offline_uncached' }` を返す（SG-C62）。
     3. `cached` なら `offline.get(id)`、`network` なら `fetchEpisode(id)` でエピソードを得る。`network` で取得に失敗したら、キューもセッションも変えず `{ ok: false, notice: 'fetch_failed' }` を返す。
     4. `decodeEpisode` で再生可能か判定する。再生可能でなければ、キューもセッションも変えず `{ ok: false, notice: 'not_playable' }` を返す。
     5. 再生可能なら、キューを整える（`jump` 済みならそのまま、無ければ `playNext` → `jump`。現行の挿入規則）→ `candidate = server > 0 ? server : local`（local は `keyValueStore` の `podcastPositionKey(id)` を `JSON.parse` して有限の正数だけ採る）→ `resume = resolveResumePosition(candidate, episode.durationSeconds)`（SG-C54。開始前なので DTO の総時間を使う）→ `session.start(episode, resume, defaultSpeed())`（PS-08）→ `{ ok: true }`。
     6. await の後は、その間に別の `startEpisode` が始まっていないかを確かめる（後から始めた方を優先する。古い方は何も変えずに `{ ok: true }` を返してよい）。
   - **`onEnded`**（Session の `stateChanged(ended)` を受けて動く。完聴の記録と位置の書込みは Reporter が行う）: `advance` → 次があれば再生元を解決して開始する。**この経路ではキューが既に次を現在にしている**ので、再生できないと分かった場合・取得に失敗した場合は `session.fail({ id }, reason)` を呼ぶ（SG-C52・PS-01・PS-03。`offline_uncached` と `not_playable` は `source_unavailable`、取得失敗は `fetch_failed`）。次が無ければ何もしない（`ended` のまま）。応答を待ってから進むことはしない（SG-C61）。
   - **`retry()`**: 状態が `errored` のとき、`queue.current` の id で再生元の解決からやり直す（PS-02）。失敗した場合は `onEnded` と同じく `session.fail` を呼ぶ。`errored` 以外では何もしない。
   - **`skipToNext()`**（SG-C63。共有仕様 §2.12）: 次があれば、次の再生元を**先に**解決する。再生できると分かったら `advance` して開始する（今のエピソードは Session の `start` が止める。Reporter が一時停止への遷移で位置を 1 回送る。完聴は送らない）。再生できないと分かったら、キューもセッションも変えず通知を返す。次が無ければ何もしない。戻り値は `startEpisode` と同じ `StartResult`。
   - `addToQueue` / `playNext`: 何も再生していなければ `startEpisode` と同じ手順で開始する（現行と同じ）。`removeFromQueue` / `reorder`: `queue.ts` の `remove` / `moveUpNext` を呼ぶ。
   - `nowPlaying()`: `Queue.current` から導く表示用の値（`episodeId` `title` `difficulty` `createdAt` `durationSeconds` と、トランスクリプト・語彙・クイズ・出典）。何も無ければ `null`。`upNext()`: `{ id, title }` の配列。
   - `decodeEpisode(podcast) → PlayableEpisode | GeneratingEpisode | FailedEpisode` と `isPlayable(podcast)` を export する。矛盾する DTO（`completed` かつ `error_message` 非 null、`audio_url` が空など）は `FailedEpisode` に倒す（PS-07）。`GeneratingEpisode`・`FailedEpisode` の型はこのファイルに置く。保存済みのエピソードは、`offline.get` の `podcast` に `audioUrl`（blob URL）を入れてから `decodeEpisode` に通し、`audioHandle` を付ける。

**削除・変更**: なし（W-S2a / W-S2a1 のファイルもテスト補助も変えない）。

## 契約（RED テストの対応。Spec §4）
| CI | RED テスト（`tests/lib/playback/`） | 行 ID |
|---|---|---|
| CI-T5 / T6 / T7 | `coordinator.test.ts`: 注入した関数 double の呼出列で検証する。`unavailable` では `fetchEpisode` が呼ばれない。手動の開始で再生できない場合はキューとセッションが変わらず `notice` が返る（SG-C62）。advance 後の失敗で `Queue.current` が失敗エピソード・`errored`・`retry` で再解決。全公開操作の後に INV-P1（セッションが `idle` でないとき `session.episode.id === Queue.current.id`） | PS-01〜PS-04 |
| CI-T11 | `coordinator.test.ts`: 表駆動 status 4 × audio_url 2 × error_message 2 = 16。16 行それぞれの期待（Playable / Generating / Failed）を表としてテストに書く | PS-07 |
| CI-T8 | `positionReporter.test.ts`: 注入した `updatePosition` / `markCompleted` double の呼出列と値。周期（10 秒進むごと）、一時停止への遷移で 1 回、同じ位置は再送しない、一時停止中の `seek` で周期の書込みなし、`errored` / `idle` で周期の書込みなし、完聴の順序（`markCompleted` → 位置）、完聴は 1 回、総時間が不明なときの代替、応答を待たずに次の開始が進むこと | PS-05・PS-05b・PS-06 |
| CI-T4（Coordinator 側） | `coordinator.test.ts`: 開始ごとに `defaultSpeed()` の値で `session.start` する | PS-08 |
| CI-T10 | `offlineLibrary.test.ts`: deferred-put double（`MockCache.deferPuts` / `flushPuts`）で、書込みの途中は `has()` が false。`fetchEpisode` が呼ばれること（SG-C55）。永続化した podcast の `audio_url` が空。`cacheStore` が `null` のときの 7 操作。`handle.release()` で revoke | — |
| —（導出 W-4） | `gatewayFns.test.ts`: `tests/helpers/gatewayDouble.ts` の呼出列（パスと method）が旧 3 箇所と一致 | — |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストは 1 行も変更せず green（件数 = 着手前＋新規）。
- 新規 6 ファイル（`lib/playback/` 4、`lib/platform/` 2）とテスト 4 ファイルが存在し、テストが `verifies: CI-T*` と上表の行 ID をテスト名またはコメントに持つ。
- **既存コードから呼ばれていない**: `grep -rln "@/lib/playback/\|@/lib/platform/" app components hooks contexts lib --include='*.ts' --include='*.tsx' | grep -v '^lib/playback/\|^lib/platform/'` が 0 件（2026-09-30 実測 0 件。パターンは末尾スラッシュ付き。スラッシュ無しだと旧 `@/lib/playbackQueue`・`@/lib/playbackPosition` に前方一致する）。
- `lib/playback/*.ts` の参照の制約: `grep -rn "from 'react'\|fetch(\|localStorage\|caches\.\|new Audio\|@/lib/api\|URL\.createObjectURL\|URL\.revokeObjectURL\|navigator\.storage" lib/playback | grep -v "import type .* from '@/lib/api/gateway'"` が 0 件（2026-09-30 実測 0 件）。コメントにこれらの語を書くと一致するので、説明では「ブラウザの保存領域」「KV store」などと書く。`navigator\.` だけのパターンは使わない（既存 `source.ts:11` のコメントに一致する）。
- Coordinator の公開面: `createPlaybackCoordinator` が返すオブジェクトのメンバーが、上の 9 操作と `subscribe` の 10 個だけ（型 `PlaybackCoordinator` の宣言を PR 説明に貼る）。`coordinator.ts` の `^export` は `createPlaybackCoordinator`・`decodeEpisode`・`isPlayable` と型だけ。
- `'audio-v1'` のリテラルが `lib/playback/offlineLibrary.ts` の 1 箇所だけ: `grep -rn "'audio-v1'" lib/playback lib/platform | wc -l` が 1。
- W-S2a / W-S2a1 のファイルに差分が無い: `git -C web diff --name-only origin/main -- lib/playback/ports.ts lib/playback/session.ts lib/playback/queue.ts lib/playback/source.ts lib/playback/resume.ts lib/platform/audioElement.ts lib/platform/cacheStore.ts lib/platform/keyValueStore.ts` が空（worktree ルートで実行するときは `git -C web`。`web/` の中では `git diff …`）。

## 禁止事項 / scope 外
- W-S2a / W-S2a1 の 8 ファイルを変更しない（型の不足があれば本 slice ではなく修正 PR とし、理由を `docs/trial-log/` へ）。
- `contexts/` `hooks/` `components/` `app/` を変更しない。旧 4 ファイル・`AppContext.currentPodcast` に触れない。Cache 名を変えない（W-S5）。
- `stopForSubjectLeave` を作らない（W-S5）。Coordinator の変更操作を 9 より増やさない。
- タブを閉じる・隠すときの位置の送信を入れない（共有仕様 §6.4 の web の保留）。
- 応答を待ってから次のエピソードを開始する実装にしない（SG-C61）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
なし（新規コードのみ）。`npm test` 全件が baseline。

## 検証
`npm test`（新規 4 ファイル green・既存件数不変）、上記 grep 3 種、`npm run build` 成功。

## 記録
- 完了時、共有仕様 §6.4 の web の保留（一時停止・停止への遷移時の即時 1 回）のうち、ドメイン層の分を満たした旨を親 docs へ返す（入口の接続は W-S2b）。
- Spec §3.1 の `startEpisode(id)` と、共有仕様 §6.8 の web 欄「Coordinator は id を受けない」が食い違っている。本 order は Spec §3.1 と現行 `playById(id)` に合わせた（導出 W-8）。親 docs へ返す。
- 棄却・方針転換があれば `docs/trial-log/` に追記。
