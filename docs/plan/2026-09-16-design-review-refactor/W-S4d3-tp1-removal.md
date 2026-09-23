## web リファクタ W-S4d3: TP1 本体削除・HTTP status 分岐の eslint・失効検知の一般化（学習機能サイクルで着手）

## 概要
旧 W-S4d を 4 PR に分けた最後（2026-09-24）。W-S4d1 で production の呼出が 0 になった `createApiClient()`・`ApiError`・`lib/api.ts`（TP1）を削除し、それらを検証していた `tests/lib/api.*.test.ts` 6 本を `lib/api/<resource>` 向けに書き換え（W-S4d2b の処遇表）、Spec §4 冒頭「呼出側が `kind` 以外（数値 status）で分岐することを eslint で禁止」を `eslint.config.mjs` に入れ、失効の検知点を「`getMe` だけ」から「任意 API の `unauthorized`」へ一般化する（共有仕様 §6.5）。正本は Implementation Spec §2・§4 冒頭・§6 S1 行（TP1 の削除条件）、共有仕様 §6.5「失効の検知点」・§4.4 SL-05。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 規模（見込み。根拠 = 2026-09-24 実測）
- production ≈ 130 行（うち削除 ≈ 100）: `lib/api.ts` 削除（W-S1b 後は合成点 ≈ 80 行）、`lib/api/legacyRequest.ts` 削除（W-S1b が置いた場合 ≈ 40 行）、`eslint.config.mjs` ≈ 25、`ApiClientProvider` の `onUnauthorized` ≈ 20、`contexts/AuthProvider.tsx` の `expire` と配線 ≈ 15。
- test ≈ 450 行: `tests/lib/api.*.test.ts` 6 本の書き換え ≈ 370（`client.` / `createApiClient` / `ApiError` に触れる行の実測: `api.test.ts` 298・`api.auth.test.ts` 29・`api.passkey.test.ts` 17・`api.invites.test.ts` 14・`api.sessions.test.ts` 8・`api.starred.test.ts` 4）、`tests/contexts/AuthProvider.expiry.test.tsx` に 2 件 ≈ 40、`ApiClientProvider` の `onUnauthorized` 単体 ≈ 40。
- 合計 ≈ 580 行。

## 前提・着手条件
- 依存 slice: **W-S4d1** の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- W-S5 とは `contexts/AuthProvider.tsx`・`tests/contexts/AuthProvider.*.test.tsx` が重なるため**並行投入しない**（順序不定。後から merge する側が rebase）。W-S5 が先なら遷移②で走る後始末は `subjectCleanup`、後なら W-S0 の `clearManagedServiceWorkerCaches()`（どちらでも本 slice が変えるのは発火の入口だけで、後始末の中身は変えない）。W-S3 とは並行可。
- Selection Gate 依存なし。
- 棄却済み案（再提案しない）: `ApiClientProvider` を `AuthProvider` の外側に置き `AuthProvider` が handler を登録する形（layout は server component で callback を渡せず、登録 API は raw dispatch と同型。W-S4d1 で `AuthProvider` ⊃ `ApiClientProvider` に固定済み）、失効の判定を path 集合（`/auth/login` 等の除外）で行うこと（下記 3 の「`authenticated` のときだけ」で足りる）。
- `docs/trial-log/` を最初に読む。着手前に `grep -rn "createApiClient\|ApiError" app components hooks contexts lib tests e2e | grep -v '^lib/api\.ts:\|^lib/api/legacyRequest\.ts:\|^tests/lib/api\.' | wc -l` が 0 であることを確認する（W-S4d1 の完了条件）。

## 対象（web サブモジュールのみ）
1. **TP1 の削除**: `lib/api.ts`（`ApiError`・`createApiClient()`・wrap 関数）と `lib/api/legacyRequest.ts`（存在すれば）を削除する。`lib/api/` に残るのは `gateway.ts` と 10 リソースファイルだけ。
2. **`tests/lib/api.*.test.ts` 6 本の書き換え**（W-S4d2b 処遇表の実施）: import を `@/lib/api/<resource>`、呼出を `fn(fakeGateway, ...args)`（`tests/helpers/fakeGateway.ts`）に替え、oracle を「request の形（method ＋ path ＋ body ＋ header）と `Result` の変換」にする。`fetch` mock で HTTP 応答を組んでいる行のうち gateway の `request` 自体の検証（W-S1 の T-T12 / T-T13。W-S1 が同じ 6 ファイルに置いた場合は `tests/lib/api/gateway.test.ts` へ分離して残し、別ファイルに置いた場合はそのまま）と重複する部分を削り、resource 関数の責務（path・method・body・応答の型）だけを残す。`describe` の関数名は不変。件数は減ってよい（減った分を担うテストを PR 説明に対応表で示す）。
3. **失効検知の一般化**（共有仕様 §6.5・SL-05。確定した形）:
   - `ApiClientProvider` に省略可能な prop `onUnauthorized: () => void` を加える。Provider は受け取った gateway の `request` を包み、戻り値が `{ ok: false, failure: { kind: 'unauthorized' } }` のとき `onUnauthorized()` を呼んでから `Result` をそのまま返す（`Result` を書き換えない。呼出側の文言写像は不変）。
   - `contexts/AuthProvider.tsx` は `expire()` を 1 つ持つ: `session.kind === 'authenticated'` のときだけ遷移②（`authenticated → anonymous`）と後始末（W-S5 後は `subjectCleanup(A)`、前は W-S0 の cleanup）を 1 回走らせ、それ以外（`resolving` / `anonymous` / `unavailable`）では何もしない。`refreshMe` の `getMe` が `unauthorized` を返す既存経路も `expire()` を呼ぶ形に寄せる（遷移②を起こす関数が `expire` の 1 つになる。入口は `getMe` と Provider 経由の任意 API の 2 つ）。
   - `AuthProvider` は W-S4d1 で描画している `<ApiClientProvider gateway={gateway}>` に `onUnauthorized={expire}` を渡す。`AuthProvider` 自身の呼出（`login` / `register` / passkey）は包まれていない raw gateway を使うため、ログイン失敗の 401 は `onUnauthorized` を通らず、かつ `expire` は `authenticated` でなければ no-op（SL-05 の二重の担保）。
   - 同じ画面で複数の API が同時に `unauthorized` を返しても、最初の `expire()` で `anonymous` になった後は no-op なので後始末は 1 回（完了条件で pin）。
   - **`app/layout.tsx` の Provider 順序（本 slice 完了時点。上から）**: `PreferencesProvider`（W-S4b。W-S4b 前は `AppProvider`）→ `AuthProvider`（内部で `ApiClientProvider gateway onUnauthorized` を描画）→ `ToastProvider` → `PlaybackProvider`（`useApiClient()` で gateway を取る）→ `{children}` `PushRegistrar` `ClientErrorReporter`。`ApiClientProvider` は layout に直接書かない。
4. **eslint（Spec §4 冒頭）**: `eslint.config.mjs` に次の block を加える（`no-restricted-properties` は識別子名で縛るため `podcast.status` を巻き込む。数値 Literal との比較だけを縛る `no-restricted-syntax` にする）。
   ```js
   {
     files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "contexts/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
     ignores: ["lib/api/gateway.ts", "app/api/backend/**"],
     rules: {
       "no-restricted-syntax": ["error",
         { selector: "BinaryExpression[operator=/^(===|!==|==|!=|<|<=|>|>=)$/][left.type='MemberExpression'][left.property.name='status'][right.type='Literal'][right.raw=/^[0-9]+$/]",
           message: "HTTP status の数値で分岐しない。ApiFailure.kind で分岐する（Spec §4）" },
         { selector: "BinaryExpression[operator=/^(===|!==|==|!=|<|<=|>|>=)$/][right.type='MemberExpression'][right.property.name='status'][left.type='Literal'][left.raw=/^[0-9]+$/]",
           message: "HTTP status の数値で分岐しない。ApiFailure.kind で分岐する（Spec §4）" },
         { selector: "SwitchStatement[discriminant.type='MemberExpression'][discriminant.property.name='status'] > SwitchCase[test.type='Literal'][test.raw=/^[0-9]+$/]",
           message: "HTTP status の数値で分岐しない。ApiFailure.kind で分岐する（Spec §4）" }
       ]
     }
   }
   ```
   - 正例（許可）: `podcast.status === 'completed'`（右辺が文字列 Literal。`app/(app)/podcast/page.tsx:91` の現行コード）。
   - 負例（エラー）: `res.status === 401`（右辺が数値 Literal。W-S4d1 前の `app/(app)/feed/page.tsx:169` の形）。`switch (err.status) { case 400: ... }`（W-S4d1 前の `app/signup/page.tsx:47`）も負例。
   - `lib/api/gateway.ts` の `response.status === 204`（CI-T12 の 204 判定）と BFF `app/api/backend/[...path]/route.ts`（`backendResponse.status` の転送）は `ignores` で除外する。`tests/` は対象に入れない（`new Response(..., { status: 401 })` は property であり比較ではないが、範囲を production に限る）。CI での実行は W-S3 の `lint-test` ジョブに含まれる。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T15（検知点） | 認証済みで任意 API が `unauthorized` を返すと遷移②と後始末が 1 回だけ発火し、ログイン失敗の 401 では発火しない。同時 2 件の `unauthorized` でも後始末は 1 回 | `tests/contexts/AuthProvider.expiry.test.tsx` に 2 件追加（`SL-05` をテスト名に含める）。fake `request` を `ApiClientProvider` 配下の子 component から呼ばせ、`expire` の発火回数と後始末の呼出回数を数える |
| — | `onUnauthorized` の wrap | `tests/contexts/ApiClientProvider.test.tsx`（新規）: `unauthorized` で 1 回呼ばれ `Result` は不変、他の `kind` では呼ばれない |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 4 本 green（変更なし）。
- `lib/api.ts`・`lib/api/legacyRequest.ts` が存在しない。`ls lib/api/` が `gateway.ts` ＋ 10 リソースファイルの 11 件。
- **`createApiClient` / `ApiError` の出現 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/` `lib/` `tests/` `e2e/`。除外なし。コメントも含めて 0）。
- eslint: 負例 `res.status === 401` と `switch (err.status) { case 400: }` を `app/` の一時ファイルに置いた `npm run lint` が非ゼロ終了し、正例 `podcast.status === 'completed'` では終了 0 であることを確認済み（確認後に一時ファイルを削除）。`lib/api/gateway.ts` の `=== 204` が lint で指摘されない。
- 失効検知: 上表 2 件が green。`grep -rn "expire()" contexts/AuthProvider.tsx` の呼出元が `refreshMe` と `onUnauthorized` の 2 箇所、`setSession(.*anonymous` 相当の遷移②を書く箇所が `expire` の中 1 箇所（PR 説明に列挙）。
- `app/layout.tsx` の Provider 順序が対象 3 の並びと一致し、`ApiClientProvider` が layout に無い。
- `tests/lib/api.*.test.ts` 6 本が `@/lib/api/<resource>` だけを import し（`grep -n "from '@/lib/api'" tests/lib/api.*.test.ts` が 0 件）、削った件数の対応表が PR 説明にある。

## 禁止事項 / scope 外
- backend の API・BFF を変えない。`lib/api/gateway.ts` の契約（`Result` / `ApiFailure` の形・`request` の署名）を変えない。10 リソースファイルの関数名・URL を変えない。
- 表示文言を変えない。`ApiFailure.kind` の集合を増やさない。
- `AuthSession` の状態集合（W-S4c）・`subjectCleanup` の手順（W-S5）を変えない。
- eslint の `files` を `tests/` に広げない。`no-restricted-properties` で `.status` を縛らない。

## 特性テスト（baseline）
W-S4d2a / 2b で移植済みの 21 ファイル、`tests/contexts/AuthProvider.*.test.tsx`、`tests/lib/api/gateway.test.ts`（W-S1）、e2e 4 本。`tests/lib/api.*.test.ts` 6 本は本 slice の書き換え対象であり baseline に含めない。

## 検証
`npm test`、上記 grep 4 種、`npm run lint`（負例・正例の確認を含む）、`npm run build`、`npm run test:e2e`。

## 記録
- 完了後、親 docs web-design §8・§12.2「注入点」行・§12.3 W-S1 行（TP1）を現状記述へ書き換える対象として README に印を付ける。TP1 の削除日を PR 説明に残す。共有仕様 §6.5「失効の検知点」の web 行を実装済みへ。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §2・§4 冒頭・§6（S1 行 TP1）
- 親 docs: web-design §12.2（注入点）・§12.3、共有仕様 §6.5（失効の検知点）・§4.4 SL-05
