## web リファクタ W-S4a: Catalog — `Episode` の UI 展開・`error_message` 4 値の文言写像・`rate_limited.scope` の集約（学習機能サイクルで着手）

## 概要
旧 W-S4（2026-09-23 起票）を context 境界で 4 つに分けた 1 つ目。Catalog context に属する 3 項目だけを行う: (1) `Episode` 判別共用体（`PlayableEpisode` / `GeneratingEpisode` / `FailedEpisode`。W-S2a の `decodeEpisode` が既に存在）を `PodcastCard` と `podcast` pages へ展開し▶を `PlayableEpisode` にしか付けない（PS-07）、(2) backend `GET /podcasts/{id}` の `error_message` 識別子 4 値（ADR-102）の日本語文言写像、(3) `rate_limited.scope` の判定規則を `lib/catalog/` の 1 箇所へ集約する。正本は Implementation Spec §3.2（Catalog）・§4 CI-T11（UI 側）・§6 S4 行、親 docs web-design §12.1 Catalog 行・§12.5 W-S4 行（PS-07）、共有仕様 §4.4 PS-07・§6.6「再生可能の判定」、[ADR-102](../../../../docs/adr/102-generation-failure-kind-contract.md)。**検証モード: 再設計しない**。新しい契約 ID は作らない。

分けた理由（2026-09-23 点検）: 旧 W-S4 は Catalog / Preferences / Account / Platform 注入の 4 context を 1 PR に抱え、page 側 15 ファイル・37 箇所と `vi.mock('@/lib/api')` 25 テストファイルの移行を含むため 1 PR で読める規模を超える。context ごとに切れば各 slice は独立に revert できる。W-S4a〜d の順序は README「投入順」。

## 規模（見込み。根拠 = 2026-09-24 実測: `components/PodcastCard.tsx` 173 行、`app/(app)/podcast/page.tsx` 235 行、`app/(app)/podcast/[id]/page.tsx` 455 行、`app/(app)/feed/page.tsx` 615 行）
- production ≈ 140 行: `PodcastCard.tsx` の props 分岐 ≈ 40、podcast 2 page の `decodeEpisode` 化 ≈ 40、`feed/page.tsx:17` の置換 ≈ 10、`lib/catalog/failureMessage.ts` ≈ 25、`lib/catalog/rateLimitScope.ts` ≈ 25。
- test ≈ 140 行: `PodcastCard.test.tsx`（188 行）＋ podcast 2 page テストの種別 4 行 ≈ 80、`failureMessage.test.ts` ≈ 30、`rateLimitScope.test.ts` ≈ 30。
- 合計 ≈ 280 行。

## 前提・着手条件
- 依存 slice: **W-S2c** の web PR が main に merge 済み（`lib/playback/coordinator.ts` の `decodeEpisode` / `isPlayable`・`nowPlaying()`・`PlaybackProvider` が存在し、旧再生実装が無い）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- **backend 契約が main にあること**（PR 番号ではなく契約で判定）: backend B-S0b が merge 済みで、`GET /podcasts/{id}` の `error_message` が `generation_failed` / `partial_failed` / `quota_exhausted` / `null` の 4 値しか返さない（backend `api/schemas.py` の `PodcastResponse.from_podcast` と `tests/test_api_podcasts.py::test_get_podcast_returns_failure_kind_not_internal_text` を親 main の backend submodule で確認）。**未 merge なら着手しない**。
- Selection Gate 依存なし（SG-FK = FK-a は backend 側で確定済み）。
- 棄却済み案（再提案しない）: `error_message` の構造化（code + detail。backend Spec rejected_overdesign）、`Episode` 型を DTO 世代で分けること（Spec §3.2 G4: optional field は `PlayableEpisode` の任意付加物）。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
1. **`Episode` の UI 展開**（Spec §3.2）: `components/PodcastCard.tsx` の props を `Episode` 種別で分け、▶は `PlayableEpisode` にしか付かない。`app/(app)/podcast/page.tsx`・`app/(app)/podcast/[id]/page.tsx` は DTO を `decodeEpisode` で `Episode` に読んでから描く（`status` / `audio_url` / `error_message` の直接判定を page から消す）。矛盾 DTO（`completed` かつ `error_message` 非 null 等）は `FailedEpisode` として表示され▶が付かない（PS-07 の UI 側）。
2. **`error_message` 4 値の文言写像**（新規 `lib/catalog/failureMessage.ts` 相当の純関数 1 つ）: `generation_failed` / `partial_failed` / `quota_exhausted` / `null` → 日本語文言。`FailedEpisode.errorMessage` はこの識別子を保持し、文言化は表示側の 1 関数だけが行う。識別子以外の値（B-S0b 前の自由文が残る doc）は `generation_failed` と同じ文言に倒す（fail-closed。ADR-102 の RO-c「識別子の生表示を短期間許容」の期間が終わった後の扱いで、表示は識別子・自由文とも同じ）。
3. **`rate_limited.scope` の集約**（Spec §3.2 LF2）: `/monthly/i` regex と `retryAfterSeconds > 86400` の ADR-073 フォールバック規則（現状 `app/(app)/feed/page.tsx:17` の 1 箇所）を `lib/catalog/` の純関数 `rateLimitScope(detail, retryAfterSeconds) → 'monthly' | 'daily' | 'unknown'` に置き、feed page はそれを呼ぶ。W-S1 の gateway が `ApiFailure.rate_limited.scope` を既に埋めている場合は、その判定をこの純関数へ移して gateway から呼ぶのではなく（`lib/api/gateway.ts` → `lib/catalog` の依存は §12.1 の方向に反する）、gateway 側は判定を持たず `scope` を呼出側（Catalog）が確定する形にする。利用者に見える差は無い。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T11（UI 側） | `Episode` 判別共用体を `PodcastCard` / `podcast` pages が使い、▶は `PlayableEpisode` にしか付かない | T-T11（UI 側）: `tests/components/PodcastCard.test.tsx`・`tests/app/podcast/page.test.tsx`・`tests/app/podcast/id/page.test.tsx` で種別 3 ＋ 矛盾 DTO 1 の表示分岐。テスト名に `PS-07` を含める |
| — | 4 値それぞれの文言 | `tests/lib/catalog/failureMessage.test.ts`（表駆動 4 行 ＋ 自由文 1 行） |
| — | scope 規則 | `tests/lib/catalog/rateLimitScope.test.ts`（monthly 文言・86400 超・それ以外の 3 行。`tests/app/feed/` の既存テストが regression の oracle） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。
- T-T11（UI 側）が `verifies: CI-T11` と `PS-07` をテスト名またはコメントに持つ。
- **▶の付く条件が 1 箇所**（量化する集合 = `components/` `app/` の `.tsx` 全ファイル）: `status === 'completed'`・`audio_url` の空判定・`error_message` の null 判定を再生可否の意味で行う箇所が `lib/playback/coordinator.ts`（`isPlayable`）以外に 0 件（`grep -rn "status === 'completed'\|audio_url\b" app components --include='*.tsx'` の全出現を PR 説明に列挙し、残る出現が「表示用の badge・文言」であって再生可否の判定ではないことを示す）。
- 4 値それぞれに対応する日本語文言があり、識別子以外の値でも例外にならず `generation_failed` の文言になる。
- `/monthly/i`・`86400` の出現が `lib/catalog/` の 1 ファイルだけ（`grep -rn "monthly/i\|86400" app components hooks contexts lib | grep -v '^lib/format\.ts:33:'` が `lib/catalog/` の 1 ファイルの行だけ。除外は `lib/format.ts:33` の日数換算 1 行のみ）。
- 既存の page tests（`tests/app/podcast/`・`tests/app/feed/`）が、`Episode` 種別に応じた props 変更以外は変更なしで green。

## 禁止事項 / scope 外
- `PreferencesRegistry`・`AppContext` の解体（W-S4b）、`PasswordPolicy`・`AuthSession`（W-S4c）、`lib/api` の context 別取り込みと page 側注入点の移行（W-S4d1）・TP1 削除（W-S4d3）は行わない。`createApiClient()` の呼出箇所を変えない。`tests/app/podcast/*`・`tests/app/feed/` の `vi.mock('@/lib/api')` は本 slice では残す（W-S4d2a が gateway double へ移す）。
- backend の `error_message` の型・値域を変えない。表示文言を backend に求めない（FK-a）。
- 生成状態の遷移検知（`detectCompleted`）とポーリング停止条件の単一所有（Spec §3.2 UC-S1）は本 slice の対象外（学習サイクルの別 order）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/components/PodcastCard.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/feed/`、`tests/lib/playback/coordinator.test.ts`（CI-T11 の decode 側 16 行）。

## 検証
`npm test`、上記 grep 2 種、`npm run build`。

## 記録
- 完了時、共有仕様 §4.4 PS-07 の web 保留（解除条件 = 旧 W-S4 = 本 slice）を解除できる旨を親 docs へ返す（web-design §12.5 の W-S4 行は W-S4a と読み替える。親 plan・web-design §12.3 の W-S4 行の分割は router が反映）。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.2・§4（CI-T11）・§5（CP5）・§6（S4 行）
- 親 docs: ADR-102、web-design §12.1（Catalog）・§12.5、共有仕様 §4.4 PS-07・§6.6
