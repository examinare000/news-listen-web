## web リファクタ W-S4d: `lib/api` の context 別取り込み・page 側注入点の移行・TP1 削除（学習機能サイクルで着手）

## 概要
旧 W-S4 を context 境界で分けた 4 つ目（最後）。W-S1b のリソース単位 10 ファイルを `lib/<context>`（Playback / Catalog / Account / Preferences / Admin / Learning / Notifications）が取り込む 2 段階の 2 段目を行い、page 側の `createApiClient()` 呼出を `ApiClientProvider`（W-S1）経由の gateway 呼出（`Result` / `ApiFailure`）へ移行し、TP1（`ApiError` 互換 adapter）を削除する。失効の検知点を「`getMe` だけ」から「任意 API の `unauthorized`」へ一般化する（共有仕様 §6.5）。正本は Implementation Spec §2（依存方向・prohibited_structures「`app/` は `ApiError.status` や `localStorage` を直接参照しない」）・§4 冒頭（失敗の表現・eslint で数値 status の分岐を禁止）・§6 S1 行（TP1 の削除条件）・S4 行、親 docs web-design §12.1・§12.2「注入点」行・§12.3 W-S1 / W-S1b / W-S4 行。**検証モード: 再設計しない**。新しい契約 ID は作らない。

本 slice は 4 つの中で最も大きい（page 側 15 ファイル・37 箇所と `vi.mock('@/lib/api')` を使うテスト 25 ファイル。2026-09-23 実測）。機械的な移行だが、レビュー時に context ごとのコミット分割を提示する。W-S4a〜c を先に終えるのは、同じ page（`podcast/`・`feed/`・`settings/`・`admin/users/`・`signup/`）を触る変更を分離し、TP1 削除の前提（`contexts/` の `ApiError` 依存が W-S4c で消える）を揃えるため。

## 前提・着手条件
- 依存 slice: **W-S1b**（`lib/api/{feed,articles,podcasts,settings,users,vocabulary,health,auth,admin,notifications}.ts` の 10 ファイル）と **W-S4a / W-S4b / W-S4c** の web PR がすべて main に merge 済み、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- W-S5 との順序は不定。W-S5 が先なら `AuthProvider` の回収・`subjectCleanup` の発火条件を変えずに gateway 化する。
- Selection Gate 依存なし。
- 棄却済み案（再提案しない。Spec §5）: `createApiClient` factory の階層化（RO1）、`lib/api.ts` の削除を W-S1b で行うこと（本 slice で行う）。
- `docs/trial-log/` を最初に読む。着手前に次を記録する（2026-09-23 実測値は参考。着手時に数え直す）:
  ```
  grep -rn 'createApiClient()' app components hooks contexts lib | wc -l     # 実測 38 行（W-S1 後は AudioPlayerContext の 4 が減り、W-S2c 後はそのファイル自体が無い）
  grep -rln "ApiError" app components hooks contexts lib | sort              # 実測 13 ファイル（W-S2c 後 12。W-S4c 後は contexts/ が消え app 7・components 3・lib/api.ts）
  grep -rln "vi.mock('@/lib/api'" tests | wc -l                              # 実測 25 ファイル
  ```

## 対象（web サブモジュールのみ）
1. **`lib/<context>/` の取り込み**: 各 context が必要なリソース関数を `lib/api/<resource>.ts` から取り込み、`Result` を返す形で公開する（Playback は W-S2a で注入済み。Catalog = feed / articles / podcasts / settings(sources・featured・onboarding)、Account = auth、Preferences = settings(preferences)、Admin = admin、Learning = users / vocabulary / podcasts(quiz)、Notifications = notifications、health は Platform）。`lib/<context>` は `fetch` を import せず `ApiGateway` port 経由（Spec §2）。
2. **page 側の注入点移行**（量化する集合 = 着手時の `createApiClient()` 呼出全行）: `app/`・`components/`・`hooks/` の呼出を `ApiClientProvider` から得た gateway ＋ `lib/<context>` の関数へ替え、失敗は `ApiFailure.kind` で分岐する。`ApiError.status` の数値分岐・`instanceof ApiError` は消す。文言は hook / page 側の写像（`kind` → 日本語）に集約する（Spec §3.1「UI 文言は hook 側で写像」）。
3. **失効検知の一般化**（共有仕様 §6.5「失効の検知点は 1 箇所: `getMe` / 任意 API の `unauthorized`」）: gateway の `Result` が `unauthorized` を返したとき `AuthProvider`（W-S4c）の遷移②（`authenticated → anonymous`）を 1 箇所で発火する（`ApiClientProvider` が `onUnauthorized` を `AuthProvider` から受ける、等。形は実装が決める）。トークン無しの 401（ログイン失敗・SL-05）では発火しない。
4. **TP1 の削除**: `lib/api.ts` の `ApiError` と互換 adapter（W-S1b で `lib/api/legacyRequest.ts` へ移してある場合はそのファイル）を削除する。`createApiClient()` と `lib/api.ts` を削除し、`lib/api/` には `gateway.ts` と 10 リソースファイルだけが残る。
5. **eslint**: Spec §4 冒頭「呼出側が `kind` 以外（数値 status）で分岐することを eslint ルールで禁止」を `eslint.config.mjs` に加える（`no-restricted-properties` で `.status` の参照を `lib/api/gateway.ts` 以外で禁止。W-S2c の T-T7b と同じ仕組み）。CI での実行は W-S3 の `lint-test` ジョブに含まれる。
6. **テスト**: `vi.mock('@/lib/api')` を使う 25 ファイルを gateway double（`ApiClientProvider` に注入する fake `request`）へ移植する。oracle（表示文言・呼出の有無）は変えない。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T12 | 失敗は `Result` の `ApiFailure`（W-S1 で gateway 側は満たし済み） | 本 slice は呼出側の移植: 各 page テストで `ApiFailure{kind}` を注入し、文言が現行と同じであることを pin |
| CI-T15（検知点） | 任意 API の `unauthorized` で遷移②が 1 回発火し、ログイン失敗の 401 では発火しない | `tests/contexts/AuthProvider.expiry.test.tsx` に 2 行追加（`SL-05` をテスト名に含める） |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 4 本 green（変更なし。`page.route` の stub は HTTP 応答なので gateway 化の影響を受けない）。
- **`createApiClient()` の呼出 0 件**、**`ApiError` の出現 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/` `lib/` `tests/` `e2e/`。除外なし）。`lib/api.ts`・`lib/api/legacyRequest.ts` が存在しない。
- **`app/` から `ApiError.status`・`.status` 数値分岐・`localStorage` の直接参照 0 件**（`localStorage` は W-S4b の完了条件を維持。`.status` は `grep -rn "\.status\b" app components hooks` の全出現を PR 説明に列挙し、残る出現が `Podcast.status`（生成状態）等の DTO field であって HTTP status ではないことを示す。eslint ルールは HTTP status の識別子に限定して負例で確認）。
- `lib/<context>/` が `fetch` / React / `localStorage` / `caches` / `Audio` を import しない（`grep -ln "from 'react'\|fetch(\|localStorage\|caches\.\|new Audio" lib/catalog lib/account lib/preferences lib/admin lib/learning lib/notifications` が 0）。
- 失効検知: 認証済みで任意 API が `unauthorized` を返すと遷移②が 1 回だけ発火し、W-S5 の `subjectCleanup`（merge 済みなら）または W-S0 の cleanup が 1 回走る。ログイン失敗の 401 では走らない（SL-05）。
- 表示文言が変わっていない（各 page テストの文言 assertion を変えずに green。変わる箇所があれば PR 説明に列挙し理由を書く）。

## 禁止事項 / scope 外
- backend の API・BFF（`app/api/backend/[...path]/route.ts`）を変えない。
- `lib/api/gateway.ts`（W-S1）の契約を変えない。10 リソースファイル（W-S1b）の関数名・URL を変えない。
- 表示文言を変えない。新しい業務条件を足さない。
- `Episode` の UI 展開（W-S4a）・`PreferencesRegistry`（W-S4b）・`AuthSession`（W-S4c）の設計を変えない（本 slice はそれらの gateway 化だけ）。
- Learning の model 化（`lib/learning/` の 3 ルール・StreakContext の副作用移動）は行わない（保留 learning）。

## 特性テスト（baseline）
`vi.mock('@/lib/api')` を使う 25 ファイル（着手時に列挙）、`tests/lib/api.*.test.ts` 6 ファイル（W-S1 で Result 形式へ移植済みのもの）、`tests/contexts/AuthProvider.*.test.tsx`、e2e 4 本。

## 検証
`npm test`（件数が着手前と同数以上）、上記 grep 3 種、`npm run lint`（`.status` 分岐の負例確認を含む）、`npm run build`、`npm run test:e2e`。

## 記録
- 完了後、親 docs web-design §8（API クライアント設計）・§12.2「注入点」行・§12.3 W-S1 / W-S1b / W-S4 行を現状記述へ書き換える対象として README に印を付ける。TP1 の削除日を PR 説明に残す。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §2（依存方向）・§4 冒頭（失敗の表現）・§5（CP6・rejected_overdesign）・§6（S1 行 TP1・S4 行）
- 親 docs: web-design §12.1・§12.2（注入点）・§12.3、共有仕様 §6.5（失効の検知点）・§4.4 SL-05
- レビュー: `docs/research-reports/2026-09-16-code-design-review.md` §8.2（SG5）、`verification-run.md`（`createApiClient` 呼出箇所の erratum）
