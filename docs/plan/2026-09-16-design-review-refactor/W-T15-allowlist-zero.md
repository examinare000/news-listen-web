## web リファクタ W-T15: 許可リストを空にし、一時経路を外す（適用 slice。最後の slice）

## 概要
目標アーキテクチャの最後の slice。(1) 許可リスト `architecture/boundaries.allowlist.json`（TP-A1）を 0 件にする。(2) 再 export（TP-A2: `lib/api/gateway.ts` の `Result`・`ApiFailure`、`types/index.ts` の `DifficultyLevel`・`UserRole`・`PushSubscriptionState`）の import 元を全部付け替えて外す。(3) `types/index.ts` を `lib/api/dto.ts` へ改名する（DTO 専用）。(4) `lib/format.ts`・`lib/highlightTerms.tsx` を `lib/presentation/` へ。(5) `lib/config.ts` の残り（TP-A7）を adapter へ吸収して削除する。(6) backend B-S6 が main に入っていれば `PodcastStatus` から `partial_failed` を外す。TA-V10 の 7 問を通して確かめる。**利用者に見える挙動・request は変えない**。正本は新 Spec §3.2（`types/index.ts`・`lib/config.ts`・`lib/format.ts` の行）・§7（許可リスト・TA-V10）・§8.2 W-T15 行・§8.4（TP-A1・A2・A7）。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09・NFR-10、AQ-1〜AQ-7（TA-V10 の 7 問）、TA-D1〜TA-D12（違反 0）、TA-V1〜V3・TA-V10、ADR-110 決定 10（最後の slice で一覧を空にする）、ADR-108（`partial_failed` の値域。B-S6 の後）。

## 種別
適用 slice。判断待ちに依存しない。`partial_failed` の除去だけは B-S6 の有無で行う・行わないが決まる（新 Spec §8.2 の条件。選択ではない）。

## 規模（見込み。根拠 = 2026-10-01 実測: `types/index.ts` 456 行、`lib/format.ts` 140 行、`lib/config.ts` 27 行。import の付け替えの数は着手時に数える）
- production ≈ 200 行（大半は import の 1 行置換）、設定 ≈ −80 行（許可リスト）、test ≈ 80 行（import の置換・TA-V10 の記録）。合計 10² 行。

## 前提・着手条件
- 依存: **W-T1〜W-T13 と W-T14 の全部**（W-T7b・W-T10b を含む）、および W-S2a1〜W-S5 の全部の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと（新 Spec §8.1「全部」）。
- backend B-S6 の契約（`error_message` 3 値・`status` に `partial_failed` を返さない）が backend main にあるかを着手時に確かめる（親 main の backend submodule の `api/schemas.py`）。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` / `npm run test:e2e`。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（投入の直前に数える）
| 項目 | 期待（前の slice が全部入っていれば） | 数える手順 |
|---|---|---|
| 許可リストの残り | `removeBy: "W-T15"` の行だけ（TA-V3 (a) の `@/types` を INFRA の外で import する行が残っていれば、それは前の slice の取りこぼし。本 slice では消さずに報告する） | `node -e "const a=require('./architecture/boundaries.allowlist.json');const m={};for(const r of a)m[r.removeBy]=(m[r.removeBy]\|\|0)+1;console.log(m)"` |
| TP-A2 の再 export を使う import | `@/lib/api/gateway` から `Result`・`ApiFailure` を import する全行、`@/types` から `DifficultyLevel`・`UserRole`・`PushSubscriptionState` を import する全行 | `grep -rn "import.*\(Result\|ApiFailure\).*from '@/lib/api/gateway'" app components hooks contexts lib tests; grep -rn "\(DifficultyLevel\|UserRole\|PushSubscriptionState\).*from '@/types" app components hooks contexts lib tests` |
| `@/types` の読み手 | INFRA（`lib/api/**`・`lib/*/infrastructure/**`）と `tests/**` だけ | `grep -rln "from '@/types" app components hooks contexts lib \| grep -v '^lib/api/\|/infrastructure/'` が 0 |
| `lib/config.ts` の読み手 | `lib/preferences/infrastructure/localSettingsStore.ts`・`lib/playback/infrastructure/localPositionStore.ts` だけ | `grep -rn "@/lib/config" app components hooks contexts lib tests` |
| `lib/format.ts`・`lib/highlightTerms.tsx` の読み手 | PRES だけ | `grep -rn "@/lib/format\|@/lib/highlightTerms" app components hooks contexts lib tests` |

## 対象（web サブモジュールのみ）
1. TP-A2 の付け替え: 上の点検の全行を `@/lib/shared/{result,apiFailure,difficulty}`・`@/lib/account/domain/role`・`@/lib/notifications/domain/pushSubscriptionState` へ。`lib/api/gateway.ts` と `types/index.ts` の再 export を消す。
2. `types/index.ts` → `lib/api/dto.ts`（`git mv`）。読み手（INFRA と tests）の import を付け替える。`architecture/eslint-boundaries.mjs` と `tests/architecture/*` の DTO の path を `@/lib/api/dto` に直す（TA-D4 の文面どおり）。
3. `lib/format.ts`・`lib/highlightTerms.tsx` → `lib/presentation/`。`formatAuthUserLabel` が DTO を受けていれば `AuthView['subject']` にする（W-T6 で済んでいれば何もしない）。
4. `lib/config.ts`: 残る key の定数を `localSettingsStore.ts`・`localPositionStore.ts` へ移し、削除する（TP-A7）。
5. B-S6 が backend main にあるときだけ: `PodcastStatus` から `partial_failed` を外し、`lib/catalog/infrastructure/episodeMapper.ts` の `partial_failed` の読み替えは残す（古いキャッシュの応答を読むため。ADR-108 の移行の扱い）。B-S6 が無ければこの項目は行わず、PR 説明にそう書く。
6. `architecture/boundaries.allowlist.json` を `[]` にする（ファイルと検査の仕組みは残す。以後の違反は 0 件から増やせない）。
7. TA-V10 の 7 問（新 Spec §7）に、実コードで「その変更をしたら変わるファイル」を答え、期待するファイルの範囲に収まることを PR 説明に書く。

## 変更の責務（層ごと）
置き場の整理だけ（shared kernel・adapter の DTO・presentation の整形）。規則と状態は動かさない。

## 移行の中間状態
TP-A1・TP-A2・TP-A7 を消す。残る一時経路は TP1（W-S4d3 で削除済み）・TP2（SW の prefix。既存 Spec §6 の条件）・TP3（inline の theme script。既存 Spec §6 の条件）だけで、どちらも許可リストの対象外。

## 変わる挙動
無い。

## 契約と検査
TA-V1〜V3（許可リスト 0 件で green）、TA-V4（全行が許可リストなしで green）、TA-V5〜V8（全 context）、TA-V9（既存テスト全件と e2e）、TA-V10（7 問）。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e`（4 本）。

## 完了条件
- 上のコマンドが成功。
- `architecture/boundaries.allowlist.json` の配列の長さが 0（`node -e "console.log(require('./architecture/boundaries.allowlist.json').length)"` が `0`）。
- `types/index.ts`・`lib/config.ts`・`lib/format.ts`・`lib/highlightTerms.tsx` が存在しない。
- `grep -rn "from '@/types" app components hooks contexts lib tests` が 0 件。`grep -rln "from '@/lib/api/dto'" app components hooks contexts lib` の出力が `lib/api/`・`lib/*/infrastructure/` の中だけ。
- `lib/api/gateway.ts` が `Result`・`ApiFailure` を export しない（`grep -n "export type Result\|export type ApiFailure\|export type { Result\|export { .*ApiFailure" lib/api/gateway.ts` が 0 件）。
- TA-V10 の 7 問の答えが PR 説明にある。

## 禁止事項 / scope 外
- 規則・状態・request・文言を変えない。eslint の規則を緩めない（許可リストを空にした後に違反が出たら、前の slice の取りこぼしとして報告し、規則を変えずに直す範囲が import の付け替えを超えるなら止める）。TP2・TP3 を外さない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`npm test` 全件・e2e 4 本・`tests/architecture/*`。

## 規模・返却事項
規模は上。返却: (1) 許可リスト 0 件の達成と TA-V10 の答えを親 docs（architecture.md §10 の web 行・新 Spec §7）へ。(2) 本フォルダの削除と web-design §3〜§9 の書き換え（README「完了後」）を router へ。

## 参照
新 Spec §3.2・§7・§8.2（W-T15 行）・§8.4、ADR-110 決定 10、ADR-108。
