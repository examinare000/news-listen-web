## web リファクタ W-T1: 層の骨格と、依存の向きの検査（許可リストつき）・Queue と Session の不変性（適用 slice）

## 概要
目標アーキテクチャ（親 docs [ADR-110](../../../../docs/adr/110-refactor-target-domain-centered-onion-cqrs.md) 決定 3・7・10、[architecture.md](../../../../docs/design/architecture.md) §3・§6・§8）を web に入れる最初の slice。(1) 既存の再生 domain を `lib/playback/domain/` へ、port の型を domain（`AudioElement`）と技術 seam（`lib/platform`）へ分け、shared kernel `lib/shared/` を置く。(2) `QueueState<T>` と Session を「外へ渡した値から内部を書き換えられない」値にする。(3) 依存の向き・データモデルの漏れ・規則の置き場・公開面の検査を eslint と `tests/architecture/` に入れ、現状の違反を 1 つの許可リストに固定する。**利用者に見える挙動と backend への request は変えない**。正本は新 Spec [`2026-09-30-implementation-spec-target-architecture.md`](../../design/2026-09-30-implementation-spec-target-architecture.md)（以下「新 Spec」）§3.1・§3.2・§4・§7・§8.2 W-T1 行・§8.4 TP-A1〜TP-A3・§10.1 W-16・W-17・W-34。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: PRD NFR-09 (4)(5)・NFR-10（新 Spec §2）、AQ-5・AQ-6・AQ-7（architecture.md §2）、TA-D1〜TA-D12（新 Spec §4）、TA-V1〜TA-V6・TA-V8（新 Spec §7）、既存 Spec [`2026-09-16-implementation-spec-domain-model.md`](../../design/2026-09-16-implementation-spec-domain-model.md) §4 の CI-T1〜T4・CI-T1b・CI-T9（名前と期待値は不変）、共有仕様 Q-01〜Q-32（`docs/design/shared-playback-spec.md` §2）。

## 種別
適用 slice。判断待ちに依存しない。

## 規模（見込み。根拠 = 2026-10-01 実測: `lib/playback/` 5 ファイル、`lib/platform/` 3 ファイル、`tests/lib/playback/` 6 ファイル（件数は着手前に vitest で記録）、`eslint.config.mjs` 70 行）
- production ≈ 150 行（移動を除く）: `lib/shared/{result,apiFailure,difficulty}.ts` ≈ 40、`lib/account/domain/role.ts` ≈ 5、`queue.ts` の generic 化と凍結 ≈ 40、`session.ts` の複製と凍結 ≈ 25、`lib/platform/{cacheStore,keyValueStore}.ts` の型の移設 ≈ 30、再 export（`gateway.ts`・`types/index.ts`）≈ 10。
- 設定 ≈ 150 行: `architecture/eslint-boundaries.mjs` ≈ 100、`boundaries.allowlist.json`（着手時の実測で ≈ 70 行）、`eslint.config.mjs` の読み込み ≈ 5。
- test ≈ 450 行: `tests/architecture/` 6 ファイル ≈ 380、`tests/architecture/immutability.playback.test.ts` ≈ 70。既存テストは import path の付け替えだけ。
- 合計 ≈ 750 行。

## 前提・着手条件
- 依存 slice: **W-S2a**（web PR #146）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。W-S2a1 は本 slice の後（W-S2a1 の path を `domain/` に直してある）。
- 再開ゲート（親 docs [refactor plan](../../../../docs/plan/2026-09-16-design-review-refactor.md)「実装の停止と再開ゲート」）が満たされていること。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない）: 層はディレクトリで判定する（W-16）。技術 seam の型は `lib/platform`（新 Spec §5.1「port と adapter」）。許可リストは 1 ファイル（W-34）。棄却済み: 汎用 Storage port（既存 Spec §5 RO3）、branded type（同 rejected_overdesign）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直し、値が違えば本 order の数値を直してから投入する）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| DOMAIN の禁止 import（TA-D1） | 5 import 文 / 4 ファイル: `lib/playback/session.ts:4`（`@/lib/api/gateway` の型）・`:5`（`@/types`）、`lib/playback/queue.ts:8`、`lib/playback/ports.ts:2`、`lib/account/adminAccess.ts:1` | `grep -n "^import" lib/playback/{session,queue,ports,source,resume}.ts lib/account/adminAccess.ts` |
| APP の禁止 import（TA-D2） | 5 import 文 / 2 ファイル: `lib/push/pushRegistration.ts:1-3`、`lib/passkey.ts:13-14` | `grep -n "^import" lib/push/pushRegistration.ts lib/passkey.ts` |
| TA-D3 | `lib/playback/ports.ts:22-23`（`Response`）、`lib/passkey.ts:40,61`（`JSON.parse` の呼出 2。`:28,50` はコメント） | `grep -n "Response\|JSON\." lib/playback/ports.ts lib/passkey.ts` |
| PRES＋ROOT の `@/types` import（TA-D4） | 23 import 文 / 22 ファイル（`app`・`components`・`hooks` 19、`contexts` 4） | `grep -rn "from '@/types" app components hooks contexts \| wc -l`、`grep -rln "from '@/types" app components hooks contexts \| wc -l` |
| PRES の `@/lib/api` import（TA-D5） | 18 import 文 / 17 ファイル | `grep -rn "from '@/lib/api" app components hooks` |
| PRES の adapter import（TA-D5） | 18 import 文 / 15 ファイル | `grep -rn "from '@/lib/\(audioCache\|sfx\|reportClientError\|pushBrowserPort\|webauthnBrowserPort\|swCacheCleanup\|config\)'" app components hooks` |
| TA-D6 | 1 件: `contexts/AudioPlayerContext.tsx:6` | `grep -rn "from '@/components" contexts` |
| TA-D8 | 42 件 | `grep -rn "instanceof ApiError\|err\.status\|reason\.status" app components hooks contexts \| wc -l` |
| TA-D11 | 15 行 / 7 ファイル（`lib/platform/keyValueStore.ts` を除く。コメント行を除く） | `grep -rn "localStorage" app components hooks contexts lib \| grep -v '^lib/platform/keyValueStore\.ts:' \| grep -v ':[0-9]*: *\(//\|\*\)'` |
| PRES / ROOT の集合 | 48 ファイル / 7 ファイル | `git ls-files app components hooks \| grep -E '\.(ts\|tsx)$' \| grep -v '^app/api/' \| grep -v '^app/layout\.tsx$' \| grep -v '^app/(app)/layout\.tsx$' \| wc -l`、`git ls-files contexts app/layout.tsx 'app/(app)/layout.tsx' \| wc -l` |
| `lib/playback` を import するもの | `lib/platform/{audioElement,cacheStore,keyValueStore}.ts`（型だけ）、`tests/helpers/{mockAudio,mockCaches}.ts`、`tests/lib/playback/*.test.ts`。production の `app/ components/ hooks/ contexts/` からは 0 件 | `grep -rn "from '@/lib/playback" app components hooks contexts lib tests` |
| 既存テストの件数 | `tests/lib/playback/` の 6 ファイル。grep の目安は 143〜145 件（`it.each` や行頭の書き方で数え方が変わる。2026-10-01 の grep で `session` 64〜65・`queue.conformance` 32・`queue` 31・`ports` 8・`resume` 3〜4・`source` 4）。**基準は件数の grep ではなく、着手前に `npx vitest run tests/lib/playback` を実行して表示される passed の数**（PR 説明に記録） | `npx vitest run tests/lib/playback` |
| 再 export の元 | `lib/api/gateway.ts:10-24`（`Result`・`ApiFailure`）、`types/index.ts:3-13`（`DifficultyLevel`・`DEFAULT_DIFFICULTY`）・`:149`（`UserRole`） | `grep -n "export type Result\|export type ApiFailure" lib/api/gateway.ts; grep -n "DifficultyLevel =\|DEFAULT_DIFFICULTY\|UserRole =" types/index.ts` |

新 Spec §4 の違反数は `grep` による実測で、AST による数え直しは本 slice が行う（新 Spec §11）。数が合わなければ本 slice の AST 実測を正とし、差を PR 説明に書く。

## 対象（web サブモジュールのみ）
**移動（`git mv`。production）**
1. `lib/playback/{session,queue,resume,source}.ts` → `lib/playback/domain/` の同名ファイル。
2. `lib/playback/ports.ts` を 3 つに分ける: `AudioElement`（`AudioElementEventType` を含む）→ `lib/playback/domain/audioElement.ts`。`CacheStore`・`CacheBucket`・`CacheWriteFailure` → `lib/platform/cacheStore.ts` に export を足す。`KeyValueStore` → `lib/platform/keyValueStore.ts` に export を足す。`ports.ts` は削除する。
3. `lib/account/adminAccess.ts` → `lib/account/domain/adminAccess.ts`。
**新規（production）**
4. `lib/shared/result.ts`（`Result`）・`lib/shared/apiFailure.ts`（`ApiFailure`。10 variant の field を `readonly` にする: TA-D9）・`lib/shared/difficulty.ts`（`DifficultyLevel` と、その値の一覧 `DIFFICULTY_LEVELS`。`types/index.ts:3-13` から移す。既定値 `DEFAULT_DIFFICULTY` は `types/index.ts` に残す = 既定値は W-S4b が `lib/preferences/domain/settings.ts` へ置く）。`lib/account/domain/role.ts`（`UserRole`）。
5. `lib/api/gateway.ts` は `Result`・`ApiFailure` を `lib/shared` から import し、同じ名前で再 export する（**TP-A2**）。`types/index.ts` は `DifficultyLevel`・`UserRole` を再 export する（TP-A2）。呼出側の import は変えない（付け替えは W-T15）。
**変更（production）**
6. `lib/playback/domain/queue.ts`: `QueueState<T extends { readonly id: string }>`（W-17）。`items: ReadonlyArray<T>`。`create(items, currentIndex)` は `items` を複製して `Object.freeze` し、状態も凍結して返す。`upNext` の戻り値は `ReadonlyArray<T>`。`current()` は凍結済みの要素を返す（要素自体の凍結は生成関数の責務 = W-T2 の `queuedEpisode(...)`。本 slice では `create` が要素も凍結する）。no-op が同じ参照を返す挙動（Q-* が固定）は変えない。`emptyQueue` は `QueueState<never>` 相当の凍結値。11 操作の名前・引数・期待値は不変。`import type { Podcast } from '@/types'` を消す。
7. `lib/playback/domain/session.ts`: `start(episode, …)` は受けた `episode` の写し（入れ子の配列を含む）を作って深く凍結し、それを保持する。`state()` と `stateChanged` の値を深く凍結する（今は 1 段: `:113,122`）。`ApiFailure` は `lib/shared/apiFailure` から、`DifficultyLevel` は `lib/shared/difficulty` から import する。`PlayableEpisode` の 5 field（`:25-29`）が `Podcast['segments']` 等を指す点は変えない（**TP-A3**。W-T2 が Catalog の型へ替える）。
8. `lib/platform/{audioElement,cacheStore,keyValueStore}.ts`・`tests/helpers/{mockAudio,mockCaches}.ts`・`tests/lib/playback/*.test.ts`・`tests/lib/platform/adapters.test.ts`: import path を対象 1・2 に合わせる。テスト名・期待値は変えない。`QueueState` の型注釈に型引数が要る箇所は `QueueState<Podcast>`（テストは DTO の fixture を使ってよい）。
**新規（検査。新 Spec §7）**
9. `architecture/eslint-boundaries.mjs`（TA-V1）: 新 Spec §4 の集合（DOMAIN・APP・INFRA・PRES・ROOT）の glob ごとに `no-restricted-imports`（TA-D1・D2・D5・D6・D7・D12）、DOMAIN と APP に `no-restricted-globals`（TA-D3 のグローバル）と `no-restricted-syntax`（`JSON.parse` / `JSON.stringify` の呼出・`new Response`）。許可リストの行に当たる違反は、同じファイルを読んで `overrides` に写す（`eslint-disable` コメントは使わない）。`eslint.config.mjs` はこれを import して配列に足す。TA-D8（status の数値分岐）は W-S4d3、`currentPodcast`・`contexts → components` は W-S2c がここへ足す。
10. `architecture/boundaries.allowlist.json`（**TP-A1**）: 1 件 = `{ rule, file, specifier, introducedBy, removeBy }`。`rule` は `TA-D1` … `TA-D11`、`specifier` は import の文字列（TA-D11 は `"localStorage"`、TA-D4(b) は型名）。`introducedBy` は `"W-T1"`（既存の違反）。`removeBy` は下の表のとおり。
11. `tests/architecture/boundaries.test.ts`（TA-V2）・`dataModels.test.ts`（TA-V3）・`rules.test.ts`（TA-V4）・`readonly.types.test.ts`（TA-V5 (a)）・`publicTypes.test.ts`（TA-V5 (b)）・`testIsolation.test.ts`（TA-V8）・`immutability.playback.test.ts`（TA-V6 の Queue と Session の上の段）。AST は TypeScript の compiler API で読む（`typescript` は devDependency に既にある）。TA-V2・V3・V4 は「実測した違反の集合 ＝ 許可リスト」を `toEqual` で比べる（多くても少なくても落ちる）。

**`removeBy` の割当て（許可リストの行の持ち主。後続 slice が対で確かめる）**

| rule | file（specifier） | removeBy |
|---|---|---|
| TA-D1 | `lib/playback/domain/session.ts`（`@/types`。TP-A3） | W-T2 |
| TA-D4 (b) | `lib/playback/domain/session.ts`（`Podcast` の型名が export する宣言に現れる） | W-T2 |
| TA-D2 | `lib/push/pushRegistration.ts`（`@/lib/pushBrowserPort`・`@/lib/webpush`・`@/types/index` の 3 行） | W-T9 |
| TA-D2 | `lib/passkey.ts`（`@/lib/webauthnBrowserPort`・`@/types/index` の 2 行） | W-T6 |
| TA-D3 | `lib/passkey.ts`（`JSON.parse` 2 箇所） | W-T6 |
| TA-D4 (a) | `app/(app)/podcast/page.tsx`・`podcast/[id]/page.tsx`・`components/PodcastCard.tsx`・`components/ui/StatusBadge.tsx`・`components/ui/DifficultyBadge.tsx`（`@/types`） | W-T3 |
| TA-D4 (a) | `app/(app)/feed/page.tsx`・`components/ArticleCard.tsx` | W-T4 |
| TA-D4 (a) | `app/(app)/subscriptions/page.tsx`・`components/ui/OnboardingSourcesModal.tsx` | W-T5 |
| TA-D4 (a) | `components/ui/AccountSection.tsx`・`contexts/AuthContext.tsx`（TP-A8。W-S4c が `AuthProvider.tsx` へ改名したら行の `file` も直す） | W-T6 |
| TA-D4 (a) | `app/(app)/settings/page.tsx` | W-T13（`settings/page.tsx` を最後に触る slice。W-T7a は `UserPreferences`・`GenerationQuota` の分を消し、残る `DifficultySuggestion` を W-T13 が消す） |
| TA-D4 (a) | `app/(app)/admin/{users,invites,featured-sites,metrics}/page.tsx` | W-T8 |
| TA-D4 (a) | `hooks/useWebPushSubscription.ts` | W-T9 |
| TA-D4 (a) | `app/(app)/vocabulary-test/page.tsx` | W-T12 |
| TA-D4 (a) | `app/(app)/dashboard/page.tsx`・`contexts/StreakContext.tsx` | W-T13 |
| TA-D4 (a) | `contexts/AppContext.tsx` | W-S4b（ファイル削除） |
| TA-D4 (a)・TA-D6 | `contexts/AudioPlayerContext.tsx` | W-S2c（ファイル削除） |
| TA-D5 | `@/lib/api` を import する PRES 17 ファイル（`app/page.tsx`・`app/signup/page.tsx`・`components/ui/LoginModal.tsx`・`hooks/useWebPushSubscription.ts` を含む） | W-S4d1 が specifier を `@/lib/<context>/infrastructure/api` に書き替える（TP-A6）。`removeBy` は context の slice: Catalog（`podcast`・`podcast/[id]`）= W-T3、`feed` = W-T4、`subscriptions`・`OnboardingSourcesModal`・`app/page.tsx` = W-T5、`AccountSection`・`LoginModal`・`signup` = W-T6、`settings` = W-T7a、admin 4 = W-T8、`useWebPushSubscription` = W-T9、`vocabulary-test` = W-T12、`dashboard` = W-T13 |
| TA-D5 | `@/lib/audioCache`（`podcast`・`podcast/[id]`・`settings`） | W-S2b |
| TA-D5 | `@/lib/config`（`settings`・`ThemeToggle`） | W-S4b |
| TA-D5 | `@/lib/config`（`hooks/useAudioPlayer.ts`） | W-S2c（ファイル削除） |
| TA-D5 | `@/lib/sfx`（`dashboard`・`feed`・`podcast/[id]`・`vocabulary-test`） | W-T13 |
| TA-D5 | `@/lib/reportClientError`（`app/global-error.tsx`・`components/{ClientErrorReporter,ErrorFallback}.tsx`） | W-T10a |
| TA-D5 | `@/lib/pushBrowserPort`（`components/PushNotificationSection.tsx`・`hooks/useWebPushSubscription.ts`） | W-T9 |
| TA-D5 | `@/lib/webauthnBrowserPort`（`AccountSection`・`LoginModal`） | W-T6 |
| TA-D11 | `app/(app)/dashboard/page.tsx`・`components/ui/ThemeToggle.tsx`・`hooks/useLocalStorage.ts`・`contexts/AppContext.tsx`・`lib/sfx.ts` | W-S4b |
| TA-D11 | `hooks/useAudioPlayer.ts` | W-S2c |
| TA-R-CT-1（TA-V4） | `.status` と `'completed'` 等の比較・`audio_url`・`error_message` の判定の出現（`podcast/page.tsx:91` を除く） | W-S4a |
| TA-R-CT-6（TA-V4） | `podcast/page.tsx:91`（`prevStatus !== 'completed' && p.status === 'completed'`）・`lib/podcastPolling.ts`（`POLL_TIMEOUT_MS`）・`hooks/usePodcastListPolling.ts` | W-T3（`:91` は TA-R-CT-1 の式にも当たるが、TA-R-CT-6 の行としてだけ載せる。TA-R-CT-1 の式は TA-R-CT-6 の式に当たる出現を除いて数える） |
| TA-R-CT-2（TA-V4） | `lib/podcastTitle.ts` | W-T3 |
| TA-R-CT-3（TA-V4） | `app/(app)/feed/page.tsx:17`（`/monthly/i`・`86400`） | W-S4a |
| TA-R-AC-3（TA-V4） | `admin/users/page.tsx:53`・`app/signup/page.tsx`・`components/ui/AccountSection.tsx` | W-S4c |
| TA-R-AC-6（TA-V4） | `components/NavigationBar.tsx:121` | W-T6 |
| TA-R-PB-2（TA-V4） | `hooks/useAudioPlayer.ts:7` | W-S2c（ファイル削除） |
| TA-R-PF-1（TA-V4） | `app/(app)/settings/page.tsx:21-29`（難易度の一覧・`[3, 5, 7, 10]`）・`types/index.ts:3-9` の難易度の値の配列があれば | W-S4b |
| TA-R-LN-1 / 2 / 3（TA-V4） | `contexts/StreakContext.tsx:8` / `podcast/[id]/page.tsx:138` / `vocabulary-test/page.tsx:19,59,410,443` | W-T13 / W-T11 / W-T12 |
| TA-D8（TA-V4） | 着手時の 42 件（`instanceof ApiError`・`err.status`・`reason.status`） | W-S4d1（数値の status の分岐を `kind` へ移す）。eslint の規則は W-S4d3 |
| TA-D9・D10（TA-V5 (b) の違反） | 本 slice が 0 件にする（Queue・Session・`ApiFailure`・`CacheStore.keys`） | —（許可リストに載せない） |

`app/layout.tsx` の inline の theme script（TP3。`:47`）は TA-D11 の規則そのものが除外する（新 Spec §4 TA-D11「inline の theme script = TP3 を除く」）。許可リストには載せず、検査の側で `app/layout.tsx` の inline script の 1 箇所を除外として書く（TP3 の削除条件は既存 Spec §6 のまま。W-T15 で 0 件にする許可リストの対象外）。

`removeBy` の slice は、自分の完了条件で「`removeBy` が自分の ID の行が 0 件」を確かめる（新 Spec §8.2 共通）。

**削除**: `lib/playback/ports.ts`（対象 2 で分けた後）。

## 変更の責務（層ごと。名前は新 Spec §3.2・§5.1）
| 層 | 置くもの |
|---|---|
| shared kernel `lib/shared/` | `Result`・`ApiFailure`・`DifficultyLevel`・`DIFFICULTY_LEVELS`。何も import しない |
| domain `lib/playback/domain/` | `session`・`queue`・`resume`・`source`・`audioElement`（port の型）。import してよいのは `lib/shared` と同じ dir だけ（TP-A3 の `@/types` を除く） |
| domain `lib/account/domain/` | `adminAccess`・`role` |
| adapter `lib/platform/` | `cacheStore`（型と実装）・`keyValueStore`（型と実装）・`audioElement`（実装。型は domain から `import type`） |
| adapter `lib/api/gateway.ts` | `lib/shared` の再 export（TP-A2） |
| 検査 | `architecture/`・`tests/architecture/` |

## 移行の中間状態（一時経路。持ち主はすべて user）
| ID | 経路 | 導入 | 削除の条件・slice |
|---|---|---|---|
| TP-A1 | `architecture/boundaries.allowlist.json`（着手時の実測の全行） | W-T1 | 各行は `removeBy` の slice が消す。W-T15 で 0 件 |
| TP-A2 | `lib/api/gateway.ts` の `Result`・`ApiFailure` 再 export、`types/index.ts` の `DifficultyLevel`・`UserRole` 再 export | W-T1 | W-T15（import 元を全部付け替えた後） |
| TP-A3 | `lib/playback/domain/session.ts` の `PlayableEpisode` が DTO の型を指す | 既存（W-S2a） | W-T2 |

許可リストの増減: 本 slice で「着手時の実測」を全部載せる（増やす方向は本 slice だけに許す）。以後の slice は減らす方向にだけ変える。

## 変わる挙動
無い（利用者に見える挙動・文言・backend への request は不変。`lib/playback` はまだどこからも呼ばれていない）。

## 契約と検査
| 契約 / 検査 | テスト | 備考 |
|---|---|---|
| Q-01〜Q-32・T-T1〜T-T4・T-T1b・T-T9 | `tests/lib/playback/*.test.ts`（既存の全件。件数は着手前に vitest で記録。名前と期待値は不変） | import path の付け替えだけ |
| TA-V1 | `npm run lint`（`architecture/eslint-boundaries.mjs`） | 許可リストに無い違反 0 件 |
| TA-V2 | `tests/architecture/boundaries.test.ts` | 実測 ＝ 許可リスト |
| TA-V3 | `tests/architecture/dataModels.test.ts` | (a)(c) は許可リストと一致。(b) は `session.ts` の 1 行が許可リスト（W-T2 で 0） |
| TA-V4 | `tests/architecture/rules.test.ts` | 新 Spec §7「TA-V4 の規則の表」の 11 行を骨格として持ち、着手時の出現を許可リスト（`rule` = `TA-R-*`）として固定する。式で拾えない書き方があれば式を足し、PR 説明に書く |
| TA-V5 (a) | `tests/architecture/readonly.types.test.ts` | `@ts-expect-error` で `q.items.push(x)`・`current(q)!.id = 'x'`・`state().episode` の入れ子への代入が型エラー。`npm run typecheck` が検査する |
| TA-V5 (b) | `tests/architecture/publicTypes.test.ts` | DOMAIN・APP の export する型に `readonly` でない property・配列が 0 件 |
| TA-V6（Queue・Session の上の段） | `tests/architecture/immutability.playback.test.ts` | 新 Spec §7「TA-V6 の観点」の 4 (a)〜(d)。テスト名に `TA-V6` と観点の番号を含める |
| TA-V8 | `tests/architecture/testIsolation.test.ts` | `tests/lib/**` のうち DOMAIN・APP を対象にするテストが `@/lib/api`・`@/lib/platform`・`vi.mock('@/lib/api` を含まない（0 件） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。既存テストの件数 ＝ 着手前に vitest で記録した件数＋ 新規（`tests/architecture/` 7 ファイル）。既存のテスト名・期待値は 1 つも変えない（変えてよいのは import path と `QueueState` の型引数だけ。変えた行を PR 説明に列挙）。
- **ファイルの配置**（量化する集合 = 対象 1〜5 の全ファイル）: `lib/playback/domain/{session,queue,resume,source,audioElement}.ts`・`lib/shared/{result,apiFailure,difficulty}.ts`・`lib/account/domain/{adminAccess,role}.ts` が存在し、`lib/playback/{session,queue,resume,source,ports}.ts`・`lib/account/adminAccess.ts` が存在しない（`ls`）。
- **DOMAIN の禁止 import**（量化する集合 = `lib/playback/domain/*.ts`・`lib/account/domain/*.ts`）: `grep -rn "from '@/" lib/playback/domain lib/account/domain | grep -v "from '@/lib/shared\|from '@/lib/playback/domain\|from '@/lib/account/domain"` の出力が `lib/playback/domain/session.ts` の `@/types` の 1 行だけ（TP-A3。許可リストの行と一致）。
- **`Response` と JSON**（集合 = `lib/playback/domain/**`）: `grep -rn "Response\|JSON\.\|localStorage\|fetch(\|caches\." lib/playback/domain` が 0 件（コメントを含む。説明では「応答」「保存領域」と書く）。
- **許可リスト**: `architecture/boundaries.allowlist.json` の行数 ＝ TA-V2・V3・V4 が実測した違反の数（テストが `toEqual` で固定）。全行に `removeBy` があり、値は上の表の slice ID のどれか（テストで pin）。
- **凍結**（集合 = `queue.ts` の 11 操作の全戻り値・`session.ts` の `state()` と `stateChanged`）: TA-V6 の観点 4 (a)〜(d) が green。
- eslint の負例確認: `lib/playback/domain/` の一時ファイルに `import '@/lib/api/gateway'` と `JSON.parse('{}')` を置いた `npm run lint` が非ゼロ終了し、`lib/platform/` の `import type` は指摘されない（確認後に一時ファイルを削除）。
- `lib/playback`・`lib/shared`・`lib/account/domain` を production（`app components hooks contexts`）から import する箇所が 0 件（`grep -rln "@/lib/playback/\|@/lib/shared/\|@/lib/account/domain" app components hooks contexts` が 0）。

## 禁止事項 / scope 外
- `PlayableEpisode` の 5 field の DTO 参照を外さない（W-T2）。`Episode`・`QueuedEpisode`・`displayTitle` を作らない（W-T2）。
- `fail` を足さない（W-S2a1）。Coordinator・OfflineLibrary・PositionReporter・リードモデルを作らない（W-S2a2）。
- `app/`・`components/`・`hooks/`・`contexts/` の production を変えない（許可リストに載せるだけ）。旧再生実装を変えない。
- `lib/api/gateway.ts` の契約（`request` の署名・`ApiFailure` の variant の集合）を変えない。`readonly` の付与だけ。
- 呼出側の import（`@/lib/api/gateway` の `Result`、`@/types` の `DifficultyLevel`・`UserRole`）を付け替えない（W-T15）。
- 許可リストの行を、着手時の実測より減らさない（本 slice が消すのは TA-D1 の 4 行・TA-D3 の `ports.ts` の 2 行・TA-D9 だけで、これは「消した」のではなく「本 slice の対象」なので載せない）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/playback/*.test.ts`（着手前に記録した件数）、`tests/lib/platform/adapters.test.ts`、`tests/lib/account/adminAccess.test.ts`、`tests/lib/api/gateway.test.ts`、`npm test` 全件。

## 検証
`npm test`（既存件数不変 ＋ 新規）、`npm run lint`（負例確認を含む）、上記 grep 4 種、`npm run typecheck`（TA-V5 (a)）、`npm run build`。

## 記録
- 完了時、新 Spec §4 の「現状の違反」列の実測値（AST）と、許可リストの初期の行数を PR 説明と親 docs（`research-reports/2026-09-30-refactor-target-architecture.md` の web の節）へ返す。grep の値と違う場合はその差。
- TA-V4 の式を足した場合は、新 Spec §7 の表へ返す。
- 導出 W-16・W-17・W-34 を台帳 §5.0（親 docs `research-reports/2026-09-23-design-docs-mino-audit.md`）へ登録する旨を返す。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §3.1・§3.2・§4・§7・§8.2（W-T1 行）・§8.4・§10.1（W-16・W-17・W-34）・§11
- 既存 Spec §2（port を置く根拠）・§3.1（Queue の段）・§4（CI-T1〜T4・T1b・T9）
- 親 docs: ADR-110 決定 3・7・10、architecture.md §3・§6・§8
