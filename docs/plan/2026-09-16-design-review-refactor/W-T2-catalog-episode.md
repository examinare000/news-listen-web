## web リファクタ W-T2: Catalog の `Episode`（判別・生成関数・`QueuedEpisode`・`displayTitle`）と DTO からの変換（適用 slice。既存コードから呼ばない）

## 概要
再生可能の規則（TA-R-CT-1）と表示用の題の規則（TA-R-CT-2）を Catalog の domain `lib/catalog/domain/episode.ts` に置き、`Podcast` DTO からの読み取りを `lib/catalog/infrastructure/episodeMapper.ts`、取得を `episodeGateway.ts`（Playback の port `EpisodeSource` の実装）に置く。`lib/playback/domain/session.ts` の `PlayableEpisode` を Catalog の domain の型に替え、TP-A3 を消す。**既存のコード（page・旧再生実装・`lib/podcastTitle.ts`）からは呼ばない**。画面への展開は W-S4a、Coordinator からの利用は W-S2a2。正本は新 Spec §5.2（TA-M-CT・TA-R-CT-1・2・10・11）・§5.1（`PlayableEpisode`・`QueuedEpisode`）・§8.2 W-T2 行・§10.1 W-18、既存 Spec §3.2（`Episode` の判別の表）・§4 CI-T11・§5 CP5。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (1)(2)・NFR-10、AQ-1・AQ-3・AQ-6、F-POD-01・F-POD-07（PRD §5）、CI-T11（既存 Spec §4）、共有仕様 §4.4 PS-07・PS-07b、TA-R-CT-1・2・10・11、TA-V3 (b)・TA-V4・TA-V5・TA-V6、ADR-102・ADR-108（`error_message` の値域）・ADR-095（CC BY-SA の表示条件）、導出 W-12・W-18・W-31。

## 種別
適用 slice。判断待ちに依存しない。

## 規模（見込み。根拠 = 2026-10-01 実測: `types/index.ts` の `Podcast` `:87-113`、`lib/playback/domain/session.ts` の `PlayableEpisode` `:17-32`（W-T1 後の path）、`lib/podcastTitle.ts` 21 行）
- production ≈ 200 行: `lib/catalog/domain/episode.ts` ≈ 120（型 ≈ 50・`classifyEpisode` ≈ 25・生成関数と凍結 ≈ 30・`displayTitle` ≈ 10）、`lib/catalog/infrastructure/episodeMapper.ts` ≈ 40、`episodeGateway.ts` ≈ 15、`session.ts` の型の差し替え ≈ 10、`lib/playback/application/ports.ts`（`EpisodeSource` の型だけ。W-S2a2 がほかの port を足す）≈ 10。
- test ≈ 250 行: `tests/lib/catalog/domain/episode.test.ts` ≈ 120（T-T11 の 16 行・`displayTitle`・`SourceCredit`）、`tests/lib/catalog/infrastructure/episodeMapper.test.ts` ≈ 60、`episodeGateway.test.ts` ≈ 30、`tests/architecture/immutability.catalog.test.ts` ≈ 40。
- 合計 ≈ 450 行。

## 前提・着手条件
- 依存 slice: **W-T1**（`lib/playback/domain/`・`lib/shared/`・許可リスト）と **W-S2a1**（`fail`・`EpisodeRef`・`isPlayableEpisode`）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- backend の契約: `GET /podcasts/{id}` の `error_message` は識別子（`generation_failed`・`partial_failed`・`quota_exhausted`）か `null`（B-S0b 完了・ADR-102）。B-S6（`partial_failed` を出口で `failed` に写す・3 値）は**待たない**（mapper が 4 値を受ける。W-31）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない）: `partial_failed` は再生不可（SG-C64・ADR-108）。識別子以外の値は `generation_failed` と同じ扱い（W-31）。`Episode` の規則は Catalog の所有（W-18）。棄却済み: `Episode` を DTO 世代で分けること（既存 Spec §3.2 G4）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| `PlayableEpisode` の DTO 参照 | `lib/playback/domain/session.ts` の `transcript`・`vocabulary`・`quiz`・`sources`・`sourceKind` の 5 field が `Podcast['…']` を指す（W-T1 前は `lib/playback/session.ts:25-29`） | `grep -n "Podcast\[" lib/playback/domain/session.ts` |
| 許可リストの `removeBy: W-T2` | 2 行（TA-D1 と TA-D4 (b)。どちらも `session.ts`） | `grep -c '"removeBy": "W-T2"' architecture/boundaries.allowlist.json` |
| `Podcast` DTO の field | `types/index.ts:87-113`。`status: PodcastStatus`（4 値 `:15`）・`audio_url`・`error_message: string \| null`・`title?`・`japanese_intro_text`・`segments?`・`vocabulary?`・`quiz?`・`source_articles?`・`source_kind?`・`duration_seconds`・`created_at`・`playback_position_seconds` | `sed -n 87,113p types/index.ts` |
| 再生可否の判定の現状 | 画面に無い（`components/PodcastCard.tsx:51-69` は status に関係なく▶を描く）。`grep -rn "status === 'completed'" app components` の出現は `podcast/page.tsx:91`（生成完了の検知）だけ | `grep -rn "status === '\|audio_url\|error_message" app components hooks lib --include='*.ts' --include='*.tsx'` |
| 表示用の題 | `lib/podcastTitle.ts`（`podcastTitle(p, maxLen)`。`title` が空なら `japanese_intro_text` の先頭 `maxLen` 字）。呼出は `components/AudioPlayerBar.tsx`・`PodcastCard.tsx` ほか | `grep -rn "podcastTitle" app components hooks contexts lib \| grep -v '^lib/podcastTitle\.ts'` |
| 取得の request | `lib/api/podcasts.ts:12` `getPodcast(id)` → `GET /api/backend/podcasts/{id}`（W-S4d1 の前は `legacyRequest` 経由） | `sed -n 12,14p lib/api/podcasts.ts` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/catalog/domain/episode.ts`:
   - 型 `Episode = PlayableEpisode | GeneratingEpisode | FailedEpisode`（判別は `kind`）。`PlayableEpisode` の field は既存 Spec §3.2 の表のとおり（`id`・`title`・`audioUrl`・`durationSeconds`・`difficulty: DifficultyLevel`（`lib/shared/difficulty`）・`createdAt`・`serverPositionSeconds`・任意の `transcript`・`vocabulary`・`quiz`・`sources`・`audioHandle?`）。内容の型 `TranscriptLine`・`GlossaryEntry`・`QuizQuestion`・`SourceCredit`（`showsShareAlikeNotice: boolean` を持つ。TA-R-CT-10: 運営者提示ソース由来のときだけ true）はこのファイルの domain の型で、`@/types` の型名を使わない。配列は `ReadonlyArray`、property は `readonly`（TA-D9）。
   - `FailedEpisode.reason` の値域は `'generation_failed' | 'quota_exhausted'`（TA-R-CT-11。`partial_failed` と識別子以外の値は mapper が `generation_failed` に写す）。
   - `classifyEpisode(input)`: 判別の規則（TA-R-CT-1）。入力は domain の語で書いた読み取り結果（`status: 'completed' | 'processing' | 'failed'`・`audioUrl`・`failure: … | null` ほか）。矛盾する組合せ（`completed` ∧ `failure` 非 null、`completed` ∧ `audioUrl` 空 など）は `FailedEpisode` に倒す（PS-07）。
   - 生成関数 `playableEpisode(...)`・`generatingEpisode(...)`・`failedEpisode(...)`・`queuedEpisode({ id, title, intro })`: 入力を複製して深く凍結する（新 Spec §5.0「値の生成」）。`audioHandle` は凍結の対象にしない。
   - `EpisodeLabel`（`{ title: string | null; intro: string }`）と `displayTitle(label, maxLen)`（TA-R-CT-2。規則は `lib/podcastTitle.ts` と同じ: `title` を trim して非空ならそれ、そうでなければ `intro` の先頭 `maxLen` 字。`maxLen` は 0 以上に丸める）。
   - `QueuedEpisode`（`{ readonly id: string; readonly label: EpisodeLabel }`。Queue の要素。W-17）。
2. `lib/catalog/infrastructure/episodeMapper.ts`: `decodeEpisode(dto: Podcast) → Episode`。DTO の field を読み、欠落の補完（`title` 欠落 → `null`、`segments` 等の `null` → 空）、`partial_failed` → `failed`（PS-07b・W-31）、`error_message` の識別子以外 → `generation_failed`、`source_kind === 'featured'` → `showsShareAlikeNotice: true`（ADR-095）を行ってから `classifyEpisode` へ渡す。`@/types` を import してよいのはこのファイル（INFRA）。
3. `lib/catalog/infrastructure/episodeGateway.ts`: `createEpisodeGateway(gateway: ApiGateway)` が port `EpisodeSource`（`fetch(id) → Promise<Result<Episode, ApiFailure>>`）を実装する。request は `lib/api/podcasts.ts` の `getPodcast` と同じ path・method（W-S4d1 の後は `getPodcast` を呼ぶ形に寄せる = W-S4d1 の補正 (4)。本 slice では `gateway.request` を直接呼んでよい）。
4. `lib/playback/application/ports.ts`: 型 `EpisodeSource` だけを置く（ほかの port は W-S2a2）。
**変更（production）**
5. `lib/playback/domain/session.ts`: `PlayableEpisode` の定義を消し、`lib/catalog/domain/episode` から `import type { PlayableEpisode }` する（TA-D12 の組 Playback → Catalog）。`isPlayableEpisode`・`EpisodeRef`（W-S2a1）は残す。`@/types` の import を消す（TP-A3 の解消）。
6. `architecture/boundaries.allowlist.json`: `removeBy: "W-T2"` の 2 行を消す。
**新規（test）**
7. `tests/lib/catalog/domain/episode.test.ts`・`tests/lib/catalog/infrastructure/{episodeMapper,episodeGateway}.test.ts`・`tests/architecture/immutability.catalog.test.ts`。
**削除**: なし（`lib/podcastTitle.ts` は最後の利用が消える W-T3 で削除する。新 Spec §3.2）。

## 変更の責務（層ごと）
| 層 | 置くもの | 規則の ID |
|---|---|---|
| domain `lib/catalog/domain/episode.ts` | 判別・生成関数・`displayTitle`・`SourceCredit` の生成・失敗の理由の値域 | TA-R-CT-1・2・10・11 |
| infrastructure `lib/catalog/infrastructure/episodeMapper.ts` | DTO → domain の読み取り（欠落の補完・`partial_failed` の読み替え・識別子の正規化） | PS-07b・W-31 |
| infrastructure `lib/catalog/infrastructure/episodeGateway.ts` | `EpisodeSource` の実装 | W-18 |
| application `lib/playback/application/ports.ts` | `EpisodeSource` の型 | — |
| domain `lib/playback/domain/session.ts` | `PlayableEpisode` を Catalog から import | TA-D12 |

## 移行の中間状態
- TP-A3 を消す（許可リスト −2 行）。新しい一時経路は無い。
- `lib/podcastTitle.ts` と `displayTitle` が同じ規則を 2 箇所に持つ状態が W-T3 まで残る（TA-V4 の TA-R-CT-2 の行は、`lib/podcastTitle.ts` を W-T3 が消すまで許可リストに載せる: `rule: TA-R-CT-2, file: lib/podcastTitle.ts, removeBy: W-T3`。W-T1 が既に載せていれば行を変えない）。

## 変わる挙動
無い（新しいコードはどこからも呼ばれない）。

## 契約と検査
| 契約 / 検査 | テスト | 行 ID |
|---|---|---|
| CI-T11 | `episode.test.ts`: 表駆動 `status` 4（`completed` / `processing` / `failed` / `partial_failed`）× `audio_url` 2（非空 / 空）× `error_message` 2（`null` / 非 null）= 16 行。各行の期待（Playable / Generating / Failed）を表として書く。`partial_failed` の 4 行はすべて Failed。テスト名に `verifies: CI-T11` と `PS-07`（`completed` ∧ `error_message` 非 null の行）・`PS-07b`（`partial_failed` ∧ `audio_url` 非空の行）を含める | PS-07・PS-07b |
| TA-R-CT-2 | `episode.test.ts`: `displayTitle` が `tests/lib/podcastTitle.test.ts` と同じ期待値を返す（空白だけの title・負の maxLen・境界） | — |
| TA-R-CT-10 | `episode.test.ts`: `source_kind` が `featured` のときだけ `showsShareAlikeNotice` が true（`user`・`unknown`・欠落は false） | — |
| TA-R-CT-11 | `episodeMapper.test.ts`: `error_message` が `generation_failed` / `quota_exhausted` / 自由文 / `null` の 4 通りで `reason` が期待どおり | — |
| TA-V3 (b) | `tests/architecture/dataModels.test.ts`（W-T1）: DOMAIN・APP が export する宣言に `types/index.ts` の型名が 0 件になる（許可リストの行を消すと green） | — |
| TA-V4 | `tests/architecture/rules.test.ts`（W-T1）: TA-R-CT-1 の式（`.status` と `'completed'` 等の比較・`audio_url`・`error_message` の判定）の出現が `lib/catalog/domain/episode.ts`・`lib/catalog/infrastructure/episodeMapper.ts` 以外に無い（着手時に許可リストにある page の出現はそのまま。本 slice は増やさない） | — |
| TA-V5 | `tests/architecture/readonly.types.test.ts` に `episode.transcript!.push(...)` 等の `@ts-expect-error` 行を足す。`publicTypes.test.ts` で `lib/catalog/domain` が 0 件 | — |
| TA-V6 | `immutability.catalog.test.ts`: 観点 1（生成関数に渡した配列を後で書き換えても値が変わらない）・2（返した値の入れ子への代入が strict mode で throw）。`session.start(ep, …)` の後で `ep.transcript` を書き換えても `state().episode` が変わらない（新 Spec §7 観点 4 (d) の入れ子の段） | — |
| TA-V9 | 既存テスト全件が期待値を変えずに green | — |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストは名前・期待値とも不変（`session.test.ts` の fixture が `PlayableEpisode` の型に合わない箇所は、生成関数を通す形に直してよい。直した行を PR 説明に列挙）。
- **既存コードから呼ばれていない**（量化する集合 = `app components hooks contexts lib` の `.ts` / `.tsx` から `lib/catalog/`・`lib/playback/` を除いたもの）: `grep -rln "@/lib/catalog/" app components hooks contexts lib | grep -v '^lib/catalog/\|^lib/playback/'` が 0 件。
- **DTO 参照 0 件**（集合 = `lib/catalog/domain/**`・`lib/playback/domain/**`・`lib/playback/application/**`）: `grep -rn "from '@/types\|Podcast\[" lib/catalog/domain lib/playback/domain lib/playback/application` が 0 件。`grep -rn "from '@/types" lib/catalog/infrastructure` は `episodeMapper.ts` の 1 行だけ。
- **許可リスト**: `grep -c '"removeBy": "W-T2"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3 が green（行数 = 着手前 − 2）。
- **再生可否の規則の置き場**（集合 = `lib app components hooks contexts`）: TA-V4 の TA-R-CT-1 の行で、着手前の許可リストに無い出現が 0 件。
- T-T11 の 16 行がテスト名に `CI-T11`・`PS-07`・`PS-07b` を持つ。

## 禁止事項 / scope 外
- page・`PodcastCard`・`StatusBadge`・旧再生実装を変えない（W-S4a・W-S2b）。`lib/podcastTitle.ts` を変えない・消さない（W-T3）。
- Coordinator・OfflineLibrary・PositionReporter・リードモデル・`EpisodeSource` 以外の port を作らない（W-S2a2）。
- `Episode` の判別の規則を既存 Spec §3.2 の表から変えない。文言（`failureMessage`）を作らない（W-S4a の `lib/catalog/presentation/failureMessage.ts`）。
- `generationLimit`・`generationWatch`・`article`・`source`・`featuredCategory` を作らない（W-S4a・W-T3・W-T4・W-T5）。
- `types/index.ts`・`lib/api/podcasts.ts` を変えない。backend の契約を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/playback/*.test.ts`（W-T1 後の path）、`tests/lib/podcastTitle.test.ts`、`tests/architecture/*.test.ts`（W-T1）、`npm test` 全件。

## 検証
`npm test`、上記 grep 4 種、`npm run lint`、`npm run build`。

## 記録
- 完了時、共有仕様 §4.4 の PS-07b の web の保留（規則の分）を解除できる旨と、CI-T11 の規則側（16 行）の置き場が `lib/catalog/domain` になった旨を親 docs へ返す（UI 側は W-S4a）。
- 導出 W-18 を台帳 §5.0 へ登録する旨を返す。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §5.1（TA-M-PB の `PlayableEpisode`・`QueuedEpisode`）・§5.2・§7（TA-V3〜V6・TA-V4 の表）・§8.2（W-T2 行）・§8.4（TP-A3）・§10.1（W-18・W-31）
- 既存 Spec §3.2・§4（CI-T11）・§5（CP5）
- 親 docs: ADR-102・ADR-108・ADR-095、共有仕様 §4.4 PS-07・PS-07b・§6.6
