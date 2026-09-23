## web リファクタ W-S1b: `lib/api.ts` の backend リソース単位分割（挙動不変）

## 概要
`lib/api.ts`（554 行。`ApiError`・`request`・`createApiClient()` が返す 58 メソッド。2026-09-23 実測）を backend リソース単位の 10 ファイルへ分割する。分割軸は「同じ backend リソースの契約が同じ理由で変わる」こと（親 docs `design/web-design.md` §12.3 W-S1b 行）。型・関数名・シグネチャ・呼出箇所は不変で、変わるのは定義の置き場（module 構成）だけ。正本は Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md` §2（`lib/api/` の置き場・prohibited_structures）と親 docs web-design §12.1・§12.3。**検証モード: 再設計しない**。新しい契約 ID は作らない（本 slice に RED テストは無い。既存 `tests/lib/api.*.test.ts` 6 ファイルが特性テスト）。

W-S1（失敗の表し方＝`Result` / `ApiFailure`）を先に決めてから 10 箇所へ配る、という順序で W-S1 に依存する（親 plan）。context 別（`lib/<context>`）への取り込みは W-S4d で行う 2 段階の 1 段目。W-S2a（`lib/playback/*` の新設）とは対象ファイルが重ならないため並行投入できる（README「投入順」）。

## 前提・着手条件
- 依存 slice: W-S1（`lib/api/gateway.ts`・`ApiClientProvider`・TP1 `ApiError` 互換 adapter）の **web PR が main に merge 済み、かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` を実行し `web` 行に `+` が無い）こと。takt の worktree は親 main から clone し submodule が親の記録と一致することを検査するため、ポインタ PR 前に投入すると `tree_incomplete` で失敗する。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。着手前に次を記録する（2026-09-23 実測値は参考。着手時に数え直す）:
  ```
  grep -cE "^    (async )?[a-zA-Z_]+\(" lib/api.ts                          # メソッド数＋1（実測 59。うち 1 行は ApiError の `super(detail)` でメソッドではない → 58）
  grep -rn "from '@/lib/api'" app components hooks contexts lib | wc -l     # 呼出側 import 行（実測 21 ファイル）
  grep -rln "vi.mock('@/lib/api'" tests | wc -l                             # mock 箇所（実測 25 ファイル）
  ```
- Selection Gate 依存なし。
- 棄却済み案（再提案しない）: `createApiClient` factory の階層化（Spec §5 RO1）、context 別 6 分割をこの slice で行うこと（Spec §5 rejected_overdesign。W-S4d）、`lib/api.ts` の削除（呼出側 21 ファイルの import 変更は W-S4d の page 側移行と同じ作業になり W-S1「呼出箇所は変更しない」に反する）。
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
- TP1（`ApiFailure` → `ApiError` throw の互換 adapter。W-S1 導入）が `lib/api.ts` 内にある場合は、10 ファイルから循環 import せずに使えるよう `lib/api/legacyRequest.ts` へ**移すだけ**（挙動・owner・削除条件は W-S1 のまま。`lib/api/gateway.ts` には入れない: gateway は throw しない契約 CI-T12）。

**削除**: なし。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。
- 10 ファイルが存在し、各ファイルのメソッド集合が上の列挙と一致する（合計 58。着手時の数え直しで差があれば差分を PR 説明に書き、列挙を更新してから着手）。
- **リソース横断関数 0 件**（量化する集合 = 10 ファイルの全 export 関数）: 各ファイルの `request` 呼出パスが当該リソースの URL prefix（`/api/backend/feed` `/articles` `/podcasts` `/settings` `/users/me` `/vocabulary` `/health` `/auth` `/admin` `/notifications`）以外を含まない。判定: `grep -n "/api/backend/" lib/api/<file>.ts` の全行が当該 prefix。
- 呼出側は不変: `app/`・`components/`・`hooks/`・`contexts/`・`lib/`（`lib/api/` 配下を除く）で `from '@/lib/api'` の行数と `createApiClient()` の呼出数が着手前と同数、`grep -rn "from '@/lib/api/" app components hooks contexts lib` の結果（ファイルと行）が着手前と同一（W-S1 が入れた `lib/api/gateway.ts` への import は着手前から存在する。`lib/api.ts` 自身と `lib/api/` 配下の相互 import は除外）。
- 既存テスト `tests/lib/api.{test,auth.test,invites.test,passkey.test,sessions.test,starred.test}.ts` 6 ファイルと `vi.mock('@/lib/api')` を使う 25 ファイルが **1 行も変更せず** green。
- 10 ファイルのいずれも React・`localStorage`・`caches`・`Audio` を import しない（Spec §2 prohibited_structures。`grep -ln "from 'react'\|localStorage\|caches\.\|new Audio" lib/api/*.ts` が 0）。

## 禁止事項 / scope 外
- メソッド名・引数・戻り型・URL・HTTP method・エラー写像（TP1 の throw 契約）を変えない。
- 呼出側の import 経路を `@/lib/api/<resource>` へ変えない（W-S4d）。`lib/<context>/` を作らない（W-S4d）。
- `lib/api/gateway.ts`（W-S1）の契約を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/api.*.test.ts` 6 ファイル（2026-09-23 実測 146 件）。加えて `npm test` 全件。

## 検証
`npm test` 全件 green（件数が着手前と同数）、上記 grep 群、`npm run build` 成功。

## 記録
- 着手時の数え直し結果（メソッド数・import 行数）と、列挙との差分を PR 説明に残す。
- 完了後、親 docs `design/web-design.md` §8（API クライアント設計）のファイル構成記述と §12.3 の W-S1b 行を現状記述へ書き換える対象として `docs/trial-log/` に「未反映」を残さず、README の完了印を付ける。
