## web リファクタ W-S2a1: `PlaybackSession` に「失敗にする」入口を足す（W-S2a の修正。新規コードのみ・既存コードから呼ばない）

## 概要
W-S2a で作った `lib/playback/session.ts` に、取得前・開始前の失敗を表す入口が無い。`PlaybackErrorReason` は `fetch_failed` と `source_unavailable` を型として持つが、その状態を作る操作が無く、`errored` は再生可能なエピソード全体を必須にしている（`session.ts:34-63`）。このままでは、W-S2a2 の Coordinator が「次へ進んだ後に取得へ失敗した」「オフラインで未キャッシュ」を Session に伝えられず、共有仕様 §2.11（PS-01・PS-03）と INV-P1 を満たせない。本 slice は Session に遷移表の外の操作 `fail` を足し、`errored` が id だけの参照を持てるようにする。あわせて、共有仕様に足した正本テストケース Q-33 を準拠テストに加える。

正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md` 冒頭の「2026-09-30・wave 3 の前提点検による上書き」追記（SG-C52・SG-C50）と、親 docs `design/shared-playback-spec.md` §2.4・§2.11・§6.6、`adr/105-playback-session-out-of-table-operations-and-shared-rules.md`。**検証モード: 再設計しない**。契約 ID は Spec の追記が定義済みの **CI-T1f** を使う（新しい契約 ID は作らない）。

2026-09-30 の前提点検で見つかった欠落（点検の記録は親 docs `research-reports/2026-09-30-wave3-order-premise-check.md` の web A1）を、W-S2a2 の前に埋める slice。W-S2a2 の order は「W-S2a の 8 ファイルを変更しない。型の不足があれば W-S2a の修正 PR とする」と定めている。

## 規模（見込み。根拠 = 2026-09-30 実測 `session.ts` 303 行・`session.test.ts` 921 行・64 件）
- production ≈ 50 行: `session.ts` の型 2 箇所（`EpisodeRef`・`errored` の `episode`）、`fail` ≈ 20、`play()` の分岐 ≈ 5、型ガード ≈ 5。
- test ≈ 130 行: `session.test.ts` に CI-T1f ≈ 110、`queue.conformance.test.ts` に Q-33 ≈ 20。
- 合計 ≈ 180 行。

## 前提・着手条件
- 依存 slice: **W-S2a**（`lib/playback/*`・`lib/platform/*`）の web PR が main に merge 済み（2026-09-30。web PR #146）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S1b とは対象ファイルが重ならないが、同一 submodule の slice は直列で投入する。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない。親 docs 監査レポート §5）: **SG-C52** 取得前・開始前の失敗は Session の遷移表の外の操作で表す。開始の操作に「再生できない」を渡す案と、Coordinator が失敗状態を持つ案は棄却。**SG-C24** 停止も遷移表の外のリセット（実装済み）。**SG-C50** `setQueue` の重複 id の扱い（実装済み。テスト行の追加だけ）。
- コマンドはすべて `web/` で実行する。
- `docs/trial-log/`（web・親）を最初に読む。

## 対象（web サブモジュールのみ）
**変更（production）**
1. `lib/playback/session.ts`:
   - 型 `EpisodeRef = { readonly id: string }` を export する。
   - `PlaybackState` の `errored` の `episode` を `PlayableEpisode | EpisodeRef` にする。`position` と `speed` は残す。
   - `PlaybackErrorReason` の 4 種（`media` / `autoplay_blocked` / `source_unavailable` / `fetch_failed`）は変えない。
   - 公開操作 **`fail(ref: EpisodeRef, reason)`** を足す。`reason` は `source_unavailable` と `fetch_failed` だけを受ける型にする（`media` と `autoplay_blocked` は音声要素の事象からだけ生まれる）。動作は次のとおり。
     - どの状態から呼んでも `errored` になる。`episode` は渡された `ref`、`position` は 0、`speed` は直前の状態が速度を持てばその値、持たなければ 1.0。
     - 直前の状態が `idle` でなければ、`stop()` と同じ手順で音声要素を一時停止して音源を外す（`pause()` → `src` を空に → `load()`）。
     - 直前の状態が持っていた `audioHandle` は、音源を外した後に `release()` する（`stop()` と同じ順序）。
     - 進行中の `play()` の遅延 reject が結果を上書きしないよう、`stop()` と同じく世代（`token`）を進める。
     - `stateChanged` を 1 回 emit する。`positionChanged` と `listenCompleted` は emit しない。
   - `play()`: `errored` で `episode` が id だけの参照のときは何もしない（音源を持たないので読み込み直せない。再試行は Coordinator の `retry()` が再生元の解決からやり直し、`start` を呼ぶ）。`episode` が再生可能なエピソードのときの動作（`loadSource` で読み込み直す）は変えない。
   - `handleOf` は、`errored` の `episode` が id だけの参照のとき `undefined` を返す。
   - 型ガード `isPlayableEpisode(e: PlayableEpisode | EpisodeRef): e is PlayableEpisode` を export する（W-S2a2 の Coordinator と W-S2b の再生バーが使う）。

**変更（test）**
2. `tests/lib/playback/session.test.ts`: `describe('CI-T1f fail()', …)` を足す。既存の 64 件は名前・期待値とも変えない。`errored` の `episode` の型が union になることで、既存テストが `state.episode.audioUrl` などを直接読んでいる箇所は型エラーになり得る。その場合は `isPlayableEpisode` で絞ってから読む形に直す（期待値は変えない）。直した箇所は PR 説明に列挙する。
3. `tests/lib/playback/queue.conformance.test.ts`: Q-33 を足す（`setQueue([a,b,a,c], 2)` → `items=[a,b,c]`・`current=a`・`upNext=[b,c]`）。冒頭コメントの「Q-01〜Q-32」を「Q-01〜Q-33」に直す。旧モジュール用の `tests/lib/playbackQueue.conformance.test.ts` は変えない（旧 `lib/playbackQueue.ts` の `setQueue` は重複を除かない。W-S2c で削除する）。

**削除**: なし。

## 契約（RED テストの対応）
| CI | RED テスト | 行 ID |
|---|---|---|
| CI-T1f | `session.test.ts`: (a) `idle` / `loading` / `paused` / `playing` / `ended` / `errored` の 6 状態それぞれから `fail({id}, {kind:'fetch_failed', failure})` → `state().status === 'errored'`・`episode` が `{id}`・`reason.kind === 'fetch_failed'`。(b) `idle` 以外から呼んだ後、`AudioElement` double が `paused === true` かつ `src === ''`。`idle` から呼んだ場合は double の状態が変わらない。(c) `audioHandle` を持つ状態から呼ぶと `release` が 1 回呼ばれ、その時点で double の `src` は空。(d) `play()` の遅延 reject が `fail` の後に届いても、状態は `fail` の結果のまま。(e) `errored`（id だけの参照）で `play()` を呼んでも状態と double が変わらない。(f) `fail` の後に `start(episode, …)` で `loading` へ進める。(g) `source_unavailable` でも同じ。double の呼出回数は assert しない | PS-01・PS-03 の Session 側 |
| CI-T9 | `queue.conformance.test.ts`: Q-33 | Q-33 |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。
- 既存の遷移のテスト（`describe('CI-T1 遷移（13 件）'` ほか）は名前・期待値とも不変。分母 13 は変えない（`fail` は `stop` と同じく表の外）。
- `session.ts` の公開操作が `state / start / play / pause / seek / seekRelative / setSpeed / setVolume / stop / fail / subscribe` の 11 個（着手前の 10 個に `fail` を足したもの）。
- **既存コードから呼ばれていない**: `grep -rln "@/lib/playback/\|@/lib/platform/" app components hooks contexts lib --include='*.ts' --include='*.tsx' | grep -v '^lib/playback/\|^lib/platform/'` が 0 件（2026-09-30 実測 0 件。パターンは末尾スラッシュ付き。スラッシュ無しの `@/lib/playback` は旧 `@/lib/playbackQueue`・`@/lib/playbackPosition` に前方一致する）。
- `lib/playback/*.ts` の参照の制約: `grep -rn "from 'react'\|fetch(\|localStorage\|caches\.\|new Audio\|@/lib/api" lib/playback | grep -v "import type .* from '@/lib/api/gateway'"` が 0 件（2026-09-30 実測 0 件）。
- 変更ファイルが `lib/playback/session.ts` と上のテスト 2 本だけ: `git -C web diff --name-only origin/main`（worktree ルートでは `git -C web`、`web/` の中では `git diff --name-only origin/main`）が 3 行。

## 禁止事項 / scope 外
- 13 遷移の分母に `fail` を足さない。`stop` の動作を変えない。
- `ports.ts`・`queue.ts`・`source.ts`・`resume.ts`・`lib/platform/*` を変えない。
- `contexts/` `hooks/` `components/` `app/` を変えない。旧再生実装を変えない。
- Coordinator・OfflineLibrary・PositionReporter を作らない（W-S2a2）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/playback/session.test.ts`（64 件）・`queue.conformance.test.ts`（32 件）・`queue.test.ts`（31 件）。加えて `npm test` 全件。

## 検証
`npm test`（既存件数 ＋ 新規）、上記 grep 2 種が 0 件、`npm run build` 成功。

## 記録
- 完了時、共有仕様 §4.1 の Q-33 の web の保留（解除条件 = 本 slice の完了）を解除できる旨を親 docs へ返す。
- 既存テストで型の絞り込みを足した箇所を PR 説明に列挙する。
- 棄却・方針転換があれば `docs/trial-log/` に追記。
