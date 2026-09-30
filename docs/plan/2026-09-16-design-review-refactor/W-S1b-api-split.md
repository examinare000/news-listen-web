## web リファクタ W-S1b: `lib/api.ts` の backend リソース単位分割（挙動不変）

## 概要
`lib/api.ts`（578 行。`ApiError`・TP1 の互換 adapter `request`・`createApiClient()` が返す 58 メソッド。2026-09-30 実測。W-S1 前の 2026-09-23 実測は 554 行）を backend リソース単位の 10 ファイルへ分割する。分割軸は「同じ backend リソースの契約が同じ理由で変わる」こと（親 docs `design/web-design.md` §12.3 W-S1b 行）。型・関数名・シグネチャ・呼出箇所は不変で、変わるのは定義の置き場（module 構成）だけ。正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md` §2（`lib/api/` の置き場・prohibited_structures）と親 docs web-design §12.1・§12.3。**検証モード: 再設計しない**。新しい契約 ID は作らない（本 slice に RED テストは無い。既存 `tests/lib/api.*.test.ts(x)` **8 ファイル**が特性テスト。W-S1 が TP1 の特性テスト 2 本を足した）。

> **2026-09-30 の前提点検（wave 1 完了後）**: W-S1 と SG-W1 の成果で実測値が変わった。`lib/api.ts` 554 → 578 行、特性テスト 6 → 8 ファイル（146 → 156 件）、`vi.mock('@/lib/api'` を使うテスト 25 → 23 ファイル、呼出側の `from '@/lib/api'` は 21 → 19 ファイル（20 行）、`createApiClient()` の呼出は 35。58 メソッドと export 集合（`ApiError`・`createApiClient`）は不変。減った分は W-S1 が再生系 4 箇所を gateway 直呼びへ移し、`lib/audioCache.ts` が引数注入になったため（SG-W1 / SG-W2）。本文の数値は 2026-09-30 実測へ更新済み。

W-S1（失敗の表し方＝`Result` / `ApiFailure`）を先に決めてから 10 箇所へ配る、という順序で W-S1 に依存する（親 plan）。context 別（`lib/<context>`）への取り込みは W-S4d1 で行う 2 段階の 1 段目。W-S2a（`lib/playback/*` の新設）とは対象ファイルが重ならないため並行投入できる（README「投入順」）。

## 規模（見込み。根拠 = 2026-09-30 実測 `lib/api.ts` 578 行・58 メソッド）
- production ≈ 760 行: 10 ファイルへの移動 ≈ 430（メソッド定義。移動であり diff は「削除＋追加」で 2 倍に見えるが内容は同一）、`legacyRequest.ts` への移動 ≈ 100（`ApiError`・TP1 の `request` と補助型。`lib/api.ts:48-146`）、各ファイルの雛形（import・型）≈ 50、`lib/api.ts` の合成点 ≈ 80。
- test 0 行（1 行も変更しない。完了条件）。
- 合計 ≈ 760 行（実質の新規記述 ≈ 130 行）。

## 前提・着手条件
- 依存 slice: W-S1（`lib/api/gateway.ts`・`ApiClientProvider`・TP1 `ApiError` 互換 adapter）の **web PR が main に merge 済み、かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` を実行し `web` 行に `+` が無い）こと。takt の worktree は親 main から clone し submodule が親の記録と一致することを検査するため、ポインタ PR 前に投入すると `tree_incomplete` で失敗する。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。着手前に次を記録する（括弧内は 2026-09-30 実測。着手時に数え直す）:
  ```
  grep -cE "^    (async )?[a-zA-Z_]+\(" lib/api.ts                          # メソッド数＋1（実測 59。うち 1 行は ApiError の `super(detail)` でメソッドではない → 58）
  grep -rn "from '@/lib/api'" app components hooks contexts lib | wc -l     # 呼出側 import 行（実測 20 行・19 ファイル）
  grep -rln "vi.mock('@/lib/api'" tests | wc -l                             # mock 箇所（実測 23 ファイル）
  ```
- Selection Gate 依存なし。
- 棄却済み案（再提案しない）: `createApiClient` factory の階層化（Spec §5 RO1）、context 別 6 分割をこの slice で行うこと（Spec §5 rejected_overdesign。W-S4d1）、`lib/api.ts` の削除（呼出側 19 ファイルの import 変更は W-S4d1 の page 側移行と同じ作業になり W-S1「呼出箇所は変更しない」に反する。削除は W-S4d3）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
**新規（10 ファイル。括弧内は移すメソッド。合計 58）** — 各ファイルは `createApiClient()` が返すオブジェクトのうち当該リソースのメソッド群を、メソッド名・引数・戻り型を変えずに定義する。
1. `lib/api/feed.ts`（1）: `getFeed`
2. `lib/api/articles.ts`（4）: `getStarredArticles` `starArticle` `dismissArticle` `unstarArticle`
3. `lib/api/podcasts.ts`（5）: `getPodcasts` `getPodcast` `updatePosition` `markCompleted` `submitQuizAnswers`
4. `lib/api/settings.ts`（8）: `getSources` `addSource` `deleteSource` `getFeaturedSources` `getOnboardingStatus` `completeOnboarding` `getPreferences` `updatePreferences`
5. `lib/api/users.ts`（4）: `getGenerationQuota` `getListeningStreak` `getDifficultySuggestion` `getLearningDashboard`
6. `lib/api/vocabulary.ts`（4）: `saveVocabulary` `getVocabulary` `getVocabularyTestSession` `submitVocabularyTestResult`
7. `lib/api/health.ts`（1）: `checkHealth`
8. `lib/api/auth.ts`（16）: `login` `logout` `register` `getMe` `updateProfile` `changePassword` `deleteAccount` `getPasskeyRegisterOptions` `verifyPasskeyRegistration` `getPasskeyLoginOptions` `verifyPasskeyLogin` `getPasskeyCredentials` `deletePasskeyCredential` `getSessions` `revokeSession` `revokeOtherSessions`（backend router は auth.py / passkey.py の 2 つだが URL は全て `/auth/*`）
9. `lib/api/admin.ts`（12）: `getMetrics` `listUsers` `createUser` `updateUser` `deleteUser` `createInvite` `listInvites` `revokeInvite` `listFeaturedSites` `createFeaturedSite` `updateFeaturedSite` `deleteFeaturedSite`（admin.py / invites.py。URL は全て `/admin/*`。Spec §2 の `lib/api/admin.ts`）
10. `lib/api/notifications.ts`（3）: `getVapidPublicKey` `subscribePush` `unsubscribePush`

**変更**
- `lib/api.ts`: 上記 10 ファイルを合成して `createApiClient()` を返す薄い合成点にする。export 集合は着手前と同一（2026-09-23 実測: `ApiError`・`createApiClient` の 2 つ。W-S1 が加えた export があれば着手時に列挙し、同じ集合を維持）。`ReturnType<typeof createApiClient>` の型は着手前と同一。
- TP1（`ApiFailure` → `ApiError` throw の互換 adapter。W-S1 導入）は `lib/api.ts:48-146` にある（2026-09-30 実測）。10 ファイルから循環 import せずに使えるよう `lib/api/legacyRequest.ts` へ**移すだけ**（挙動・owner・削除条件は W-S1 のまま。`lib/api/gateway.ts` には入れない: gateway は throw しない契約 CI-T12）。**`ApiError` class も一緒に `legacyRequest.ts` へ移し、`lib/api.ts` は `export { ApiError } from '@/lib/api/legacyRequest'` で再 export する**（`request` が `ApiError` を throw するため、class を `lib/api.ts` に残すと `lib/api.ts` → リソースファイル → `legacyRequest.ts` → `lib/api.ts` の循環になる。再 export なので class の同一性は保たれ、呼出側 11 箇所の `import { ApiError } from '@/lib/api'` と `instanceof ApiError` は変わらない）。`GATEWAY_RAW_KEY` の読み手が 1 ファイルだけである条件（W-S1 のコメント）は移動先で保つ。

**削除**: なし。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。
- 10 ファイルが存在し、各ファイルのメソッド集合が上の列挙と一致する（合計 58。着手時の数え直しで差があれば差分を PR 説明に書き、列挙を更新してから着手）。
- **リソース横断関数 0 件**（量化する集合 = 10 ファイルの全 export 関数）: 各ファイルの `request` 呼出パスが当該リソースの URL prefix（`/api/backend/feed` `/articles` `/podcasts` `/settings` `/users/me` `/vocabulary` `/health` `/auth` `/admin` `/notifications`）以外を含まない。判定: `grep -n "/api/backend/" lib/api/<file>.ts` の全行が当該 prefix。
- 呼出側は不変: `app/`・`components/`・`hooks/`・`contexts/`・`lib/`（`lib/api/` 配下を除く）で `from '@/lib/api'` の行数と `createApiClient()` の呼出数が着手前と同数、`grep -rn "from '@/lib/api/" app components hooks contexts lib` の結果（ファイルと行）が着手前と同一（W-S1 が入れた `lib/api/gateway.ts` への import は着手前から存在する。`lib/api.ts` 自身と `lib/api/` 配下の相互 import は除外）。
- 既存テスト `tests/lib/api.{test,auth.test,invites.test,passkey.test,sessions.test,starred.test,tp1.test}.ts`・`tests/lib/api.tp1.fake.test.tsx` の 8 ファイルと、`vi.mock('@/lib/api'` を使う 23 ファイル（2026-09-30 実測。集合は着手時に `grep -rln "vi.mock('@/lib/api'" tests` で固定する）が **1 行も変更せず** green（本 slice 完了時点の条件。後続 W-S4d2a / W-S4d2b が mock 側を、W-S4d3 が特性テスト側を更新する（許可））。`tests/lib/api/gateway.test.ts` と `vi.mock('@/lib/api/gateway'` を使うテスト（`api.tp1.fake.test.tsx`）も不変。
- 10 ファイルのいずれも React・`localStorage`・`caches`・`Audio` を import しない（Spec §2 prohibited_structures。`grep -ln "from 'react'\|localStorage\|caches\.\|new Audio" lib/api/*.ts` が 0）。

## 禁止事項 / scope 外
- メソッド名・引数・戻り型・URL・HTTP method・エラー写像（TP1 の throw 契約）を変えない。
- 呼出側の import 経路を `@/lib/api/<resource>` へ変えない（W-S4d1）。`lib/<context>/` を作らない（W-S4d1）。
- `lib/api/gateway.ts`（W-S1）の契約を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/api.*.test.ts(x)` 8 ファイル（2026-09-30 実測 156 件 = 従来 6 ファイル 146 ＋ TP1 の 2 ファイル 10）。加えて `npm test` 全件。

## 検証
`npm test` 全件 green（件数が着手前と同数）、上記 grep 群、`npm run build` 成功。

## 記録
- 着手時の数え直し結果（メソッド数・import 行数）と、列挙との差分を PR 説明に残す。
- 完了後、親 docs `design/web-design.md` §8（API クライアント設計）のファイル構成記述と §12.3 の W-S1b 行を現状記述へ書き換える対象として `docs/trial-log/` に「未反映」を残さず、README の完了印を付ける。
