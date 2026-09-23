## web リファクタ W-S4d2b: Account / Admin / Learning / Preferences / Notifications 系テスト 16 本の gateway double 移植と旧テストの処遇（テストのみ・production 不変）

## 概要
旧 W-S4d を 4 PR に分けた 2 つ目（2026-09-24）。W-S4d2a と同じ方法（`tests/helpers/fakeGateway.ts`・`vi.mock('@/lib/api/gateway')`）で、残り 16 テストを gateway double へ移す。あわせて `lib/api.ts` を直接検証している旧テスト（`tests/lib/api.*.test.ts` 6 本）と、`ApiError` を直接 new している 2 本（`tests/lib/passkey.test.ts`・`tests/app/signup/page.test.tsx`）の処遇を確定する（下表）。production は 1 行も変えない。**検証モード: 再設計しない**。

## 規模（見込み。根拠 = 2026-09-24 実測: mock / `ApiError` / `toHaveBeenCalled` に触れる行数）
- test ≈ 700 行: `tests/app/settings/page.test.tsx` 209、`tests/components/ui/AccountSection.test.tsx` 144、`tests/app/dashboard/page.test.tsx` 81、`tests/app/admin/{featured-sites,invites,metrics,users}/page.test.tsx` 85、`tests/contexts/AuthProvider.{test,expiry,passkey}.test.tsx` 71（W-S4c 前の名は `AuthContext.*`）、`tests/components/ui/LoginModal.{test,passkey.test}.tsx` 25、`tests/app/vocabulary-test/page.test.tsx` 21、`tests/contexts/StreakContext.test.tsx` 17、`tests/components/PushNotificationSection.test.tsx` 17、`tests/hooks/useWebPushSubscription.test.ts` 15（計 685）。
- production: 0 行。

## 前提・着手条件
- 依存 slice: **W-S4d2a**（`tests/helpers/fakeGateway.ts`）・**W-S4b**（`tests/app/settings/page.test.tsx`・`tests/app/dashboard/` を先に触る）・**W-S4c**（`AuthProvider.*.test.tsx` への改名・`tests/components/ui/AccountSection.test.tsx`・`LoginModal` を先に触る）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- **W-S5 とは `tests/contexts/AuthProvider.*.test.tsx` が重なるため並行投入しない**（順序不定。後から merge する側が rebase）。W-S3・W-S4a とは並行可（対象ファイルが重ならない）。
- W-0 の完了条件 8「`tests/hooks/useWebPushSubscription.test.ts`・`tests/components/PushNotificationSection.test.tsx` を 1 行も変更しない」は W-0 完了時点の条件であり、本 slice が更新する（許可。W-0 order に明記）。W-S1b の同種の条件（25 ファイル不変）も同じ（W-S4d2a と同様。W-S1b order に明記）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ。テストのみ）
1. **16 テストの移植**: 手順・変換規則は W-S4d2a 対象 2 と同一。`useWebPushSubscription` / `PushNotificationSection` は W-0 の `pushRegistration` が `createApiClient()` から組み立てる経路のまま fake `request` が効く（TP1 が `gateway.request` を呼ぶため）。`AuthProvider.*.test.tsx` は `getMe` / `login` / `register` / passkey の 4 経路を fake `request` の path で表す（`GET /api/backend/auth/me`・`POST /api/backend/auth/login`・`POST /api/backend/auth/register`・`POST /api/backend/auth/passkey/login/{options,verify}`。正確な path は W-S1b の `lib/api/auth.ts` から写す）。W-0 が `AuthContext.push.test.tsx` に置いた `vi.mock('@/lib/api')` も同じ規則で移す（着手時の `grep` に含まれる）。
2. **旧テストの処遇**（確定。実施 slice を列に書く）:
   | テスト | 現状 | 処遇 | 実施 |
   |---|---|---|---|
   | `tests/lib/api.{test,auth.test,invites.test,passkey.test,sessions.test,starred.test}.ts`（6 本・2,329 行・`it()` 146 件） | `@/lib/api` の `createApiClient()` 経由で 58 メソッドを `fetch` mock で検証（W-S1 の T-T12 で失敗の assertion は `Result` 形式へ移植済み） | **`lib/api/<resource>` 向けに書き換えて残す**。import を `@/lib/api/<resource>` に、呼出を `fn(fakeGateway, ...args)` に替え、oracle を「各 resource の request 形（method ＋ path ＋ body ＋ `Result` の変換）」にする。`ApiError` の assertion は `Result` 失敗の `kind` に写す。テスト名（`describe` の関数名）は不変 | **W-S4d3**（`createApiClient()` の削除と同じ PR。削除するコードのテストを同じ commit で対象へ付け替える）。本 slice と W-S4d1 の baseline からは外す（TP1 wrap 経由で green のまま残るが、判定には使わない） |
   | `tests/lib/passkey.test.ts`（155 行） | `PasskeyClient` の 4 メソッドを `vi.fn()` で組み `new ApiError(...)` を reject 注入 | `lib/passkey.ts` が `Result` を返す形に合わせ、注入を `Result` 失敗へ替えて残す | **W-S4d1**（`lib/passkey.ts` の production 変更と同じ PR） |
   | `tests/app/signup/page.test.tsx`（166 行） | `useAuth().register` を mock し `new ApiError(status, detail)` を reject 注入 | `register` が `Result` を返す形に合わせ、注入を `{ ok: false, failure: { kind, detail } }` へ替えて残す。文言 assertion 不変 | **W-S4d1**（`AuthProvider.register` の契約変更と同じ PR） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` 成功。テスト件数が着手前と同数。
- `grep -rln "vi.mock('@/lib/api'" tests` が 0 件。`grep -rln "ApiError" tests` が `tests/lib/api.*.test.ts` 6 本・`tests/lib/passkey.test.ts`・`tests/app/signup/page.test.tsx` の 8 本だけ（処遇表のとおり W-S4d1 / W-S4d3 が消す）。
- production（`app/` `components/` `hooks/` `contexts/` `lib/`）の diff が 0 行。
- 各テストの文言 assertion が着手前と同一。

## 禁止事項 / scope 外
- production を変えない。処遇表の 8 本を本 slice で触らない。
- 文言 assertion・テスト名・テスト数を変えない。skip しない。

## 特性テスト（baseline）
対象 16 ファイル自身（移植前 green）。

## 検証
`npm test`、上記 grep 2 種、`git diff --stat -- app components hooks contexts lib` が空。

## 記録
- 棄却・方針転換は `docs/trial-log/` へ。
