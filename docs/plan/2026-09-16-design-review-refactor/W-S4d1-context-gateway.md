## web リファクタ W-S4d1: `lib/<context>/` の export 集合と page 側注入点の gateway 化（学習機能サイクルで着手）

> **2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正**（新 Spec = `docs/design/2026-09-30-implementation-spec-target-architecture.md`。§8.3 W-S4d1 の 5 項目を本文へ反映した）
> - (1) export 集合の置き場を `lib/<context>/infrastructure/api.ts` にした（旧 `lib/<context>/api.ts`）。`lib/playback/api.ts` は作らない。対象は 6 ファイル（catalog・account・preferences・admin・learning・notifications）と `lib/platform/health.ts`（W-23）。
> - (2) page がこれらを import する形は **TP-A6** として許可リストに載せる（W-T1 が載せた `@/lib/api` の TA-D5 の行の `specifier` を、移した先の `@/lib/<context>/infrastructure/api` に書き替える。行数は増やさない。`removeBy` は W-T1 の表の context ごとの slice のまま）。
> - (3) 対象に `lib/push/pushRegistration.ts` と `tests/lib/push/pushRegistration.test.ts` を足した: client の型を `Result` を返す形にし、`ok` でない結果を現行の throw と同じ結果に写す（W-25）。
> - (4) `lib/playback/infrastructure/gatewayFns.ts` と `lib/catalog/infrastructure/episodeGateway.ts` は path を自分で組み立てず、`lib/api/podcasts.ts` の関数を呼ぶ形にする（path の置き場を 1 つにする: W-23）。
> - (5) 禁止事項「`lib/api/gateway.ts` の契約を変えない」はそのまま（`detail` は W-S4a で足してある）。
> - あわせて、TA-D8 の 42 件（`removeBy: W-S4d1`。W-T1 の表）を 0 件にすることを完了条件に足した。

## 概要
旧 W-S4d（2026-09-23 起票）を 2026-09-24 に 4 つの PR（W-S4d2a → W-S4d2b → **W-S4d1** → W-S4d3）へ分けたうちの production 側。W-S1b のリソース単位 10 ファイルを `Result` を返す形に揃え、各 context の export 集合 `lib/<context>/infrastructure/api.ts` を新設し、page 側の `createApiClient()` 呼出と `ApiError` 参照を `ApiClientProvider`（W-S1）経由の gateway 呼出へ替える。TP1（`ApiError` 互換 adapter）と `lib/api.ts` は本 slice では**残す**（削除は W-S4d3）。失効検知の一般化（`onUnauthorized`）も W-S4d3。正本は Implementation Spec §2（依存方向・prohibited_structures）・§4 冒頭（失敗の表現）・§6 S1 行・S4 行、親 docs web-design §12.1・§12.2「注入点」行・§12.3 W-S1 / W-S1b / W-S4 行。**検証モード: 再設計しない**。新しい契約 ID は作らない。

分割の理由（2026-09-24 実測）: 旧 W-S4d は production 19 ファイル（5,731 行）と `vi.mock('@/lib/api')` テスト 21 ファイル（7,742 行。W-S2c 後の値）を 1 PR に抱え、見込み変更行が 2,500 行を超える。テストを先に gateway double へ移すと（W-S4d2a / 2b）、本 slice は production の置換だけになり 1 PR で読める。

## 規模（見込み。根拠 = 2026-09-24 実測の対象ファイル行数と呼出箇所数）
- production ≈ 780 行: `lib/<context>/infrastructure/api.ts` 6 ファイル新設 ≈ 300（56 関数の再 export と署名）、`pushRegistration.ts` ≈ 30、`gatewayFns.ts`・`episodeGateway.ts` ≈ 20、`lib/api/<resource>.ts` 10 ファイルの `Result` 化 ≈ 120（58 関数 × 2 行）、`lib/api.ts` の TP1 wrap 化 ≈ 40、page 側 19 ファイル ≈ 300（`createApiClient()` 32 箇所 ＋ `ApiError` / `.status` 分岐 44 箇所 × 3 行 ＋ import と hook 配線 19 × 5 ＋ `kind` → 文言の写像関数 feed / subscriptions / signup / AccountSection ≈ 100）。
- test ≈ 250 行: 21 テストの `ApiClientProvider` 包み込み ≈ 105（1 ファイル 5 行）、`tests/lib/passkey.test.ts`（155 行）の `Result` 化 ≈ 60、`tests/app/signup/page.test.tsx`（166 行）の `register` 失敗注入 ≈ 20、`tests/app/page.test.tsx` の Provider 包み込み ≈ 5、`AuthProvider.*.test.tsx` の `login` / `register` 戻り値 ≈ 30、`lib/<context>/infrastructure/api.ts` の export 集合 pin テスト ≈ 30、`tests/lib/push/pushRegistration.test.ts` の `Result` 化 ≈ 50。
- 合計 ≈ 1,030 行。1,000 行をわずかに超えるが、production の切替は「全 page が同時に Provider を使う」1 段でないと `createApiClient()` と Provider の 2 経路が並存する（Spec §5 rejected: factory 階層化と同型）ため、これ以上は割らない。

## 前提・着手条件
- 依存 slice: **W-S1b**（10 リソースファイル）・**W-S4a / W-S4b / W-S4c**・**W-S4d2a / W-S4d2b**（テストが gateway double を使う状態）の web PR がすべて main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- W-S5 とは `contexts/AuthProvider.tsx`・`app/(app)/settings/page.tsx`・`tests/contexts/AuthProvider.*.test.tsx` が重なるため**並行投入しない**（順序は不定。後から merge する側が rebase）。W-S5 が先なら `AuthProvider` の回収 `reclaimAudioCaches`・`subjectCleanup` の発火条件を変えずに gateway 化する。W-S3 とは対象ファイルが重ならず並行可。
- Selection Gate 依存なし。
- 棄却済み案（再提案しない。Spec §5）: `createApiClient` factory の階層化（RO1）、旧新 2 経路の併存移行。
- `docs/trial-log/` を最初に読む。着手前に次を記録する（2026-09-24 実測値は参考。着手時に数え直す）:
  ```
  grep -rn 'createApiClient()' app components hooks contexts lib | grep -v '^lib/api' | wc -l   # 実測 36（W-S2c 後は AudioPlayerContext 4・audioCache 1 が消え 31。W-0 が useWebPushSubscription に足した分は着手時の値）
  grep -rln "ApiError" app components hooks contexts | sort                                       # 実測 12（W-S2c 後 11: app 7・components 3・contexts/AuthProvider.tsx）
  grep -rn "instanceof ApiError\|err\.status\|reason\.status" app components hooks contexts | wc -l   # 実測 44（W-S2c 後 42）
  ```

## 対象（web サブモジュールのみ）
1. **`lib/api/<resource>.ts` 10 ファイルの `Result` 化**（W-S1b の関数名・URL・HTTP method 不変）: 各関数の署名を `fn(gateway: ApiGateway, ...args) → Promise<Result<T, ApiFailure>>` にし、TP1 の throw 経路（`lib/api/legacyRequest.ts`）を呼ばず `gateway.request` を直接呼ぶ。`lib/api.ts` の `createApiClient()` は 58 関数を「`Result` を受けて失敗なら `ApiError` を throw する」1 つの wrap 関数で包む（TP1 の置き場が `legacyRequest.ts` から `lib/api.ts` 内の wrap 1 関数へ移るだけ。owner・削除条件は W-S1 のまま。W-S4d3 が削除）。
2. **`lib/<context>/infrastructure/api.ts` の export 集合**（新規 6 ファイル ＋ `lib/platform/health.ts`。各ファイルは当該関数を `lib/api/<resource>` から再 export するだけで、`fetch` / React / `localStorage` / `caches` / `Audio` を import しない）。Playback の request（`getPodcast`・`updatePosition`・`markCompleted`）は export 集合を作らず、`lib/playback/infrastructure/gatewayFns.ts`（W-S2a2）と `lib/catalog/infrastructure/episodeGateway.ts`（W-T2）が `lib/api/podcasts.ts` の関数を直接呼ぶ（W-23。下の対象 7）:
   | ファイル | 公開関数（計 56 ＋ `checkHealth`。Playback の `updatePosition`・`markCompleted` は export 集合に入れない: 対象 7） |
   |---|---|
   | `lib/catalog/infrastructure/api.ts`（13） | `getFeed` / `getStarredArticles` `starArticle` `dismissArticle` `unstarArticle` / `getPodcasts` `getPodcast` / `getSources` `addSource` `deleteSource` `getFeaturedSources` `getOnboardingStatus` `completeOnboarding` |
   | `lib/account/infrastructure/api.ts`（16） | `login` `logout` `register` `getMe` `updateProfile` `changePassword` `deleteAccount` `getPasskeyRegisterOptions` `verifyPasskeyRegistration` `getPasskeyLoginOptions` `verifyPasskeyLogin` `getPasskeyCredentials` `deletePasskeyCredential` `getSessions` `revokeSession` `revokeOtherSessions` |
   | `lib/preferences/infrastructure/api.ts`（2） | `getPreferences` `updatePreferences` |
   | `lib/admin/infrastructure/api.ts`（12） | `getMetrics` `listUsers` `createUser` `updateUser` `deleteUser` `createInvite` `listInvites` `revokeInvite` `listFeaturedSites` `createFeaturedSite` `updateFeaturedSite` `deleteFeaturedSite` |
   | `lib/learning/infrastructure/api.ts`（10） | `getGenerationQuota` `getListeningStreak` `getDifficultySuggestion` `getLearningDashboard` / `saveVocabulary` `getVocabulary` `getVocabularyTestSession` `submitVocabularyTestResult` / `submitQuizAnswers` |
   | `lib/notifications/infrastructure/api.ts`（3） | `getVapidPublicKey` `subscribePush` `unsubscribePush` |
   | `lib/platform/health.ts`（1） | `checkHealth`（production の呼出 0 件。2026-09-24 実測。`tests/app/settings/page.test.tsx:15` の mock と `tests/lib/api.test.ts` だけが参照） |
   着手時に、`lib/api/*` の export 58 関数 ＝ 上表の 56 ＋ `checkHealth` ＋ Playback の 2（`updatePosition`・`markCompleted`）であることを `tests/lib/contextApi.test.ts` で確かめる（`getPodcast` は Catalog の表に含め、`episodeGateway.ts` も `lib/api/podcasts.ts` から直接呼ぶ）。
   `lib/passkey.ts` の `registerPasskey` / `loginWithPasskey` は `PasskeyClient` を `lib/account/infrastructure/api.ts` の 4 関数 ＋ gateway に替え、`Result` を返す（`ApiError` を throw しない）。
3. **`ApiClientProvider` の配置と `gateway` prop**: `ApiClientProvider`（W-S1 が置いたファイル）に省略可能な `gateway` prop を加える（渡されればそれを保持、省略時は W-S1 どおり自前生成）。`contexts/AuthProvider.tsx` が `createGateway()`（`lib/api/gateway.ts`）で 1 つ生成し、自身の呼出（`getMe` / `login` / `register` / `logout` / passkey）にはそれを直接使い、`<ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>` で配下へ渡す。`app/layout.tsx` からは W-S1 が置いた `<ApiClientProvider>` を外す（`AuthProvider` ⊃ `ApiClientProvider` の順に固定。`onUnauthorized` の配線は W-S4d3）。
4. **page 側の注入点移行**（量化する集合 = 着手時の `createApiClient()` 呼出全行 ＋ `ApiError` を import する全ファイル）: `app/` 13（`page.tsx`・`signup/page.tsx`・`(app)/` の `admin/{users,featured-sites,metrics,invites}`・`dashboard`・`settings`・`vocabulary-test`・`feed`・`subscriptions`・`podcast`・`podcast/[id]`）・`components/ui/` 3（`AccountSection` `OnboardingSourcesModal` `LoginModal`）・`hooks/useWebPushSubscription.ts`・`contexts/StreakContext.tsx`・`contexts/AuthProvider.tsx` の計 19 ファイルの呼出を `useApiClient()`（`ApiClientProvider` の hook）で得た gateway ＋ `lib/<context>/infrastructure/api.ts` の関数へ替え、失敗は `ApiFailure.kind` で分岐する。`ApiError.status` の数値分岐・`instanceof ApiError` を消す。`useAuth()` の `login` / `register` / `loginWithPasskey` は `Promise<Result<void, ApiFailure>>` を返し、`LoginModal` / `signup` は `kind` を文言に写す。文言は hook / page 側の写像に集約する（Spec §3.1「UI 文言は hook 側で写像」）。`hooks/useWebPushSubscription.ts` は W-0 の `pushRegistration` を `lib/notifications/infrastructure/api.ts` ＋ gateway で組み立てる（`createApiClient()` を使わない）。
4b. **`lib/push/pushRegistration.ts`**（W-25・新 Spec §5.5 TA-R-NT-1）: client（`getVapidPublicKey`・`subscribePush`・`unsubscribePush`）の型を `Result` を返す形にし、`ok` でない結果を現行の throw と同じ結果に写す: `subscribe` は `'error'`、`reregister` は黙って終える、`detachFromSubject` は失敗を返し、呼出側（認証 Provider の logout）は握る。`tests/lib/push/pushRegistration.test.ts`（40 件）の reject の注入を `Result` の失敗へ替える（期待値は不変）。組み立ては `hooks/useWebPushSubscription.ts`・認証 Provider が `lib/notifications/infrastructure/api.ts` ＋ gateway で行う。
5. **テストの包み込み**: W-S4d2a / 2b で gateway double（`vi.mock('@/lib/api/gateway')` の fake `request`）に移した 21 テストと、`useApiClient()` を呼ぶ component を描画するその他のテスト（着手時に `grep -rL "ApiClientProvider" tests/app tests/components tests/contexts tests/hooks` と描画対象の突合で数える。2026-09-24 実測で該当が見込まれるのは `tests/app/page.test.tsx`）の render を `<ApiClientProvider>` で包む。fake `request` の設定行と oracle は W-S4d2a / 2b のまま変えない。
7. **Playback の request の置き場**（W-23）: `lib/playback/infrastructure/gatewayFns.ts`（`createPositionSync`）と `lib/catalog/infrastructure/episodeGateway.ts`（`createEpisodeGateway`）を、`gateway.request` に path を書く形から `lib/api/podcasts.ts` の `updatePosition`・`markCompleted`・`getPodcast`（本 slice で `fn(gateway, …) → Result` になったもの）を呼ぶ形にする。path・method・body は不変（`gatewayFns.test.ts`・`episodeGateway.test.ts` の期待値は不変）。
6. **`tests/lib/passkey.test.ts`・`tests/app/signup/page.test.tsx`**（W-S4d2b の処遇表の実施）: `ApiError` の reject 注入を `Result` 失敗（`{ ok: false, failure: { kind } }`）に替える。oracle（文言・呼出の有無）は不変。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T12 | 失敗は `Result` の `ApiFailure`（gateway 側は W-S1 で満たし済み） | 本 slice は呼出側: 各 page テストで fake `request` に `ApiFailure{kind}` を返させ、文言が現行と同じであることを pin（W-S4d2a / 2b が既に書いた行が green になる） |
| — | export 集合の固定 | `tests/lib/contextApi.test.ts`（新規）: 上表 6 ファイルと `lib/platform/health.ts` の `Object.keys(await import(...))` が列挙と一致し、`lib/playback/api.ts`・`lib/<context>/api.ts`（`infrastructure` の外）が存在しない |
| W-25 | push の client の失敗 | `tests/lib/push/pushRegistration.test.ts`（期待値不変） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 4 本 green（変更なし。`page.route` の stub は HTTP 応答なので gateway 化の影響を受けない）。
- **`createApiClient()` の呼出 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/` と `lib/` のうち `lib/api.ts` を除く全ファイル。`grep -rn 'createApiClient()' app components hooks contexts lib | grep -v '^lib/api\.ts:'` が 0 件）。
- **`ApiError` の参照 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/` `lib/` のうち `lib/api.ts` を除く。`grep -rn "ApiError" app components hooks contexts lib | grep -v '^lib/api\.ts:'` が 0 件。コメントも含めて 0）。`tests/` の `ApiError` 参照は `tests/lib/api.*.test.ts` 6 ファイルだけ（W-S4d3 が書き換える）。
- **`.status` の数値分岐 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/`。`grep -rnE "\.status *(===|!==|==|!=) *[0-9]" app components hooks contexts` と `grep -rn "switch (.*\.status)" app components hooks contexts` が 0 件。`podcast.status === 'completed'` のような文字列比較は対象外）。
- `lib/<context>/infrastructure/api.ts` 6 ファイルと `lib/platform/health.ts` の export 集合が対象 2 の表と一致し、いずれも `fetch` / React / `localStorage` / `caches` / `Audio` を import しない（`grep -ln "from 'react'\|fetch(\|localStorage\|caches\.\|new Audio" lib/*/infrastructure/api.ts lib/platform/health.ts` が 0）。`ls lib/playback/api.ts lib/*/api.ts` が何も出さない。
- **path の置き場が 1 つ**: `grep -rn "/api/backend/podcasts" lib/playback lib/catalog` が 0 件（path は `lib/api/podcasts.ts` だけ）。
- **許可リスト**: TA-D8 の行（`removeBy: "W-S4d1"`）が 0 件。`@/lib/api` を specifier に持つ TA-D5 の行が 0 件で、同じ file の `@/lib/<context>/infrastructure/api` の行（TP-A6）に置き換わっている（行数は増えない）。TA-V1〜V3 が green。
- `app/layout.tsx` に `ApiClientProvider` が無く、`contexts/AuthProvider.tsx` が `ApiClientProvider` を描画している（grep 各 1 件）。
- 表示文言が変わっていない（W-S4d2a / 2b が pin した文言 assertion を変えずに green。変わる箇所があれば PR 説明に列挙し理由を書く）。
- W-S1b の完了条件「10 ファイルの export 関数の URL prefix」が維持されている（同じ grep）。

## 禁止事項 / scope 外
- backend の API・BFF（`app/api/backend/[...path]/route.ts`）を変えない。`lib/api/gateway.ts`（W-S1）の契約を変えない。10 リソースファイルの関数名・URL・HTTP method を変えない。
- `lib/api.ts`・TP1 の削除、eslint ルールの追加、`onUnauthorized` の配線（以上 W-S4d3）。
- テストの fake `request` 設定・oracle の変更（W-S4d2a / 2b で確定済み。本 slice は Provider で包むだけ）。
- 表示文言を変えない。新しい業務条件を足さない。`Episode` の UI 展開（W-S4a）・`PreferencesRegistry`（W-S4b）・`AuthSession`（W-S4c）の設計を変えない。
- Learning の model 化（W-T11〜W-T13）・context の application の入口（W-T3〜W-T9）は作らない。page は `lib/<context>/infrastructure/api` を直接呼んでよい（TP-A6。新 Spec §8.4）。`pushRegistration.ts` の置き場は動かさない（W-T9）。

## 特性テスト（baseline）
W-S4d2a / 2b で移植済みの 21 ファイル、`tests/contexts/AuthProvider.*.test.tsx`（同上に含む）、`tests/app/page.test.tsx`、`tests/lib/passkey.test.ts`、`tests/app/signup/page.test.tsx`、e2e 4 本。`tests/lib/api.*.test.ts` 6 ファイルは TP1 wrap 経由で green のまま（本 slice で変更しない。W-S4d3 が書き換える）。

## 検証
`npm test`（件数が着手前と同数以上）、上記 grep 5 種、`npm run build`、`npm run test:e2e`。

## 記録
- 完了後、親 docs web-design §8（API クライアント設計）・§12.2「注入点」行・§12.3 W-S1b / W-S4 行を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §2（依存方向）・§4 冒頭（失敗の表現）・§5（CP6・rejected_overdesign）・§6（S1 行 TP1・S4 行）
- 親 docs: web-design §12.1・§12.2（注入点）・§12.3
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.2（SG5）、`verification-run.md`（`createApiClient` 呼出箇所の erratum）
