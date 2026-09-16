# T5 敵対的検証レポート（independent_evaluator）

判定: **partially_accepted**（RF5・RF7・RF12/§4.4 に RC1 相当の実測誤り。他は反証失敗）
独立性: 他票（T1-T4 package）のレポートは判定に使用せず、report §4 の主張のみを対象に自分で grep/read した。

## 1-3. 主張別 verdict

| # | 主張 | 反証試行（自分で読んだ根拠 path:line） | verdict | severity 妥当性 |
|---|---|---|---|---|
| T1 | §2.1 AI 復唱が依頼と一致（proposed_status: matched, differences: []） | 依頼=「設計を徹底レビュー」+ Markdown in docs/ + primary=maintainability。成果物は `docs/research-reports/2026-09-16-code-design-review.md` で条件充足。ただし §4 は「優先品質順」と宣言しながら §4.1 に QL4(constraint) の RF1-RF4 を先頭配置し、primary の QL1/QL2 は §4.2。`differences: []` は過小申告 | **WEAKENED** | 依頼漏れ・スコープ逸脱(RC7)は無し。差分欄に「constraint 先頭配置」を記載すべき |
| T2 | RF1 失効時に SW キャッシュ消去経路が無い | `contexts/AuthContext.tsx:59-63`（catch は setUser/setStatus のみ）。`clearManagedServiceWorkerCaches` の呼出は全 repo で `AuthContext.tsx:98`（logout）のみ、`deleteAllAudio` は加えて `settings/page.tsx:140`（手動削除）のみ。`public/sw.js:50-61` の catch が cache を返す／`:79-87` で navigate と `/api/backend/podcasts` を格納、key は URL のみ。反証（別の消去経路／主体付き key）は見つからず | **CONFIRMED** | blocker 妥当（未知は U5 共有端末実態のみ） |
| T2 | RF2 API key 欠落で fail-open・env 名露出 | `route.ts:66-72`（`if (apiKey)` のみ、欠落でもそのまま fetch）vs `:53-58`（BACKEND_BASE_URL 欠落は 500＋本文に変数名）。非対称は実在 | **CONFIRMED** | major 妥当 |
| T3a | RF3 降格（blocker→major）: 取得は `authenticated && isAdmin` で guard | 4 ページ全て確認: users `86-98`/load `37-41`、invites `142`/load `72-76`、metrics `70`/load `64-68`、featured-sites `207`/load `65-69`。`(app)/layout.tsx:12-21` に gating 無し、`middleware.ts` 不在。`unknown` 中もシェルは描画されるが一覧は空。**追加反証**: unknown 中でも mutation は到達可能（`admin/users/page.tsx:43-65` handleCreate はフォームから送信可能、`handleDelete`/`handleToggleRole` は行が無く到達不能）。ただし送信は BFF→backend の require_admin で拒否され、UI へは文言のみ。データ漏洩経路は作れなかった | **CONFIRMED**（降格は妥当） | major 妥当。ただし「データ取得は guard」だけでなく「mutation ハンドラは到達するが fail-closed」を降格理由に明記すべき（現文は mutation に言及なし） |
| T3b | RF4 minor: 細工 segment で別 host / 意図外 path へ到達しない | `route.ts:39-40`（join）・`:63`（`baseUrl.replace(/\/$/,'')+'/'+path+search`）。host 部は env 由来で文字列前置のため置換不能（`..` は URL 正規化で host より上へ行けない）。**唯一の残余**: `BACKEND_BASE_URL` が path prefix 付き（例 `https://h/api/v1`）の場合、`..` segment で prefix 外の path クラスへ到達しうる。現行設定値は未確認（.env は非追跡） | **WEAKENED** | minor は妥当だが「host 固定」だけでは不十分。「baseUrl が path prefix を持たない」ことが未検証前提（前提台帳に無い） |
| T3c | RF17 は HTML 仕様の default playback start position により moot か | `hooks/useAudioPlayer.ts:205-207`（src 代入直後に currentTime 代入＝readyState HAVE_NOTHING）・`:153-159`（loadedmetadata は超過時 0 のみ）を確認。本ロールに WebFetch/WebSearch が無く仕様条項を引用できない | **UNVERIFIABLE**（ツール不在） | 仕様条項が確認できれば RF17 は finding ではなく観測記録へ降格すべき。現状の「minor + evidence_status: inferred + UV3」は許容範囲 |
| T3d | RF20 `/_audio-podcast/` は fetch event にならない | `lib/audioCache.ts:40`（key 生成）・`84` put・`91` match・`118` delete のみ。全 repo grep で `/_audio-podcast/` を fetch/navigate する箇所なし。Cache API の put/match は fetch event を発火しない。加えて `sw.js:63-89` の分岐（`/_next/static/`・navigate・`/api/backend/podcasts`）のいずれにも該当しない | **CONFIRMED** | minor（記録のみ）妥当 |
| T3e | §4.4 conformance alias が退化 oracle でない | `tests/lib/playbackQueue.conformance.test.ts:226-232,241-246,268-277` の期待値 [c,b,d]／[c,d,b]／[b,a,c] が `docs/design/shared-playback-spec.md:226,228,232` の行と完全一致。`lib/playbackQueue.ts:103` は onMove（削除前オフセット）を実装、spec:90,106 の正本意味論と一致 | **CONFIRMED** | 退化 oracle ではない。§4.4 の判断は成立 |
| T2 | RF5 「404=未蓄積 5 ファイル 5 箇所」「規則の重複」 | 実測は **4 ファイル 5 箇所**（`feed/page.tsx:234,318` が同一ファイル）。さらに意味が 3 種に分かれる: `settings:75-77`=エンドポイント未実装の graceful degradation、`admin/metrics:51-54`=スナップショット未生成(ADR-075 E1)、`podcast/[id]:59`=エピソード不在、`feed:234,318`=記事 doc 消失。「同一ルールの 5 重実装」ではない。429 regex は `feed/page.tsx:15-20` の 1 定義・同一ファイル内 2 利用（`:241,:388`）で他ファイルへの波及なし、かつ `:12-14` に ADR-073 の意図的フォールバック戦略と明記。パスワード政策の 2 実装（`AccountSection.tsx:17-38` / `signup/page.tsx:16-43`）のみが「複数ファイル同期修正」を実証 | **WEAKENED** | major の根拠 4 件中 2 件（404・429）が主張を支えない。R4(transport 値露出=RF6) と混同。severity 据置なら根拠の書き換えが必要 |
| T2 | RF6 失敗の意味が transport 値のまま UI へ | `lib/api.ts:47-57`(ApiError)・`:85`(`new ApiError(0,'Network error')`)・`:110-112`(retryAfterSeconds)・`:118`(`undefined as T`)。UI 側ラダー: `feed:234-241`、`podcast/page.tsx:66-68`（`エラーが発生しました (${err.status})`）を実見。反証（lib 側に意味変換層がある）を探したが `lib/` に該当モジュールなし | **CONFIRMED** | major 妥当 |
| T2 | RF7 現在 Podcast/速度/位置の owner が一意でない | 一意でない点は確認: `AudioPlayerContext.tsx:90`(SET_PODCAST) / `lib/playbackQueue.ts:18-21` / `hooks/useAudioPlayer.ts:94,197`、速度は `AppContext.tsx:15,45-46` と `useAudioPlayer.ts:237-240`(audio.playbackRate のみ、state 無し) を `AudioPlayerBar.tsx:24-26` の eslint-disable effect が橋渡し。**ただし「位置は reconciliation 規則なし」は自身の引用 `lib/playbackPosition.ts:25-37` に反する** — server>0→server、local>0→local の純粋関数が存在し `AudioPlayerContext.tsx:87` で production 経路上にある | **WEAKENED** | major は維持可（速度・現在 Podcast は成立）。位置の記述は「読み出し規則は存在／書き込みが二重（`useAudioPlayer.ts:126,140`）」へ訂正必要 |
| T2 | RF8 再生状態が 4 atom・error/ended/pause が潰れる | `useAudioPlayer.ts:25-30`(4 atom)・`:148-151`(handleError は isPlaying=false のみ)・`:132-146`(handleEnded も同じ)・`:212-216`(play() の reject を捕捉せず)・`:224-235`(seek は clamp 無し / seekRelative は clamp) をすべて実見。反証（別の状態型が存在する）は見つからず | **CONFIRMED** | major 妥当 |
| T2 | RF9 Provider が業務ルール置き場・'unavailable' を network と同一視 | `lib/resolvePlayback.ts:15,26`（`unavailable` を返す）→ `AudioPlayerContext.tsx:104` の `if (source !== 'cached') return null` で吸収 → `:116` の getPodcast がオフラインで throw → `:119` で `再生できませんでした (0)`。`:112-123` vs `:143-161`、`:126-133` vs `:192-196` の重複、`:6` の Toast 依存も実見 | **CONFIRMED** | major 妥当 |
| T2 | RF10 非 ok 応答の cache.put 等 | `lib/audioCache.ts:68-71`（`fetch` 結果を ok 検証なしに put）・`83-84`（`audio_url:''` 永続化）・`88-94`・`106-111`（isCached は audioKey の有無のみ）・`137`（`response!`）・`99-104`（blob 発行のみ、revoke は `useAudioPlayer.ts:171-172,192-194`）。対照 `public/sw.js:44,54` の ok 判定も一致 | **CONFIRMED** | major 妥当。補足: 403 が保存されるには署名 URL 側が CORS 応答を返す必要（`fetch` は既定 mode:'cors'）＝到達条件が 1 つ未検証 |
| T2 | RF12 network seam 欠如／「34 箇所 19 ファイル」 | seam 欠如は CONFIRMED（`lib/api.ts:124` は無状態 factory、注入点なし）。**実測が誤り**: `createApiClient()` の出現は 38（うち定義 1）＝**呼出 37／19 ファイル**。verification-run.md §7a の内訳表は `app/(app)/vocabulary-test/page.tsx` の 4 箇所（`:55,102,407,440`）を丸ごと欠落させ、逆に定義行 `lib/api.ts:1` を call site に算入している。§4.4 の「実測 34/19（定義行含め 38/21）」も 20 ファイル（`lib/passkey.ts:10` は型でなくコメント言及）で不一致 | **WEAKENED**（結論は維持・数値は誤り） | major 妥当。RC1（未確認転記）に触れる: Explorer 値 60/21 の「訂正」自体が誤り |
| T2 | RF13 テストが production 経路を迂回 | `tests/integration/` は 1 ファイル（AccountSection-password-422.test.tsx）✓、`vi.mock('@/lib/api'` は 24 ファイル✓、`toHaveBeenCalled` 273✓、e2e 4 本すべて `page.route` 使用（13/8/10/12 回）✓。conformance が非退化なのも T3e で確認 | **CONFIRMED** | major 妥当 |
| T2 | RF18 `Q.start`/`Q.setQueue` は production 未使用 | `app/ components/ contexts/ hooks/` の grep で `Q.start`/`Q.setQueue` の呼出ゼロ（`AudioPlayerContext.tsx:141` はコメント、`:49-53` は React の useState setter）。`lib/playbackQueue.ts:7-12`（不変条件が型に無い）・`:30-39`（未使用 export 本体）も一致 | **CONFIRMED** | minor 妥当 |
| — | RF16 / RF19 / RF21 / RF22 | not reached within turn budget | **UNVERIFIABLE** | 未判定 |

## 4. rejection criteria RC1-RC7（task 2 で未読の引用を中心にサンプル）

チェックした引用: **34 件 / 誤り 3 件**（うち §4 本文の数値・件数誤りが 2、自己矛盾が 1）
- 正しかった引用（抜粋・自分で開いて確認）: `AppContext.tsx:60`(raw dispatch 公開)・`:92`(speed>0 検証)・`:45-46`・`:127`、`settings/page.tsx:352`(dispatch SET_SPEED を UI から直接)、`app/layout.tsx:45-49`(inline script の生 'theme')、`dashboard/page.tsx:48,65`(生 'seen_achievement_ids')、`ConfirmDialog.tsx:40-47`・`LoginModal.tsx:95-96`・`OnboardingSourcesModal.tsx:27`(modal shell 3 重)、`AccountSection.tsx:412,547,678`(確認 UI 3 重)＋722 行、`feed/page.tsx` 615 行、`playbackQueue.ts:7-12,30-39`、`playbackPosition.ts:25-37`、`resolvePlayback.ts` の 'unavailable'、`sw.js:16-24,70-72` と `swCacheCleanup.ts:6-14,21` の prefix 二重定義。
- 誤り 1（RC1・verification gate）: RF5「404=未蓄積 **5 ファイル** 5 箇所」→ 実際は 4 ファイル 5 箇所、かつ 3 種類の別ルール。
- 誤り 2（RC1・verification gate）: RF12/§4.4 の createApiClient 実測（34/19・38/21）→ 正しくは呼出 37/19（`vocabulary-test/page.tsx` 欠落、定義行の混入）。verification-run.md §7a の内訳表が原因。
- 誤り 3（自己矛盾）: RF7「位置は…reconciliation 規則なし」が自身の引用 `lib/playbackPosition.ts:25-37` と矛盾。
- RC2: `npm overrides による TS 固定` の再提案は §4・§7 のいずれにも無し（`docs/trial-log/typescript7-eslint-coexistence.md` の棄却済み案）。RF21 も「ゲート追加は運用判断」に留め overrides に触れない → **合格**。
- RC3: §7 で `decision.status: pass` / `artifact_readiness: ready` と `subject_verdict_summary`（incomplete/insufficient/leaky）を別 key で保持 → **合格**。
- RC5: §2.1 の `reviewed_by` は `unresolved` のまま T5 に委ねており自己証明していない → **合格**。
- RC6: 将来用抽象の推奨なし（RF12 は「port は 1 実装でも許容、factory/Strategy 階層は不要＝RO1 棄却」と明記）→ **合格**。
- RC7: backend 契約・意匠を finding 化していない（RF3 の require_admin は前提扱い＋residual_risks に明記）→ **合格**。
- RC4: 分母/分子（契約 53、test 26、applicable 62/present 9、要件 8）は記載あり → 形式は合格（分母の正しさ自体は未検証）。

## 5. 新規候補（confirmed finding ではない・最大 5）

1. **候補 N1**: `app/(app)/vocabulary-test/page.tsx:55,102,407,440` が §4 のどの finding の Evidence にも現れない（createApiClient 直呼び 4 箇所・615 行級の page）。RF12/RF14 の母集団から漏れている可能性。
2. **候補 N2**: `lib/api.ts:117-118` の `return undefined as T` は 204 だけでなく **204 以外の空 body** を救わない一方、型上は全 caller が非 undefined を仮定。RF6 は CI-A04 として触れるのみで、caller 側の未防御（例 `AccountSection` の戻り値利用）は未調査。
3. **候補 N3**: `contexts/AuthContext.tsx:119-123` の初期 `refreshMe` は `state.isRestoring` に依存し、AppContext の restore が失敗/遅延すると `unknown` が永続する。RF3 の「unknown 中の描画」の発生確率に直結するが、前提台帳・finding いずれにも記載なし。
4. **候補 N4**: `app/(app)/admin/users/page.tsx:46` のクライアント側パスワード検証は `newPassword.length < 8`。`AccountSection.tsx:17`/`signup/page.tsx:16` の `PASSWORD_MIN_LENGTH = 12` と不一致＝**3 つ目のパスワード規則**。RF5 は「2 実装」としており過小。
5. **候補 N5**: `lib/audioCache.ts:69` の `fetch(podcast.audio_url)` は `lib/api.ts` の `request()` も SW も通らない第 3 の network 経路（RF19 は `reportClientError.ts:22` のみを第 2 経路として挙げる）。

```yaml
reviewed_by:
  kind: independent_evaluator
  identity: adversarial-verifier (T5)
  review_status: partially_accepted
  scope_accepted: [RF1, RF2, RF3, RF6, RF8, RF9, RF10, RF13, RF18, "§4.4 conformance alias 判断", "RC2/RC3/RC5/RC6/RC7 合格"]
  scope_rejected_or_weakened:
    - RF5（「5 ファイル」は 4 ファイル・404 の意味が 3 種で「同一ルール重複」を支えない・429 は単一ファイル内 1 定義かつ ADR-073 の意図的設計）
    - RF7（「位置の reconciliation 規則なし」は lib/playbackPosition.ts:25-37 と矛盾。速度・現在 Podcast の主張は維持）
    - RF12 と §4.4（createApiClient 実測 34/19・38/21 が誤り。正しくは呼出 37 / 19 ファイル。vocabulary-test 欠落）
    - RF4（「host 固定ゆえ無害」は BACKEND_BASE_URL に path prefix が無いことを未検証前提にしている）
    - §2.1（differences: [] は過小。primary=maintainability に対し §4 先頭が QL4 constraint）
    - RF17（UNVERIFIABLE: 仕様条項を引用できるツールが本ロールに無い）
    - RF16 / RF19 / RF21 / RF22（UNVERIFIABLE: not reached within turn budget）
  evidence:
    - contexts/AuthContext.tsx:59-63,98
    - app/api/backend/[...path]/route.ts:53-58,63,66-72
    - app/(app)/admin/{users:37-41,86-98 | invites:72-76,142 | metrics:64-68,70 | featured-sites:65-69,207}
    - app/(app)/settings/page.tsx:75-77 / admin/metrics/page.tsx:51-54 / podcast/[id]/page.tsx:59 / feed/page.tsx:234,318
    - app/(app)/feed/page.tsx:12-20,241,388 / components/ui/AccountSection.tsx:17-38 / app/signup/page.tsx:16-43 / app/(app)/admin/users/page.tsx:46
    - lib/playbackPosition.ts:25-37 / hooks/useAudioPlayer.ts:126,140,205-207,153-159,237-240 / components/AudioPlayerBar.tsx:24-26
    - lib/audioCache.ts:40,68-71,83-84,137 / public/sw.js:44,54,63-89
    - app/(app)/vocabulary-test/page.tsx:55,102,407,440（review 未収載）
    - tests/lib/playbackQueue.conformance.test.ts:226-232,241-246,268-277 vs docs/design/shared-playback-spec.md:226,228,232,90,106
    - docs/trial-log/typescript7-eslint-coexistence.md（overrides 棄却の確認）
```
