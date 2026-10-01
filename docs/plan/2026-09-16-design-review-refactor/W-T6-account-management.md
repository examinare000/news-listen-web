## web リファクタ W-T6: Account — account 管理の use case と `Subject`・`AuthView` を置く（適用 slice）

## 概要
`components/ui/AccountSection.tsx`（722 行）・`LoginModal.tsx`・`app/signup/page.tsx`・`components/NavigationBar.tsx` が直接呼ぶ account 管理の操作（表示名・パスワード・退会・passkey・セッション）を Account の application の command（TA-C-AC-7〜13）と query（TA-Q-AC-3・4）にし、`useAuth()` の `user`（DTO `AuthUser` = TP-A8）を domain の `Subject` から作るリードモデル `AuthView` に替える。username の形式（TA-R-AC-4）を domain へ、admin のナビゲーションの表示（TA-R-AC-6）を `adminAccess` へ寄せる。`lib/passkey.ts` を `lib/account/application/passkey.ts` へ移し、`JSON.parse` と DTO の参照を adapter（`lib/platform/webauthn.ts`）へ出す。`contexts/AuthProvider.tsx` は配線だけにする。**利用者に見える挙動・文言・request は変えない**。正本は新 Spec §3.2（`lib/passkey.ts`・`contexts/AuthContext.tsx` の行）・§5.3（TA-M-AC・TA-C-AC・TA-Q-AC・TA-R-AC-4〜6）・§8.2 W-T6 行・§8.4 TP-A8。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (1)(3)・NFR-10、AQ-1・AQ-3・AQ-4、F-ACC-04・F-PKY-01〜03（PRD §5）、UC-A2（既存 Spec §1.2）、CI-T16（不変）、TA-R-AC-4・5・6、TA-D2・TA-D3（`lib/passkey.ts` の許可リスト行）、TA-V4・TA-V6・TA-V7、SG-B6・SL-10（`Subject.userId` の形式）。

## 種別
適用 slice。判断待ちに依存しない。`settings/page.tsx`（`AccountSection` を描画）を触る W-T7a と続けて置く（新 Spec §8.1）。

## 規模（見込み。根拠 = 2026-10-01 実測: `AccountSection.tsx` 722 行、`LoginModal.tsx` 160 行超、`signup/page.tsx` 265 行、`NavigationBar.tsx` 130 行超、`lib/passkey.ts` 70 行、`contexts/AuthContext.tsx` 164 行（W-S4c 後は `AuthProvider.tsx`）、`useAuth()` の呼出 11 ファイル）
- production ≈ 450 行: `lib/account/domain/{subject,username}.ts` ≈ 50（`subject.ts` は W-S5 が先に作っていればその拡張）、`lib/account/application/{commands,queries,readModels,ports,passkey}.ts` ≈ 200、`lib/account/infrastructure/accountGateway.ts` ≈ 80、`lib/platform/webauthn.ts` ≈ 20（`lib/webauthnBrowserPort.ts` の実装を移す。W-T9 と重なるので、先に入った側の path を使う）、`AccountSection.tsx` ≈ −80/+60、`LoginModal`・`signup`・`NavigationBar`・`SidebarAccount`・`LogoutButton`・`AdminGate`・`admin/users` の `useAuth()` の読み替え ≈ 40、`AuthProvider.tsx` ≈ 40。
- test ≈ 450 行: `subject.test.ts`・`username.test.ts` ≈ 60、`commands.test.ts`・`queries.test.ts` ≈ 150、`accountGateway.test.ts` ≈ 60、`passkey.test.ts`（`tests/lib/passkey.test.ts` を移す）≈ 40、`cqrs.account.test.ts`・`immutability.account.test.ts` ≈ 60、component テストの mock 置換 ≈ 80。
- 合計 ≈ 900 行（10² 行の後半）。

## 前提・着手条件
- 依存 slice: **W-S4d3**（`useAuth().login/register/loginWithPasskey` が `Result` を返す・`AuthProvider ⊃ ApiClientProvider`・失効の検知）と **W-S5**（`lib/account/domain/subject.ts` の `user_id` の形式の検査・`lib/account/application/subjectCleanup.ts`）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4c（`lib/account/domain/{password,authSession}.ts`・`AuthProvider.tsx`）はその前提。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow` / `signup-flow`。
- 確定済み（再提案しない）: パスワードの規則は `lib/account/domain/password.ts` の 1 実装（ADR-101・W-S4c）。`Subject.userId` の形式 `[A-Za-z0-9_-]+`（SG-B6・SL-10。W-S5）。`AuthSession` の遷移は純関数（W-28）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4c・W-S4d1・W-S5 で行番号と名前が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| account 管理の操作 | `AccountSection.tsx:97`（`getPasskeyCredentials`）・`:108`（`getSessions`）・`:134`（`updateProfile`）・`:154`（`changePassword`）・`:173`（`registerPasskey`）・`:206`（`deletePasskeyCredential`）・`:230`（`revokeSession`）・`:245`（`revokeOtherSessions`）・`:271`（`deleteAccount`） | `grep -n "client\.\|registerPasskey(" components/ui/AccountSection.tsx` |
| `useAuth().user` の読み手 | 11 ファイル（`admin/users`・`app/page`・`signup`・`AdminGate`・`NavigationBar`・`PushReregistration`・`AccountSection`・`LoginModal`・`LogoutButton`・`SidebarAccount`・`AuthContext`）。`user.role`（`NavigationBar.tsx:121`）・`display_name`・`username`（`lib/format.ts:131-136` `formatAuthUserLabel`） | `grep -rln "useAuth()" app components hooks contexts; grep -rn "user?\.\|user\." components/NavigationBar.tsx components/ui/SidebarAccount.tsx lib/format.ts` |
| username の形式 | `app/signup/page.tsx:12`（`/^[a-z0-9][a-z0-9_-]{2,31}$/`。正規化 = trim + lowercase `:28`） | `grep -n "USERNAME_REGEX\|toLowerCase" app/signup/page.tsx` |
| 登録の失敗の意味 | `signup/page.tsx:45-63`（W-S4d1 の後は `kind` で分岐） | `grep -n "mapRegisterError" -A20 app/signup/page.tsx` |
| admin の判定 | `NavigationBar.tsx:121` `user?.role === 'admin'`（`lib/account/domain/adminAccess.ts` とは別に判定） | `grep -rn "role === 'admin'" app components hooks contexts lib` |
| `lib/passkey.ts` | `:13-14` の import、`:40,61` の `JSON.parse`、`PasskeyClient` の 4 操作（W-S4d1 の後は `Result`） | `grep -n "^import\|JSON.parse\|^export" lib/passkey.ts` |
| request | `lib/api/auth.ts:44-137`（`updateProfile`〜`revokeOtherSessions` の 11 関数） | `grep -n "^export function" lib/api/auth.ts` |
| 許可リストの `removeBy: W-T6` | TA-D2 2 行・TA-D3 1 行（`lib/passkey.ts`）、TA-D4 (a) 2 ファイル（`AccountSection.tsx`・`contexts/AuthProvider.tsx`）、TA-D5（TP-A6: `AccountSection`・`LoginModal`・`signup`。`@/lib/webauthnBrowserPort`: `AccountSection`・`LoginModal`） | `grep -B4 '"removeBy": "W-T6"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/account/domain/subject.ts`（W-S5 が作ったものに足す）: `Subject`（`userId`・`username`・`displayName`・`role: UserRole`。全 `readonly`）と生成関数 `subject(...)`（`userId` の形式を検査し、不正なら「主体別の資産を使えない主体」= `userId: null` 相当の値。W-S5 の検査と 1 箇所にする）。`lib/account/domain/username.ts`（TA-R-AC-4）: `normalizeUsername`（trim + lowercase）・`validateUsername → ok | 'invalid_format'`（現行の正規表現）。文言は呼ぶ側。
2. `lib/account/application/readModels.ts`: `AuthView`（`status: 'resolving' | 'authenticated' | 'anonymous' | 'unavailable'`・`subject: { username; displayName; role } | null`）、`SessionRow`（現行 `Session` DTO のうち `AccountSection` が読む field。`id`・`createdAt`・`lastUsedAt`・`isCurrent` ほか着手時に `AccountSection.tsx` の読み取りで数える）、`PasskeyRow`（同様）。
3. `lib/account/application/commands.ts`: `updateProfile`・`changePassword`・`deleteAccount`・`registerPasskey`・`deletePasskey`・`revokeSession`・`revokeOtherSessions`（TA-C-AC-7〜13）→ `Result<void, 失敗>`（`revokeOtherSessions` は消した件数を receipt に持ってよい: 現行 `:245` が件数を読むなら `Result<{ revoked: number }, ApiFailure>`）。`changePassword` は `validatePassword`（W-S4c）を通してから送る。`queries.ts`: `listSessions`・`listPasskeys`（TA-Q-AC-3・4）。`session()`・`adminAccess()`（TA-Q-AC-1・2）は `AuthProvider` が持つ state から作る（`AuthView` の生成関数を `readModels.ts` に置き、Provider が呼ぶ）。
4. `lib/account/application/ports.ts`: `AccountGateway`（上の command と query が要る操作。DTO を返さず `Subject`・`SessionRow`・`PasskeyRow` の材料か `Result<void>`）と `WebAuthnPort`（`lib/webauthnBrowserPort.ts:18-27` の型を移す。引数と戻り値は `unknown` か application の型。`JSON.parse` した options を渡す責務は adapter）。
5. `lib/account/application/passkey.ts`: `lib/passkey.ts` を移す。`JSON.parse` を書かない（options の文字列 → object は `WebAuthnPort` の実装が行う）。`@/types` を import しない。
6. `lib/account/infrastructure/accountGateway.ts`: `createAccountGateway(gateway)`。`lib/api/auth.ts` の関数を呼び、DTO → `Subject`・`SessionRow`・`PasskeyRow`、status → 失敗の意味（TA-R-AC-5 の `RegisterFailure` の写しは W-S4d1 の `kind` の分岐を移す）。
7. `lib/platform/webauthn.ts`: `lib/webauthnBrowserPort.ts` の `createRealWebAuthnBrowserPort`・`createFakeWebAuthnBrowserPort` を移す（W-T9 が先なら W-T9 の path）。
**変更（production）**
8. `contexts/AuthProvider.tsx`: `user: AuthUser` の state を `Subject | null` にし、`useAuth()` が `AuthView`（`session()`）・`adminAccess()`・command（`login`・`register`・`loginWithPasskey`・`logout`・`retry`）を出す。DTO を出さない（TP-A8 の解消）。`SubjectCleanup`・回収（W-S5）の配線は変えない。
9. `AccountSection.tsx`・`LoginModal.tsx`・`signup/page.tsx`・`NavigationBar.tsx`・`SidebarAccount.tsx`・`LogoutButton.tsx`・`AdminGate.tsx`・`PushReregistration.tsx`・`admin/users/page.tsx`・`app/page.tsx`: `useAuth().user` の読み取りを `session().subject` へ。`NavigationBar` の `role === 'admin'` を `adminAccess() === 'granted'` へ（TA-R-AC-6）。`signup` の `validateUsername` を domain へ。`lib/format.ts` の `formatAuthUserLabel` の引数を `AuthView['subject']` に。
10. `architecture/boundaries.allowlist.json`: `removeBy: "W-T6"` の行を消す。
**削除**: `lib/passkey.ts`・`lib/webauthnBrowserPort.ts`（W-T9 が先に移していれば W-T9）。`tests/lib/passkey.test.ts` は `tests/lib/account/application/passkey.test.ts` へ移す。
**テスト**: `tests/lib/account/domain/{subject,username}.test.ts`・`tests/lib/account/application/{commands,queries,passkey}.test.ts`・`tests/lib/account/infrastructure/accountGateway.test.ts`・`tests/architecture/{cqrs,immutability}.account.test.ts`、`tests/components/ui/{AccountSection,LoginModal}.test.tsx`・`tests/app/signup/page.test.tsx`・`tests/components/NavigationBar.test.tsx`・`tests/contexts/AuthProvider.*.test.tsx` の mock 置換（文言・呼出の oracle は不変）。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| domain `subject.ts`・`username.ts` | `Subject` と `userId` の形式・username の形式 | TA-R-AC-4・SG-B6 |
| application | 7 command・4 query・`AuthView`・`SessionRow`・`PasskeyRow`・`AccountGateway`・`WebAuthnPort`・passkey の手順 | TA-C-AC-7〜13・TA-Q-AC-1〜4 |
| infrastructure `accountGateway.ts` | DTO → `Subject`、status → 意味 | TA-R-AC-5 |
| adapter `lib/platform/webauthn.ts` | WebAuthn のブラウザ API・options の `JSON.parse` | — |
| composition root `AuthProvider.tsx` | state を持ち domain の遷移と application を呼ぶだけ | W-28 |
| presentation | 文言・フォーム | — |

## 移行の中間状態
- TP-A8（`useAuth().user` が DTO）を消す。
- TP-A6 の Account の分（`AccountSection`・`LoginModal`・`signup`）を消す。`lib/account/infrastructure/api.ts`（W-S4d1）は `accountGateway.ts` が使う。
- `lib/webauthnBrowserPort.ts` の移動は W-T9 と重なる。先に main に入った側が移し、後の側は path を合わせる（両方の order に同じ行がある）。

## 変わる挙動
無い（各操作の文言・順序・request は不変。判定は component テストと e2e 2 本）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-AC-4 | `username.test.ts`（3〜32 文字・先頭は英数字・大文字は正規化で通る・空白） |
| SG-B6・SL-10 | `subject.test.ts`（形式不正の `userId` は資産を使えない主体になる。W-S5 のテストと重複するなら W-S5 のテストを移す） |
| TA-R-AC-6 | `NavigationBar.test.tsx`: admin リンクの表示が `adminAccess()` の 4 値に従う（`granted` だけ表示） |
| CI-T16 | `tests/lib/account/adminAccess.test.ts`・`AdminGate.test.tsx` 不変 |
| TA-V4 | `rules.test.ts`: TA-R-AC-6 の式 `role === 'admin'` の出現が `lib/account/domain/adminAccess.ts` だけ（`NavigationBar.tsx:121` の行を許可リストから消す）。TA-R-AC-4 の式（正規表現）は `username.ts` だけ |
| TA-V6 | `immutability.account.test.ts`: `session()`・`listSessions()`・`listPasskeys()` の観点 2・3 |
| TA-V7 | `cqrs.account.test.ts`: (a) `AccountCommands` / `AccountQueries` の入口の名前の集合が §5.3 の表と一致。(b) query が変更系の port を呼ばない。(c) command の戻り値がリードモデルでない |
| TA-V3 (b)・TA-D2・TA-D3 | `lib/account/application/**` に `@/types` の型名・`JSON.parse` が 0 件 |
| TA-V9 | component テスト・`AuthProvider.*.test.tsx`・e2e `main-flow` / `signup-flow` |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。`npm run test:e2e`（`main-flow` / `signup-flow`）green。
- **DTO を出さない**（集合 = `useAuth()` を呼ぶ全ファイル。着手時の grep で固定）: `grep -rn "AuthUser" app components hooks contexts lib | grep -v '^lib/account/infrastructure/\|^lib/api/\|^types/'` が 0 件。
- **`lib/account/application/**` の禁止**: `grep -rn "from '@/types\|JSON\.\|from '@/lib/api\|from '@/lib/platform" lib/account/application` が 0 件。
- **`lib/passkey.ts`・`lib/webauthnBrowserPort.ts` が存在しない**（W-T9 が先の場合は `lib/webauthnBrowserPort.ts` は既に無い）。`grep -rn "@/lib/passkey\|@/lib/webauthnBrowserPort" app components hooks contexts lib tests` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "role === 'admin'\|\[a-z0-9\]\[a-z0-9_-\]" app components hooks contexts lib` の出現が `lib/account/domain/` だけ。
- **許可リスト**: `grep -c '"removeBy": "W-T6"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- `AuthProvider.tsx` に業務の判断（規則の式）が無い（TA-V4 の対象に `contexts/**` を含める。`grep -n "role ===\|\.length <\|status ===" contexts/AuthProvider.tsx` が 0 件）。
- 文言 assertion に diff が無い。

## 禁止事項 / scope 外
- `AuthSession` の 4 状態と遷移（W-S4c）・`SubjectCleanup` の手順と発火（W-S5）・失効の検知（W-S4d3）を変えない。
- パスワードの規則（W-S4c）・admin 画面の操作（W-T8）・入口の判定（W-T5）を変えない。
- 文言・request（path・method・body）・WebAuthn のセレモニーの手順を変えない。
- `lib/pushBrowserPort.ts`・`lib/push/`（W-T9）を触らない（`lib/webauthnBrowserPort.ts` だけ）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/components/ui/{AccountSection,LoginModal}.test.tsx`・`tests/app/signup/page.test.tsx`・`tests/components/{NavigationBar,AdminGate}.test.tsx`・`tests/contexts/AuthProvider.*.test.tsx`・`tests/lib/passkey.test.ts`・`tests/lib/account/adminAccess.test.ts`・`tests/lib/format.test.ts`、e2e `main-flow` / `signup-flow`。

## 検証
`npm test`、上記 grep 5 種、`npm run lint`、`npm run build`、`npm run test:e2e -- main-flow signup-flow`。

## 記録
- 完了時、TP-A8 の削除と、既存 Spec §3.3 の「`authenticated` が持つ値を `Subject` に替える（W-T6）」が済んだ旨を親 docs へ返す。web-design §12.1 Account 行を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §3.2・§5.3・§7・§8.2（W-T6 行）・§8.4（TP-A8）
- 既存 Spec §1.2（UC-A2）・§3.3・§4（CI-T15・CI-T16）・§5（CP7）
- 親 docs: ADR-101・ADR-104 決定 6・16、共有仕様 §4.4 SL-10
