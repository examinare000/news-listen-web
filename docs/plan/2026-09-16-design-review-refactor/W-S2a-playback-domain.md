## web リファクタ W-S2a: `lib/playback/*` ドメイン層の新設（新規コードのみ・既存コードから呼ばない）

## 概要
再生セッション（排他 union）・Queue（不変条件 gate）・再生元の解決・resume 規則（末尾 2 秒窓）・オフライン保存庫・Coordinator・PositionReporter を `lib/playback/` に新設する。3 段分割（親 plan「一括切替を 3 段に割る」）の ①。本 slice では**既存コードのどこからも新モジュールを呼ばず**、旧 `contexts/AudioPlayerContext.tsx`・`hooks/useAudioPlayer.ts`・`lib/{playbackQueue,audioCache,resolvePlayback,playbackPosition}.ts` は 1 行も変えない。入口の差し替えは W-S2b、旧実装の削除は W-S2c。正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.1・§4 CI-T1〜T11・§5 CP1〜CP5 / CP9。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 前提・着手条件
- 依存 slice: W-S1b が main に merge 済み（親 plan の直列順。Coordinator が注入で受けるのは W-S1 の gateway が返す `Result` 関数で、`lib/api/podcasts.ts` の throw 版ではない）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。特性テストは不要（新規コードのみ。既存テストの green が挙動不変の証拠）。
- 確定済み Selection Gate（共有仕様 §6.7、2026-09-16）で本 slice の純関数に効くもの: **SG-X2** `resolveResumePosition(serverSeconds, durationSeconds)` は末尾 2 秒窓（RS-01〜RS-07 全行）。**SG-X5** 速度は 8 段 `PLAYBACK_SPEEDS`（現行と同じ）。SG-X1 / SG-X4 は Coordinator / PositionReporter の契約テストに現れる（下表 CI-T8）。
- 棄却済み案（再提案しない。Spec §5 rejected_overdesign）: `QueueState` の branded type 化、`Clock` port、Strategy for PlaybackSource、汎用 Storage port、旧新 Provider の併存移行。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/playback/ports.ts`: port の型のみ。`AudioElement`（`tests/helpers/mockAudio.ts` を seam 昇格）・`CacheStore`（`tests/helpers/mockCaches.ts` を seam 昇格）・`KeyValueStore`。Spec §2 の 4 port のうち `ApiGateway` は W-S1 の `lib/api/gateway.ts` の型を使う。
2. `lib/playback/session.ts`（CP1）: `PlaybackSession`。状態 `idle` / `loading` / `paused` / `playing` / `ended` / `errored(reason: media | autoplay_blocked | source_unavailable | fetch_failed(ApiFailure))`。遷移は Spec §3.1 の **13 遷移**のみ。位置は `[0, duration]` に clamp。速度は `PLAYBACK_SPEEDS` 内、`start(episode, resume, speed)` で受けた速度を `load` 後に `playbackRate` と `defaultPlaybackRate` の両方へ再適用。`positionChanged` / `listenCompleted` / `stateChanged` を emit。storage・fetch を持たない。
3. `lib/playback/queue.ts`（CP2）: `lib/playbackQueue.ts` の複製に内部 gate `create(items, currentIndex)`（不変条件 1〜3 違反は throw）を加え、公開操作 `emptyQueue` `current` `upNext` `start` `setQueue` `add` `playNext` `jump` `advance` `remove` **`moveUpNext`**（`reorderUpNext` の名は export しない。引数意味は同じ）を持つ。公開操作は §2 どおり正規化し throw しない。
4. `lib/playback/source.ts`: `resolvePlaybackSource` を `lib/resolvePlayback.ts` から複製（挙動同一）。
5. `lib/playback/resume.ts`: `resolveResumePosition(serverSeconds, durationSeconds)`（共有仕様 §6.4 の表）。旧 `lib/playbackPosition.ts` とはシグネチャが異なる別関数。
6. `lib/playback/offlineLibrary.ts`（CP3）: `save` / `get` / `has` / `remove` / `clear` / `list` / `usage`。Cache 名は現行と同じ `audio-v1`、entry key は現行 `lib/audioCache.ts` の `/_audio/{id}` `/_audio-meta/{id}` `/_audio-podcast/{id}` と同一（Spec §6「Cache 名前空間は不変」。主体別化は W-S5）。`CacheStore` port 経由で `caches` を直接触らない。
7. `lib/playback/coordinator.ts`（CP4＋CP5）: `startEpisode` / `retry` / `addToQueue` / `playNext` / `removeFromQueue` / `reorder` / `skipToNext` / `nowPlaying()` / `upNext()`、`onEnded`（完聴 1 回 → advance → 失敗時は停止 `errored(reason)`・`Queue.current` は失敗エピソード）、`decodeEpisode` / `isPlayable`（DTO → `PlayableEpisode | GeneratingEpisode | FailedEpisode`。矛盾 DTO は `FailedEpisode` に fail-closed）。`getEpisode`・`markCompleted`・`updatePosition` は `Result` を返す関数として**引数注入**で受ける（`lib/playback ↛ lib/api`）。resume の入力合成は Coordinator の **1 箇所**: `candidate = server > 0 ? server : local`（local は `KeyValueStore` port 経由の `podcast_position:{id}`）→ `resolveResumePosition(candidate, duration)`（user 判断 Q12=A、2026-09-23。Spec §3.1 の `(server, local)` 署名はこの合成を指し、共有仕様の純関数は `(candidate, duration)`）。
8. `lib/playback/positionReporter.ts`（CP9）: `attach(session)`。10 秒 throttle・local 書込・server 書込の単調非減少・順序 = `onCompleted` → local 0 → server に **`duration`** を 1 回 → advance（SG-X1・PS-06）。送るのは session が `loading | playing | paused | ended` のときのみ（§6.4 送信条件・PS-05）。一時停止中は周期送信しない（SG-X4・PS-05b）。
9. `lib/platform/{audioElement,cacheStore,keyValueStore}.ts`: 各 port の本番 adapter（`new Audio()` / `caches` / `localStorage`）。本 slice では誰も import しない。

**変更（テスト補助のみ）**: `tests/helpers/mockAudio.ts`・`tests/helpers/mockCaches.ts` を `ports.ts` の型を実装する形に整える（既存テストの利用箇所は変えない）。`mockCaches` に deferred-put（T-T10）を足す。

**削除**: なし。

## 契約（RED テストの対応。Spec §4）
| CI | RED テスト（`tests/lib/playback/`） | 行 ID |
|---|---|---|
| CI-T1 / T2 / T3 / T4 | `session.test.ts`: 13 遷移を `AudioElement` double で駆動。`play()` reject → `errored`。resume の `loadedmetadata` 後再適用。速度の初期化と再適用 | T-T3 は RS-01〜07 |
| CI-T9 | `queue.test.ts`（`create` gate・正規化 property）＋ `queue.conformance.test.ts`（Q-01〜Q-32 を新モジュールに対して。旧 `tests/lib/playbackQueue.conformance.test.ts` は残す。W-S2c で削除） | Q-01〜Q-32 |
| — | `resume.test.ts`: 表駆動 | RS-01〜RS-07（テスト名に含める） |
| CI-T5 / T6 / T7 | `coordinator.test.ts`: gateway double が呼ばれない・advance 失敗後の停止と `retry`・INV-P1 を全操作後に検査 | PS-01〜PS-04 |
| CI-T11 | `coordinator.test.ts`: 表駆動 status 4 × audio_url 2 × error_message 2 = 16 | PS-07 |
| CI-T8 | `positionReporter.test.ts`: gateway double の呼出列と値 | PS-05・PS-05b・PS-06・PS-08 |
| CI-T10 | `offlineLibrary.test.ts`: deferred-put double で途中状態を `has()` から観測 | — |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストは 1 行も変更せず green（件数 = 着手前＋新規）。
- 新規ファイル一覧（対象 1〜9 の 11 ファイル＋テスト 7 ファイル）が存在し、T-T1〜T11 が `verifies: CI-T*` と上表の行 ID をテスト名またはコメントに持つ。
- **既存コードから呼ばれていない**（量化する集合 = `app/` `components/` `hooks/` `contexts/` と `lib/` 直下の既存ファイル）: `grep -rln "@/lib/playback\|@/lib/platform" app components hooks contexts lib --include='*.ts' --include='*.tsx'` が `lib/playback/` と `lib/platform/` 配下以外で **0 件**。
- `lib/playback/*.ts` が `react` / `fetch(` / `localStorage` / `caches.` / `new Audio` / `@/lib/api` を import・参照しない（`grep -ln` で 0 件。`lib/platform/` は参照してよい。`lib/` 直下の既存ファイルは本 slice の判定対象外）。
- `tests/lib/playbackQueue.conformance.test.ts`（旧）と `tests/lib/playback/queue.conformance.test.ts`（新）の両方が green。

## 禁止事項 / scope 外
- `contexts/` `hooks/` `components/` `app/` を変更しない。`app/layout.tsx` の Provider 配線を変えない（W-S2b）。
- 旧 `lib/playbackQueue.ts` の `reorderUpNext` を rename しない（W-S2c の独立コミット）。旧 4 ファイルを削除・変更しない（W-S2c）。
- `AppContext.currentPodcast` に触れない（W-S2c）。eslint ルールを追加しない（W-S2c）。
- Cache 名を `audio-v1` から変えない（W-S5）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
なし（新規コードのみ）。`npm test` 全件が baseline。

## 検証
`npm test`（新規 7 ファイル green・既存件数不変）、上記 grep 3 種が 0 件、`npm run build` 成功。

## 記録
- 完了時、共有仕様 §4.3 RS-01〜RS-07 の web 保留（解除条件 = W-S2a 完了）を解除できる旨を親 docs へ返す（`design/shared-playback-spec.md` §4.3 の保留文）。
- 棄却・方針転換があれば `docs/trial-log/` に追記。
