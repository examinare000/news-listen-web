## web リファクタ W-S4: Catalog / Preferences / Account の残作業（学習機能サイクルで着手）

## 概要
`Episode` 判別共用体の UI 展開、設定レジストリの一本化、`rate_limited.scope` の単一所有、パスワード規則の統一、backend の `error_message` 4 値の文言写像、`lib/api` の context 別分割と page 側注入点移行をまとめて行う。正本は user 承認済みの Implementation Spec `docs/design/2026-09-16-implementation-spec-domain-model.md`（§3.2 Catalog・§3.3 Account・§3.4 Preferences・§4 CI-T11(UI側)/T17・§5 CP8・§6 S4 行）。本タスクは**承認済み指示書に従う実装**であり、analyze_order は検証モード（新規設計をしない）。generate_spec の spec.md は Spec の該当契約（CI-T11 UI 側・CI-T17）の抜粋で足りる。

着手順（W-S2c に依存。学習機能サイクルで着手。backend B-S0b / S0c（完了）の merge が別途必要）。

## 前提・着手条件
- 依存 slice: W-S2c（`Episode` 判別共用体・`nowPlaying()` が存在し、旧再生実装が削除済みであること。W-S1b の `lib/api/<resource>.ts` 10 ファイルが存在すること）が main に merge 済みであること。
- **着手条件**: backend の B-S0b / S0c（`PasswordPolicy` 12〜20 文字の ADR-101、`error_message` 識別子 4 値の ADR-102）が main に merge 済みであること。この着手条件が満たされるまで本 slice に着手しない。
- Selection Gate 依存なし（本 slice の項目は SG7 で確定済み）。
- **SG7（パスワード長、user 2026-09-16 確定）**: 統一値は**12〜20 文字**（親 docs ADR-101）。Implementation Spec 本文 §3.3 に残る「8〜20 文字」の記述は、backend 決定で差し戻された旧値であり**採らない**。文字種規則は現行 `countPasswordCharacterClasses` を維持する。
- backend のパスワード検証値・`error_message` 4 値との整合を W-S4 着手時に確認する（Spec §3.3 OB-A1・§8 unknowns）。
- 棄却済み案（再提案しない、Spec §5 rejected_overdesign）: `lib/api` の context 別 6 分割を W-S1 で行うこと（W-S1b がリソース単位に分け、本 slice が context 別に取り込む）。
- `docs/trial-log/` を最初に読み、棄却済み案を再試行しない。

## 対象（web サブモジュールのみ）
1. **`Episode` の UI 展開**: `PodcastCard` と `podcast` pages（`app/(app)/podcast/page.tsx`、`app/(app)/podcast/[id]/page.tsx`）で `Episode` 判別共用体（`PlayableEpisode`/`GeneratingEpisode`/`FailedEpisode`）を使う。`PodcastCard` の props を Episode 種別で分け、▶は `PlayableEpisode` にしか付かない（Spec §3.2）。
2. **`PreferencesRegistry`（新規、`lib/preferences/`、CP8）**: 各設定を `{ key, scope: 'local'|'server', codec(encode/decode/validate), default }` で宣言（Spec §3.4 の設定一覧: `defaultPlaybackSpeed`, `timeFormat`, `theme`, `sfxEnabled`, `seenAchievementIds`, `volume`, `default_difficulty`/`digest_*`/`weekly_goal`）。`PreferencesProvider` は `get(setting)`/`set(setting, value)` のみ公開し、raw dispatch は公開しない（CI-T17）。**TP3（temporary path）**: `app/layout.tsx:45-49` の inline theme script は import 不可のため、key 文字列と列挙を複製し、テストで一致を pin する。owner: user。導入: W-S4。削除条件: `beforeInteractive` script を module から生成できた時。
3. **`rate_limited.scope`**: `/monthly/i` regex と `retryAfter > 86400` の ADR-073 フォールバック規則を Catalog policy の 1 箇所（`lib/catalog/` 配下）に集約する（Spec §3.2、LF2）。
4. **`PasswordPolicy` の単一化**: `lib/account/password.ts` に 1 実装。長さは**12〜20 文字**（SG7・ADR-101）。現状 8 文字の `admin/users` は 12〜20 へ、現状 12 文字下限の `AccountSection`/`signup` は上限 20 を追加する挙動変更を伴う。backend の検証値（ADR-101）と一致することを確認してから統一する。
5. **`GET /podcasts/:id` の `error_message` 識別子 4 値の日本語文言写像**: `generation_failed` / `partial_failed` / `quota_exhausted` / `null` の 4 値（ADR-102）を web の UI 文言へ写像する。
6. **`lib/api` の context 別取り込み**: W-S1b のリソース単位 10 ファイル（`lib/api/{feed,articles,podcasts,settings,users,vocabulary,health,auth,admin,notifications}.ts`）を `lib/<context>`（Playback / Catalog / Account / Preferences / Admin 等）が取り込む 2 段階の 2 段目をこの slice で行う。page 側 15 ファイル・37 箇所（`docs/research-reports/2026-09-16-code-design-review/verification-run.md` erratum の内訳）を新しい context 別 gateway 呼出へ移行する。TP1（`ApiError` 互換 adapter）の削除条件（`app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時）をこの slice で満たし、TP1 を削除する。
7. **`AppContext` の解体の完了**（親 docs web-design §12.2「`AppContext` の解体」行）: `isRestoring` → `PreferencesProvider.ready`、`timeFormat` → registry（local）、`playbackSpeed`（既定速度）→ registry。残る責務が無くなるため `AppProvider` / `useApp` と `contexts/AppContext.tsx`・`tests/contexts/AppContext.test.tsx` を削除する（`currentPodcast` / `SET_PODCAST` は W-S2c で削除済み）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T11（UI 側） | `Episode` 判別共用体を `PodcastCard`/`podcast` pages が使い、▶は `PlayableEpisode` にしか付かない | T-T11（UI 側）: page/コンポーネントテストで種別ごとの表示分岐を検証 |
| CI-T17 | registry 外の key・列挙外の値は拒否／既定へ正規化。raw dispatch なし | T-T17 |

## 特性テスト（baseline）
`Episode` を扱う page tests（`app/(app)/podcast/page.tsx`、`app/(app)/podcast/[id]/page.tsx`、`components/PodcastCard.tsx` のテスト）。

## 手順
1. baseline: 該当 page tests と `npm test` / `npm run lint` / `npm run typecheck` の green を記録。backend S0b / S0c の merge 済みを確認。
2. T-T11（UI 側）→ RED → `PodcastCard`/`podcast` pages を `Episode` 種別分岐へ書き換え → GREEN。
3. T-T17（PreferencesRegistry）→ RED → `lib/preferences/` 実装・`PreferencesProvider` 置換 → GREEN。TP3（inline theme script pin テスト）を追加。
4. `rate_limited.scope` の集約 → 既存テストで regression が無いことを確認。
5. `PasswordPolicy` 単一化（12〜20 文字）→ backend 検証値との整合確認 → 該当 3 箇所（`AccountSection`/`signup`/`admin/users`）を統一実装へ置換。
6. `error_message` 4 値の文言写像 → UI テストで 4 値それぞれの表示を確認。
7. `lib/api` の context 別分割 → page 側 15 ファイルを順次移行 → TP1 の削除条件（`ApiError` import 0）を満たしたら TP1 adapter を削除。
8. 1 slice = 1 PR（ただし内容が広いため、レビュー時に論理変更単位でのコミット分割を提示する）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` すべて成功。
- T-T11（UI 側）・T-T17 が `verifies: CI-T11/T17` をテスト名またはコメントに持つ。
- `app/` から `ApiError.status` や `localStorage` の直接参照が無い（grep 0、Spec §2 prohibited_structures）。
- TP1（`ApiError` 互換 adapter）が削除され、`app/`・`components/`・`hooks/` に `ApiError` の import が無い（grep 0）。
- `PasswordPolicy` の長さ検証が 12〜20 文字の 1 実装に統一されている（`admin/users`・`AccountSection`・`signup` が同じ実装を参照）。
- backend の `error_message` 4 値それぞれに対応する日本語文言がある。

## 禁止事項 / scope 外
- パスワード長を**8〜20 文字**にしない（Spec 本文の旧値。SG7 は 12〜20 が正）。
- backend S0b / S0c の merge 前に着手しない。
- Learning（`lib/learning/`）・StreakContext の副作用移動は本 slice の対象外（S5 保留）。
- `(app)` レイアウト全体の gating はしない（S0 の Q7 決定を維持）。
- 仕様にない業務条件を足さない。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.2（Catalog）・§3.3（Account・PasswordPolicy・SG7 注記）・§3.4（Preferences）・§4（CI-T11・CI-T17）・§5（CP8）・§6（S4 行）・§8（SG7 satisfied）
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.3・§8.4（パスワード最小長の不一致）
- 親 docs: ADR-101（PasswordPolicy 12〜20 文字）、ADR-102（`error_message` 識別子 4 値）
