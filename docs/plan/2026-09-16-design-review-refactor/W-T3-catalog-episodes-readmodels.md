## web リファクタ W-T3: Catalog — 一覧・詳細をリードモデルにし、生成の完了の検知とポーリングの停止を 1 箇所にする（UC-S1。適用 slice）

## 概要
`app/(app)/podcast/page.tsx`・`podcast/[id]/page.tsx`・`components/PodcastCard.tsx` が持つ DTO の保持（`useState<Podcast[]>`）と `decodeEpisode` の直呼び（TP-A4）を、Catalog の query（TA-Q-CT-2〜4）とリードモデル（`EpisodeCardView`・`EpisodeDetailView`）に置き換える。生成の完了の検知（`podcast/page.tsx` の `useEffect`）とポーリングの停止の条件（`lib/podcastPolling.ts`・`hooks/usePodcastListPolling.ts`・page の 3 箇所）を `lib/catalog/domain/generationWatch.ts` の 1 箇所にする（TA-R-CT-6）。`lib/podcastTitle.ts`・`lib/podcastPolling.ts` の最後の利用が消えるので削除する。**利用者に見える挙動・文言・request は変えない**。正本は新 Spec §5.2（TA-M-CT・TA-Q-CT-2〜4・TA-R-CT-6・10）・§8.2 W-T3 行・§8.4 TP-A4・TP-A6・§10.1 W-35、既存 Spec §1.2 UC-S1・§3.2「生成状態の遷移検知」。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (1)(3)、AQ-1・AQ-3・AQ-4、F-POD-01・F-POD-07、UC-S1（既存 Spec §1.2）、TA-R-CT-6・TA-R-CT-10、TA-V4・TA-V6・TA-V7、導出 W-35。

## 種別
適用 slice。判断待ちに依存しない。W-T4・W-T5・W-T6・W-T7a・W-T8・W-T9・W-T10a とは順序を問わない（page が重ならない）。

## 規模（見込み。根拠 = 2026-10-01 実測: `podcast/page.tsx` 235 行、`podcast/[id]/page.tsx` 455 行、`PodcastCard.tsx` 173 行、`usePodcastListPolling.ts` 113 行、`lib/podcastPolling.ts` 49 行。W-S2b・W-S4a・W-S4d1 の後に行数は変わる）
- production ≈ 380 行: `lib/catalog/domain/generationWatch.ts` ≈ 50、`lib/catalog/application/{queries,readModels,ports}.ts` ≈ 140、`lib/catalog/infrastructure/catalogGateway.ts` ≈ 60、page 2 本 ≈ 80、`PodcastCard.tsx` ≈ 30、`usePodcastListPolling.ts` ≈ 20。削除 `lib/podcastTitle.ts` 21・`lib/podcastPolling.ts` 49。
- test ≈ 350 行: `generationWatch.test.ts` ≈ 80（`podcastPolling.test.ts` の観点を移す）、`queries.test.ts` ≈ 100、`catalogGateway.test.ts` ≈ 40、`tests/architecture/cqrs.catalog.test.ts` ≈ 40、`immutability.catalog.test.ts` への追加 ≈ 30、page テストの mock 置換 ≈ 60。
- 合計 ≈ 800 行（10² 行の後半。新 Spec §8.2）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み（page が `lib/catalog/infrastructure/api` と `useApiClient()` を使い、TP1 が無い）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-T2（`Episode`・`episodeMapper`・`episodeGateway`）・W-S4a（`PodcastCard` の `Episode` 種別の props・`failureMessage`）・W-S2b（`usePlayback()`・`usePlaybackActions()`）はその前提。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow` / `queue-autoadvance` / `offline-playback`。
- 確定済み（再提案しない）: UC-S1 の持ち主は W-T3（W-35）。完了の演出（1.5 秒）は presentation に残す（TA-R-CT-6 の依存先）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S2b・W-S4a・W-S4d1 で行番号が動くので、投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 一覧 page の DTO 保持と取得 | `podcast/page.tsx:53` `useState<Podcast[]>`、`:60-73` `fetchPodcasts`（取得＋toast＋ポーリングの入力） | `grep -n "useState<\|fetchPodcasts\|showToast" 'app/(app)/podcast/page.tsx'` |
| 生成の完了の検知 | `podcast/page.tsx:79-108`（`prevStatus !== 'completed' && p.status === 'completed'` `:91`。1.5 秒の演出 `:98-102`） | `grep -n "completed" 'app/(app)/podcast/page.tsx'` |
| ポーリングの停止（3 箇所） | `lib/podcastPolling.ts:34-45` `shouldStopPolling`（件数の増加・`POLL_TIMEOUT_MS` = 120000）、`hooks/usePodcastListPolling.ts:63-79`、`podcast/page.tsx:55,153-159`（`pollingEnabled`） | `grep -rn "shouldStopPolling\|POLL_TIMEOUT_MS\|pollingEnabled" app hooks lib` |
| 詳細 page | `podcast/[id]/page.tsx:42` `useState<Podcast \| null>`、`:56` 取得、`:393-425` 出典と CC BY-SA（`source_kind === 'featured'` `:417`）。クイズ・語彙（`:104-161,240-370`）は W-T11 | `grep -n "useState<\|source_kind\|getPodcast" 'app/(app)/podcast/[id]/page.tsx'` |
| `PodcastCard` の props | `components/PodcastCard.tsx:8-22`（`podcast: Podcast`・`onPlay(podcast)`・`savedPosition`・`playing`・`onPlayNext`・`onAddToQueue`・`cached`・`onDownload`・`justCompleted`）。W-S4a の後は `Episode` 種別の props | `sed -n 8,22p components/PodcastCard.tsx` |
| `podcastTitle` の利用 | `components/AudioPlayerBar.tsx`・`PodcastCard.tsx` ほか。W-S2b の後は `AudioPlayerBar` が `nowPlaying().title` を読むので残るのは Catalog 側だけ | `grep -rn "podcastTitle" app components hooks contexts lib \| grep -v '^lib/podcastTitle\.ts'` |
| 許可リストの `removeBy: W-T3` | TA-D4 (a) 5 ファイル（`podcast/page.tsx`・`podcast/[id]/page.tsx`・`PodcastCard.tsx`・`StatusBadge.tsx`・`DifficultyBadge.tsx`）＋ TA-D5（TP-A6 の `lib/catalog/infrastructure/api`。W-S4d1 の後の specifier）＋ TA-R-CT-2（`lib/podcastTitle.ts`）＋ TA-D5（TP-A4: page の `episodeMapper` import。W-S4a が載せる） | `grep -B4 '"removeBy": "W-T3"' architecture/boundaries.allowlist.json` |
| page テスト | `tests/app/podcast/page.test.tsx`・`tests/app/podcast/id/page.test.tsx`・`tests/components/PodcastCard.test.tsx`（W-S4d2a で gateway double 化済み） | `ls tests/app/podcast tests/components/PodcastCard.test.tsx` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/catalog/domain/generationWatch.ts`（TA-R-CT-6）: `detectCompleted(prev: ReadonlyArray<{ id; kind }>, next: 同) → ReadonlyArray<string>`（前回は完了でない → 今回は完了。初回は空）と `shouldStopWatching({ baselineCount, currentCount, elapsedMs }) → { stop: boolean; reason: 'new-episode' | 'timeout' | null }`（件数が増えた・120 秒。`GENERATION_WATCH_TIMEOUT_MS` = 120000・`GENERATION_WATCH_INTERVAL_MS` = 5000 をここに置く。`lib/podcastPolling.ts` と同じ規則）。純関数。
2. `lib/catalog/application/readModels.ts`: `EpisodeCardView`（`id`・`kind: 'playable' | 'generating' | 'failed'`・`title`（`displayTitle(label, n)` の結果。`n` は現行 `PodcastCard` が `podcastTitle` に渡している値）・`difficulty`・`createdAt`・`durationSeconds`・`failureReason`（`failed` のときだけ）・`statusLabelKind`（`StatusBadge` の入力。`partial_failed` は無い）・`savedPositionSeconds: number | null`・`isCached: boolean`）と `EpisodeDetailView`（`EpisodeCardView` の field ＋ `transcript`・`glossary`・`quiz`・`sources: ReadonlyArray<{ articleId; source; title; url }>`・`showsShareAlikeNotice: boolean`）。全 field `readonly`・凍結済み。`Podcast`・`Episode` の object を含まない。
3. `lib/catalog/application/ports.ts`: `CatalogGateway` に `listEpisodes() → Promise<Result<ReadonlyArray<Episode>, ApiFailure>>`・`getEpisode(id) → Promise<Result<Episode, ApiFailure>>`（W-T2 の `EpisodeSource.fetch` を流用してよい）を置く（W-T4・W-T5 が Feed・Source の操作を足す）。
4. `lib/catalog/application/queries.ts`: `createCatalogQueries(deps)`。`listEpisodes()`（TA-Q-CT-2）・`getEpisodeDetail(id)`（TA-Q-CT-3）・`watchGeneration(prev, next)`（TA-Q-CT-4。`generationWatch` を呼ぶだけ）。`deps` = `CatalogGateway`・`savedPosition(id)`（Playback の `PlaybackQueries.savedPosition`）・`isCached(id)`（`PlaybackQueries.offline.has`）。query は値を返すだけで、toast は hook が結果を見て出す（新 Spec §5.2「1 つの操作が読む・書くの両方をしている現状」）。
5. `lib/catalog/infrastructure/catalogGateway.ts`: `createCatalogGateway(gateway: ApiGateway)`。`lib/api/podcasts.ts` の `getPodcasts`・`getPodcast` を呼び、`decodeEpisode` で `Episode` に変換して返す。
**変更（production）**
6. `app/(app)/podcast/page.tsx`: `useState<Podcast[]>` → `useState<ReadonlyArray<EpisodeCardView>>`。取得は `queries.listEpisodes()`。失敗の toast は現行の文言のまま hook（page）が出す。完了の検知は `queries.watchGeneration(prev, next)` の結果で `justCompletedIds` を作る（1.5 秒の演出は page に残す）。ポーリングの停止の判定を page から消す（`pollingEnabled` の state は hook の戻り値で置き換える）。`decodeEpisode` の直呼び（TP-A4）と `@/types`・`@/lib/catalog/infrastructure/*` の import を消す。
7. `app/(app)/podcast/[id]/page.tsx`: `useState<Podcast | null>` → `EpisodeDetailView | null`。出典と CC BY-SA は `view.sources`・`view.showsShareAlikeNotice` を読む（`source_kind` の判定を page から消す。TA-R-CT-10）。クイズ・語彙の state と handler は変えない（W-T11。`view.quiz`・`view.glossary` を読む形にだけ直す）。
8. `components/PodcastCard.tsx`: props を `episode: EpisodeCardView` にする（W-S4a が置いた `Episode` 種別の分岐は `kind` の分岐に置き換える。▶は `kind === 'playable'` だけ）。`onPlay(id)` ほか handler の引数は `id`。`StatusBadge` の入力は `statusLabelKind`（`components/ui/StatusBadge.tsx` の `PodcastStatus` import を消す）。`DifficultyBadge.tsx` は `DifficultyLevel` を `@/lib/shared/difficulty` から import する。
9. `hooks/usePodcastListPolling.ts`: `shouldStopWatching` と定数を `@/lib/catalog/domain/generationWatch` から取り、`enabled` の分割を無くす（hook が停止を決めて `stopped: boolean` を返す。呼出側が `enabled` を渡す形はやめる）。
10. `architecture/boundaries.allowlist.json`: `removeBy: "W-T3"` の行を消す。
**削除**: `lib/podcastTitle.ts`・`tests/lib/podcastTitle.test.ts`（観点は W-T2 の `displayTitle` のテストが持つ）、`lib/podcastPolling.ts`・`tests/lib/podcastPolling.test.ts`（観点は 1 の `generationWatch.test.ts` へ移す）。
**テスト**: `tests/lib/catalog/domain/generationWatch.test.ts`・`tests/lib/catalog/application/queries.test.ts`・`tests/lib/catalog/infrastructure/catalogGateway.test.ts`・`tests/architecture/cqrs.catalog.test.ts`、page 3 本と `usePodcastListPolling` のテストの mock 置換（oracle は不変）。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| domain `lib/catalog/domain/generationWatch.ts` | 完了の検知・停止の条件・定数 | TA-R-CT-6 |
| application `queries.ts`・`readModels.ts`・`ports.ts` | TA-Q-CT-2〜4・2 つのリードモデル・`CatalogGateway` | TA-Q-CT-2〜4 |
| infrastructure `catalogGateway.ts` | DTO → `Episode`（`decodeEpisode` を呼ぶ） | W-18 |
| presentation（page 2・`PodcastCard`・`usePodcastListPolling`） | リードモデルを描く・演出・toast・駆動 | — |

## 移行の中間状態
| ID | 扱い |
|---|---|
| TP-A4（page が DTO を持ち `decodeEpisode` を自分で呼ぶ） | 本 slice で消す（許可リストの該当行 = `removeBy: W-T3`） |
| TP-A6（page が `lib/catalog/infrastructure/api` を直接 import） | Catalog の一覧・詳細の分を消す。Feed（W-T4）・購読（W-T5）の分は残る |
| `QueueEntryInput` への写し（W-S2b。page が DTO から 3 field を写す） | `EpisodeCardView` から `{ id, title: label.title, intro: label.intro }` を作る形になるので、`EpisodeCardView` に `label: EpisodeLabel` を持たせる（`title` は表示用、`label` は command の入力用。両方 readonly） |

## 変わる挙動
無い（一覧・詳細の表示・toast の文言・ポーリングの間隔と停止の条件・request の path と method は不変。判定は既存 page テストと e2e 3 本）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-CT-6 | `generationWatch.test.ts`: `podcastPolling.test.ts` の全観点（件数の増加・timeout・継続）＋ `detectCompleted`（初回は空・`generating → playable` だけ検知・`failed` は検知しない）。テスト名に `UC-S1` を含める |
| TA-R-CT-10 | `queries.test.ts`: `showsShareAlikeNotice` が `EpisodeDetailView` に写る |
| TA-V4 | `tests/architecture/rules.test.ts`: TA-R-CT-6 の式（`POLL_TIMEOUT_MS`・`!== 'completed' && … === 'completed'`）の出現が `lib/catalog/domain/generationWatch.ts` 以外に 0 件。TA-R-CT-2 の行（`lib/podcastTitle.ts`）を許可リストから消す |
| TA-V6 | `immutability.catalog.test.ts`: `listEpisodes()`・`getEpisodeDetail()` が観点 2・3（凍結・別 object・等しい内容）を満たす |
| TA-V7 | `cqrs.catalog.test.ts`: (a) `CatalogQueries` の入口の名前の集合が §5.2 の表（本 slice の分: `listEpisodes`・`getEpisodeDetail`・`watchGeneration`）と一致。(b) 書き込む port の double を渡し、query を全部呼んでも記録 0 件。(c) 戻り値がリードモデルの型 |
| TA-V9 | `tests/app/podcast/*`・`tests/components/PodcastCard.test.tsx`・`tests/hooks/usePodcastListPolling.test.ts`（存在すれば）が文言の assertion を変えずに green。e2e 3 本 |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。`npm run test:e2e`（`main-flow` / `queue-autoadvance` / `offline-playback`）green。
- **DTO を持たない**（量化する集合 = `app/(app)/podcast/page.tsx`・`podcast/[id]/page.tsx`・`components/PodcastCard.tsx`・`components/ui/{StatusBadge,DifficultyBadge}.tsx`）: `grep -n "from '@/types\|from '@/lib/catalog/infrastructure\|decodeEpisode\|useState<Podcast" <5 ファイル>` が 0 件。
- **停止の条件が 1 箇所**（集合 = `lib app components hooks contexts`）: `grep -rn "POLL_TIMEOUT_MS\|shouldStopPolling\|GENERATION_WATCH_TIMEOUT_MS\|!== 'completed'" lib app components hooks contexts` の出現が `lib/catalog/domain/generationWatch.ts` だけ。
- **削除**: `lib/podcastTitle.ts`・`lib/podcastPolling.ts` とそのテスト 2 本が存在しない。`grep -rn "podcastTitle\|podcastPolling" app components hooks contexts lib tests` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T3"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- TA-V6・TA-V7 の Catalog のテストが green。
- 表示文言・toast が不変（page テストの文言 assertion に diff が無い。PR 説明に diff の要約）。

## 禁止事項 / scope 外
- Feed（`feed/page.tsx`・`ArticleCard`）・購読・onboarding・入口の判定を変えない（W-T4・W-T5）。クイズ・語彙の command・`Learning` の domain を作らない（W-T11）。
- `lib/catalog/domain/episode.ts` の判別の規則・`episodeMapper` を変えない（W-T2）。`failureMessage`（W-S4a）の文言を変えない。
- Playback（`lib/playback/**`・`PlaybackProvider`・`AudioPlayerBar`）を変えない。`usePlayback()` の公開面を変えない。
- ポーリングの間隔（5 秒）・停止の条件（件数の増加・120 秒）・完了の演出（1.5 秒）を変えない。
- backend の契約・`lib/api/podcasts.ts` の path と method を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/podcast/page.test.tsx`・`tests/app/podcast/id/page.test.tsx`・`tests/components/PodcastCard.test.tsx`・`tests/lib/podcastPolling.test.ts`・`tests/lib/podcastTitle.test.ts`（削除前の観点の pin）・`tests/hooks/`（`usePodcastListPolling` のテストがあれば）、e2e 3 本。

## 検証
`npm test`、上記 grep 4 種、`npm run lint`、`npm run build`、`npm run test:e2e`。

## 記録
- 完了時、UC-S1 の停止条件の単一所有（既存 Spec §7 の「CI 対象外 11 件」の UC-S1）が満たされた旨と、TP-A4 の削除を親 docs へ返す。導出 W-35 を台帳 §5.0 へ登録する旨を返す。
- 親 docs web-design §12.1 Catalog 行を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §5.2・§7（TA-V4・V6・V7）・§8.2（W-T3 行）・§8.4（TP-A4・TP-A6）・§10.1（W-35）
- 既存 Spec §1.2（UC-S1）・§3.2（生成状態の遷移検知）
