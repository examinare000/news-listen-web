## web リファクタ S2: 再生正本の一本化（`lib/playback/*`・`PlaybackProvider`・一括切替 SG8）

## 概要
「現在再生中」の二重表現（`Queue` と `AppContext.currentPodcast`）、速度の 1 概念化、再生セッションの非構造化 boolean 群を解消し、`lib/playback/` にドメインモデルを一本化する。正本は user 承認済みの Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（§3.1 Playback モデル・§4 CI-T1〜T11・§5 CP1〜CP4/CP9・§6 S2 行）。本タスクは**承認済み指示書に従う実装**であり、analyze_order は検証モード（新規設計をしない）。generate_spec の spec.md は Spec の該当契約（CI-T1〜T11）の抜粋で足り、契約 ID は Spec のものを再利用する。

着手順 3（S1 に依存）。**検証モード**: 状態遷移・失敗方針・速度規則は Spec で決定済みであり、本タスクで再設計しない。

## 前提・着手条件
- 依存 slice: S1（`ApiGateway`・`ApiClientProvider`・再生系 4 箇所の注入）が main に merge 済みであること。
- **SG8（一括切替、user 2026-09-16 承認）**: S2 は小ステップではなく一括切替。入口条件 = 下記「特性テスト（baseline）」の 12 ファイル＋e2e 3 本（`offline-playback` / `queue-autoadvance` / `main-flow`）が**すべて追加・green** になってから切替に入る。それ以前は revert 以外の回復手段がない（Spec §6 rollback）。
- **Selection Gate は確定済み（共有仕様 §6.7、2026-09-16 user 判断）。本 slice で実装する**:
  - SG-X1: 完聴時は位置 0 ではなく **`duration` を明示的に 1 回送る**（順序: 完聴イベント → `duration` → advance。共有仕様 §6.4・PS-06）。現行 `useAudioPlayer` の `handleEnded` が行う `onPositionSave(id, 0)` は `duration` へ改める（local の 0 保存は resume 規則が先頭に写すため不要になるが、`localStorage` の互換は S4 の Preferences 移行まで現状維持でよい）。
  - SG-X2: `resolveResumePosition` に duration を渡し、**末尾 2 秒窓**（共有仕様 §4.3 RS-01〜RS-07 の全行）を実装する。現行は server 位置をそのまま使い窓判定がない。
  - SG-X4: web は現行どおり再生中のみ周期送信（変更なし。PS-05b で pin）。
- **SG9（RF16/18/19/20 の作業化、user 2026-09-16 採用）**: レビュー §8.3 で「記録のみ・変更しない」とされた RF16（完聴重複・位置順序）、RF18（Queue 不変条件 gate）、RF19（依存方向）、RF20（SW prefix pin テスト）を、本 slice の一部として作業化する（CP9 / `Queue.create` / 依存禁止 eslint / T-T18 は S2 の構造変更に付随するため）。RF4・RF14・RF22 は本 slice で扱わない。RF17 は UV3 の観測のみ。
- 棄却済み案（再提案しない、Spec §5 rejected_overdesign）: 旧 `AudioPlayerProvider` と新 `PlaybackProvider` の併存移行（SG3 の正本一意と二重 owner が両立しないため不採用）、`QueueState` の branded type 化（iOS/Android 共有型の乖離になるため不採用）、`Clock` port（学習サイクルで再判定）。
- `docs/trial-log/` を最初に読み、棄却済み案（Provider 併存移行等）を再試行しない。

## 対象（web サブモジュールのみ）
1. **`lib/playback/session.ts`**: `PlaybackSession`（transport 状態の正本、排他 union）。状態: `idle` / `loading`（episode, resumePosition, speed）/ `paused`（episode, position, duration, speed）/ `playing`（同上）/ `ended`（episode, duration）/ `errored`（episodeRef または episode, position, `reason: media|autoplay_blocked|source_unavailable|fetch_failed(ApiFailure)`）。分母 13 遷移（Spec §3.1 の表）。位置は `[0, duration]` に clamp（CI-P08）。速度は `PLAYBACK_SPEEDS` 内（OB-C9）、`start` 時はセッション速度を既定速度で初期化し `load` 後に再適用（CI-T4）。`positionChanged` / `listenCompleted` / `stateChanged` を emit（CP1）。
2. **`lib/playback/queue.ts`**: 既存 `lib/playbackQueue.ts` の `QueueState` と公開操作（`emptyQueue`, `current`, `upNext`, `start`, `setQueue`, `add`, `playNext`, `jump`, `advance`, `remove`, `moveUpNext`）を移設し、内部不変条件 gate `Queue.create(items, currentIndex)` を追加（不変条件 1〜3 違反は programmer error として throw。公開操作自体は throw せず §2 どおり正規化する。CI-T9）。`Queue.current` を「現在再生中（の位置）」の唯一の正本とする（SG3・OB-C12）。
3. **`lib/playback/source.ts` / `resume.ts`**: 既存の純関数 `resolvePlaybackSource`, `resolveResumePosition` を移設。`'unavailable'` は Coordinator が `errored(source_unavailable)` に写す（CI-X02 / OB-C6）。
4. **`lib/playback/offlineLibrary.ts`**: 既存 `lib/audioCache.ts` を移設・改称。`save`（応答 ok のみ格納、audio→meta→episode の順で書き、最後の書込完了まで `has()` は false）、`get`（`PlayableEpisode & {audioHandle}` を返す。`audioHandle.release()` で revoke、発行者＝解放者）、`remove`/`clear`/`list`（列挙中の削除で例外を投げない）/`usage`。
5. **`lib/playback/coordinator.ts`**: `PlaybackCoordinator`。`startEpisode(id)`（source 解決 → cached/network/unavailable の分岐 → Playable でなければ `errored(source_unavailable)` → Queue jump/playNext → `resume = resolveResumePosition` → `session.start`）、`onEnded`（`ListenCompleted` fire-and-forget → 位置 0 保存 → `Queue.advance` → 次があれば `startEpisode`、失敗時は**停止**: `current` は失敗エピソードのまま、`errored(reason)`、手動 `play()` で再試行）、`nowPlaying()`（`Queue.current` から id、`session.episode` から title/difficulty/createdAt/duration を導出する view model。CI-T7）。
6. **`lib/playback/positionReporter.ts`**: `PositionReporter`（CP9）が位置 writer を単独所有。`session` の `positionChanged`/`listenCompleted` 事象を受け、10 秒 throttle・local 書込・server 書込の単調非減少（完聴の 0 は最後の例外）・順序（onCompleted → local 0 → server 0、CI-A13）を一手に持つ。`session.ts`（CP1）は storage を持たない。
7. **`contexts/PlaybackProvider.tsx`（新規）**: 旧 `contexts/AudioPlayerContext.tsx`（`AudioPlayerProvider`）を置換。React 配線のみ（adapter 生成と capsule 配線）。
8. **`AppContext.currentPodcast` 削除**: `Queue.current` の派生値へ完全移行。UI が「何が再生中か」を問う唯一の入口は `nowPlaying()`。
9. **`components/AudioPlayerBar.tsx` の DTO 直読み解消**（`components/AudioPlayerBar.tsx:16,28-30,65-66,139,160`）: `Podcast` DTO の `duration_seconds`/`difficulty`/`created_at` 直読みを `nowPlaying()` の view model（title, difficulty, createdAt, durationSeconds, episodeId）へ置換。`AppContext.currentPodcast` 削除と同時に必ず型が変わるため、この変更を S2 に含める（S4 に送らない、gate 指摘 1）。
10. **`app/(app)/podcast/page.tsx:199` の「再生中」判定**を `nowPlaying()` へ置換。
11. **`useStartPodcast` 削除**: Coordinator の `startEpisode` を直接呼ぶ形に統合。
12. **`lib/playback/queue.ts` の `reorderUpNext` → `moveUpNext` rename**: 挙動不変の純粋 rename（引数意味＝upNext 基準・削除前オフセット、conformance 行 ID は不変）。影響: `lib/playbackQueue.ts:95`, `contexts/AudioPlayerContext.tsx:188`, テスト 3 ファイル。**独立コミット**とする。
13. **`EpisodeDecoder`（Coordinator 内）**: DTO → `Episode` 判別共用体（`PlayableEpisode` / `GeneratingEpisode` / `FailedEpisode`）。矛盾 DTO は `FailedEpisode(errorMessage ?? 'inconsistent')` に fail-closed（IV1・CI-T11）。
14. **依存方向 eslint（RF19、SG9 で本 slice に含む）**: `no-restricted-properties` で `currentPodcast` 参照を禁止、`no-restricted-imports` で `contexts/` → `components/` の import を禁止（T-T7b）。CI（S3）での実行は S3 の担当だが、ルール自体は S2 で導入する。
15. **`sw.js` prefix 集合の pin テスト（RF20、TP2）**: `sw.js` と cleanup の prefix 集合が一致することを T-T18 で検証（fs 読み比較。capsule API 外の例外的テスト）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T1 | 状態は 13 遷移の union のみ | T-T1: `AudioElement` port の double でイベント駆動し `state()` を観測 |
| CI-T2 | `play()` reject → `errored(autoplay_blocked\|media)`。重複 `play()` は 1 状態に収束 | T-T2 |
| CI-T3 | `start` 後の位置は `resolveResumePosition(server, duration)`（末尾 2 秒窓: RS-01〜RS-07）。`loadedmetadata` 後に再適用 | T-T3（unit・RS-01〜07 の行 ID を含む）＋ UV3（e2e 実ブラウザ） |
| CI-T4 | セッション速度は `start` で既定速度に初期化、以後保持、`load` 後に再適用（`playbackRate` と `defaultPlaybackRate` の両方を設定） | T-T4 |
| CI-T5 | `unavailable` → network 取得なし、`errored(source_unavailable)` | T-T5: gateway double が呼ばれない＋状態 |
| CI-T6 | advance 失敗後: `Queue.current` = 失敗エピソード、`errored(fetch_failed)`、`retry()` が `startEpisode` を再実行 | T-T6 |
| CI-T7 | INV-P1（`session.episode.id === Queue.current.id`）。唯一の読出口は `nowPlaying()`。`AppContext.currentPodcast` と DTO 直読みは存在しない | T-T7a（unit、全操作後に検査）／T-T7b（eslint、S3 で CI 実行） |
| CI-T8 | `ListenCompleted` は 1 セッション内 1 回。server 位置書込は単調非減少。順序 = onCompleted → server に `duration` を 1 回 → advance（共有仕様 PS-06） | T-T8: gateway double の呼出列と値を観測（PS-06 の行 ID を含む） |
| CI-T9 | 公開操作は §2 どおり正規化し throw しない。戻り値は不変条件 1〜3 を満たす | 既存 conformance 32 件（不変）＋ T-T9: 公開操作の戻り値に対する property test |
| CI-T10 | `save` は ok 応答のみ、完了前 `has()` false、重複収束。`get` は Playable か null。handle は release で revoke | T-T10: deferred-put `CacheStore` double で途中状態を `has()` から観測 |
| CI-T11 | DTO → 判別共用体。矛盾 DTO は `FailedEpisode` に fail-closed | T-T11（表駆動 status 4 × audio_url 2 × error_message 2 = 16） |

## 特性テスト（baseline。着手前に green を確認。**7 + 5 = 12 ファイル**）
`tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`、`tests/hooks/useAudioPlayer.test.ts`、`tests/lib/audioCache.test.ts`、`tests/lib/playbackQueue.{test,conformance.test}.ts`（以上 7）、`tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/app-group-layout.test.tsx`、`tests/contexts/AppContext.test.tsx`、`tests/app/settings/page.test.tsx`（速度）（以上 5）。加えて e2e `offline-playback` / `queue-autoadvance` / `main-flow` の 3 本。

## 手順
1. baseline: 上記 12 ファイル＋e2e 3 本すべて green を確認・記録（SG8 の入口条件）。
2. T-T11（EpisodeDecoder）→ RED → 実装 → GREEN。
3. T-T9（Queue.create gate・正規化不変条件）→ RED → `lib/playback/queue.ts` 実装 → GREEN。`reorderUpNext` → `moveUpNext` rename は**独立コミット**として先に、または本ステップ内で分離して行う。
4. T-T1〜T4（PlaybackSession）→ RED → `lib/playback/session.ts` 実装 → GREEN。
5. T-T5〜T7（Coordinator・INV-P1・nowPlaying）→ RED → `lib/playback/coordinator.ts` 実装 → GREEN。
6. T-T8（PositionReporter）→ RED → `lib/playback/positionReporter.ts` 実装 → GREEN。
7. T-T10（OfflineLibrary）→ RED → `lib/playback/offlineLibrary.ts` 実装 → GREEN。
8. T-T18（TP2、sw.js prefix pin）→ RED → テスト追加 → GREEN。
9. `contexts/PlaybackProvider.tsx` を組み立て、`AppContext.currentPodcast` 削除、`AudioPlayerBar` と `podcast/page.tsx:199` を `nowPlaying()` へ置換、`useStartPodcast` 削除。
10. 12 特性テスト＋e2e 3 本が green であることを確認してから、旧 `AudioPlayerProvider` から `PlaybackProvider` への**一括切替**（SG8）を行う。
11. **TP2（temporary path）を導入する**: `sw.js` prefix 文字列の複製を pin テストで保持。owner: user。導入: S2。削除条件: ビルド時注入か SW を module 化した時。
12. UV3（resume 再適用・load 後の速度リセット）を e2e（Chromium）で実ブラウザ観測する。
13. `reorderUpNext` → `moveUpNext` rename は独立コミットのまま残す（他の実装変更と混ぜない）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` すべて成功。
- e2e `offline-playback` / `queue-autoadvance` / `main-flow` が green。
- T-T1〜T11・T-T18 が `verifies: CI-T*` をテスト名またはコメントに持つ。
- `AppContext.currentPodcast` が存在しない（grep 0）。`components/`・`hooks/`・`app/` から `Podcast` DTO を「再生中」の意味で読む箇所がない。
- `contexts/` → `components/` の import が存在しない（eslint `no-restricted-imports` で 0 件）。
- `reorderUpNext` → `moveUpNext` rename が独立コミットになっている。
- 完聴時に `duration` が送られ（PS-06）、resume が RS-01〜RS-07 のとおりに解決される（T-T3）。

## 禁止事項 / scope 外
- 旧 `AudioPlayerProvider` と新 `PlaybackProvider` の併存移行はしない（棄却済み）。
- `QueueState` の branded type 化はしない（棄却済み）。
- `lib/api` の context 別分割・page 側 15 ファイルの注入点移行（S4）は行わない。
- RF4・RF14・RF22 はこの slice で扱わない。
- 仕様にない業務条件を足さない。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.1（Playback モデル）・§4（CI-T1〜T11）・§5（CP1〜CP4, CP9・naming_decisions・rejected_overdesign）・§6（S2 行・gate 指摘 1・§8 からの逸脱 SG9）
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.3（RF7〜RF9・RF12・RF16〜RF20）
- 親 docs: `shared-playback-spec.md` §2.11（advance 後の再生失敗）・§4.3 RS-01〜07（再開位置）・§4.4 PS-01〜08 / SL-01〜05（再生セッション・主体離脱）・§6.4〜§6.7（SG-X1〜X5）。準拠テストは行 ID（`PS-*`/`SL-*`/`RS-*`）をテスト名に含める。
