## web リファクタ W-S2a: `lib/playback/*` ドメイン層の新設 その 1 — port・Session・Queue・source・resume・platform adapter（新規コードのみ・既存コードから呼ばない）

## 概要
再生セッション（排他 union）・Queue（不変条件 gate）・再生元の解決・resume 規則（末尾 2 秒窓）と、port の型・本番 adapter を `lib/playback/`・`lib/platform/` に新設する。3 段分割（親 plan「一括切替を 3 段に割る」）の ① の前半。OfflineLibrary・Coordinator・PositionReporter は **W-S2a2** に分けた（2026-09-24。見込み行数が 1,000 行を超えるため）。本 slice と W-S2a2 のどちらも**既存コードのどこからも新モジュールを呼ばず**、旧 `contexts/AudioPlayerContext.tsx`・`hooks/useAudioPlayer.ts`・`lib/{playbackQueue,audioCache,resolvePlayback,playbackPosition}.ts` は 1 行も変えない。入口の差し替えは W-S2b、旧実装の削除は W-S2c。正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.1・§4 CI-T1〜T4・T9・§5 CP1〜CP2。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 規模（見込み。根拠 = 2026-09-24 実測の旧ファイル行数）
- production ≈ 570 行（新規のみ）: `ports.ts` ≈ 60、`session.ts` ≈ 200、`queue.ts` ≈ 130（旧 `lib/playbackQueue.ts` 106 行の複製 ＋ gate）、`source.ts` 27（旧 `lib/resolvePlayback.ts` の複製）、`resume.ts` ≈ 30、`lib/platform/{audioElement,cacheStore,keyValueStore}.ts` ≈ 120。
- test ≈ 680 行: `session.test.ts` ≈ 200、`queue.test.ts` ≈ 100（旧 122 行を基に gate の行を足す）、`queue.conformance.test.ts` 278（旧 `tests/lib/playbackQueue.conformance.test.ts` の複製。import 先だけ違う）、`resume.test.ts` ≈ 60、`tests/helpers/mockAudio.ts`・`mockCaches.ts` の整え ≈ 40。
- 合計 ≈ 1,250 行。うち複製（旧ファイルからのコピーで diff レビュー不要）≈ 410 行（`queue.ts` 106・`source.ts` 27・`queue.conformance.test.ts` 278）。複製を除く実質 ≈ 840 行。

## 前提・着手条件
- 依存 slice: **W-S1**（`lib/api/gateway.ts` の `Result` / `ApiFailure` 型。`session.ts` の `errored(fetch_failed(ApiFailure))` が型を参照する）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b（`lib/api.ts` の分割）とは対象ファイルが重ならないため、W-S1b の完了を待たずに並行投入できる（親 plan は直列表記だが、本 slice が `lib/api/*` を読むのは `gateway.ts` の型だけ。README「投入順」）。並行した場合、後から merge する側は rebase のみで conflict は生じない（新規ファイルのみ）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。特性テストは不要（新規コードのみ。既存テストの green が挙動不変の証拠）。
- 確定済み Selection Gate（共有仕様 §6.7、2026-09-16）で本 slice の純関数に効くもの: **SG-X2** `resolveResumePosition(serverSeconds, durationSeconds)` は末尾 2 秒窓（RS-01〜RS-07 全行）。**SG-X5** 速度は 8 段 `PLAYBACK_SPEEDS`（現行と同じ）。SG-X1 / SG-X4 は W-S2a2 の Coordinator / PositionReporter の契約テストに現れる。
- 棄却済み案（再提案しない。Spec §5 rejected_overdesign）: `QueueState` の branded type 化、`Clock` port、Strategy for PlaybackSource、汎用 Storage port、旧新 Provider の併存移行。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/playback/ports.ts`: port の型のみ。`AudioElement`（`tests/helpers/mockAudio.ts` を seam 昇格）・`CacheStore`（`tests/helpers/mockCaches.ts` を seam 昇格）・`KeyValueStore`。Spec §2 の 4 port のうち `ApiGateway` は W-S1 の `lib/api/gateway.ts` の型を使う（`import type` のみ）。**音声本体の取得**（現行 `lib/audioCache.ts:69` の `fetch(podcast.audio_url)`）は `lib/playback` が `fetch` を呼べないため `CacheStore` port の操作 `putFromUrl(cacheName, key, url)`（URL を受けて応答を格納し、失敗は `Result` で返す）として置く。利用者に見える差は無い。
2. `lib/playback/session.ts`（CP1）: `PlaybackSession`。状態 `idle` / `loading` / `paused` / `playing` / `ended` / `errored(reason: media | autoplay_blocked | source_unavailable | fetch_failed(ApiFailure))`。遷移は Spec §3.1 の **13 遷移**のみ。位置は `[0, duration]` に clamp。速度は `PLAYBACK_SPEEDS` 内、`start(episode, resume, speed)` で受けた速度を `load` 後に `playbackRate` と `defaultPlaybackRate` の両方へ再適用。`positionChanged` / `listenCompleted` / `stateChanged` を emit。storage・fetch を持たない。**`PLAYBACK_SPEEDS`（8 段。値は現行 `hooks/useAudioPlayer.ts:7` と同一）をこのファイルから export する**（W-S2b が `app/(app)/settings/page.tsx:6`・`components/AudioPlayerBar.tsx:6` の import 元をここへ替える。旧 export は W-S2c で消える）。
3. `lib/playback/queue.ts`（CP2）: `lib/playbackQueue.ts` の複製に内部 gate `create(items, currentIndex)`（不変条件 1〜3 違反は throw）を加え、公開操作 `emptyQueue` `current` `upNext` `start` `setQueue` `add` `playNext` `jump` `advance` `remove` **`moveUpNext`**（`reorderUpNext` の名は export しない。引数意味は同じ）を持つ。公開操作は §2 どおり正規化し throw しない。
4. `lib/playback/source.ts`: `resolvePlaybackSource` を `lib/resolvePlayback.ts` から複製（挙動同一）。
5. `lib/playback/resume.ts`: `resolveResumePosition(serverSeconds, durationSeconds)`（共有仕様 §6.4 の表）。旧 `lib/playbackPosition.ts` とはシグネチャが異なる別関数。
6. `lib/platform/{audioElement,cacheStore,keyValueStore}.ts`: 各 port の本番 adapter（`new Audio()` / `caches` ＋ `fetch` / `localStorage`）。本 slice では誰も import しない。

**変更（テスト補助のみ）**: `tests/helpers/mockAudio.ts`・`tests/helpers/mockCaches.ts` を `ports.ts` の型を実装する形に整える（既存テストの利用箇所は変えない）。`mockCaches` に deferred-put（W-S2a2 の T-T10 が使う）を足す。

**削除**: なし。

## 契約（RED テストの対応。Spec §4）
| CI | RED テスト（`tests/lib/playback/`） | 行 ID |
|---|---|---|
| CI-T1 / T2 / T3 / T4 | `session.test.ts`: 13 遷移を `AudioElement` double で駆動。`play()` reject → `errored`。resume の `loadedmetadata` 後再適用。速度の初期化と再適用 | T-T3 は RS-01〜07 |
| CI-T9 | `queue.test.ts`（`create` gate・正規化 property）＋ `queue.conformance.test.ts`（Q-01〜Q-32 を新モジュールに対して。旧 `tests/lib/playbackQueue.conformance.test.ts` は残す。W-S2c で削除） | Q-01〜Q-32 |
| — | `resume.test.ts`: 表駆動 | RS-01〜RS-07（テスト名に含める） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストは 1 行も変更せず green（件数 = 着手前＋新規）。
- 新規ファイル一覧（対象 1〜6 の 8 ファイル＋テスト 4 ファイル）が存在し、T-T1〜T4・T9 が `verifies: CI-T*` と上表の行 ID をテスト名またはコメントに持つ。
- **既存コードから呼ばれていない**（量化する集合 = `app/` `components/` `hooks/` `contexts/` と `lib/` 直下の既存ファイル）: `grep -rln "@/lib/playback\|@/lib/platform" app components hooks contexts lib --include='*.ts' --include='*.tsx'` が `lib/playback/` と `lib/platform/` 配下以外で **0 件**。
- `lib/playback/*.ts` が `react` / `fetch(` / `localStorage` / `caches.` / `new Audio` / `@/lib/api` を import・参照しない（`grep -rn "from 'react'\|fetch(\|localStorage\|caches\.\|new Audio\|@/lib/api" lib/playback | grep -v ":import type .* from '@/lib/api/gateway'"` が 0 件。除外は **`import type { Result, ApiFailure } from '@/lib/api/gateway'` の型のみ import** だけ（`ports.ts`・`session.ts` が型を参照するために要る。値の import は 0）。`lib/platform/` は `caches` / `localStorage` / `new Audio` / `fetch(` を参照してよい（adapter）。`lib/` 直下の既存ファイルは本 slice の判定対象外）。
- `tests/lib/playbackQueue.conformance.test.ts`（旧）と `tests/lib/playback/queue.conformance.test.ts`（新）の両方が green。

## 禁止事項 / scope 外
- `contexts/` `hooks/` `components/` `app/` を変更しない。`app/layout.tsx` の Provider 配線を変えない（W-S2b）。
- `offlineLibrary.ts` / `coordinator.ts` / `positionReporter.ts` を作らない（W-S2a2）。
- 旧 `lib/playbackQueue.ts` の `reorderUpNext` を rename しない（W-S2c の独立コミット）。旧 4 ファイルを削除・変更しない（W-S2c）。
- `AppContext.currentPodcast` に触れない（W-S2c）。eslint ルールを追加しない（W-S2c）。
- Cache 名を `audio-v1` から変えない（W-S5）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
なし（新規コードのみ）。`npm test` 全件が baseline。

## 検証
`npm test`（新規 4 ファイル green・既存件数不変）、上記 grep 2 種が 0 件、`npm run build` 成功。

## 記録
- 完了時、共有仕様 §4.3 RS-01〜RS-07 の web 保留（解除条件 = W-S2a 完了）を解除できる旨を親 docs へ返す（`design/shared-playback-spec.md` §4.3 の保留文）。
- 棄却・方針転換があれば `docs/trial-log/` に追記。
