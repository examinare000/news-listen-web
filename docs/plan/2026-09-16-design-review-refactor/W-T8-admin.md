## web リファクタ W-T8: Admin — admin の 4 画面を command・query・リードモデルにする（適用 slice）

## 概要
`app/(app)/admin/{users,invites,featured-sites,metrics}/page.tsx` が直接呼ぶ 13 の操作と、page に散る入力の規則（自己ロックアウトの guard・featured の order の採番と並べ替えの差分・招待の入力の検査）を `lib/admin/{domain,application,infrastructure}` へ移す。page は DTO（`AuthUser[]`・`Invite[]`・`FeaturedSource[]`・`MetricsSnapshot`）を持たず、リードモデル（`AdminUserRow`・`InviteRow`・`FeaturedSiteRow`・`MetricsView`）を持つ。**利用者に見える挙動・文言・request は変えない**。規則の正本は backend で、web は入力の検査と表示を持つ。正本は新 Spec §5.7（TA-C-AD-1〜9・TA-Q-AD-1〜4・TA-R-AD-1〜3）・§8.2 W-T8 行・§8.4 TP-A6、ADR-110 決定 9。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-SET-07・F-ACC-05・F-ACC-06（PRD §5）、UC-M1〜M4、CI-T16（`AdminGate`。不変）、TA-R-AD-1〜3（TA-R-AD-4 は W-S4c で済み）、TA-D4・TA-D5、TA-V4・TA-V6・TA-V7。

## 種別
適用 slice。判断待ちに依存しない。W-T3〜W-T7a・W-T9・W-T10a とは順序を問わない。

## 規模（見込み。根拠 = 2026-10-01 実測: `admin/users/page.tsx` 190 行、`featured-sites/page.tsx` 300 行超、`invites/page.tsx` 260 行超、`metrics/page.tsx` 150 行超）
- production ≈ 450 行: `lib/admin/domain/{featuredOrder,inviteInput,userGuard}.ts` ≈ 70、`lib/admin/application/{commands,queries,readModels,ports}.ts` ≈ 180、`lib/admin/infrastructure/adminGateway.ts` ≈ 90、page 4 本 ≈ −150/+110。
- test ≈ 400 行: domain 3 ≈ 100、command / query ≈ 150、gateway ≈ 60、`cqrs.admin.test.ts`・`immutability.admin.test.ts` ≈ 50、page テストの mock 置換 ≈ 40。
- 合計 ≈ 850 行（10² 行の後半）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4c（admin が設定するパスワードも `lib/account/domain/password.ts`）・W-T5（featured の category の値域が `lib/catalog/domain/featuredCategory.ts`）が main にあること（W-T5 が後なら、本 slice は `lib/featuredCategories.ts` を import のまま使い、W-T5 が付け替える）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない）: featured の更新は全置換なので order を引き継ぐ（web-design §12.4）。招待コードは作成時に 1 度だけ見せる（receipt）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4c・W-S4d1 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 自己ロックアウトの guard | `admin/users/page.tsx:168` 付近（自分の行の role 変更・削除の抑止） | `grep -n "username ===\|currentUser\|user?.username\|disabled" 'app/(app)/admin/users/page.tsx'` |
| featured の採番 | `featured-sites/page.tsx:85`（`Math.max(...order) + 1`、空なら 0） | `grep -n "Math.max\|order" 'app/(app)/admin/featured-sites/page.tsx'` |
| featured の全置換で order を引き継ぐ | `:133-142` | 同上 |
| 並べ替えの差分 | `:151-176`（隣と入れ替え、`order !== i` の行だけ PUT） | 同上 |
| 招待の入力 | `invites/page.tsx:29-34`（`parseOptionalPositiveInt`: 空は未指定・正の整数・それ以外は `invalid`）・`:92-103` | `grep -n "parseOptionalPositiveInt\|invalid" 'app/(app)/admin/invites/page.tsx'` |
| request | `lib/api/admin.ts` の 12 関数（`getMetrics`〜`deleteFeaturedSite`） | `grep -n "^export function" lib/api/admin.ts` |
| 許可リストの `removeBy: W-T8` | TA-D4 (a) 4 ファイル・TA-D5（TP-A6）4 ファイル | `grep -B4 '"removeBy": "W-T8"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/admin/domain/userGuard.ts`（TA-R-AD-1）: `canChangeRole(actor, target)`・`canDelete(actor, target)`（自分自身なら false。正本は backend の F-ACC-06。web は UI の guard）。
2. `lib/admin/domain/featuredOrder.ts`（TA-R-AD-2）: `nextOrder(sites)`・`orderForUpdate(sites, id)`・`reorderDiff(sites, index, direction) → ReadonlyArray<{ id; order }>`（位置が変わった行だけ）。
3. `lib/admin/domain/inviteInput.ts`（TA-R-AD-3）: `parseOptionalPositiveInt(raw) → number | undefined | 'invalid'`（現行の規則）。
4. `lib/admin/application/{commands,queries,readModels,ports}.ts`: command 9（TA-C-AD-1〜9: `createUser`・`updateUser`・`deleteUser`・`createInvite`（receipt = 一度しか見せない招待コード）・`revokeInvite`・`createFeaturedSite`・`updateFeaturedSite`・`deleteFeaturedSite`・`reorderFeaturedSites`）と query 4（TA-Q-AD-1〜4: `listUsers`・`listInvites`・`listFeaturedSites`・`getMetrics`）。`createUser` は `validatePassword`（`lib/account/domain/password.ts`）を通す。リードモデル `AdminUserRow`・`InviteRow`・`FeaturedSiteRow`・`MetricsView`（各 page が読む field だけ。着手時に page の読み取りで数える）。`AdminGateway`（port）。domain の型の import は TA-D12 の組（Admin → Account の `UserRole`・`PasswordPolicy`、Admin → Catalog の `FeaturedCategory`）だけ。
5. `lib/admin/infrastructure/adminGateway.ts`: `lib/api/admin.ts` の 12 関数を呼び、DTO → application の型。
**変更（production）**: 4 page を command / query / リードモデルへ。文言・確認ダイアログ・toast は page に残す。`@/types`・`@/lib/admin/infrastructure/api`（TP-A6）の import を消す。`architecture/boundaries.allowlist.json` の `removeBy: "W-T8"` の行を消す。
**テスト**: `tests/lib/admin/domain/*.test.ts`・`tests/lib/admin/application/*.test.ts`・`tests/lib/admin/infrastructure/adminGateway.test.ts`・`tests/architecture/{cqrs,immutability}.admin.test.ts`、`tests/app/admin/*/page.test.tsx` の mock 置換。

## 変更の責務（層ごと）
domain = 3 規則（TA-R-AD-1〜3）。application = 13 の入口・4 リードモデル・port。infrastructure = DTO の変換。presentation = 文言・確認・`AdminGate`（CI-T16。変えない）。

## 移行の中間状態
TP-A6 の Admin の分を消す。新しい一時経路は無い。

## 変わる挙動
無い（文言・request の順序（並べ替えは位置が変わった行だけを順に PUT）・自己ロックアウトの表示は不変）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-AD-1〜3 | domain の 3 テスト（表駆動。`reorderDiff` は先頭・末尾・中間の入替え） |
| CI-T16 | `tests/components/AdminGate.test.tsx` 不変 |
| TA-V4 | `rules.test.ts`: `Math.max(` と `order !== ` の出現が `lib/admin/domain/featuredOrder.ts` だけ、`parseOptionalPositiveInt` の定義が `inviteInput.ts` だけ（式を表に足す） |
| TA-V6 | `immutability.admin.test.ts`: query 4 つの観点 2・3 |
| TA-V7 | `cqrs.admin.test.ts`: (a) 入口の名前の集合が §5.7 の command 9・query 4 と一致。(b)(c)。`createInvite` の receipt は招待コードと id だけ |
| TA-V9 | `tests/app/admin/*/page.test.tsx` の文言と `fake.calls` |

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。
- **DTO を持たない**（集合 = admin の 4 page）: `grep -n "from '@/types\|from '@/lib/admin/infrastructure\|useState<AuthUser\|useState<Invite\|useState<FeaturedSource\|useState<MetricsSnapshot" 'app/(app)/admin'/*/page.tsx` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: `grep -rn "Math.max(\.\.\.\|parseOptionalPositiveInt" app components hooks contexts lib` の出現が `lib/admin/domain/` だけ。
- **許可リスト**: `grep -c '"removeBy": "W-T8"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3・V4 が green。
- 文言・request の assertion に diff が無い。

## 禁止事項 / scope 外
- backend の規則（自己ロックアウトの判定・全置換）を web で変えない。`AdminGate`・`adminAccess`（W-S0・W-S4c・W-T6）を変えない。
- 文言・request を変えない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/admin/{users,invites,featured-sites,metrics}/page.test.tsx`・`tests/components/AdminGate.test.tsx`。

## 規模・返却事項
規模は上。返却: web-design §12.1 の Admin 行を現状記述へ書き換える対象として README に印を付ける。棄却・方針転換は `docs/trial-log/` へ。

## 参照
新 Spec §5.7・§7・§8.2（W-T8 行）・§8.4（TP-A6）、ADR-110 決定 9、web-design §12.4。
