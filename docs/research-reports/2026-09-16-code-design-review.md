# news-listen-web コード設計レビュー（mino 設計 Skill 群・review mode）

日付: 2026-09-16 ／ 対象: `web/`（news-listen-web submodule、`main` dirty 0）／ mode: review（read-only）
成果物種別: `reproducible_development_result.mode_artifact.kind = review_result`
決定の成熟度: **proposed**（AI 生成。finding の採否・修正優先度はユーザーが所有）

> 読み方: §1〜§3 が Core（問題定義・前提・要件）、§4 が finding 一覧（優先品質順）、§5 が専門 Function package（lossless）、§6 が追跡表と検証結果、§7 が canonical decision。
> 外部知識源: `mcp__shelf__consult` は本セッションで接続失敗（timeout）のため未使用。設計原則の根拠は各 Skill の references と実コードのみ。

---

## 0. Decision frame

```yaml
decision_frame:
  mode: review
  requested_outcome: Review Result（finding・Function package・traceability・subject verdict・canonical decision）
  decision_owner: user
  routing_origin: integrated
  mutation_authorized: false   # 本文書の新規作成のみ。ソース・設定・git は不変
  in_scope: [app/, components/, contexts/, hooks/, lib/, types/, public/sw.js, tests/, e2e/, CI/lint/TS gates]
  out_of_scope: [backend 契約の妥当性, iOS, UI 意匠（15-frontend-design）, 修正実装]
  reversibility: reversible
  public_contract_change_allowed: false
  destructive_change_allowed: false
  host_platform: macos
  target_platforms: [browser(jsdom/Chromium), vercel-node]
  decision_maturity: {status: proposed, owner: user, scope: [web/], evidence_status: confirmed, approval_evidence: [], baseline_version: "", change_control: ""}
```

```yaml
method_provenance:
  source_derived_principles: [技術より先に actor/purpose/rule を確認, consumer が知る契約と内部技術の分離, code/test/scenario による検証]
  suite_operationalization: [canonical decision, Selection Gate, Requirement Catalog, 12 dimension screening, quality vocabulary]
  repository_policy: [agent-rules/11・12・70, docs/design/shared-playback-spec.md の Q-*/RT- 行 ID]
```

## 1. Problem Frame と前提監査（Core）

### 1.1 Problem Frame

```yaml
problem_frame:
  actor: web モジュールを変更する開発者（人間・AI エージェント）
  context: Next.js 16 / React 19 の SPA 的クライアント。全 page が 'use client' で useEffect から BFF proxy 経由に fetch
  desired_state: 機能追加・修正の影響範囲が読め、業務ルールの所有者が一意で、テストが production 経路を通る
  observed_barrier: 業務ルールが page/context に散在、状態の所有者が複数、API/型が単一巨大モジュール、テストが内部呼出検証に偏る
  impact: 変更のたびに複数ファイルを同期修正（例: パスワードポリシー 2 箇所、admin gate 4 箇所）、状態不整合が構築可能、緑のテストが本番経路を保証しない
problem_readiness: ready
```

技術語を除いても問題が説明できる（「ルールの所有者が一意でない」「状態の真実が複数」「テストが本番経路を迂回」）。candidate_means（モジュール分割・状態機械化・MSW 導入 等）は手段として §7 の Selection Gate に退避し、本レビューでは確定しない。

### 1.2 前提台帳

| ID | 前提 | Evidence | 反証条件 | 誤り時の影響 | status |
|---|---|---|---|---|---|
| P1 | 全 page がクライアント描画で、サーバ側 gating（middleware）は存在しない | `app/(app)/layout.tsx:12-21` に gating なし、`middleware.ts`/`proxy.ts` 不在 | middleware 追加の痕跡 | R5 の重大度が下がる | confirmed |
| P2 | 再生キューは `docs/design/shared-playback-spec.md` を正本とし、web は onMove 方式へ修正済み | spec §2.7 本文、`tests/lib/playbackQueue.conformance.test.ts:5-8` | Q-26/28/32 が red | U2 が finding に昇格 | confirmed |
| P3 | セッションは httpOnly Cookie、CSRF は JS 可読 Cookie | `app/api/backend/[...path]/route.ts:73-83`、`lib/api.ts:69-78` | backend の csrf 設定が異なる | R4/R6 の前提が変わる | confirmed |
| P4 | ログアウト時に SW 管理キャッシュは消去される | `contexts/AuthContext.tsx:92-101`、`lib/swCacheCleanup.ts:16-24` | 消去パスが到達しない | R6 の severity 上昇 | confirmed |
| P5 | セッション失効（明示ログアウト以外）時にキャッシュを消す経路は無い | `public/sw.js:26-36` は SW_VERSION 変化時のみ、`AuthContext.tsx:59-63` は状態変更のみ | 別の消去経路の発見 | R6 finding が誤り | confirmed（Completeness U1: cleanup の production call site は AuthContext.tsx:98 のみ） |
| P6 | TS7 typecheck は CI 未実行 | `.github/workflows/ci.yml` の run ステップ（T1 で再確認） | CI に typecheck:ts7 がある | R8 finding 撤回 | confirmed（verification-run.md §6: lint/typecheck(TS6)/test/e2e/gitleaks のみ） |

### 1.3 因果鎖（既存負債）

```yaml
causal_chain:
  applicability: required
  reason: 新規能力ではなく既存構造の負債
  symptom: 同一ルールの複数箇所修正、状態不整合の構築可能性、緑テストの非保証
  violated_goal_or_quality: [QL1 modifiability, QL2 testability, QL3 fault tolerance, QL4 confidentiality]
  violated_rule_or_invariant: [R1, R2, R3, R4, R5, R6, R7, R8]
  incorrect_owner_or_source: 業務ルールの owner が page/component、状態の source of truth が context/hook/queue に分散
  structural_cause: lib 層に「意味」の層（ルール・状態機械・失敗の意味）が無く、React 層が直接 transport（fetch/ApiError.status）と storage（localStorage/Cache Storage）を扱う
```

## 2. Context Packet

```yaml
context_packet:
  actors: [開発者（人間/AI）, エンドユーザー（学習者）, 管理者]
  problem: 上記 Problem Frame
  purposes: [変更容易性, テスト容易性, 再生/認証の失敗経路での安全性, 共有端末での機密性]
  success_conditions: [finding が path:line 付き, 追跡表に分母/分子, 独立評価済み, decision schema 完全]
  context:
    time_or_state: [2026-09-16, main dirty 0, next@^16.2.10 react@^19.2 typescript@^6.0.3 + typescript7 alias]
    business_background: [副業有償化は 2026-09-09 に見送り・news-listen は休止中（ユーザー memory）。本レビューは再開時の起点]
    technical_background: [BFF proxy 方式, httpOnly session + CSRF cookie, SW によるオフライン, Cache Storage 音声キャッシュ]
  terminology:
    - {term: 再生キュー, meaning: spec §2.1 の QueueState, alternative_meanings: [], evidence: [docs/design/shared-playback-spec.md §2]}
    - {term: 現在の Podcast, meaning: 再生中の Podcast エンティティ, alternative_meanings: [queue current / AppContext.currentPodcast / audio 要素の podcastId], evidence: [contexts/AudioPlayerContext.tsx:90, lib/playbackQueue.ts:18, hooks/useAudioPlayer.ts:94]}
    - {term: 認証済み, meaning: GET /auth/me が成功した状態, alternative_meanings: [Cookie が存在する状態], evidence: [contexts/AuthContext.tsx:12-16]}
  rules:
    - {id: R1, statement: 業務ルールは lib に単一所有, kind: policy, owner: user, evidence_status: inferred}
    - {id: R2, statement: 再生の不正状態を公開経路から構築できない, kind: invariant, owner: user, evidence_status: inferred}
    - {id: R3, statement: 現在 Podcast / 速度 / 位置の source of truth が一意, kind: invariant, owner: user, evidence_status: inferred}
    - {id: R4, statement: 消費者は失敗の意味を受け取り transport 値に依存しない, kind: policy, owner: user, evidence_status: inferred}
    - {id: R5, statement: 認証状態 unknown 中に保護 UI を描画しない, kind: prohibition, owner: user, evidence_status: inferred}
    - {id: R6, statement: 認証済み応答のキャッシュはセッション失効時に他利用者へ返らない, kind: prohibition, owner: user, evidence_status: confirmed（rule 12 / swCacheCleanup の WHY コメント）}
    - {id: R7, statement: テストは production 経路を通り契約に対応付く, kind: policy, owner: user, evidence_status: confirmed（agent-rules/11 :70-74）}
    - {id: R8, statement: CI は typecheck:ts7・build を独立ゲート化, kind: policy, owner: user, evidence_status: confirmed（agent-rules/70 「TypeScript v7 試験用エイリアス」節）}
  quality_lens:
    definitions:
      - {id: QL1, quality: {reference_model: "ISO/IEC 25010:2023", level: subcharacteristic, characteristic: maintainability, subcharacteristic: modifiability, standard_term: modifiability, display_name_ja: 変更容易性, source_terms_ja: [変更容易性]}, evidence: [ユーザー選択 2026-09-16]}
      - {id: QL2, quality: {reference_model: "ISO/IEC 25010:2023", level: subcharacteristic, characteristic: maintainability, subcharacteristic: testability, standard_term: testability, display_name_ja: テスト容易性, source_terms_ja: [テスト容易性]}, evidence: [ユーザー選択 2026-09-16]}
      - {id: QL3, quality: {reference_model: "ISO/IEC 25010:2023", level: subcharacteristic, characteristic: reliability, subcharacteristic: fault tolerance, standard_term: fault tolerance, display_name_ja: 障害許容性, source_terms_ja: [信頼性]}, evidence: [再生/認証の失敗経路]}
      - {id: QL4, quality: {reference_model: "ISO/IEC 25010:2023", level: subcharacteristic, characteristic: security, subcharacteristic: confidentiality, standard_term: confidentiality, display_name_ja: 機密性, source_terms_ja: [セキュリティ]}, evidence: [agent-rules/12]}
    primary_ids: [QL1, QL2]
    secondary_ids: [QL3]
    constraint_ids: [QL4]
    intentionally_not_optimized_ids: [performance（Explorer 報告に性能問題の Evidence なし）]
    tradeoff_decisions:
      - {id: TD1, statement: オフライン可用性（SW/Cache）と共有端末の機密性のトレードオフ, affected_quality_ids: [QL3, QL4], decision_maturity: {status: unknown, owner: user}, evidence: [public/sw.js:79-87, lib/swCacheCleanup.ts]}
  change_boundary:
    must_preserve: [spec Q-*/RT-* の観測挙動, BFF proxy の API key 非露出, httpOnly session]
    may_change: [lib/contexts/hooks の責務配置, テスト戦略, CI ゲート]
    must_not_change: [backend 契約, 公開 URL]
    out_of_scope: [iOS, 意匠]
  evidence:
    confirmed: [P1, P2, P3, P4, R6, R7, R8]
    inferred: [P5, P6, R1-R5]
    assumptions: []
    unknowns: [U1, U3]   # §7 に canonical record
    contradictions: []
```

### 2.1 AI 復唱

```yaml
ai_restatement:
  statement: >
    web モジュールの変更容易性・テスト容易性を主眼に、業務ルールの所有、状態の真実、失敗の意味、認証/キャッシュの機密性、テストの本番経路同一性を
    R1〜R8 の要件に正規化し、Architecture / Completeness / Contract / Boundary の 4 Function で監査して finding と obligation を返す。
    修正手段は選択せず Selection Gate に隔離する。
  comparison_basis: [ユーザー依頼文, AskUserQuestion 回答（Markdown 保存・maintainability primary）, R1-R8, change_boundary]
  proposed_status: matched
  differences:
    - "§4 は primary=maintainability を宣言しつつ §4.1 に QL4 constraint 違反を先頭配置している。理由: constraint は must-hold で primary の最適化に先行するため。primary 内の順序は QL1/QL2 → QL3"
  reviewed_by: {kind: independent_evaluator, identity: "adversarial-verifier (T5)", review_status: accepted, evidence: ["§7.1", "2026-09-16-code-design-review/t5-adversarial.md"]}   # scope・依頼一致は accepted。finding 個別の判定は §7.1
```

## 3. Requirement Catalog と rejection criteria

（各 R の actor/context/trigger/expected/prohibited/acceptance。現行挙動の分類を付す）

| ID | actor | trigger / context | expected_result | prohibited_results | 現行分類 | QL | acceptance（観測方法） |
|---|---|---|---|---|---|---|---|
| R1 | 開発者 | 業務ルール（429 月/日判定・server-star merge・パスワードポリシー・404=未蓄積）を変更 | 1 箇所の lib 変更で全 UI に反映 | 同一ルールの複数実装 | intentional-change | QL1 | grep で同一ルールの実装箇所数 = 1 |
| R2 | 学習者 | 再生 error / ended / offline | UI が状態を正しく区別 | error と pause の判別不能、completed+error_message | intentional-change | QL3 | 状態型が排他 union、不正状態のテスト |
| R3 | 開発者 | 現在 Podcast / 速度 / 位置を読む・書く | writer/reader が単一 owner を通る | 二重保持の乖離 | intentional-change | QL1/QL3 | owner 表で writer が 1 |
| R4 | UI 実装者 | API 失敗を表示 | 失敗の意味（network/unauthorized/rate-limited(+retry-after)/not-found/server）を受け取る | `status===0` 判定・regex 文言判定 | intentional-change | QL1 | UI 側に status 数値比較が無い |
| R5 | 管理者/一般 | `/admin/*` を状態 unknown で開く | 保護 UI を描画しない | unknown 中の admin UI 描画 | intentional-change | QL4 | unknown 状態のテスト |
| R6 | 共有端末の次利用者 | セッション失効後にオフライン | 前利用者の /podcasts・ページ HTML が返らない | Cache Storage からの他人データ | must-preserve（ログアウト経路）/ unknown（失効経路） | QL4 | 失効時消去経路の存在 |
| R7 | 開発者 | テストを緑にする | production 経路（request()・Provider）を通る | `@/lib/api` 全 mock の呼出検証のみ | intentional-change | QL2 | integration 層の件数、mock 率 |
| R8 | 開発者 | PR を出す | CI が typecheck:ts7 と build を独立に実行 | e2e 内の暗黙 build のみ | intentional-change | QL2 | ci.yml の run ステップ |

```yaml
rejection_criteria:   # 本レビュー成果物自体の拒否条件（decision_maturity: proposed）
  - {id: RC1, requirement_ids: [R1-R8], condition: finding に path:line Evidence が無い／Explorer 報告の未確認転記, gate: verification}
  - {id: RC2, requirement_ids: [R8], condition: trial-log 棄却済み案（npm overrides による TS 固定）を提案に含める, gate: core}
  - {id: RC3, requirement_ids: [], condition: subject_verdict と artifact_readiness の混同, gate: verification}
  - {id: RC4, requirement_ids: [R7], condition: T*（既存テスト）の coverage 分母・分子を数えていない, gate: contract}
  - {id: RC5, requirement_ids: [], condition: AI 復唱 matched を自己証明にする（独立評価未実施）, gate: core}
  - {id: RC6, requirement_ids: [R1-R3], condition: pattern 名・class 数を根拠にする／将来用抽象を推奨, gate: boundary}
  - {id: RC7, requirement_ids: [], condition: スコープ外（backend 契約・意匠）を finding にする, gate: core}
```

---

## 4. Findings（優先品質順。severity は proposed、§7 の独立評価で確定）

凡例: gate = core/requirements/architecture/completeness/contract/boundary/verification、参照 ID は §5 の各 package 内で解決する（G*=Completeness gap、IV*=不正状態、CI*=contract item、LF*=leakage、F*=Architecture finding、SG*=Selection Gate）。
実測値の出典は `2026-09-16-code-design-review/verification-run.md`。

### 4.1 Constraint（QL4 confidentiality）違反

| ID | severity | gate | finding | Evidence（path:line） | 違反 R | 参照 | required_action（obligation。手段選択は SG） |
|---|---|---|---|---|---|---|---|
| RF1 | major（初版 blocker。2026-09-16 の人間判断 §8 で降格: 端末・ブラウザ共有の利用者が存在しない） | completeness/contract | セッション失効（`/auth/me` 失敗）経路で SW 管理キャッシュ（`api-*`/`shell-pages-*`）を消す遷移が存在しない。消去は明示 logout にのみ結線。キャッシュ key は URL のみで主体を含まず、次利用者がオフラインになると前利用者の `/api/backend/podcasts` とページ HTML が返る | `contexts/AuthContext.tsx:59-63`（失効時は状態変更のみ）, `:86-104`（logout のみ cleanup）, `lib/swCacheCleanup.ts:16-24`, `public/sw.js:50-61`（networkFirst catch が cache を返す）, `:79-87`（格納対象） | R6 | G1, CI-S01, CI-S02, LF12, F2, OB-C1/OB-T1 | 失効遷移の事後条件として cleanup を契約化（OB-C1）。手段（失効時 cleanup／主体付き key／SW への一元化）は SG4 |
| RF2 | major | contract/boundary | BFF proxy が `BACKEND_API_KEY` 欠落時に無認証で転送を続行する（fail-open）。`BACKEND_BASE_URL` 欠落は 500 で停止する非対称。500 本文に環境変数名を露出 | `app/api/backend/[...path]/route.ts:66-72`, `:53-58` | R4（失敗の意味）, rule 12 :18 | CI-A20, LF10, LF11 | 両 env 欠落を同じ fail-closed 500 に揃え、本文を generic 化（2 行修正相当だが承認は人間） |
| RF3 | major（Completeness/Architecture は blocker 提案。router が降格、独立評価で降格妥当と確認） | completeness/boundary | admin 4 ページの gate が `status === 'authenticated' && !isAdmin` の否定形のみで、`unknown`／`unauthenticated` 中に管理 UI シェルを描画する。`(app)/layout.tsx` に route-level gating なし、middleware なし。**降格理由**: 一覧取得は `status === 'authenticated' && isAdmin` で guard（4 ページとも）。`unknown` 中でも作成フォーム送信（例 `admin/users/page.tsx:43-65`）は到達するが BFF→backend の require_admin（ADR-075 E1）で拒否され、UI には文言のみ。データ漏洩経路は独立評価でも構築できなかった。発生確率は `AuthContext.tsx:119-123` が `AppContext.isRestoring` に依存するため restore 遅延で `unknown` が長引く点に左右される | `app/(app)/admin/users/page.tsx:86-98,37-41,43-65`, `admin/invites/page.tsx:142,72-76`, `admin/metrics/page.tsx:70,64-68`, `admin/featured-sites/page.tsx:207,65-69`, `app/(app)/layout.tsx:12-21`, `contexts/AuthContext.tsx:119-123` | R5 | G2, LF7, F1, OB-C5, SG1 | gate を単一 policy に集約し `unknown` を fail-closed（描画しない）へ。4 箇所の重複解消は R1 にも効く |
| RF4 | minor | contract | catch-all segment を `join('/')` して連結するだけで segment 検証がない。**評価**: host 部は env 由来の文字列前置で置換不能。ただし「backend の全 path が元々到達可能」という無害判定は **`BACKEND_BASE_URL` が path prefix（例 `https://h/api/v1`）を持たない**ことを前提にしており、これは未検証（assumption A1、.env は非追跡）。prefix があれば `..` で prefix 外の path クラスへ到達しうる | `route.ts:39-40, 63` | — | CI-A22, A1 | A1 を運用側で確認し、prefix 運用なら segment 正規化を入れる |

### 4.2 Primary（QL1 modifiability / QL2 testability）

| ID | severity | gate | finding | Evidence | 違反 R | 参照 | required_action |
|---|---|---|---|---|---|---|---|
| RF5 | major | boundary/requirements | 業務ルールの semantic owner が lib に無く UI 層に分散する。**独立評価後の根拠**: (a) パスワード最小長が **3 実装で不一致**（`AccountSection`/`signup` = 12 文字、`admin/users` = 8 文字）— 同期修正漏れの実例; (b) 「生成中→完了」の検知が page 内（RO3）; (c) admin 認可判定 4 重複（RO1）; (d) theme 既定決定が inline script（RO4）。**訂正**: 初版の「404=未蓄積 5 ファイル 5 箇所」は 4 ファイル 5 箇所で、かつ意味が 3 種（エンドポイント未実装／スナップショット未生成／リソース不在）に分かれるため「同一ルールの重複」ではない → transport 値の解釈が UI に散る問題として RF6 へ移す。429 の `/monthly/i` 判定は単一ファイル 1 定義・ADR-073 の意図的フォールバックで、他ファイルへの波及なし → RF5 の根拠から除外 | `components/ui/AccountSection.tsx:17,30`, `app/signup/page.tsx:16,36`, `app/(app)/admin/users/page.tsx:46`; `app/(app)/podcast/page.tsx:81-108`; admin gate 4 箇所（RF3）; `app/layout.tsx:45-49` | R1 | LF2, RO1-RO5, CS4（パスワード規則: 3 ファイル）, OB-N1 | 各ルールの owner を lib の policy 関数に一意化。まずパスワード規則の不一致（8 vs 12）を要件として確定 |
| RF6 | major | boundary/contract | API 失敗の意味が transport 値（`ApiError.status` の数値比較、`status===0`=network、`retryAfterSeconds`、404 の意味解釈）のまま UI に渡り、各 page が ApiError→日本語文言ラダーを独自実装。404 は 4 ファイル 5 箇所で 3 種の意味（未実装／未生成／不在）に解釈され、`/monthly/i` regex（ADR-073 で意図的）も lib ではなく page にある。`request()` の `undefined as T`（204）は型上すべての caller が非 undefined を仮定 | `lib/api.ts:47-57,85,110-112,117-118`; ラダー: `feed/page.tsx:166-176,234,318`, `subscriptions/page.tsx:69-77,109-116,158-163`, `podcast/page.tsx:66-68`, `podcast/[id]/page.tsx:59`, `settings/page.tsx:75-77`, `admin/metrics/page.tsx:51-54`, `components/ui/LoginModal.tsx:59-67`; `feed/page.tsx:12-20` | R4 | LF1, LF2, CI-A01, CI-A03, CI-A04 | 失敗を意味（network / unauthorized / forbidden / not_found / rate_limited(+retryAfter, monthly/daily) / server）の判別共用体に変換する層を lib に置く。404 の意味は endpoint ごとに lib 側で確定 |
| RF7 | major | architecture | 「現在再生中の Podcast」「再生速度」の source of truth が一意でない。現在 Podcast は queue currentIndex／`AppContext.currentPodcast`／`podcastIdRef` の 3 系統、速度は `AppContext.playbackSpeed` と `audio.playbackRate` を `AudioPlayerBar` の effect（eslint-disable）が橋渡し。再生位置は**読み出し規則は存在**（`resolveResumePosition`: server>0→server、local>0→local。production 経路 `AudioPlayerContext.tsx:87`）するが、**書き込みが local と server の二重**で順序・失敗時の整合規則がない（初版の「reconciliation 規則なし」は訂正）。data authority 6 fact のうち一意 0 | `contexts/AudioPlayerContext.tsx:87,90`, `lib/playbackQueue.ts:18-21`, `hooks/useAudioPlayer.ts:94,197`; `contexts/AppContext.tsx:15,45-46`, `hooks/useAudioPlayer.ts:237-240`, `components/AudioPlayerBar.tsx:24-26`; `hooks/useAudioPlayer.ts:126,140`, `contexts/AudioPlayerContext.tsx:56-62`, `lib/playbackPosition.ts:25-37` | R3 | F3, F6, G3, IV11, CI-P12, CI-A10/A11, SG2, SG3, OB-B1 | authority を 1 つ選ぶ（SG3）。位置は書込側の順序契約（CI-A10/A11）を定義 |
| RF8 | major | contract/completeness | 再生状態に意味の状態型が無く 4 atom（isPlaying/currentTime/duration/volume）。error/ended/pause がすべて `isPlaying=false` に潰れ、`play()` reject の失敗契約（CI-P09）と重複 play の冪等性（CI-P10）が観測不能。`seek` は clamp せず `seekRelative` は clamp（同一概念に 2 契約） | `hooks/useAudioPlayer.ts:25-30,148-151,212-216,224-235` | R2 | CI-P01, CI-P08, CI-P09, CI-P10, G3, OB-C3 | 排他 union（idle/loading/playing/paused/ended/error）と遷移表を契約化し、既存 4 atom を派生値に |
| RF9 | major | boundary/completeness | Provider が業務ルールの置き場になっている: resume 合成、offline/network 選択、queue 挿入方針、auto-advance。`resolvePlaybackSource` の `'unavailable'` を `source !== 'cached'` で network と同一視し、オフライン失敗が `再生できませんでした (0)` になる。`fetchAndPlay`/`playById` と `handleEnded`/`skipToNext` が重複。auto-advance 失敗後の state/retry 未定義。Provider が Toast（表示層）に依存 | `contexts/AudioPlayerContext.tsx:84-133,143-196`, `:98-109`（`:104`）, `:112-123` vs `:143-161`, `:126-133` vs `:192-196`, `:6` | R1, R2, R4 | RO2, LF6, G5, G6, CI-P（advance）, OB-C2, OB-C6 | 純粋 policy（lib）へ移し、Provider は orchestration と React 配線のみ。`'unavailable'` を UI 文言へ写像 |
| RF10 | major | contract/completeness | オフラインキャッシュの不変条件欠落: 非 ok 応答を音声として `cache.put`（403 本文が「保存済み」になり `isCached()` は true。到達には署名 URL 側が CORS 応答を返す条件が付く）、`audio_url:''` の Podcast を永続化し呼出側が patch、`response!` 非 null 断言が削除との競合で一覧を落とす、3 put が非原子、blob URL の発行と revoke の owner が別モジュール。`fetch(podcast.audio_url)` は `request()` も SW も通らない第 3 の network 経路 | `lib/audioCache.ts:68-71`, `:83-84,88-94`, `:106-111`, `:137`, `:99-104` と `hooks/useAudioPlayer.ts:171-172,192-194`; 対照 `public/sw.js:44,54` は ok 判定あり | R2, R4 | CI-C01, CI-C02, CI-C04, CI-C05, IV3, IV4, G9, OB-C11, OB-C14 | `downloadAudio` の事後条件（ok 検証・原子性・isCached の意味）と blob lifecycle owner を契約化 |
| RF11 | major | boundary/completeness | 設定永続化の owner 不在: `AppContext` が raw `dispatch` を公開し復元経路の検証（`speed > 0`）を公開経路が迂回、localStorage key が `lib/config.ts` と生リテラル（`'theme'` inline script、`'seen_achievement_ids'`）に分散、encode 規約が key ごとに異なる、`data-theme` を列挙検証なしに代入 | `contexts/AppContext.tsx:60,45-46,92,127`, `app/layout.tsx:45-49`, `app/(app)/dashboard/page.tsx:48,65`, `app/(app)/settings/page.tsx:352`; 経路 6 種は verification-run.md §7d | R1, R3 | G8, IV8, IV9, LF9, RO4, RO5, OB-C7, OB-C9 | 設定ごとに検証付き command を公開し raw dispatch を閉じる。key・encode を単一所有 |
| RF12 | major | architecture/verification | network seam の欠如: `createApiClient()` は状態を持たない factory で **呼出 37 箇所/19 ファイル**（定義行除く。router 再計測。`vocabulary-test/page.tsx` 4 箇所を含む）から都度生成され、注入点が無い。結果としてテストは `vi.mock('@/lib/api')` 24 ファイル・`toHaveBeenCalled` 273 箇所の呼出検証に偏る（他 finding の修正コストを押し上げる増幅器） | `lib/api.ts:124`; 上位: `settings/page.tsx` 5, `feed/page.tsx` 5, `AudioPlayerContext.tsx` 4, `vocabulary-test/page.tsx:55,102,407,440`, `podcast/[id]/page.tsx` 4; `tests/` 計測は verification-run.md §7g | R7 | F4, LF15, SG5, OB-B2 | Provider 経由の単一注入点（port は 1 実装でも「テスト隔離」の品質根拠で許容。factory/Strategy 階層は不要＝RO1 棄却） |
| RF13 | major | verification | テストが production 経路を迂回する（rule 11 :70-74 (c)）: integration 層は 1 ファイル、E2E 4 本も backend を `page.route` で stub、契約 53 件中テスト裏付け 26 件、未 coverage 27 件。R6 は既存 SW テストが green のまま要件に反する（contradictory）。conformance test（Q-01..Q-32）は本 review で唯一の非退化な網羅 oracle | `tests/integration/`（1 file）, `e2e/main-flow.e2e.ts:25-205`, `tests/setup.ts:5-17`; 計測 verification-run.md §7g; `tests/lib/playbackQueue.conformance.test.ts:1-8` | R7 | contract coverage（test 26/53）, OB-N5, OB-T1..T12 | 未 coverage 27 件のうち CI-A20/A21/A22/S01/S02/C01/C02 を RED 優先（OB-N5）。real `request()` を通す integration を主要フローに 1 本ずつ |
| RF14 | major | boundary | UI 層の重複と長大化: modal シェル＋focus trap 3 重実装、`SkeletonCard`/`RefreshIcon` 各 2 定義、empty-state 7 箇所コピー、`AccountSection.tsx` 722 行・24 useState・確認 UI 3 重実装（`ConfirmDialog` 不使用）、`feed/page.tsx` 615 行・14 useState、stale-request guard を 2 page が独自実装 | `components/ui/ConfirmDialog.tsx:40-47`, `LoginModal.tsx:95-96`, `OnboardingSourcesModal.tsx:27`; `feed/page.tsx:36-64`, `podcast/page.tsx:15-44`; `AccountSection.tsx:412,547,678`; 行数は verification-run.md §7f | R1 | LF7, CS4 | 共有 UI（Modal shell / EmptyState / 非同期送信の状態）を 1 実装に。分割は 1 関心事 1 hook |

### 4.3 Secondary（QL3 fault tolerance）

| ID | severity | gate | finding | Evidence | 違反 R | 参照 | required_action |
|---|---|---|---|---|---|---|---|
| RF15 | major | completeness/boundary | 認証状態が直積型で不正組合せ（`authenticated`+`user:null`、`unauthenticated`+`user`）を test-only props から構築でき、`refreshMe` は 500/network も含む全失敗を `unauthenticated` に潰す（一時障害でログアウト表示）。logout のキャッシュ消去失敗を黙殺し、残留を観測できない。`WebAuthnBrowserPort` が公開契約の引数 | `contexts/AuthContext.tsx:16,37-47,59-63,99-101,32` | R2, R6 | IV6, IV7, G7, LF8, LF12, OB-C8 | `AuthSession` 判別共用体、失敗の分類（unauthorized / unavailable）、port 注入点を Provider へ |
| RF16 | minor | contract | `markCompleted` の duplicate 抑止が web に無く再生し直しで再送（backend first-write-wins 依存がコメント・テストに未記載）。`updatePosition` は in-flight と ended の `position=0` の順序保証なし | `hooks/useAudioPlayer.ts:132-146`, `contexts/AudioPlayerContext.tsx:56-71`, `lib/api.ts:184-194` | R2 | CI-A10, CI-A11, CI-A12 | 依存を契約として明記（コメント＋テスト）。順序は sequence を持たせるか last-write を許容と明文化 |
| RF17 | minor | contract | `load()` が metadata 前に `currentTime` を代入し、`loadedmetadata` では duration 超過時に 0 へ戻すだけで resumePosition を再適用しない。**evidence_status: inferred** — HTML 仕様の default playback start position により多くのブラウザで有効に働く可能性があり、実ブラウザ観測が未実施 | `hooks/useAudioPlayer.ts:205-207,153-159` | R2 | CI-P05, U2（Completeness） | e2e で確認（unexecuted_validation UV3） |
| RF18 | minor | completeness | `QueueState.currentIndex` の範囲不変条件が型に無く任意 importer が構築可能（現在の production 経路では in-range）。`Q.start`/`Q.setQueue` は production 未使用（spec §2.3/2.4 対応の死んだ実装）。`'completed'` が生成完了と完聴の二義 | `lib/playbackQueue.ts:7-12,30-39`, `types/index.ts:15`, `hooks/useAudioPlayer.ts:135-138` | R2 | IV5, G11, OB-C4 | smart constructor か不変条件テスト。未使用 export は spec と突合して削除か採用 |
| RF19 | minor | architecture | 依存方向: `lib/audioCache.ts` → `lib/api.ts`（cache が network に依存）、`contexts/AudioPlayerContext.tsx` → `components/ui/Toast`（状態層→表示層）、`hooks/useStartPodcast` → context の pass-through。network 経路が 3 本（`request()`／`lib/reportClientError.ts` の raw fetch＝CSRF 付与なし・ApiError 正規化なし／`lib/audioCache.ts` の raw fetch） | `lib/audioCache.ts:20,69`, `contexts/AudioPlayerContext.tsx:6`, `hooks/useStartPodcast.ts:17-19`, `lib/reportClientError.ts:22` | R1 | LF14, LF15, RO4（Boundary rejected: pass-through 削除は低優先） | 方向を lib ← contexts ← components に揃える。エラー通報の CSRF 免除は backend 契約として明記 |
| RF20 | minor | completeness/architecture | SW とアプリ側でキャッシュ名前空間 prefix（`shell-`/`api-`）を手複製し、コメントで同期を要求。`/_audio-podcast/` が sw.js の素通しリストに無いが、Cache Storage の key としてのみ使われ fetch イベントにならないため実害なし（記録のみ） | `public/sw.js:16-24,70-72`, `lib/swCacheCleanup.ts:6-14,21`, `lib/audioCache.ts:39-41` | R1, R6 | G10, LF13, CI-S03, OB-C13 | 名前空間の単一 source（生成時にビルドで注入するか、テストで両者の一致を pin） |
| RF21 | minor | verification | CI に `typecheck:ts7`（現時点 exit 0）と独立 `npm run build`、`npm audit` が無い。build は e2e の `webServer` 内で暗黙実行。lint は 177 warning を許容（`no-floating-promises` 65 が最多）。**訂正**: rule 70 は CI ゲートを要求していない（R8 は router 由来の要件・`inferred`） | `.github/workflows/ci.yml` run steps（verification-run.md §6）, `eslint.config.mjs:42-57`, `package.json:11` | R8 | OB-N4 | ゲート追加は運用判断（SG1 の later 候補） |
| RF22 | minor | boundary | BFF が要求・応答の `Content-Type` を無条件に `application/json` へ固定し、他の backend ヘッダを落とす（`Set-Cookie` 以外）。`forward()` 75 行に 8 責務。`HEAD` は本文で参照されるが handler なし | `app/api/backend/[...path]/route.ts:67-69,105-108,113-121,50-124,87` | R4 | CI-A26, LF-C5 | 現状の backend が JSON のみなら制約として明文化。関数分割は任意 |

### 4.4 finding にしなかったもの（RC7・反証済み）

- conformance test が `reorderUpNext` を `moveUpNext` の alias で呼ぶこと: spec §2.7 が「web を onMove 方式に追随修正済み」と明記し、判別行 Q-26/28/32 が green（`lib/playbackQueue.ts:103` の `insertAt = toIndex - (fromIndex < toIndex ? 1 : 0)` が正本アルゴリズム）。退化 oracle ではない。
- `createApiClient` 生成数 60/21 ファイル（Explorer 初報）→ T1 計測 34/19 → **独立評価の指摘で router が再計測: 呼出 37/19（定義行除く）**。T1 の内訳表は `vocabulary-test/page.tsx` 4 箇所を欠落し定義行を算入していた（verification-run.md §7a の erratum 参照）。finding の向きは不変。
- `WebAuthnBrowserPort` / `PushBrowserPort` の port 抽象: テスト注入という品質根拠がコード内に明記されており過剰抽象ではない（Boundary RO5）。注入点の位置だけが finding（RF15）。
- 性能: Evidence なし。intentionally_not_optimized。
- 意匠（rule 15）・backend 契約の妥当性: out_of_scope。

## 5. Function packages（lossless 付録）

router の要約は上記 §4 に圧縮しているが、stable ID・Evidence 状態・authority・coverage 分母/分子・subject verdict は次のファイルで保持する（`2026-09-16-code-design-review/` 配下）。

```yaml
function_plan:
  - {function: architecture, run_if: "web 内 data authority が複数＋品質 trade-off", status: completed, artifact: architecture-strategy-package.md, subject_verdict: incomplete, package_decision: {status: revise, artifact_readiness: incomplete}, note: "F3 の option 未作成（U6: spec Q-* 未読解）。SG1-SG5 pending"}
  - {function: discovery, run_if: "用語・context 発見", status: not_applicable, not_applicable_reason: "用語は types/index.ts と shared-playback-spec で確定。unknown なし"}
  - {function: completeness, run_if: "状態・遷移・失敗の欠落判定", status: completed, artifact: completeness-package.md, subject_verdict: incomplete, package_decision: {status: pass, artifact_readiness: ready}, note: "S1-S4 すべて incomplete。IV1-IV11、G1-G11、OB-C1..C14/OB-T1..T12。applicable 62 / present 9（package 内 58 は誤記、62 が正）"}
  - {function: contract, run_if: "公開 operation の pre/post/failure", status: completed, artifact: contract-package.md, subject_verdict: insufficient, package_decision: {status: proposed→router 読替 revise, artifact_readiness: draft→incomplete}, note: "契約記述 53/53、実装適合 met 26/partial 2/unmet 25、test 26/53、要件 4/8（R6 contradictory）。CI-P12/CI-S03 の owner は Architecture 表で解決（下記）"}
  - {function: boundary, run_if: "技術漏出・caller 分岐・長大処理", status: completed, artifact: boundary-package.md, subject_verdict: leaky, package_decision: {status: revise, artifact_readiness: incomplete}, note: "C1-C6 全境界 leaky。LF1-LF15、CS1/CS4 fail、CS2/CS3 not_applicable、RO1-RO6 棄却。初版の行番号ずれは router 指示で修正済み"}
  - {function: change_safety, run_if: "既存挙動変更", status: not_applicable, not_applicable_reason: "review mode・変更提案なし。修正着手時に再判定"}
```

router による obligation の解決:
- OB-N3（Contract → Architecture 不在）: CI-P12（再生速度の authoritative owner）と CI-S03（SW prefix の単一 source）は Architecture の data authority 表 (b)(e) で「一意でない」が確定しており、owner は **未選択（SG3 / SG4 pending）**。契約の owner は gate 解決後に確定する。
- OB-B1（Boundary → Architecture）: 同上 SG3。
- OB-N1/OB-N2（R1・R5 の中核が operation inventory 外）: RF5・RF3 として router が finding 化。CI は未作成のまま obligation 保持。
- OB-B4 / CI-A14（Star の backend 冪等性）: out_of_scope。unknown U4 として保持。

## 6. Traceability と検証

### 6.1 要件 → package → test（分母 8）

| R | Architecture | Completeness | Contract（CI / test） | Boundary | 既存 test | status |
|---|---|---|---|---|---|---|
| R1 | F5, F7（scope 外→uncovered） | G8, RO1-RO5 | OB-N1（inventory 外） | LF1, LF2, LF9, LF13, CS4 fail | page テストは mock 呼出検証 | **missing**（lib に owner 無し） |
| R2 | F3 | G3, G4, G6, G7, G9, G11, IV1-IV5, IV10 | CI-P01/P05/P08/P09/P10, CI-C01-C05, CI-A11/A12 | LF4-LF6 | useAudioPlayer / audioCache / AudioPlayerContext.* | **partial**（test 26/53） |
| R3 | F3, F6, AR (a)(b)(c) | G3, IV11 | CI-P12（owner 未確定） | OB-B1 | — | **missing**（authority 未選択） |
| R4 | — | G5 | CI-A01/A03/A04/A20-A22/A26/A27 | LF1, LF6, LF10, LF11 | api.*.test / proxy.test（40） | **partial** |
| R5 | F1 | G2, IV—, RO1 | OB-N2 | LF7 | admin/*.page.test（unknown 状態の gate は未検証） | **missing** |
| R6 | F2, AR (e) | G1, G10 | CI-S01/S02/S03 | LF12, LF13 | sw.test T23-T25 green | **contradictory**（green だが要件に反する） |
| R7 | F4 | — | test coverage 26/53 | LF15 | 計測 §7g | **partial** |
| R8 | F8 | — | OB-N4 | — | ci.yml | **missing**（inferred 要件） |

coverage: covered 0 / partial 3（R2, R4, R7）/ missing 4（R1, R3, R5, R8）/ contradictory 1（R6）。

### 6.2 validation

```yaml
validation:
  executed:
    - {id: V1, command: "npm test", result: pass, evidence: "85 files / 1165 tests / 12.03s; jsdom 'Not implemented: HTMLMediaElement pause' ×3"}
    - {id: V2, command: "npm run lint", result: pass, evidence: "0 errors / 177 warnings（no-floating-promises 65, require-await 39, no-unsafe-assignment 20 …）"}
    - {id: V3, command: "npm run typecheck", result: pass, evidence: "exit 0"}
    - {id: V4, command: "npm run typecheck:ts7", result: pass, evidence: "exit 0（U3 解消）"}
    - {id: V5, command: "npm run build", result: pass, evidence: "exit 0、static 14 / dynamic 2 routes"}
    - {id: V6, command: "grep 定量（createApiClient / silent catch / eslint-disable / localStorage / useState / wc -l / vi.mock）", result: pass, evidence: "verification-run.md §7"}
    - {id: V7, command: "package 内 path:line の範囲検査（wc -l 超過の検出）", result: pass, evidence: "architecture 128/128, completeness 130/130, contract 149/149 in range; boundary は初版で 54 件超過→修正後 200 件すべて範囲内を再検査"}
  passed: [V1, V2, V3, V4, V5, V6, V7]
  failed: []
  unexecuted:
    - {id: UV1, reason: "E2E は build＋Chromium 取得を要し read-only review の範囲外", required_runner: "test-execution", planned_commands: ["npm run test:e2e:install", "CI=true npm run test:e2e"], owner: user}
    - {id: UV2, reason: "契約 test 未 coverage 27 件は未実装（design 段階）", required_runner: "tdd-implementation", planned_commands: ["OB-N5 の 7 件から RED"], owner: user}
    - {id: UV3, reason: "RF17（resume 位置の再適用）は実ブラウザ観測が必要", required_runner: "test-execution（Playwright）", planned_commands: ["e2e: load→loadedmetadata 後の currentTime 観測"], owner: user}
  platform_validation: {required_platforms: [], executed: [], unexecuted: [], parity_result: not_applicable, platform_specific_risks: ["browser 実装差（autoplay policy・Cache Storage 対応）は CI-C07/CI-P09 の environment condition として契約側に隔離"]}
```

注: V1〜V5 は「現状の実装が現状のテストに対して green」であることの Evidence であり、R6 の contradictory が示すとおり要件充足の Evidence ではない（rule 11 :70-74）。

## 7. Canonical decision

```yaml
decision:
  status: pass                       # review artifact として必須 gate を満たし、未実行事項と risk を明示
  artifact_readiness: ready
  engineering_status: not_started    # 修正は未着手
  release_status: not_applicable
  decision_maturity: {status: approved, owner: user, scope: [web/ の finding 採否と着手順], evidence_status: confirmed, approval_evidence: ["§8 dig-me セッション 2026-09-16（Q1〜Q9 の回答と共通理解の確認）"], baseline_version: "2026-09-16", change_control: "本文書の §8 を更新して再承認"}
  subject_verdict_summary: {architecture: incomplete, completeness: incomplete, contract: insufficient, boundary: leaky}
  next_phase:
    name: 修正計画（design mode）
    status: allowed
    reasons: ["SG1〜SG5 は 2026-09-16 の人間判断（§8）で satisfied", "RF1/RF2/RF3 の方針は user が確定"]
    human_approvals_required: []
    resolved_by: "§8（dig-me セッション 2026-09-16、owner: user）"
  evidence: [V1-V7, 各 package の Evidence 記録]
  assumptions: ["R1-R5 は router が実コードと rule から導いた inferred 要件（user 未承認）", "R8 は rule 70 の趣旨からの inferred 要件", "A1: BACKEND_BASE_URL は path prefix を持たない（RF4 の無害判定の前提。.env 非追跡のため未検証）"]
  unknowns:
    - {id: U4, subject: "Star（生成枠消費）の backend 冪等性・duplicate semantics", confirmation_method: "backend repo の articles/star handler と ADR-061 確認", impact_if_unresolved: "RF6 の rate_limited 意味づけと CI-A14 が確定しない", owner: user, evidence: [CI-A14]}
    - {id: U7, subject: "RF17 のブラウザ実挙動", confirmation_method: "UV3", impact_if_unresolved: "minor のまま保持", owner: user, evidence: [CI-P05]}
  contradictions: ["R6: 既存 SW テスト（T23-T25）green と要件違反（CI-S02）が併存"]
  failed_gates: []
  unexecuted_validation: [UV1, UV2, UV3]
  platform_validation: {parity_result: not_applicable}
  residual_risks: ["RF3 の降格判断（blocker→major）は backend require_admin を前提。backend 側の確認は out_of_scope", "Boundary package 初版の行番号ずれは修正済み（200 参照すべて範囲内）", "RF16 / RF17 / RF19 / RF21 / RF22 は独立評価が turn 上限で未到達（UNVERIFIABLE）。router の自己確認のみ", "件数主張（404 箇所数・createApiClient）で初版に誤りがあり独立評価で訂正した。他の件数も per-file 内訳のあるもの以外は inferred として読むこと"]
  human_approvals_required: []   # §8 で解決。finding の採否は着手順 1〜3 として確定、4〜5 は保留
```

### 7.1 独立評価（adversarial-review ロール）

全文: `2026-09-16-code-design-review/t5-adversarial.md`。評価者は T1〜T4 の package を判定材料にせず、§4 の主張を自分で grep / read して反証を試みた。

```yaml
reviewed_by:
  kind: independent_evaluator
  identity: adversarial-verifier (T5)
  review_status: partially_accepted
  scope_accepted: [RF1, RF2, RF3（降格妥当）, RF6, RF8, RF9, RF10, RF13, RF18, RF20, "§4.4 conformance alias 判断", "RC2/RC3/RC5/RC6/RC7 合格"]
  scope_weakened: [RF4（前提 A1 未検証）, RF5（件数・意味の過大計上）, RF7（位置の記述が自己矛盾）, RF12（件数誤り）, "§2.1 differences: [] は過小"]
  scope_unverifiable: [RF16, RF17, RF19, RF21, RF22]   # turn 上限で未到達、または仕様引用ツール不在
  citations_checked: 34
  citations_wrong: 3   # いずれも件数・自己矛盾。行番号の誤りは 0
```

router が反映した差分（初版 → 現版）:

| 対象 | 初版 | 現版 | 理由 |
|---|---|---|---|
| RF5 | 「404=未蓄積 5 ファイル 5 箇所」「429 regex」「パスワード 2 実装」を同一ルール重複として major | 404（4 ファイル 5 箇所・意味 3 種）と 429（単一ファイル・ADR-073 意図的）を根拠から除外し RF6 へ移す。パスワード規則は **3 実装・最小長 8 vs 12 の不一致**（新規 Evidence `admin/users/page.tsx:46`）を主根拠に major 維持 | 独立評価 T2 / 候補 N4 |
| RF6 | transport 値の露出のみ | 404 の意味解釈分散と `undefined as T` の caller 未防御（候補 N2）を追加 | RF5 からの移管 |
| RF7 | 「位置は reconciliation 規則なし」 | 「読み出し規則は `resolveResumePosition` に存在。書き込みが二重で順序契約なし（CI-A10/A11）」へ訂正 | 自身の引用と矛盾 |
| RF12 / §4.4 | 実測 34/19（38/21） | 呼出 37/19（`vocabulary-test/page.tsx` 4 箇所を追加。候補 N1） | T1 内訳表の母集団漏れ |
| RF3 | 降格理由「取得は guard」 | 「unknown 中も作成フォーム送信は到達するが backend が拒否」「`isRestoring` 依存で unknown が長引きうる（候補 N3）」を追記 | 反証試行の結果を明記 |
| RF4 | 「host 固定ゆえ無害」 | 前提 A1（BASE_URL に path prefix なし）を assumption として §7 に追加 | 未検証前提の明示 |
| RF10 | — | 403 保存の到達条件（CORS 応答）と第 3 の network 経路（候補 N5）を追記 | 補足 |
| RF19 | network 経路 2 本 | 3 本（audioCache の raw fetch を追加） | 候補 N5 |
| §2.1 | `differences: []` | constraint 先頭配置を差分として明記 | 過小申告 |

削除した finding: なし。severity 変更: なし（RF3 の降格は初版時点で router が実施し、独立評価が妥当と判定）。

canonical decision への影響: `status: pass` を維持（訂正はすべて finding 本文の根拠・件数であり、gate の失敗ではない）。ただし未到達の RF16/17/19/21/22 は `residual_risks` に記録し、人間が採否を判断する際は router の自己確認のみである点を踏まえること。


## 8. 人間判断の結果（2026-09-16・dig-me セッション、owner: user）

Selection Gate と finding の採否を、ユーザーとの一問一答（Q1〜Q9）で確定した。AI 復唱ではなく user の回答が Evidence。

### 8.1 前提（user 回答）

- 利用者は本人＋少数の知人で日常利用中。利用者を守る修正は今入れる（Q1）。
- 端末・ブラウザプロファイルの共有はない。各自が自分の端末のみで使う（Q2）。
- 次サイクルの変更予定は再生領域（キュー・オフライン・完聴・レジューム）（Q3）。

### 8.2 Selection Gate の状態

```yaml
selection_gates_resolution:
  - {id: SG1, status: satisfied, decision: "着手順 = §8.3。constraint の小修正 → 注入点 → 再生正本 → CI。学習機能側は保留", evidence: [Q1, Q2, Q3, Q9]}
  - {id: SG2, status: satisfied, decision: "F3（再生 authority 一本化）へ投資する", evidence: [Q3, Q4]}
  - {id: SG3, status: satisfied, decision: "『現在再生中』の正本 = playbackQueue.currentIndex（共有仕様 §2.1 不変条件 4 に一致）。AppContext.currentPodcast は削除し Q.current の派生値へ。hook の podcastIdRef は内部実装", evidence: [Q4, "docs/design/shared-playback-spec.md §2.1"]}
  - {id: SG4, status: satisfied, decision: "RF1 の受入条件 = セッション失効時にも SW 管理キャッシュ（shell-*/api-*）を消す契約を追加。主体付き key・SW への一元化は不採用", evidence: [Q2]}
  - {id: SG5, status: satisfied, decision: "Provider が 1 つの API client を保持し context/hook から取る最小注入点。まず再生系 4 箇所（AudioPlayerContext）を移行、page 15 ファイルは順次", evidence: [Q9]}
```

### 8.3 finding の採否と着手順

| 順 | 対象 | 決定 |
|---|---|---|
| 1 | RF2 | BFF は `BACKEND_API_KEY` 欠落も fail-closed（500）に揃え、本文を generic 化 |
| 1 | RF1 | 失効経路（`refreshMe` 失敗 → `unauthenticated`）で `deleteAllAudio` は行わず SW 管理キャッシュのみ消去する契約を追加（OB-C1） |
| 1 | RF3 | admin gate を単一 policy に集約。`unknown` は読み込み中表示のみ、`unauthenticated` はログインモーダル、非 admin は現状文言。`(app)` レイアウト全体の gating は今回しない（Q7） |
| 2 | RF12 | 最小注入点（SG5）。再生系 4 箇所を先に移行し、以後の再生変更は本物の `request()`＋fetch スタブの integration で検証（R7） |
| 3 | RF7 | SG3 のとおり正本一本化。再生速度は **2 概念**: 既定速度（設定・永続）とセッション速度（再生セッション state。`load()` 時に既定値から初期化して再適用）。`AudioPlayerBar` の同期 effect は廃止（Q5） |
| 3 | RF8 / RF9 | 状態型（idle/loading/playing/paused/ended/error(reason)）を導入。自動次再生の失敗は **停止**: 失敗エピソードを current に保持し error 状態、手動 play で再試行、`'unavailable'` は「オフライン」文言へ（Q6） |
| 4 | RF21（R8） | lint-test ジョブに `typecheck:ts7` と独立 `npm run build` を追加。`npm audit` は Dependabot と二重のため入れない（Q8） |
| 保留 | RF5 / RF6 / RF14、page 側の注入点移行 | 学習機能を触るサイクルまで保留。ただしパスワード最小長の不一致（8 vs 12）を順 1 の不具合として扱うかは未決（下記） |
| 記録のみ | RF4, RF16〜RF20, RF22 | 変更しない。RF4 は仮定 A1 の運用確認のみ |

### 8.4 残存する仮定・未決

- A1: `BACKEND_BASE_URL` に path prefix がない（RF4 の無害判定）。運用側で確認。
- RF17（resume 位置の再適用）と `load()` 後の速度リセットは実ブラウザ未観測。順 3 の作業中に e2e で確認する。
- パスワード最小長の不一致（`admin/users` 8 文字 vs 他 12 文字）を順 1 に含めるか、含める場合の統一値（12 と推定、未確認）。
