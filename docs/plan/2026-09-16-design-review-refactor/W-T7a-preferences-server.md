## web リファクタ W-T7a: Preferences — サーバー設定（難易度・週の目標）の command と query を置く（適用 slice）

## 概要
`app/(app)/settings/page.tsx`（511 行）が直接呼ぶ `getPreferences`・`updatePreferences` と、「難易度の保存は最新の要求だけを反映し、失敗したら元の値に戻す」（TA-R-PF-3。page の連番）を Preferences の application（TA-C-PF-2・3・TA-Q-PF-2）と infrastructure（`preferencesGateway.ts`）へ移す。週の目標の 400ms の debounce は hook（page）に残す。あわせて、settings page だけが読む生成の残回数（TA-Q-CT-8 `getGenerationQuota` → `QuotaView`）を Catalog の query に置く（新 Spec §8.2 はこの query の slice を決めていない。`GenerationQuota` DTO の読み手が settings だけなので本 slice が持つ = 報告事項）。**利用者に見える挙動・文言・request は変えない**（既定速度は端末のまま。サーバーとの同期は W-T7b）。正本は新 Spec §5.4（TA-M-PF・TA-C-PF-2・3・TA-Q-PF-2・TA-R-PF-3）・§5.2（TA-Q-CT-8）・§8.2 W-T7a 行。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (3)、AQ-4、F-SET-02・F-LRN-09（PRD §5）、UC-A3（既存 Spec §1.2）、TA-R-PF-3、TA-V6・TA-V7。

## 種別
適用 slice。判断待ちに依存しない。W-T6 と続けて置く（`settings/page.tsx` が重なる。後から merge する側が rebase）。W-T7b（SG-D4）は本 slice の後。

## 規模（見込み。根拠 = 2026-10-01 実測: `settings/page.tsx` 511 行（`:36-60` 設定の取得・`:64-90` quota・`:143-196` 難易度と週の目標）、`lib/api/settings.ts:50-58`・`lib/api/users.ts:10-13`）
- production ≈ 230 行: `lib/preferences/application/{commands,queries,readModels,ports}.ts` ≈ 110、`lib/preferences/infrastructure/preferencesGateway.ts` ≈ 40、Catalog の `getGenerationQuota`・`QuotaView` ≈ 30、`settings/page.tsx` ≈ −70/+40。
- test ≈ 250 行: `commands.test.ts`（最新の要求だけ反映・失敗で戻す・週の目標）≈ 100、`queries.test.ts` ≈ 40、`preferencesGateway.test.ts` ≈ 40、`cqrs.preferences.test.ts`・`immutability.preferences.test.ts` ≈ 40、`tests/app/settings/page.test.tsx` の mock 置換 ≈ 30。
- 合計 ≈ 480 行（10² 行）。

## 前提・着手条件
- 依存 slice: **W-S4d3** と **W-S4b**（`lib/preferences/domain/settings.ts`・`localSettingsStore.ts`・`PreferencesProvider`・`WEEKLY_GOALS` と難易度の一覧が domain にある）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- 確定済み（再提案しない）: 既定速度は本 slice では端末だけ（TA-R-PF-4。サーバー正本化 = SG-D4 は W-T7b）。難易度の提案のバナー（`settings/page.tsx:90-117`）は W-T13（Learning）。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S2b・W-S4b・W-S4d1・W-T6 で行番号が動く。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 設定の取得 | `settings/page.tsx:47-58`（`getPreferences` → `default_difficulty`・`weekly_goal_episodes ?? 3`。失敗は `DEFAULT_DIFFICULTY` と toast「設定の読み込みに失敗しました」） | `grep -n "loadPreferences\|getPreferences" 'app/(app)/settings/page.tsx'` |
| 難易度の保存 | `:147-173`（`difficultyRequestIdRef`・失敗で `previousDifficulty` に戻し「難易度設定の保存に失敗しました」） | `grep -n "difficultyRequestIdRef\|handleDifficultyChange" 'app/(app)/settings/page.tsx'` |
| 週の目標 | `:174-196`（400ms の debounce・失敗で戻し「学習目標の保存に失敗しました」） | `grep -n "handleWeeklyGoalChange\|400" 'app/(app)/settings/page.tsx'` |
| 残回数 | `:66-88`（`getGenerationQuota`。404 は非表示、それ以外はエラーバナー） | `grep -n "loadQuota\|getGenerationQuota" 'app/(app)/settings/page.tsx'` |
| request | `lib/api/settings.ts:50` `getPreferences` / `:54` `updatePreferences(patch)`（`PATCH`。body は `default_difficulty` か `weekly_goal_episodes` だけ）、`lib/api/users.ts:10` `getGenerationQuota` | `sed -n 50,58p lib/api/settings.ts; sed -n 10,13p lib/api/users.ts` |
| 許可リストの `removeBy: W-T7a` | TA-D5（TP-A6: `settings/page.tsx` の `lib/preferences/infrastructure/api`・`lib/learning/infrastructure/api`（`getGenerationQuota` は W-S4d1 の表では learning の api にある）） | `grep -B4 '"removeBy": "W-T7a"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
**新規（production）**
1. `lib/preferences/application/readModels.ts`: `ServerPreferencesView`（`defaultDifficulty: DifficultyLevel`・`weeklyGoal: WeeklyGoal`・`digest: { … }`（現行 `UserPreferences` の digest field を写す。着手時に `types/index.ts:209-216` で数える））。凍結済み。
2. `lib/preferences/application/ports.ts`: `PreferencesGateway`（`get() → Promise<Result<ServerPreferencesView の材料, ApiFailure>>`・`patch(patch) → Promise<Result<void, ApiFailure>>`。`patch` の型は domain の設定 id と値）。
3. `lib/preferences/application/commands.ts`: `setDefaultDifficulty(level)`（TA-C-PF-2）→ `Result<void, ApiFailure>`。最新の要求だけを反映する（連番を command の実装が持つ）。失敗したら `Result` で返し、元の値に戻すのは presentation（値の保持は page の state。TA-R-PF-3 の「失敗したら元の値に戻す」は「stale な失敗は無視する」まで含めて command が判定する: 最新でない失敗は `ok: true` 相当に潰さず、`stale: true` の receipt で返す）。`setWeeklyGoal(goal)`（TA-C-PF-3）→ `Result<void, ApiFailure>`。debounce は page。
4. `lib/preferences/application/queries.ts`: `getServerPreferences()`（TA-Q-PF-2）→ `Result<ServerPreferencesView, ApiFailure>`。
5. `lib/preferences/infrastructure/preferencesGateway.ts`: `lib/api/settings.ts` の 2 関数を呼ぶ。DTO → `ServerPreferencesView` の材料。
6. Catalog: `queries.ts` へ `getGenerationQuota()`（TA-Q-CT-8）→ `Result<QuotaView, ApiFailure>`（`not_found` は「表示しない」を presentation が選ぶので `Result` のまま返す）。`readModels.ts` へ `QuotaView`（現行 `GenerationQuota` のうち page が読む field。着手時に数える）。`CatalogGateway` へ `getGenerationQuota`。
**変更（production）**
7. `app/(app)/settings/page.tsx`: `useState<DifficultyLevel>`・`weeklyGoal`・`quota` の取得と保存を command と query へ。`difficultyRequestIdRef` を消す。文言（3 つの toast・エラーバナー）は page に残す。`@/types` の import のうち `GenerationQuota`・`DEFAULT_DIFFICULTY` を消す（`DifficultySuggestion` は W-T13 まで残る。許可リストの `settings/page.tsx` の TA-D4 行は `removeBy: W-T13` のまま）。
8. `architecture/boundaries.allowlist.json`: `removeBy: "W-T7a"` の行を消す。
**テスト**: `tests/lib/preferences/application/{commands,queries}.test.ts`・`tests/lib/preferences/infrastructure/preferencesGateway.test.ts`・`tests/architecture/{cqrs,immutability}.preferences.test.ts`、`tests/app/settings/page.test.tsx` の mock 置換（文言・request の assertion は不変）。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| application（Preferences） | TA-C-PF-2・3・TA-Q-PF-2・`ServerPreferencesView`・最新の要求だけ反映 | TA-R-PF-3 |
| application（Catalog） | TA-Q-CT-8・`QuotaView` | — |
| infrastructure `preferencesGateway.ts` | DTO ⇄ application の型 | — |
| presentation `settings/page.tsx` | 文言・debounce・失敗時の戻し・404 の非表示 | — |

## 移行の中間状態
- TP-A6 の Preferences の分（`settings/page.tsx` → `lib/preferences/infrastructure/api`・`lib/learning/infrastructure/api` の `getGenerationQuota`）を消す。`lib/learning/infrastructure/api` の残り（`getDifficultySuggestion`）は W-T13。
- `settings/page.tsx` の `@/types`（`DifficultySuggestion`）と `@/lib/sfx` は W-T13 まで残る。

## 変わる挙動
無い（文言・保存の request（`PATCH` の body は 1 field）・失敗時の戻し・404 の非表示は不変）。

## 契約と検査
| 契約 / 検査 | テスト |
|---|---|
| TA-R-PF-3 | `commands.test.ts`: 2 連続の変更で先の応答が後から届いても最新の値だけ反映。最新の失敗は `ok: false`、stale な失敗は `stale` の receipt |
| TA-V6 | `immutability.preferences.test.ts`: `getServerPreferences()` の観点 2・3 |
| TA-V7 | `cqrs.preferences.test.ts`: (a) `PreferencesCommands` / `PreferencesQueries` の入口の名前の集合が §5.4 の表（`set`・`setDefaultDifficulty`・`setWeeklyGoal` / `get`・`ready`・`getServerPreferences`。`set`・`get`・`ready` は W-S4b の registry の公開物）と一致。(b)(c) |
| TA-V9 | `tests/app/settings/page.test.tsx`（W-S4d2b で double 化済み）の文言と `fake.calls` の assertion |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。
- **page が直接呼ばない**（集合 = `app/(app)/settings/page.tsx`）: `grep -n "getPreferences\|updatePreferences\|getGenerationQuota\|difficultyRequestIdRef\|from '@/lib/preferences/infrastructure\|GenerationQuota" 'app/(app)/settings/page.tsx'` が 0 件。
- **規則の置き場**（集合 = `app components hooks contexts lib`）: 「最新の要求だけ反映」の連番（`RequestId` を名前に含む ref）が `lib/preferences/application/commands.ts` の外に無い（`grep -rn "RequestIdRef" app components hooks contexts` が 0 件。`feed/page.tsx` の `fetchRequestIdRef` は W-T4 で消える）。
- **許可リスト**: `grep -c '"removeBy": "W-T7a"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3 が green。
- 文言・request の assertion に diff が無い。

## 禁止事項 / scope 外
- 既定速度の保存先を変えない（W-T7b。SG-D4）。registry（W-S4b）の宣言を変えない。
- 難易度の提案（W-T13）・account（W-T6）・オフライン一覧（Playback）を変えない。
- 400ms の debounce・文言・request を変えない。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/settings/page.test.tsx`・`tests/lib/preferences/`（W-S4b）。

## 検証
`npm test`、上記 grep 3 種、`npm run lint`、`npm run build`。

## 記録
- 完了時、TA-Q-CT-8 の置き場（本 slice）を新 Spec §8.2 へ返す。web-design §12.1 Preferences 行を現状記述へ書き換える対象として README に印を付ける。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §5.2（TA-Q-CT-8）・§5.4・§7・§8.2（W-T7a 行）
- 既存 Spec §1.2（UC-A3）・§3.4
