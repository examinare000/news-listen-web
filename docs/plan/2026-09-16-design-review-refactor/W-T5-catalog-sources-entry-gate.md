## web リファクタ W-T5: Catalog — 購読・onboarding と、Account の入口の判定を application へ移す（適用 slice）

## 概要
`app/(app)/subscriptions/page.tsx`・`components/ui/OnboardingSourcesModal.tsx` が持つ RSS の URL の形式の検査、登録済み・形式不正の意味（409・422）、おすすめ = featured − 購読済み、featured の category の値域を Catalog の domain（`source.ts`・`featuredCategory.ts`）・application（TA-C-CT-5〜7・TA-Q-CT-5〜7）・infrastructure へ移す。`lib/featuredCategories.ts` は値域（domain）と日本語ラベル（presentation）に分ける。`app/page.tsx` の入口の判定の順（設定の復元 → 認証 → onboarding。取得の失敗は完了に倒す）を `lib/account/application/entryGate.ts`（TA-R-AC-7・TA-Q-AC-5）に置く。**利用者に見える挙動・文言・request は変えない**。正本は新 Spec §3.2（`lib/featuredCategories.ts` の行）・§5.2（TA-R-CT-7〜9）・§5.3（TA-R-AC-7）・§8.2 W-T5 行。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (2)、AQ-3、F-FEED-01・F-SET-01・F-SET-08・F-ACC-03（PRD §5）、TA-R-CT-7・8・9・TA-R-AC-7、TA-V4・TA-V6・TA-V7。

## 種別
適用 slice。判断待ちに依存しない。W-T3・W-T4・W-T6〜W-T10a とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `subscriptions/page.tsx` 330 行超、`OnboardingSourcesModal.tsx` 150 行超、`app/page.tsx` 80 行、`lib/featuredCategories.ts` 51 行）
- production ≈ 300 行: `lib/catalog/domain/{source,featuredCategory}.ts` ≈ 60、`lib/catalog/presentation/featuredCategoryLabels.ts` ≈ 15、`commands.ts`・`queries.ts`・`readModels.ts`・`ports.ts`・`catalogGateway.ts` への追加 ≈ 120、`lib/account/application/entryGate.ts` ≈ 30、page 2・modal・`app/page.tsx` ≈ 80。削除 `lib/featuredCategories.ts` 51。
- test ≈ 250 行: `source.test.ts` ≈ 60、`featuredCategory.test.ts`（`featuredCategories.test.ts` を移す）≈ 40、`entryGate.test.ts` ≈ 50、command / query のテスト ≈ 60、page・modal・`tests/app/page.test.tsx` の mock 置換 ≈ 40。
- 合計 ≈ 550 行（10² 行）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4b（`app/page.tsx` の `state.isRestoring` → `usePreferences().ready`）・W-S4c（`useAuth()` の `AuthSession` 4 状態と `unavailable` の再試行導線）はその前提。W-T3 / W-T4 の `CatalogGateway`・`commands.ts`・`queries.ts` が main に無ければ本 slice が新設する（同じファイル名・生成関数名。後から入る側が rebase）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow` / `signup-flow`。
- 確定済み（再提案しない）: onboarding の取得の失敗は完了に倒す（現行。TA-R-AC-7）。`AuthSession.unavailable` の再試行導線は root gate の 1 箇所（W-S4c）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4b・W-S4c・W-S4d1 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| URL の形式 | `subscriptions/page.tsx:123-125`（`http://` / `https://` で始まる） | `grep -n "startsWith('http" 'app/(app)/subscriptions/page.tsx'` |
| 409・422 の意味 | `subscriptions/page.tsx:110-112`（featured の購読の 409）・`:136-139`（追加の 409 → 「この URL は登録済みです」・422 → 「URL の形式が正しくありません」）、`OnboardingSourcesModal.tsx:51`（409 は追加済みとして扱う）。W-S4d1 の後は `failure.kind === 'conflict' | 'validation'` | `grep -n "409\|422\|conflict\|validation" 'app/(app)/subscriptions/page.tsx' components/ui/OnboardingSourcesModal.tsx` |
| おすすめの導出 | `subscriptions/page.tsx:52-56`（`featured.filter(site => !subscribedUrls.has(site.url))`。URL の完全一致） | `grep -n "recommended\|subscribedUrls" 'app/(app)/subscriptions/page.tsx'` |
| category の値域と既定 | `lib/featuredCategories.ts:6-31`（5 値・`normalizeFeaturedCategory` は不正なら `tech`）。利用は `subscriptions`・`OnboardingSourcesModal`・`admin/featured-sites`（W-T8） | `grep -rn "featuredCategories" app components lib tests` |
| 入口の判定 | `app/page.tsx:19`（`OnboardingGate` 3 値）・`:33`（`isRestoring` と `authenticated` の待ち）・`:39,43`（`onboarding_completed`・失敗は `done`）・`:52-57`（`/feed` へ replace）・`:61-67`（描画の分岐） | `grep -n "isRestoring\|authStatus\|gate\|replace" app/page.tsx` |
| request | `lib/api/settings.ts:10,14,21,29,36,43`（`getSources`・`addSource(name, url)`・`deleteSource(url)`・`getFeaturedSources`・`getOnboardingStatus`・`completeOnboarding`） | `grep -n "^export function" lib/api/settings.ts` |
| 許可リストの `removeBy: W-T5` | TA-D4 (a) 2 ファイル（`subscriptions/page.tsx`・`OnboardingSourcesModal.tsx`）＋ TA-D5（TP-A6: `subscriptions`・`OnboardingSourcesModal`・`app/page.tsx`） | `grep -B4 '"removeBy": "W-T5"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/catalog/domain/source.ts`（TA-R-CT-7・8）: `SourceRef`（`name`・`url`）、`FeaturedSourceRef`（`id`・`name`・`url`・`category: FeaturedCategory`・`thumbnailUrl`・`description`）、`validateSourceUrl(url) → ok | 'invalid_url'`（現行の規則: `http://` / `https://` で始まる）、`recommendedSources(featured, subscribed) → ReadonlyArray<FeaturedSourceRef>`（URL の完全一致で除く）。
2. `lib/catalog/domain/featuredCategory.ts`（TA-R-CT-9）: `FEATURED_CATEGORIES`（5 値）・`FeaturedCategory`・`normalizeFeaturedCategory`（既定 `tech`）・`groupByCategoryInOrder`。`lib/featuredCategories.ts` から移す。
3. `lib/catalog/presentation/featuredCategoryLabels.ts`: `FEATURED_CATEGORY_LABELS`（日本語ラベル）。
4. `commands.ts` へ `addSource(name, url)`・`removeSource(url)`（TA-C-CT-5・6）→ `Result<void, AddSourceFailure>`（`invalid_url` / `already_registered` / `invalid_feed` / `failed(ApiFailure)`。`invalid_url` は domain の検査で送らずに返す）、`completeOnboarding()`（TA-C-CT-7）→ `Result<void, ApiFailure>`。`queries.ts` へ `listSources()`・`getRecommendedSources()`・`getOnboardingStatus()`（TA-Q-CT-5〜7）。`readModels.ts` へ `SourceView`・`RecommendedSourceView`（category のグループ化は presentation が `groupByCategoryInOrder` で行う）・`OnboardingView`（`completed: boolean`・`featured: ReadonlyArray<RecommendedSourceView>`）。
5. `ports.ts`・`catalogGateway.ts` へ `getSources`・`addSource`・`deleteSource`・`getFeaturedSources`・`getOnboardingStatus`・`completeOnboarding`。409 → `already_registered`・422 → `invalid_feed` への写しは `catalogGateway.ts`（TA-R-CT-7 の「意味」の置き場）。
6. `lib/account/application/entryGate.ts`（TA-R-AC-7・TA-Q-AC-5）: 純関数 `entryGate({ preferencesReady, session, onboarding }) → 'loading' | 'login' | 'retry' | 'onboarding' | 'ready'`。順は 設定の復元 → 認証（`resolving` = `loading`・`anonymous` = `login`・`unavailable` = `retry`）→ onboarding（未取得 = `loading`・未完了 = `onboarding`・完了と取得失敗 = `ready`）。
**変更（production）**
7. `app/(app)/subscriptions/page.tsx`・`components/ui/OnboardingSourcesModal.tsx`: command と query を呼ぶ。文言は page・modal に残し、`AddSourceFailure` から選ぶ。`@/types`・`@/lib/catalog/infrastructure/*`・`@/lib/featuredCategories` の import を消す。
8. `app/page.tsx`: `entryGate(...)` の結果で描画と `router.replace('/feed')` を決める（現行の分岐と同じ結果になる）。`getOnboardingStatus` は `queries.getOnboardingStatus()`。
9. `app/(app)/admin/featured-sites/page.tsx`: `@/lib/featuredCategories` の import を `@/lib/catalog/domain/featuredCategory`・`@/lib/catalog/presentation/featuredCategoryLabels` に付け替える（1 行。W-T8 が admin の domain へ移すまでの間、presentation が domain の純関数を import するのは許される: 新 Spec §4 補足）。
10. `architecture/boundaries.allowlist.json`: `removeBy: "W-T5"` の行を消す。
**削除**: `lib/featuredCategories.ts`・`tests/lib/featuredCategories.test.ts`（観点は `featuredCategory.test.ts` へ）。
**テスト**: `tests/lib/catalog/domain/{source,featuredCategory}.test.ts`・`tests/lib/account/application/entryGate.test.ts`（表駆動: 入力 3 つの組合せ全部）・command / query のテスト・`cqrs.catalog.test.ts` への追加、page・modal・`tests/app/page.test.tsx` の mock 置換。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| domain `source.ts`・`featuredCategory.ts` | URL の形式・おすすめの導出・category の値域と既定 | TA-R-CT-7・8・9 |
| application（Catalog） | TA-C-CT-5〜7・TA-Q-CT-5〜7・3 つのリードモデル | — |
| application `lib/account/application/entryGate.ts` | 入口の判定の順 | TA-R-AC-7・TA-Q-AC-5 |
| infrastructure `catalogGateway.ts` | 409・422 → 意味 | TA-R-CT-7 |
| presentation | 文言・グループ表示・`FEATURED_CATEGORY_LABELS` | — |

## 移行の中間状態
- TP-A6 の購読・onboarding・入口の分を消す。
- `admin/featured-sites/page.tsx` が Catalog の domain の値域を直接 import する状態が W-T8 まで残る（TA-D12 の Admin → Catalog の組で許される。許可リストには載せない）。

## 変わる挙動
無い（文言・409/422 の扱い・onboarding の取得失敗時にフィードへ進む挙動・request は不変。判定は page・modal・`tests/app/page.test.tsx` と e2e `main-flow` / `signup-flow`）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-CT-7 | `source.test.ts`（`http://`・`https://`・それ以外）、`catalogGateway.test.ts`（409 → `already_registered`・422 → `invalid_feed`） |
| TA-R-CT-8 | `source.test.ts`（URL の完全一致で除く。末尾スラッシュ違いは除かない = 現行） |
| TA-R-CT-9 | `featuredCategory.test.ts`（`featuredCategories.test.ts` の全観点） |
| TA-R-AC-7 | `entryGate.test.ts`（表駆動。`preferencesReady` 2 × `session` 4 × `onboarding` 4 = 32 行） |
| TA-V4 | `rules.test.ts`: 本 slice の規則は構造で判定する（`startsWith('http` の出現が `lib/catalog/domain/source.ts` だけ、`'tech'` の既定値の出現が `featuredCategory.ts` だけ）。式を表に足し、PR 説明に書く |
| TA-V7 | `cqrs.catalog.test.ts`: 入口の名前の集合に本 slice の 6 つを足す。(b)(c) |
| TA-V9 | `tests/app/subscriptions/page.test.tsx`・`tests/components/ui/OnboardingSourcesModal.test.tsx`・`tests/app/page.test.tsx`、e2e 2 本 |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。`npm run test:e2e`（`main-flow` / `signup-flow`）green。
- **DTO を持たない**（集合 = `subscriptions/page.tsx`・`OnboardingSourcesModal.tsx`・`app/page.tsx`）: `grep -n "from '@/types\|from '@/lib/catalog/infrastructure\|useState<Source\|useState<FeaturedSource" <3 ファイル>` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "startsWith('http\|normalizeFeaturedCategory\|onboarding_completed" app components hooks contexts lib` の出現が `lib/catalog/` と `lib/account/application/entryGate.ts` の中だけ（`onboarding_completed` は `catalogGateway.ts` の DTO 読み取りだけ）。
- **削除**: `lib/featuredCategories.ts` が存在しない。`grep -rn "featuredCategories" app components hooks contexts lib tests` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T5"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- 文言 assertion に diff が無い。

## 禁止事項 / scope 外
- 一覧・詳細（W-T3）・Feed（W-T4）を変えない。admin の featured の採番・並べ替え（W-T8）を変えない。
- `AuthSession` の状態・遷移（W-S4c・W-T6）を変えない。`entryGate` は判定だけを持ち、状態を変えない。
- 文言・409/422 の扱い・URL の検査の規則を変えない。request を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/subscriptions/page.test.tsx`・`tests/components/ui/OnboardingSourcesModal.test.tsx`・`tests/app/page.test.tsx`・`tests/lib/featuredCategories.test.ts`（削除前の pin）、e2e `main-flow` / `signup-flow`。

## 検証
`npm test`、上記 grep 4 種、`npm run lint`、`npm run build`、`npm run test:e2e -- main-flow signup-flow`。

## 記録
- 完了時、親 docs web-design §12.1 Catalog / Account 行と §12.4（root gate の 1 行目）を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §3.2・§5.2（TA-R-CT-7〜9）・§5.3（TA-Q-AC-5・TA-R-AC-7）・§8.2（W-T5 行）
- 親 docs: web-design §12.4（root gate）
