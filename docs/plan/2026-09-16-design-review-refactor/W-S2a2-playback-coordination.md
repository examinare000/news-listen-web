## web リファクタ W-S2a2: `lib/playback/*` ドメイン層の新設 その 2 — OfflineLibrary・Coordinator・PositionReporter（新規コードのみ・既存コードから呼ばない）

## 概要
W-S2a（port・Session・Queue・source・resume）の上に、オフライン保存庫・Coordinator・PositionReporter を新設する。3 段分割 ① の後半（2026-09-24 に W-S2a から分けた。理由は W-S2a「規模」節）。**既存コードのどこからも新モジュールを呼ばず**、旧再生実装は 1 行も変えない。入口の差し替えは W-S2b。正本は Implementation Spec §3.1・§4 CI-T5〜T8・T10・T11・§5 CP3〜CP5 / CP9。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 規模（見込み。根拠 = 2026-09-24 実測の旧ファイル行数と契約テストの行数）
- production ≈ 450 行（新規のみ）: `offlineLibrary.ts` ≈ 150（旧 `lib/audioCache.ts` の 7 操作を port 経由に）、`coordinator.ts` ≈ 200、`positionReporter.ts` ≈ 100。
- test ≈ 470 行: `offlineLibrary.test.ts` ≈ 100、`coordinator.test.ts` ≈ 250（PS-01〜PS-04 ＋ CI-T11 の表駆動 16 行）、`positionReporter.test.ts` ≈ 120。
- 合計 ≈ 920 行。

## 前提・着手条件
- 依存 slice: **W-S2a**（`ports.ts`・`session.ts`・`queue.ts`・`source.ts`・`resume.ts`・`lib/platform/*`・`mockCaches` の deferred-put）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b とは対象ファイルが重ならず並行可（新規ファイルのみ）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み Selection Gate: **SG-X1** 完聴時に `duration` を 1 回送る。**SG-X4** 一時停止中は送らない。**SG-X2** は W-S2a の `resolveResumePosition` を Coordinator が呼ぶ。
- 棄却済み案（再提案しない。Spec §5）: `Clock` port、汎用 Storage port、旧新 Provider の併存移行。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/playback/offlineLibrary.ts`（CP3）: `save(podcast)` / `get` / `has` / `remove` / `clear` / `list` / `usage`。`save` は `CacheStore.putFromUrl`（W-S2a 対象 1）で音声本体を格納する。Cache 名は現行と同じ `audio-v1`、entry key は現行 `lib/audioCache.ts` の `/_audio/{id}` `/_audio-meta/{id}` `/_audio-podcast/{id}` と同一（Spec §6「Cache 名前空間は不変」。主体別化は W-S5）。`CacheStore` port 経由で `caches` を直接触らない。生成関数 `createOfflineLibrary(cacheStore)` を export する（W-S2b の `PlaybackProvider` と `AuthContext.logout` が使う）。
2. `lib/playback/coordinator.ts`（CP4＋CP5）: `startEpisode` / `retry` / `addToQueue` / `playNext` / `removeFromQueue` / `reorder` / `skipToNext` / `nowPlaying()` / `upNext()`（公開操作は **9 つ**。増やさない）、`onEnded`（完聴 1 回 → advance → 失敗時は停止 `errored(reason)`・`Queue.current` は失敗エピソード）、`decodeEpisode` / `isPlayable`（DTO → `PlayableEpisode | GeneratingEpisode | FailedEpisode`。矛盾 DTO は `FailedEpisode` に fail-closed）。`getEpisode`・`markCompleted`・`updatePosition` は `Result` を返す関数として**引数注入**で受ける（`lib/playback ↛ lib/api`）。resume の入力合成は Coordinator の **1 箇所**: `candidate = server > 0 ? server : local`（local は `KeyValueStore` port 経由の `podcast_position:{id}`）→ `resolveResumePosition(candidate, duration)`（user 判断 Q12=A、2026-09-23。Spec §3.1 の `(server, local)` 署名はこの合成を指し、共有仕様の純関数は `(candidate, duration)`）。
3. `lib/playback/positionReporter.ts`（CP9）: `attach(session)` / `detach()`。10 秒 throttle・local 書込・server 書込の単調非減少・順序 = `onCompleted` → local 0 → server に **`duration`** を 1 回 → advance（SG-X1・PS-06）。送るのは session が `loading | playing | paused | ended` のときのみ（§6.4 送信条件・PS-05）。一時停止中は周期送信しない（SG-X4・PS-05b）。

**削除・変更**: なし（テスト補助の変更も無し。deferred-put は W-S2a が入れてある）。

## 契約（RED テストの対応。Spec §4）
| CI | RED テスト（`tests/lib/playback/`） | 行 ID |
|---|---|---|
| CI-T5 / T6 / T7 | `coordinator.test.ts`: gateway double が呼ばれない・advance 失敗後の停止と `retry`・INV-P1 を全操作後に検査 | PS-01〜PS-04 |
| CI-T11 | `coordinator.test.ts`: 表駆動 status 4 × audio_url 2 × error_message 2 = 16 | PS-07 |
| CI-T8 | `positionReporter.test.ts`: gateway double の呼出列と値 | PS-05・PS-05b・PS-06・PS-08 |
| CI-T10 | `offlineLibrary.test.ts`: deferred-put double で途中状態を `has()` から観測 | — |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストは 1 行も変更せず green（件数 = 着手前＋新規）。
- 新規 3 ファイル＋テスト 3 ファイルが存在し、T-T5〜T8・T10・T11 が `verifies: CI-T*` と上表の行 ID をテスト名またはコメントに持つ。
- **既存コードから呼ばれていない**: W-S2a と同じ grep（`grep -rln "@/lib/playback\|@/lib/platform" app components hooks contexts lib --include='*.ts' --include='*.tsx'` が `lib/playback/` と `lib/platform/` 配下以外で 0 件）。
- `lib/playback/*.ts` の import 制約: W-S2a と同じ grep（`import type ... from '@/lib/api/gateway'` のみ除外。`coordinator.ts` も型のみ）が 0 件。
- `coordinator.ts` の export する公開操作が上の 9 つと `decodeEpisode` / `isPlayable` だけ（`grep -c "^export" lib/playback/coordinator.ts` の全行を PR 説明に列挙）。

## 禁止事項 / scope 外
- W-S2a の 8 ファイルを変更しない（型の不足があれば本 slice ではなく W-S2a の修正 PR とし、理由を `docs/trial-log/` へ）。
- `contexts/` `hooks/` `components/` `app/` を変更しない。旧 4 ファイル・`AppContext.currentPodcast` に触れない。Cache 名を変えない（W-S5）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
なし（新規コードのみ）。`npm test` 全件が baseline。

## 検証
`npm test`（新規 3 ファイル green・既存件数不変）、上記 grep 2 種が 0 件、`npm run build` 成功。

## 記録
- 棄却・方針転換があれば `docs/trial-log/` に追記。
