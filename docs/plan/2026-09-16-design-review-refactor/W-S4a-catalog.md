## web リファクタ W-S4a: Catalog — `Episode` の UI 展開・失敗の理由の文言写像・生成の上限の種別の集約（学習機能サイクルで着手）

> **2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正**（新 Spec = `docs/design/2026-09-30-implementation-spec-target-architecture.md`。§8.3 W-S4a の 7 項目を本文へ反映した）
> - (1) 失敗の理由の値域を 3 値（`generation_failed`・`quota_exhausted`・`null`）にした。`partial_failed` と識別子以外の値は `generation_failed` と同じ文言（W-31・ADR-108）。
> - (2) 前提を「`decodeEpisode` は W-T2 が `lib/catalog/infrastructure/episodeMapper.ts` に作る」に直した（旧: `lib/playback/coordinator.ts`）。page が mapper を import する形は **TP-A4** として許可リストに載せる。依存に W-T2 を足した。
> - (3) `failureMessage` → `lib/catalog/presentation/failureMessage.ts`。`rateLimitScope` → `lib/catalog/domain/generationLimit.ts` の `classifyGenerationLimit`（`GenerationLimit = { period: 'monthly' | 'daily'; retryAfterSeconds: number | null }`）。
> - (4) `ApiFailure.rate_limited` に `detail` を足す（`lib/shared/apiFailure.ts`・`lib/api/gateway.ts:189`）。`lib/api/legacyRequest.ts:91-92` の逆変換が `detail` を渡す（W-24）。gateway の `scope` は `unknown` のまま。
> - (5) PS-07b の行 ID を足した。
> - (6) `components/ui/StatusBadge.tsx:8,17` の「一部失敗」を消す（B-S6 を待たない。W-31）。これは利用者に見える変化なので「変わる挙動」に決定 ID つきで書いた。
> - (7) 完了条件の「`lib/playback/coordinator.ts`（`isPlayable`）以外に 0 件」を「TA-V4 の TA-R-CT-1・TA-R-CT-3 の行（`removeBy: W-S4a`）が 0 件」に替えた。

## 概要
旧 W-S4（2026-09-23 起票）を context 境界で 4 つに分けた 1 つ目。Catalog の 3 項目: (1) `Episode`（`PlayableEpisode` / `GeneratingEpisode` / `FailedEpisode`。W-T2 が `lib/catalog/domain/episode.ts` に置いた）を `PodcastCard` と `podcast` pages へ展開し、▶を `PlayableEpisode` にしか付けない（PS-07・PS-07b の UI 側）、(2) 失敗の理由（3 値）の日本語文言の写像、(3) 生成の上限の種別（月次か日次か。ADR-073）の判定を Catalog の domain の 1 箇所へ集約する。正本は新 Spec §5.2（TA-R-CT-1・3・11）・§8.3 W-S4a 行・§10.1 W-24・W-31、既存 Spec §3.2・§4 CI-T11（UI 側）、共有仕様 §4.4 PS-07・PS-07b・§6.6、[ADR-102](../../../../docs/adr/102-generation-failure-kind-contract.md)・ADR-108・ADR-073。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: F-POD-01・F-POD-07（PRD §5）、CI-T11（UI 側）・CI-T12（`rate_limited` の field の加算）、PS-07・PS-07b、TA-R-CT-1・3・11、W-24・W-31、SG-C64。

## 種別
適用 slice。判断待ちに依存しない（SG-D5 = BFF の `Retry-After` の中継は W-T10b。どちらが先でもよい）。

分けた理由（2026-09-23 点検）: 旧 W-S4 は 4 context を 1 PR に抱え、1 PR で読める規模を超える。context ごとに切れば各 slice は独立に revert できる。

## 規模（見込み。根拠 = 2026-09-24 実測: `components/PodcastCard.tsx` 173 行、`app/(app)/podcast/page.tsx` 235 行、`app/(app)/podcast/[id]/page.tsx` 455 行、`app/(app)/feed/page.tsx` 615 行。2026-10-01 の補正で増減を足した）
- production ≈ 170 行: `PodcastCard.tsx` の props 分岐 ≈ 40、podcast 2 page の `decodeEpisode` 化 ≈ 40、`feed/page.tsx:15-20` の置換 ≈ 10、`lib/catalog/presentation/failureMessage.ts` ≈ 20、`lib/catalog/domain/generationLimit.ts` ≈ 25、`StatusBadge.tsx` ≈ 5、`ApiFailure` の `detail` ≈ 10（`lib/shared/apiFailure.ts`・`gateway.ts`・`legacyRequest.ts`）。
- test ≈ 170 行: `PodcastCard.test.tsx` ＋ podcast 2 page テストの種別 ≈ 80、`failureMessage.test.ts` ≈ 25、`generationLimit.test.ts` ≈ 30、`StatusBadge.test.tsx` ≈ 10、gateway の `detail` ≈ 15、`legacyRequest` の逆変換 ≈ 10。
- 合計 ≈ 340 行。

## 前提・着手条件
- 依存 slice: **W-S2c** と **W-T2**（`lib/catalog/domain/episode.ts`・`lib/catalog/infrastructure/episodeMapper.ts` の `decodeEpisode`）の web PR が main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- **backend 契約が main にあること**（PR 番号ではなく契約で判定）: B-S0b が merge 済みで、`GET /podcasts/{id}` の `error_message` が識別子か `null` だけを返す（backend `api/schemas.py` の `PodcastResponse.from_podcast` と `tests/test_api_podcasts.py::test_get_podcast_returns_failure_kind_not_internal_text` を親 main の backend submodule で確認）。**未 merge なら着手しない**。B-S6（`partial_failed` を出口で `failed` に写す）は**待たない**（mapper が 4 値を受けて失敗に倒すので、B-S6 の前後どちらでも成り立つ: W-31）。
- 確定済み（再提案しない）: `partial_failed` は再生不可（SG-C64）。識別子以外は `generation_failed` と同じ扱い（W-31）。上限の種別は Catalog の domain、gateway の `scope` は `unknown` のまま（W-24）。棄却済み: `error_message` の構造化（backend Spec rejected_overdesign）、`Episode` 型を DTO 世代で分けること（既存 Spec §3.2 G4）。
- `docs/trial-log/` を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 「一部失敗」 | `components/ui/StatusBadge.tsx:8`（ラベル）・`:17`（色） | `grep -n "partial_failed" components/ui/StatusBadge.tsx` |
| 上限の判定 | `app/(app)/feed/page.tsx:15-20`（`/monthly/i` と `retryAfterSeconds > 86400` の判定は `:17`）。`/monthly/i`・`86400` の出現はほかに `lib/format.ts:33`（日数換算） | `grep -rn "monthly/i\|86400" app components hooks contexts lib` |
| `rate_limited` | `lib/api/gateway.ts:21`（型）・`:189`（`statusToFailure`。`detail` を捨てている）、`lib/api/legacyRequest.ts:91-92`（`ApiFailure` → `ApiError` の逆変換）。W-T1 の後は型が `lib/shared/apiFailure.ts` | `grep -n "rate_limited" lib/shared/apiFailure.ts lib/api/gateway.ts lib/api/legacyRequest.ts` |
| ▶の描画 | `components/PodcastCard.tsx:51-69`（status に関係なく描く） | `sed -n 40,75p components/PodcastCard.tsx` |
| 許可リストの `removeBy: W-S4a` | TA-V4 の TA-R-CT-1・TA-R-CT-3 の行（W-T1 の表） | `grep -B4 '"removeBy": "W-S4a"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
1. **`Episode` の UI 展開**（既存 Spec §3.2）: `components/PodcastCard.tsx` の props を `Episode` 種別で分け、▶は `PlayableEpisode` にしか付かない。`app/(app)/podcast/page.tsx`・`app/(app)/podcast/[id]/page.tsx` は DTO を `decodeEpisode`（`@/lib/catalog/infrastructure/episodeMapper`。W-T2）で `Episode` に読んでから描く（`status` / `audio_url` / `error_message` の直接の判定を page から消す）。矛盾 DTO と `partial_failed` は `FailedEpisode` として表示され▶が付かない（PS-07・PS-07b の UI 側）。page が mapper を import する形は **TP-A4**（許可リストに `rule: TA-D5, file: <2 page>, specifier: @/lib/catalog/infrastructure/episodeMapper, introducedBy: W-S4a, removeBy: W-T3` の 2 行を足す。本 slice が許可リストに行を足すのはこの 2 行だけ）。
2. **失敗の理由の文言**（新規 `lib/catalog/presentation/failureMessage.ts`。TA-R-CT-11）: `FailedEpisode.reason`（`generation_failed` / `quota_exhausted`）→ 日本語文言の純関数 1 つ。値域は W-T2 の `episode.ts` が持つ（mapper が `partial_failed` と識別子以外を `generation_failed` に写す）。文言化は表示側のこの 1 関数だけが行う。
3. **`StatusBadge`**: `partial_failed` のラベル「一部失敗」と色の行（`:8,17`）を消す。入力は `Episode` の種別（`partial_failed` は `FailedEpisode` になっているので「失敗」の表示になる）。
4. **上限の種別の集約**（TA-R-CT-3）: `lib/catalog/domain/generationLimit.ts` に `GenerationLimit`（`{ period: 'monthly' | 'daily'; retryAfterSeconds: number | null }`）と `classifyGenerationLimit(detail, retryAfterSeconds)`（本文に「monthly」を含む、または待ち時間が 24 時間を超えるなら月次。ADR-073）を置く。`feed/page.tsx` の文言の関数は、この結果から「今月 / 本日の生成上限」を選ぶ（文言は page）。`lib/api/gateway.ts` は判定を持たない（`scope` は `unknown` のまま。W-24）。
5. **`rate_limited.detail`**（W-24）: `lib/shared/apiFailure.ts` の `rate_limited` に `readonly detail: string` を足し、`lib/api/gateway.ts:189` が backend の本文の `detail` を入れる。`lib/api/legacyRequest.ts:91-92` の逆変換は `ApiError` に `detail` を渡す（`feed/page.tsx` が W-S4d1 まで `err.detail` を読むため）。gateway の契約への加算だけで、既存の field と request は変えない。

## 変更の責務（層ごと）
| 層 | 置くもの | ID |
|---|---|---|
| domain `lib/catalog/domain/generationLimit.ts` | 上限の種別 | TA-R-CT-3 |
| presentation `lib/catalog/presentation/failureMessage.ts` | 失敗の理由 → 文言 | TA-R-CT-11 |
| shared kernel `lib/shared/apiFailure.ts`・adapter `gateway.ts`・`legacyRequest.ts`（TP1） | `detail` の加算 | W-24・CI-T12 |
| presentation（`PodcastCard`・`StatusBadge`・page 3 本） | 種別ごとの描画・文言の選択 | PS-07・PS-07b |

## 移行の中間状態
- **TP-A4**（page が DTO を持ち、`decodeEpisode` を自分で呼ぶ）: 導入 W-S2b・W-S4a、削除 W-T3。許可リスト +2 行（上の対象 1）。
- TP1（`legacyRequest.ts`）は W-S4d3 まで残る（本 slice は `detail` を渡す 1 行だけ変える）。

## 変わる挙動（これ以外の挙動変更は禁止）
| 決定 ID | 変わる挙動 | 現行 | 判定 |
|---|---|---|---|
| W-31・SG-C64・ADR-108 | `partial_failed` のエピソードのバッジが「一部失敗」ではなく「失敗」になる | 「一部失敗」 | `tests/components/ui/StatusBadge.test.tsx`・`PodcastCard.test.tsx`（`PS-07b` をテスト名に含める） |
| PS-07・PS-07b（ADR-103・SG-C64） | 矛盾 DTO・`partial_failed`・`audio_url` が空のエピソードに▶が付かない | status に関係なく▶を描く | `PodcastCard.test.tsx`・podcast 2 page のテスト |
| W-31 | 識別子以外の `error_message`（B-S0b 前の自由文）は `generation_failed` と同じ文言 | 画面に出していない（新 Spec §5.2 TA-R-CT-11「今の居場所」） | `failureMessage.test.ts` |

上限到達の toast の文言・月次と日次の判定の結果は不変（判定の置き場を移すだけ）。

## 契約と検査（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T11（UI 側） | `Episode` 種別で描き分け、▶は `PlayableEpisode` だけ | T-T11（UI 側）: `tests/components/PodcastCard.test.tsx`・`tests/app/podcast/page.test.tsx`・`tests/app/podcast/id/page.test.tsx` で種別 3 ＋ 矛盾 DTO 1 ＋ `partial_failed` 1 の表示分岐。テスト名に `PS-07`・`PS-07b` を含める |
| TA-R-CT-11 | 2 つの識別子・`partial_failed`・自由文・`null` の文言 | `tests/lib/catalog/presentation/failureMessage.test.ts`（表駆動 5 行） |
| TA-R-CT-3 | 上限の種別 | `tests/lib/catalog/domain/generationLimit.test.ts`（monthly 文言・86400 超・それ以外の 3 行 ＋ 両方当たる 1 行。`tests/app/feed/` の既存テストが regression の oracle） |
| CI-T12（W-24） | `rate_limited` が `detail` を持つ・逆変換が渡す | `tests/lib/api/gateway.test.ts` に 1 行・TP1 の逆変換のテストに 1 行 |

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e -- main-flow`。

## 完了条件
- 上のコマンドが成功。
- T-T11（UI 側）が `verifies: CI-T11` と `PS-07`・`PS-07b` をテスト名またはコメントに持つ。
- **規則の置き場**（TA-V4。量化する集合 = `lib app components hooks contexts`）: 許可リストの `removeBy: "W-S4a"` の行（TA-R-CT-1・TA-R-CT-3）が 0 件で、`tests/architecture/rules.test.ts` が green（TA-R-CT-1 の式の出現が `lib/catalog/domain/episode.ts`・`lib/catalog/infrastructure/episodeMapper.ts` と、TA-R-CT-6 の行として残る `podcast/page.tsx:91` だけ。TA-R-CT-3 の式の出現が `lib/catalog/domain/generationLimit.ts` と `lib/format.ts` の日数換算 1 行だけ）。
- 許可リストの増減: −（`removeBy: W-S4a` の行数）＋ 2（TP-A4）。ほかの行は変えない。
- `grep -rn "partial_failed\|一部失敗" components app` が 0 件。
- 3 値それぞれと `partial_failed`・自由文に日本語文言があり、例外にならない。
- 既存の page tests（`tests/app/podcast/`・`tests/app/feed/`）が、`Episode` 種別に応じた props の変更と「変わる挙動」の行以外は変更なしで green。
- **公開面**（NFR-10・AQ-6。2026-10-01 追加: 新しい domain の型を作る slice は、公開面の検査の対象にその型を足す。Spec §7 TA-V5・TA-V6）: `lib/catalog/domain/generationLimit.ts` の `GenerationLimit`を、TA-V5（静的。`tests/architecture/publicTypes.test.ts` の対象で、export する型の property と配列が `readonly`。違反は 0）と TA-V6（実行時。`tests/architecture/immutability.<context>.test.ts` に「渡した入力・返した値（入れ子を含む）を後から書き換えても、次の読みと不変条件が変わらない」の場合を 1 つ以上）に足す。

## 禁止事項 / scope 外
- `PreferencesRegistry`・`AppContext` の解体（W-S4b）、`PasswordPolicy`・`AuthSession`（W-S4c）、`lib/api` の context 別の取り込みと page 側の注入点の移行（W-S4d1）・TP1 の削除（W-S4d3）は行わない。`createApiClient()` の呼出箇所を変えない。`tests/app/podcast/*`・`tests/app/feed/` の `vi.mock('@/lib/api')` は本 slice では残す（W-S4d2a が gateway の double へ移す）。
- `lib/catalog/domain/episode.ts`・`episodeMapper.ts`（W-T2）の判別の規則を変えない。
- backend の `error_message` の型・値域を変えない。表示文言を backend に求めない（FK-a）。`ApiFailure` の既存の field と variant の集合を変えない（`detail` の加算だけ）。BFF を変えない（W-T10b）。
- 生成の完了の検知（`detectCompleted`）とポーリングの停止の条件の単一所有は W-T3。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/components/PodcastCard.test.tsx`、`tests/components/ui/StatusBadge.test.tsx`（あれば）、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/feed/`、`tests/lib/catalog/domain/episode.test.ts`（W-T2。CI-T11 の規則側 16 行）、`tests/lib/api/gateway.test.ts`。

## 返却事項（記録）
- 完了時、共有仕様 §4.4 の PS-07・PS-07b の web の保留（UI 側。解除条件 = 本 slice）を解除できる旨を親 docs へ返す。web-design §12.5 の W-S4 行は W-S4a と読み替える。
- 導出 W-24・W-31 を台帳 §5.0 へ登録する旨を返す。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- 新 Spec §5.2・§7（TA-V4 の表）・§8.3（W-S4a 行・不整合 1）・§10.1（W-24・W-31）
- 既存 Spec §3.2・§4（CI-T11・CI-T12）・§5（CP5）
- 親 docs: ADR-102・ADR-108・ADR-073、web-design §12.1（Catalog）・§12.5、共有仕様 §4.4 PS-07・PS-07b・§6.6
