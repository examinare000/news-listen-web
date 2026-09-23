## web リファクタ W-S4c: Account — `PasswordPolicy` の単一化（12〜20）と `AuthSession` 判別共用体（学習機能サイクルで着手）

## 概要
旧 W-S4 を context 境界で分けた 3 つ目。Account context の 2 項目: (1) パスワード規則を `lib/account/password.ts` の 1 実装（長さ **12〜20 文字**・文字種は現行 `countPasswordCharacterClasses`）に統一する、(2) `AuthSession` 判別共用体（`resolving` / `authenticated` / `anonymous` / `unavailable`）を導入し、`contexts/AuthContext.tsx` を `contexts/AuthProvider.tsx` へ揃える（CI-T15 の全体。W-S0 は cleanup 部分のみ先行済み）。旧 W-S4 order は (2) を落としていたが、親 docs web-design §12.1 Account 行・§12.2「名前」行（`AuthProvider.tsx` は W-S4）・§12.4（`AuthSession` は W-S4）と W-S5 order（「`AuthSession` union は W-S4」）が W-S4 の担当と定めているため、本 slice に含める（2026-09-23 点検で drift を修正）。正本は Implementation Spec §3.3（Account・SG7 注記）・§4 CI-T15・§5 CP7、[ADR-101](../../../../docs/adr/101-password-policy-cross-client-unification.md)、共有仕様 §6.5「失効の検知点」「失効時のトークン破棄は 401 のときだけ」・SL-03。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 前提・着手条件
- 依存 slice: **W-S2c** の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。理由: `contexts/AuthContext.tsx` は W-0（logout の `detachFromSubject`）・W-S2b（`OfflineLibrary.clear()`）が順に編集しており、その後の形を基点にする。
- **backend 契約が main にあること**: backend S0c（完了）の `PasswordPolicy` 12〜20 文字（ADR-101）が `POST /auth/register`・`PATCH /auth/me/password`・admin のユーザー作成で 422 を返す境界値を、着手時に backend `tests/` で確認する（Spec §3.3 OB-A1・§8 unknowns の解消）。
- W-S5 との順序は不定（W-S5 order の表: 認証 Provider は W-S4c 前 `contexts/AuthContext.tsx` / 後 `contexts/AuthProvider.tsx`）。W-S5 が先に merge 済みなら、W-S5 が `refreshMe` に入れた「401 とそれ以外の分岐」と回収の発火を `AuthSession` の遷移（`unauthorized` → `anonymous`、それ以外 → `unavailable`）へ移し、発火条件は変えない。
- **SG7（パスワード長、user 2026-09-16 確定）**: 統一値は **12〜20 文字**（ADR-101）。Spec 本文 §3.3 の「8〜20 文字」は backend 決定で差し戻された旧値であり**採らない**（Spec 冒頭の追記）。
- Selection Gate 依存なし。
- 棄却済み案（再提案しない）: `(app)` レイアウト全体の gating（S0 の Q7）、一時障害でのログアウト表示（RF15。`unavailable` はトークン保持・再試行導線）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
1. **`lib/account/password.ts`（新規）**: `validatePassword(password) → ok | { reason: 'too_short' | 'too_long' | 'too_few_classes' }` の 1 実装。長さ 12〜20、文字種 3 種以上（現行 `countPasswordCharacterClasses` をここへ移す）。文言は呼出側。
2. **3 箇所の置換**（量化する集合 = production でパスワード長を判定する箇所。2026-09-23 実測）: `app/(app)/admin/users/page.tsx:53`（現状 `< 8` → 12〜20 へ。挙動変更）、`app/signup/page.tsx:16-39`（`PASSWORD_MIN_LENGTH = 12`・`countPasswordCharacterClasses`。上限 20 を追加）、`components/ui/AccountSection.tsx:17-42`（同上）。各ファイルの局所実装・定数を削除し `lib/account/password.ts` を呼ぶ。ヒント文言（`signup:209`・`AccountSection:363`「12文字以上」）に上限 20 を足す。
3. **`AuthSession` 判別共用体**（Spec §3.3、CP7）: `contexts/AuthContext.tsx` を `contexts/AuthProvider.tsx` に改名し、公開状態を `AuthStatus`（`'unknown' | 'authenticated' | 'unauthenticated'` の 3 値）から `AuthSession`（`resolving` / `authenticated(user)` / `anonymous` / `unavailable(failure)` の 4 状態）へ。`getMe` の `unauthorized` だけが `anonymous`（失効）、network / timeout / server / decode 失敗は `unavailable` に落としトークン（cookie）を保持、`retry()` で `resolving` へ戻る（SL-03）。既存の `useAuth()` の呼出側（`grep -rn "useAuth()" app components hooks contexts` で着手時に数え上げ）は `status` の 3 値を `session.kind` から導く互換 getter で受け、本 slice では呼出側を変えない（`unavailable` を `'unknown'` に写す）。`unavailable` のときの再試行導線は `app/page.tsx` の root gate（web-design §12.4 の 1 行目）に 1 箇所置く。失効 cleanup（W-S0 の `clearManagedServiceWorkerCaches()`。W-S5 後は `subjectCleanup`）の発火条件は変えない。
4. **admin gate**: `lib/account/adminAccess.ts`（W-S0）の入力を `AuthSession` に替える（4 値 policy は不変。`AdminGate` は変更なし）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T15 | `AuthSession` は 4 状態のみ。`getMe` の `unauthorized` 以外は `unavailable`。`authenticated → anonymous` の事後に `shell-*` / `api-*` が空。消去失敗は `CleanupIncomplete` として観測可能 | T-T15: `tests/contexts/AuthProvider.{test,expiry,passkey}.test.tsx`（既存 `AuthContext.*` を改名して移植）に `unavailable`（network / 5xx / decode）→ トークン保持・cleanup 不発火・`retry()` で再解決、の 3 行を追加。テスト名に `SL-03` を含める |
| — | パスワード規則 | `tests/lib/account/password.test.ts`（11 / 12 / 20 / 21 文字の境界 4 行 ＋ 文字種 2 種 / 3 種の 2 行） |
| CI-T16 | `AdminAccess` 4 値（不変） | 既存 `tests/lib/account/adminAccess.test.ts`・`tests/components/AdminGate.test.tsx` が入力型の変更以外は不変で green |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e `main-flow` / `signup-flow` green（変更してよいのは 21 文字以上を拒否する assertion の追加だけ）。
- T-T15 が `verifies: CI-T15` と `SL-03` をテスト名またはコメントに持つ。
- **パスワード長の判定が 1 実装**（量化する集合 = `app/` `components/` `hooks/` `lib/` の `.ts` / `.tsx`）: `grep -rn "length < \|PASSWORD_MIN_LENGTH\|countPasswordCharacterClasses" app components hooks lib` の出現が `lib/account/password.ts` だけ。
- 12 文字未満・21 文字以上が `admin/users`・`AccountSection`・`signup` の 3 画面すべてで backend を呼ぶ前に拒否され、12〜20 文字は通る（各画面のテストで pin）。backend の境界（ADR-101）と一致することを着手時の確認結果として PR 説明に書く。
- `contexts/AuthContext.tsx` が存在せず `contexts/AuthProvider.tsx` がある。`grep -rn "AuthContext" app components hooks contexts lib tests e2e` が 0 件（`useAuth` / `AuthProvider` の名は不変）。
- 起動時の `getMe` が network error のとき `unauthenticated` へ落ちず、ログインモーダルが出ず、再試行導線が出る（SL-03。`tests/app/page.test.tsx` で pin）。401 のときは従来どおり `anonymous` ＋ cleanup（W-S0 の挙動不変）。

## 禁止事項 / scope 外
- パスワード長を **8〜20 文字**にしない（Spec 本文の旧値。SG7 は 12〜20 が正）。文字種規則を変えない。
- 任意 API の 401 を失効として検知する一般化（§6.5「任意 API の `unauthorized`」）は W-S4d（page 側が gateway の `Result` を受けるようになった後）。本 slice の検知点は `getMe` だけ。
- `ApiError` → `ApiFailure` の呼出側移行・TP1 削除（W-S4d）、`PreferencesRegistry`（W-S4b）、`Episode` の UI 展開（W-S4a）は行わない。`createApiClient()` の呼出箇所を変えない（`AuthProvider` 内の呼出は本 slice でも `createApiClient()` のまま。gateway 化は W-S4d）。
- 主体別音声キャッシュ・回収・`subjectCleanup`（W-S5）の発火条件・順序を変えない。
- `(app)` レイアウト全体の gating をしない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/contexts/AuthContext.{test,expiry,passkey}.test.tsx`、`tests/lib/account/adminAccess.test.ts`、`tests/components/AdminGate.test.tsx`、`tests/app/page.test.tsx`、`tests/app/signup/`、`tests/app/admin/`（users）、`tests/components/ui/`（`AccountSection`・`LoginModal`）、e2e `main-flow` / `signup-flow`。

## 検証
`npm test`、上記 grep 2 種、`npm run build`、`npm run test:e2e -- main-flow signup-flow`。

## 記録
- 完了後、親 docs web-design §3（認証状態）・§12.2「名前」「パスワード」行を現状記述へ書き換える対象として README に印を付ける。Spec §8 unknowns の OB-A1 を解消済みとして記録。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.3・§4（CI-T15・CI-T16）・§5（CP7）・§8（SG7・OB-A1）
- 親 docs: ADR-101、web-design §12.1（Account）・§12.2（名前・パスワード）・§12.4（root gate）、共有仕様 §4.4 SL-03・§6.5
