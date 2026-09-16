## web リファクタ S0: constraint 修正（BFF fail-closed・失効時 cleanup・admin gate）

## 概要
2026-09-16 の web 設計レビューで **constraint（機密性）違反**と判定された 3 件を、構造変更に先立って閉じる。正本は user 承認済みの Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（§3.3・§4 CI-T14〜T16・§6 S0 行）。本タスクは**承認済み指示書に従う実装**であり、analyze_order は検証モード（新規設計をしない）。generate_spec の spec.md は Spec の該当契約（CI-T14 / T15 / T16）の抜粋で足り、契約 ID は Spec のものを再利用する。

着手順 1（S1〜S4 に依存しない。最初に実施）。

## 前提・着手条件
- Selection Gate 依存なし（共有仕様 §6.7 の SG-X1〜X5 は本 slice に無関係）。
- 失効時に消すのは **SW 管理キャッシュ（`shell-*` / `api-*`）のみ**。`audio-v1`（保存音声）は明示 logout のみ消す（レビュー §8 SG4・共有仕様 §6.5 web 行）。主体付き key・SW への一元化は不採用（棄却済み。再提案しない）。
- `docs/trial-log/` を最初に読み、棄却済み案を再試行しない。

## 対象（web サブモジュールのみ。他サブモジュールに触れない）
1. **BFF fail-closed（CI-T14）**: `app/api/backend/[...path]/route.ts`。`BACKEND_API_KEY` 欠落を `BACKEND_BASE_URL` 欠落と同じ **500・generic 本文**に揃える（現状は本文に内部情報が出る）。`BACKEND_BASE_URL` が path を含む構成も設定不正として 500（Spec resolved_unknowns A1 の契約化）。
2. **失効時 cleanup（CI-T15 の cleanup 部分のみ先行）**: `contexts/AuthContext.tsx`。`refreshMe` 失敗 → `unauthenticated` の失効経路でも `clearManagedServiceWorkerCaches()` を呼ぶ（`deleteAllAudio()` は呼ばない）。消去失敗は観測可能（`CleanupIncomplete` 相当の戻り値または state）にし、認証状態の遷移は止めない。`AuthSession` union への全面移行は S2 で行う（本 slice では現行 3 状態のまま）。
3. **admin gate（CI-T16）**: `lib/account/adminAccess.ts`（新規、純関数 `adminAccess(session) → 'loading' | 'login_required' | 'denied' | 'granted'`）と `components/AdminGate.tsx`（新規）。admin 4 ページ（`app/admin/users`・`app/admin/featured-sites`・`app/(app)/admin/invites`・metrics）の重複 gating をこの 1 policy に集約。`loading` は読み込み中表示、`login_required` はログインモーダル、`denied` は現状文言、`granted` のみ children。`(app)` レイアウト全体の gating は**しない**（レビュー §8 Q7）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T14 | `BACKEND_API_KEY` 欠落 → 500・generic 本文。`BACKEND_BASE_URL` に path → 500 | T-T14: `tests/app/api/proxy.test.ts` へ追加（path 付き BASE_URL の負例を含む） |
| CI-T15（部分） | 失効経路の事後に `shell-*` / `api-*` が空、`audio-v1` は残る。消去失敗が観測可能 | T-T15: `tests/contexts/AuthContext*.test.tsx`（`CacheStore` double = `tests/helpers/mockCaches.ts`） |
| CI-T16 | 4 値 policy。`AdminGate` は `granted` 以外で children を描画しない | T-T16: 各状態で `queryByRole` が null（4 ページの既存テストは特性テストとして green 維持） |

## 特性テスト（baseline。着手前に green を確認）
`tests/app/api/proxy.test.ts`（40 件）、`tests/contexts/AuthContext*.test.tsx`、admin 4 page のテスト、`tests/components/NavigationBar.test.tsx`。

## 手順
1. baseline: `npm test` green と `npm run lint` / `npm run typecheck` を記録。
2. T-T14 → RED → route.ts の最小修正 → GREEN。
3. T-T15（cleanup 部分）→ RED → AuthContext の失効経路に cleanup 追加 → GREEN。
4. T-T16 → RED → `adminAccess` 純関数 + `AdminGate` → 4 ページを置換 → GREEN。
5. 1 slice = 1 PR。temporary path なし。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run build` すべて成功。
- T-T14 / T-T15 / T-T16 が `verifies: CI-T14/T15/T16` をテスト名またはコメントに持つ。
- admin 4 ページに独自の gating 分岐が残っていない（grep で `status === 'unknown'` 等の重複判定が 0）。
- `route.ts` の 500 本文に環境変数名・内部 URL が含まれない。

## 禁止事項 / scope 外
- `ApiGateway` / `Result` 化（S1）、`PlaybackProvider`（S2）、`AuthSession` union 全面移行（S2 の一部として S0 では現行状態名を維持）、page 側の注入点移行（S4）は行わない。
- 仕様にない業務条件を足さない。UI 文言の変更は `denied` の現状文言を維持。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.3・§4（CI-T14〜T16）・§6（S0）
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §4.1（RF1〜RF3）・§8
- 親 docs: `shared-playback-spec.md` §6.5、ADR-103（news-listen-docs #133）
