## web リファクタ W-T4: Catalog — Feed の Star・Dismiss・一括 Star を command に、一覧を `FeedView` にする（適用 slice）

## 概要
`app/(app)/feed/page.tsx`（615 行）が持つ Star の状態の合成（サーバー値は追加の方向だけ・楽観的な Star・404 で除く）と一括 Star の数え方を、Catalog の domain `lib/catalog/domain/article.ts`（TA-R-CT-4）と application `commands.ts`（TA-R-CT-5）へ移し、一覧を query `getFeed(tab)` の `FeedView` にする。古い応答の破棄（request の連番）と `unstar` の二重送信の防止は application が持つ。**利用者に見える挙動・文言・request は変えない**。正本は新 Spec §5.2（TA-C-CT-1〜4・TA-Q-CT-1・TA-R-CT-3〜5・「整合性と失敗」）・§8.2 W-T4 行・§8.4 TP-A6、既存 Spec §1.2 UC-L1、親 docs web-design §12.4（Star の冪等性は未確認）。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (2)(3)、AQ-3・AQ-4、F-FEED-06・F-FEED-07（PRD §5）、UC-L1、TA-R-CT-4・5（TA-R-CT-3 は W-S4a が置いた `classifyGenerationLimit` を呼ぶ）、TA-V4・TA-V6・TA-V7、ADR-061（残回数）・ADR-073（上限の種別）。

## 種別
適用 slice。判断待ちに依存しない（J-W3 = SG-D5 の中継は W-T10b。どちらの順でも本 slice は進められる: 新 Spec §10.3）。W-T3・W-T5〜W-T10a とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `feed/page.tsx` 615 行、`components/ArticleCard.tsx` 200 行超、`tests/app/feed/page.test.tsx`（W-S4d2a で double 化済み））
- production ≈ 330 行: `lib/catalog/domain/article.ts` ≈ 60、`lib/catalog/application/commands.ts`（Feed の 4 command）≈ 120、`queries.ts` への `getFeed` ≈ 40、`readModels.ts` への `FeedView`・`ArticleCardView` ≈ 30、`ports.ts` と `catalogGateway.ts` への Feed の 5 操作 ≈ 40、`feed/page.tsx` ≈ −200/+120、`ArticleCard.tsx` ≈ 15。
- test ≈ 350 行: `article.test.ts` ≈ 80、`commands.test.ts` ≈ 150（一括 Star の数え方・404・429・二重送信・古い応答）、`queries.test.ts` への追加 ≈ 40、`cqrs.catalog.test.ts`・`immutability.catalog.test.ts` への追加 ≈ 40、page テストの mock 置換 ≈ 40。
- 合計 ≈ 700 行（10² 行の後半）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み（page が `lib/catalog/infrastructure/api` と `useApiClient()` を使う）、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4a（`classifyGenerationLimit`・`ApiFailure.rate_limited.detail`）・W-S4b（`ArticleCard` の `useApp()` → `usePreferences()`）はその前提。W-T3 の `CatalogGateway`・`queries.ts` が main に無ければ、本 slice が `ports.ts`・`queries.ts`・`catalogGateway.ts` を新設する（どちらが先でも同じファイル名・同じ生成関数名。後から入る側が rebase）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow`。
- 確定済み（再提案しない）: 一括 Star は部分的な成功を receipt で返す（architecture.md §7）。Star の冪等性は backend の契約に依存し、**現行の数え方を変えない**（新 Spec §11）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4a・W-S4b・W-S4d1 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 上限の文言 | `feed/page.tsx:15-20` `generationLimitMessage`（`:17` の判定は W-S4a で `classifyGenerationLimit` へ） | `grep -n "generationLimitMessage\|classifyGenerationLimit\|formatRetryAfter" 'app/(app)/feed/page.tsx'` |
| DTO の保持 | `:78` `articles`、`:86` `serverStarred`、`:97` `optimisticStarred`（`useState<Article[]>` 3 つ）、`:83` `starredIds` | `grep -n "useState<" 'app/(app)/feed/page.tsx'` |
| 古い応答の破棄 | `:116-120,152,165,178,184`（`fetchRequestIdRef`） | `grep -n "fetchRequestIdRef\|requestId" 'app/(app)/feed/page.tsx'` |
| Star の状態の合成 | `:156-162`（サーバー値は追加だけ）、`:200-218`（楽観的な Star・失われた記事の除去）、`:229-237`（404 → 一覧から除く）、`:305-328`（unstar の 404） | `grep -n "is_starred\|addOptimisticStarred\|removeFromStarredCollections\|404" 'app/(app)/feed/page.tsx'` |
| unstar の二重送信の防止 | `:111,285,299-300,338`（`unstarInFlightRef`） | `grep -n "unstarInFlightRef" 'app/(app)/feed/page.tsx'` |
| 一括 Star | `:359-403`（`Promise.allSettled`・成功と失敗の件数・429 を優先） | `grep -n "handleBulkStar\|allSettled\|429" 'app/(app)/feed/page.tsx'` |
| request | `lib/api/feed.ts:6` `getFeed`、`lib/api/articles.ts:11,17,27,36`（`getStarredArticles`・`starArticle(id, difficulty?)`・`dismissArticle`・`unstarArticle`） | `grep -n "^export function" lib/api/feed.ts lib/api/articles.ts` |
| `ArticleCard` | `components/ArticleCard.tsx:14` `article: Article`、`:81-83`（`timeFormat` の分岐）、読む field は `id`・`title`・`source`・`url`・`score`・`published_at` | `grep -n "article\." components/ArticleCard.tsx` |
| 許可リストの `removeBy: W-T4` | TA-D4 (a) 2 ファイル（`feed/page.tsx`・`ArticleCard.tsx`）＋ TA-D5（TP-A6 の `feed/page.tsx`）＋ TA-D5 `@/lib/sfx`（`feed/page.tsx`。W-T13 の行 = 本 slice では消さない） | `grep -B4 '"removeBy": "W-T4"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/catalog/domain/article.ts`（TA-R-CT-4）: `ArticleRef`（`id`・`title`・`source`・`url`・`score`・`publishedAt`。domain の型。DTO の型名を使わない）、`StarState`（`starredIds: ReadonlySet<string>`・`optimistic: ReadonlyArray<ArticleRef>`）、純関数 `mergeServerStars(state, articles)`（サーバー値は追加の方向だけ）・`markStarred(state, article)`・`removeLost(state, id)`（Dismiss 成功・Star 404・Unstar 成功と 404 で一覧と Star の集合から除く）。生成関数は複製して凍結する。
2. `lib/catalog/application/commands.ts`: `createCatalogCommands(deps)`。`starArticle(id, difficulty?)`（TA-C-CT-1）→ `Result<{ remaining: number | null }, StarFailure>`（`StarFailure` = `not_found` / `generation_limit(GenerationLimit)` / `unauthorized` / `failed(ApiFailure)`。`remaining` は receipt）、`dismissArticle(id)`・`unstarArticle(id)`（TA-C-CT-3・4）→ `Result<void, ApiFailure>`（`unstar` は進行中の同じ id を受けない = 二重送信の防止をここに置く）、`bulkStar(ids)`（TA-C-CT-2）→ `{ starred: ReadonlyArray<string>; failed: ReadonlyArray<string>; limit: GenerationLimit | null }`（TA-R-CT-5: 上限の失敗が 1 つでもあれば `limit` を埋める。現行の数え方）。
3. `queries.ts` へ `getFeed(tab)`（TA-Q-CT-1）→ `FeedView`（`articles: ReadonlyArray<ArticleCardView>`・`date: string | null`・`canSelect: boolean`）。古い応答の破棄（連番）は query の実装が持つ（後発の呼出が走っていれば古い方の結果を捨てる）。`readModels.ts` へ `ArticleCardView`（`id`・`title`・`source`・`url`・`score`・`publishedAt`・`isStarred`・`isBusy`）と `FeedView`。
4. `ports.ts` の `CatalogGateway` へ `getFeed`・`getStarredArticles`・`starArticle`・`dismissArticle`・`unstarArticle`（戻り値は domain の値か `Result`。`rate_limited` の `detail`・`retryAfterSeconds` は `GenerationLimit` に写してから返す）。`catalogGateway.ts` に実装（`lib/api/{feed,articles}.ts` を呼ぶ）。
**変更（production）**
5. `app/(app)/feed/page.tsx`: DTO の state 3 つと `starredIds`・`unstarInFlightRef`・`fetchRequestIdRef`・`addOptimisticStarred`・`removeFromStarredCollections`・`handleBulkStar` の数え方を消し、command と query を呼ぶ。toast の文言（`generationLimitMessage`・`starSuccessMessage`・「記事が見つかりません」・「N件をスターしました」・「N件のスターに失敗しました」ほか）は page に残し、`StarFailure`・`bulkStar` の結果から選ぶ。`playSfx` の呼出は残す（W-T13 が `useSfx()` に替える）。
6. `components/ArticleCard.tsx`: props を `article: ArticleCardView` に。`@/types` の import を消す。
7. `architecture/boundaries.allowlist.json`: `removeBy: "W-T4"` の行を消す。
**テスト**: `tests/lib/catalog/domain/article.test.ts`・`tests/lib/catalog/application/commands.test.ts`（Feed の分）・`queries.test.ts`（`getFeed`）、`cqrs.catalog.test.ts`・`immutability.catalog.test.ts` への追加、`tests/app/feed/page.test.tsx`・`tests/components/ArticleCard.test.tsx` の mock 置換（文言の assertion は不変）。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| domain `article.ts` | Star の状態の合成 | TA-R-CT-4 |
| application `commands.ts` | 4 command・一括 Star の数え方・unstar の排他 | TA-C-CT-1〜4・TA-R-CT-5 |
| application `queries.ts`・`readModels.ts` | `getFeed`・古い応答の破棄・`FeedView` | TA-Q-CT-1 |
| infrastructure `catalogGateway.ts` | DTO → domain・`ApiFailure` → `StarFailure` の材料 | — |
| presentation `feed/page.tsx`・`ArticleCard.tsx` | 文言・選択モード・確認ダイアログ・効果音 | — |

## 移行の中間状態
- TP-A6 の Feed の分を消す（`feed/page.tsx` が `lib/catalog/infrastructure/api` を import しなくなる）。
- `feed/page.tsx` の `@/lib/sfx` の行（`removeBy: W-T13`）は残る。

## 変わる挙動
無い（Star・Dismiss・Unstar・一括 Star の toast の文言と順序・楽観的な Star の保持・404 の扱い・request の path・method・body（`difficulty` 省略時は body なし）は不変。判定は `tests/app/feed/page.test.tsx` の文言と `fake.calls` の assertion と e2e `main-flow`）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-CT-4 | `article.test.ts`: サーバーの `is_starred: false` で Star を外さない・楽観的な Star が手動更新で消えない・404 で一覧と Star の集合から消える |
| TA-R-CT-5 | `commands.test.ts`: 3 件中 2 件成功・1 件 429 → `starred` 2・`failed` 1・`limit` あり。429 が無い失敗 → `limit` null。`unstar` の同じ id の 2 回目は送らない（double の呼出 1 回）。`getFeed` の古い応答は捨てる |
| TA-V4 | `rules.test.ts`: TA-R-CT-3 の式（`/monthly/i`・`86400`）が `lib/catalog/domain/generationLimit.ts` 以外に 0 件（W-S4a で満たし済み。本 slice で増やさない） |
| TA-V6 | `immutability.catalog.test.ts`: `getFeed()` の観点 2・3 |
| TA-V7 | `cqrs.catalog.test.ts`: (a) 入口の名前の集合に `starArticle`・`bulkStar`・`dismissArticle`・`unstarArticle`・`getFeed` を足す。(b) query が変更系の port を呼ばない。(c) command の戻り値がリードモデルでない（`bulkStar` の receipt は id の配列と `GenerationLimit` だけ） |
| TA-V9 | `tests/app/feed/page.test.tsx`・`tests/components/ArticleCard.test.tsx`、e2e `main-flow` |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。`npm run test:e2e`（`main-flow`）green。
- **DTO を持たない**（集合 = `feed/page.tsx`・`ArticleCard.tsx`）: `grep -n "from '@/types\|from '@/lib/catalog/infrastructure\|useState<Article" 'app/(app)/feed/page.tsx' components/ArticleCard.tsx` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "is_starred\|allSettled\|unstarInFlight" app components hooks contexts lib` の出現が `lib/catalog/` の中だけ。
- **許可リスト**: `grep -c '"removeBy": "W-T4"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- TA-V6・TA-V7 の追加分が green。
- `tests/app/feed/page.test.tsx` の文言 assertion と `fake.calls` の assertion に diff が無い（PR 説明に diff の要約）。

## 禁止事項 / scope 外
- 一覧・詳細（W-T3）・購読・onboarding（W-T5）を変えない。`classifyGenerationLimit`・`failureMessage`（W-S4a）を変えない。
- toast の文言・順序・`playSfx` の契機を変えない。`useSfx()` へ替えない（W-T13）。
- Star の数え方（`Promise.allSettled` 相当・成功と失敗の件数・429 の優先）を変えない。backend の Star の冪等性を前提にしない。
- request の path・method・body を変えない。`ApiFailure` の variant を増やさない。
- `Retry-After` の中継（W-T10b）に触れない。「（◯◯に可能）」の分岐は残す（W-T10b の後に本番で出る: SG-D5）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/feed/page.test.tsx`・`tests/components/ArticleCard.test.tsx`・`tests/lib/catalog/domain/generationLimit.test.ts`（W-S4a）、e2e `main-flow`。

## 検証
`npm test`、上記 grep 3 種、`npm run lint`、`npm run build`、`npm run test:e2e -- main-flow`。

## 記録
- 完了時、親 docs web-design §12.1 Catalog 行と §12.4（Star の冪等性の未確認）を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §5.2（TA-C-CT・TA-Q-CT・TA-R-CT-3〜5・整合性と失敗）・§7・§8.2（W-T4 行）・§8.4（TP-A6）・§11（Star の冪等性）
- 既存 Spec §1.2（UC-L1）
- 親 docs: ADR-061・ADR-073、web-design §12.4
