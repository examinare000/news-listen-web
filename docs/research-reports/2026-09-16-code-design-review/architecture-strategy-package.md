# Architecture Strategy Package — news-listen/web (internal data authority & quality portfolio)

routing_context: origin=integrated / mode=review / requested_by=router / return_to=router / mutation_authorized=false / requested_artifact=Architecture Strategy Package。再 routing・peer 呼び出しは行っていない。source・設定・git は一切変更していない。

scope note: 本 package は **web module 内部の data authority と品質 portfolio** に限定する。backend / iOS / system-wide architecture は out_of_scope（common-brief :10）。

---

## 1. decision_frame

```yaml
decision_frame:
  question: "news-listen web client 内部の data authority（再生中 Podcast・再生速度・再生位置・認証状態・利用者別 cache・localStorage key）と、それを支える品質 portfolio は、R1–R8 を満たす構造になっているか。満たさない場合、どの負債をどの順で解消する候補があるか。"
  owner: user
  approvers: [user]
  decision_maturity:
    status: proposed
    owner: user
    scope: ["web module 内部の data authority", "QL1-QL4 品質 portfolio", "debt priority 候補"]
    evidence_status: confirmed
    approval_evidence: []
    baseline_version: ""
    change_control: "未設定。user が承認するまで target は選択しない。"
  actors:
    - id: A1
      purpose: "学習者として、端末をまたいで途中まで聴いた podcast を正しい位置・速度から再生し、オフラインでも聴ける。"
      evidence:
        - status: confirmed
          source: "lib/playbackPosition.ts:25-37（server 位置優先の resume）、lib/audioCache.ts:64-85（オフライン保存）"
          supports: "再生継続とオフライン再生が実装済み capability である。"
    - id: A2
      purpose: "共有端末の利用者として、ログアウト後に自分の認証済みデータが次の利用者へ残らない。"
      evidence:
        - status: confirmed
          source: "contexts/AuthContext.tsx:92-101（logout で deleteAllAudio + clearManagedServiceWorkerCaches）"
          supports: "残留防止が明示された設計意図として存在する。"
    - id: A3
      purpose: "この repository の保守者（user）として、業務ルール変更・仕様（Q-*/RT-*）変更を 1 箇所の修正で安全に反映できる。"
      evidence:
        - status: confirmed
          source: "CLAUDE.md（TDD 必須）、tests/lib/playbackQueue.conformance.test.ts:1-8（spec 正本準拠テストの存在）"
          supports: "仕様正本に追随する保守が明示的な作業前提である。"
  product_values:
    - id: V1
      statement: "聴取状態（どれを・どこから・どの速度で）がユーザーの期待どおり一意に復元される。"
      actor_ids: [A1]
      success_signals: ["再生再開位置が server/local のどちらか一方の規則で説明できる", "速度変更が即時かつ恒久的に反映される"]
      owner: user
      evidence:
        - status: confirmed
          source: "lib/playbackPosition.ts:14-17（優先順位コメント）"
          supports: "復元規則が product 意図として文書化されている。"
    - id: V2
      statement: "共有端末・セッション失効後に、他利用者の認証済みデータが見えない。"
      actor_ids: [A2]
      success_signals: ["logout 後に audio-*/api-*/shell-* cache が空", "unknown 状態中に保護 UI が描画されない"]
      owner: user
      evidence:
        - status: confirmed
          source: "lib/swCacheCleanup.ts:1-5（残留 risk の明記）"
          supports: "confidentiality が明示的な product 関心事である。"
    - id: V3
      statement: "仕様（shared-playback-spec Q-*/RT-*）と業務ルールの変更が、限定された箇所の修正で完了し、回帰をテストで検出できる。"
      actor_ids: [A3]
      success_signals: ["1 ルール = 1 所有 module", "変更が無関係 module へ波及しない", "契約テストが production 経路を通る"]
      owner: user
      evidence:
        - status: confirmed
          source: "tests/lib/playbackQueue.conformance.test.ts:2-3（Q-01〜Q-32 の機械照合意図）"
          supports: "仕様追随性が明示的な品質目標である。"
  in_scope: ["web/app", "web/components", "web/contexts", "web/hooks", "web/lib", "web/types", "web/public/sw.js", "web/tests", "web/e2e", "web/.github/workflows/ci.yml"]
  out_of_scope: ["backend 契約の妥当性", "iOS / Android", "UI 意匠", "修正実装そのもの", "system-wide（backend+client）architecture"]
  horizon: "次の 1–2 機能サイクル（roadmap は未提示のため inferred）"
  target_platforms: ["web browser (Chromium/WebKit) via Next.js 16 / React 19"]
  reversibility: unknown
  constraints:
    - "mutation_authorized=false。本 package は read-only の review 成果物である。"
    - "TS6 固定 + typescript7 エイリアス併用（web/agent-rules/70-typescript-version-policy.md:6-20）。"
    - "棄却済み: npm overrides による TS サブツリー固定（web/docs/trial-log/typescript7-eslint-coexistence.md、同 rule :13 に『確認済み』として記録）。再提案しない。"
  candidate_means_parked:
    - "Redux / Zustand 等の state library 導入"
    - "Clean Architecture / hexagonal な layer 再編"
    - "Service Worker への cache 一元化"
    - "middleware.ts による route gating"
  note: "上記はいずれも技術名であり目的ではない。option O1-O8 の中で手段として評価する。"
```

---

## 2. capability

```yaml
capabilities:
  - id: CAP1
    name: "Web client 内部の playback / auth / cache 状態管理"
    kind: technical_capability
    classification: not_applicable
    classification_rationale: "core | supporting | generic は business capability / subdomain の投資分類であり、web client の内部 state 管理という技術要素へ付けない（skill workflow.md:84）。本 capability は quality scenario・failure risk・operation・cost で評価する。"
    actor_ids: [A1, A2, A3]
    value_ids: [V1, V2, V3]
    differentiation: not_applicable
    unique_knowledge: not_applicable
    expected_change: high
    failure_risk: high
    owner: user
    evidence:
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:44-209 は state 管理・queue・network・cache・toast を同一 provider が担う。"
        supports: "kind が業務能力ではなく client 側の技術能力であること。"
      - status: confirmed
        source: "tests/lib/playbackQueue.conformance.test.ts:8（Q-26/Q-28/Q-32 の乖離を spec 制定時に修正した履歴）"
        supports: "expected_change: high（仕様追随変更が実際に発生している）。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:92-101（logout 時の cache 消去）、app/(app)/admin/users/page.tsx:86（unknown 中は admin UI が描画される）"
        supports: "failure_risk: high（confidentiality 失敗が実在の経路として存在する）。"
    domain_frame:
      domain_vision_status: not_applicable
      not_applicable_reason: "technical_capability であり、顧客向けの独自 domain vision を持たない。架空の unique_value を作らない。"
      target_customer: not_applicable
      critical_problem: not_applicable
      unique_value: not_applicable
      success_signals: []
      value_preservation_or_risk_statement: "security（V2: 共有端末での認証済みデータ残留・unknown 中の保護 UI 描画）と operation（V3: 仕様追随コスト）を落とさないことが本 capability の存在理由である。Evidence: contexts/AuthContext.tsx:92-101, app/(app)/admin/users/page.tsx:86, .github/workflows/ci.yml:24-27。"
    investment:
      priority: unknown
      level: unknown
      build_buy_reuse: build
      rationale: "既に build 済みの内部構造であり、buy/reuse 対象ではない。投資優先度は F1–F8 の debt priority を user が確定した後に決まる（SG1）。"
      reevaluate_when: ["SG1 satisfied", "shared-playback-spec の Q-*/RT-* 改訂", "iOS との状態同期要件が追加されたとき"]
```

---

## 3. quality_portfolio と quality_scenario

```yaml
quality_portfolio:
  items:
    - id: QA1
      quality:
        reference_model: ISO/IEC 25010:2023
        level: subcharacteristic
        characteristic: maintainability
        subcharacteristic: modifiability
        standard_term: modifiability
        display_name_ja: 変更容易性
        source_terms_ja: [変更容易性]
      priority: primary
      value_ids: [V1, V3]
      rationale: "業務ルール・仕様（Q-*/RT-*）の変更頻度が高く（tests/lib/playbackQueue.conformance.test.ts:8）、変更点が散在すると仕様追随が失敗する。"
      owner: user
      evidence:
        - status: confirmed
          source: "common-brief.md:20（QL1 primary 指定）"
          supports: "router が指定した quality lens。"
      reevaluate_when: ["roadmap が提示されたとき"]
    - id: QA2
      quality:
        reference_model: ISO/IEC 25010:2023
        level: subcharacteristic
        characteristic: maintainability
        subcharacteristic: testability
        standard_term: testability
        display_name_ja: 試験性
        source_terms_ja: [テスト容易性]
      priority: primary
      value_ids: [V3]
      rationale: "TDD 必須（CLAUDE.md）かつ契約（Q-*/RT-*）が正本であるため、production 経路を通る契約テストが成立しないと仕様適合を証明できない。"
      owner: user
      evidence:
        - status: confirmed
          source: "common-brief.md:20（QL2 primary）、web/agent-rules/11-testing-strategy.md（TDD 規律）"
          supports: "testability が primary であること。"
      reevaluate_when: ["テスト戦略 rule の改訂"]
    - id: QA3
      quality:
        reference_model: ISO/IEC 25010:2023
        level: subcharacteristic
        characteristic: reliability
        subcharacteristic: fault_tolerance
        standard_term: fault tolerance
        display_name_ja: 耐障害性
        source_terms_ja: [障害許容性]
      priority: secondary
      value_ids: [V1]
      rationale: "network / cache 失敗時も再生体験を壊さない設計意図が既にある（contexts/AudioPlayerContext.tsx:59-61, 68-70）が、primary ではない。"
      owner: user
      evidence:
        - status: confirmed
          source: "common-brief.md:20（QL3 secondary）"
          supports: "secondary 位置づけ。"
      reevaluate_when: ["オフライン利用比率の計測が得られたとき"]
    - id: QA4
      quality:
        reference_model: ISO/IEC 25010:2023
        level: subcharacteristic
        characteristic: security
        subcharacteristic: confidentiality
        standard_term: confidentiality
        display_name_ja: 機密性
        source_terms_ja: [機密性]
      priority: constraint
      value_ids: [V2]
      rationale: "共有端末での他利用者データ残留・未解決状態での保護 UI 描画は、他品質と trade-off してよい対象ではない制約である。"
      owner: user
      evidence:
        - status: confirmed
          source: "common-brief.md:20（QL4 constraint）、lib/swCacheCleanup.ts:1-5"
          supports: "constraint 扱い。"
      reevaluate_when: ["認証方式の変更"]
    - id: QA5
      quality:
        reference_model: ISO/IEC 25010:2023
        level: characteristic
        characteristic: performance_efficiency
        subcharacteristic: not_applicable
        standard_term: performance efficiency
        display_name_ja: 性能効率性
        source_terms_ja: [性能]
      priority: intentionally_not_optimized
      value_ids: []
      rationale: "計測 Evidence が存在しない。未計測の数値目標を作らない（common-brief.md:20）。"
      owner: user
      evidence:
        - status: unknown
          source: "計測資料なし"
          supports: "性能を portfolio の最適化対象にできる根拠がないこと。"
      reevaluate_when: ["実利用の latency / bundle 計測が得られたとき"]

quality_scenarios:
  - id: Q1
    quality_item_id: QA1
    stimulus: "『再生位置の復元規則』（server 優先 → local fallback）を変更する要求が入る。"
    artifact: "lib/playbackPosition.ts と、その呼び出し経路（contexts/AudioPlayerContext.tsx:86-88, hooks/useAudioPlayer.ts:58-75）"
    environment: "通常開発。CI（.github/workflows/ci.yml）が green の main 派生ブランチ。"
    expected_response: "規則の変更が lib/playbackPosition.ts の 1 module 内に閉じ、localStorage 書き込み点・server 送信点の所有者が変わらない。"
    oracle: "grep で resume 規則を判断する分岐が playbackPosition.ts 以外に存在しないこと、および既存の position 関連テストが production 経路で green。"
    owner: user
    evidence:
      - status: contradiction
        source: "lib/playbackPosition.ts:25-37（純関数として規則を所有）vs hooks/useAudioPlayer.ts:69-75,126-128,139-142（localStorage 書き込みと throttle 規則を hook が所有）"
        supports: "規則の一部が hook 側にあり、期待応答を満たさない。"
    measurement_plan: "代表変更 simulation（VAL1）で、変更が必要な file 数を数える。数値目標は未設定。"
  - id: Q2
    quality_item_id: QA1
    stimulus: "『再生速度』の既定値・適用タイミングの仕様を変更する。"
    artifact: "contexts/AppContext.tsx:15,45-46,88-98, components/AudioPlayerBar.tsx:24-26,236-239, hooks/useAudioPlayer.ts:237-240"
    environment: "通常開発。"
    expected_response: "速度の source of truth を持つ単一 module の変更だけで完了し、UI component 内の同期 effect を書き換えずに済む。"
    oracle: "速度を保持・適用する箇所が 1 つであること（現在は AppContext.playbackSpeed と audio.playbackRate の 2 箇所）。"
    owner: user
    evidence:
      - status: confirmed
        source: "components/AudioPlayerBar.tsx:24-26 の eslint-disable 付き同期 effect が、state→audio の橋渡しを UI component に置いている。"
        supports: "期待応答を満たさない。"
    measurement_plan: "VAL1 の代表変更 simulation に含める。"
  - id: Q3
    quality_item_id: QA2
    stimulus: "『キューの次へ自動遷移』（Q-* 契約）の回帰テストを、production 経路を通して追加する。"
    artifact: "contexts/AudioPlayerContext.tsx:126-133 (handleEnded) と hooks/useAudioPlayer.ts:132-146 (handleEnded)"
    environment: "vitest + jsdom。lib/api.ts は本物、network は境界で置換。"
    expected_response: "audio element と network を境界で置換するだけで、queue 遷移規則を production 経路のまま検証できる。"
    oracle: "テストが @/lib/api 全体の vi.mock を必要とせず、注入された port の置換だけで成立すること。"
    owner: user
    evidence:
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:57-62,66-71,116-117,147-148 で createApiClient() が内部生成されており、注入 seam が無い。"
        supports: "module 全体の mock 以外で置換できない＝testability を満たさない。"
    measurement_plan: "VAL2（contract/dependency test）で、@/lib/api を vi.mock している test file 数を数える。"
  - id: Q4
    quality_item_id: QA3
    stimulus: "オフライン中に、キャッシュ未保存のエピソードを再生しようとする。"
    artifact: "lib/resolvePlayback.ts:22-27, contexts/AudioPlayerContext.tsx:99-123"
    environment: "navigator.onLine === false、Cache Storage に当該 id なし。"
    expected_response: "『オフラインのため再生できない』ことが、network 失敗（一時障害）とは区別された意味でユーザーへ伝わる。"
    oracle: "'unavailable' と 'network' が呼び出し側で別経路に分岐すること。"
    owner: user
    evidence:
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:104-105（source !== 'cached' なら一律 null を返し、'unavailable' と 'network' を同一扱い）→ :116-117 で必ず getPodcast() を試行"
        supports: "期待応答を満たさない。オフラインでも network 取得を試みて generic な失敗文言になる。"
    measurement_plan: "VAL3（failure injection）で offline 経路を再現。未実行。"
  - id: Q5
    quality_item_id: QA4
    stimulus: "共有端末で利用者 A がログアウトし、利用者 B が同じブラウザで /feed を開く。"
    artifact: "contexts/AuthContext.tsx:92-101, lib/audioCache.ts:121-125, lib/swCacheCleanup.ts:16-24, public/sw.js:22-24,84-87"
    environment: "同一ブラウザ profile、Service Worker 登録済み、Cache Storage に api-v1 / shell-pages-v1 / audio-v1 が存在。"
    expected_response: "利用者 A の認証済み応答（GET /api/backend/podcasts の一覧、閲覧済みページ HTML、保存音声）が B へ返らない。"
    oracle: "logout 完了後に caches.keys() が 'audio-'/'api-'/'shell-' prefix のいずれも認証済み内容を保持しないこと。"
    owner: user
    evidence:
      - status: confirmed
        source: "lib/swCacheCleanup.ts:21（'shell-' / 'api-' prefix を sw.js:23 から手複製）— 両者が乖離すると消し漏れる。"
        supports: "期待応答が単一の構造ではなく 2 箇所の手動同期に依存している。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:86-101 の logout 経路のみが cache 消去を行う。セッションが server 側で失効した場合（401 → refreshMe の :59-63）には消去されない。"
        supports: "『セッション失効時』（R6）の一部経路が未カバー。"
    measurement_plan: "VAL4（security review + 手動 E2E）。未実行。"
  - id: Q6
    quality_item_id: QA4
    stimulus: "管理者でない利用者（または未ログイン）が /admin/users を直接開き、/auth/me の解決前に画面を見る。"
    artifact: "app/(app)/admin/users/page.tsx:25,37-41,86-98, app/(app)/layout.tsx:11-21, contexts/AuthContext.tsx:47,118-123"
    environment: "status === 'unknown'（/auth/me 未解決）。"
    expected_response: "status が 'unknown' の間は admin UI（ユーザー作成フォーム・一覧）を描画しない。"
    oracle: "unknown 中の render 結果に data 入力要素が含まれないこと。"
    evidence:
      - status: confirmed
        source: "app/(app)/admin/users/page.tsx:86 の gate は `status === 'authenticated' && !isAdmin` のみ。unknown は素通りして :100 以降の admin UI を描画する。同型の gate が admin/metrics:70, admin/featured-sites:207, admin/invites:142 にもある。"
        supports: "R5 を満たさない。"
      - status: confirmed
        source: "app/(app)/layout.tsx:11-21 に auth gating が無く、middleware も存在しない（web/ 直下に middleware.ts / proxy.ts なし）。"
        supports: "route 層での防御も無い。"
    owner: user
    measurement_plan: "VAL5（component test で initialStatus='unknown' を注入）。未実行。"
```

---

## 4. current_findings — data authority の writer / reader / 主張された source of truth

### 4.0 authority 一覧表（path:line は全て読んで確認済み）

| fact | writer（状態を変える経路） | reader | 主張された source of truth | target authority は一意か |
|---|---|---|---|---|
| (a) 現在再生中の Podcast | `contexts/AudioPlayerContext.tsx:52-54` setQueueState（queue+queueRef）／同 `:91` dispatch SET_PODCAST → `contexts/AppContext.tsx:43-44`／`hooks/useAudioPlayer.ts:197` podcastIdRef | `lib/playbackQueue.ts:18-21` current()／`components/AudioPlayerBar.tsx:16,28,30,65-66`／`hooks/useAudioPlayer.ts:122-129,134-142`（位置保存の宛先） | コード内の明示宣言なし。`lib/playbackQueue.ts:7-12` が「現在再生中の位置」を名乗る | **No.** 3 系統が独立に保持。`playbackQueue.currentIndex`（queue 内位置）、`AppContext.currentPodcast`（UI 表示用の実体）、`podcastIdRef`（位置保存の宛先 id）が個別に更新され、整合を強制する不変条件が存在しない |
| (b) 再生速度 | `contexts/AppContext.tsx:45-46` SET_SPEED（dispatch 元は `components/AudioPlayerBar.tsx:239` と `app/(app)/settings/page.tsx:352` と `contexts/AppContext.tsx:93` の localStorage 復元）／`hooks/useAudioPlayer.ts:237-240` setSpeed は audio.playbackRate を直接書く | `components/AudioPlayerBar.tsx:25,236`／audio element 自身 | `contexts/AppContext.tsx:18-19` のコメントは volume / isPlaying を useAudioPlayer 所有と宣言するが、speed については宣言なし。`hooks/useAudioPlayer.ts:237-240` は state を持たない | **No.** 論理値は AppContext、実効値は audio element。橋渡しは `components/AudioPlayerBar.tsx:24-26` の eslint-disable 付き effect にあり、AudioPlayerBar が unmount（`:28` `if (!currentPodcast) return null`）していると同期しない |
| (c) 再生位置 | local: `hooks/useAudioPlayer.ts:69-75` savePosition（呼び出し `:126-127`, `:140`）／server: `contexts/AudioPlayerContext.tsx:57-62` updatePosition（`lib/api.ts:174`）／完聴: `contexts/AudioPlayerContext.tsx:66-71` markCompleted（`lib/api.ts:189`） | `hooks/useAudioPlayer.ts:58-67` getSavedPosition／`contexts/AudioPlayerContext.tsx:86-88` → `lib/playbackPosition.ts:25-37` | `lib/playbackPosition.ts:14-17` が「server 位置 > 0 なら authoritative」と宣言 | **Partially.** 読み出しの調停規則は `playbackPosition.ts` に一意。ただし **書き込み権限は二重**（localStorage と server へ hook / provider が別々に、throttle 規則 `hooks/useAudioPlayer.ts:10,121-129` も hook 側が単独所有）。dual writer に reconciliation / conflict rule の記述なし |
| (d) 認証状態 | `contexts/AuthContext.tsx:57-58,61-62,70-71,80-81,102-103,112-113` の setUser/setStatus（6 経路）／session cookie は `app/api/backend/[...path]/route.ts:113-121` が backend の Set-Cookie を中継／CSRF cookie は backend 発行、`lib/api.ts:74` が読む | `app/(app)/admin/*:25,38,86` 等／`contexts/AuthContext.tsx:119-123` | `contexts/AuthContext.tsx:12-13` が「ログイン可否は GET /auth/me の成否で判定」と宣言＝server session が source of truth | **No（表現上）.** 真の authority は server session cookie（JS から読めない httpOnly）だが、UI は client 側の `status` と `user` という**独立した 2 つの useState**（`:46-47`）を読む。`status: 'authenticated'` かつ `user: null` という不正状態を型が禁止していない。さらに `:59-63` は全 error（network 障害含む）を 'unauthenticated' へ畳み込むため、一時的な network 障害と本当の失効を区別できない |
| (e) 利用者別 cache | `lib/audioCache.ts:71,78,84` cache.put（'audio-v1'）／`public/sw.js:44,54` cache.put（shell-static-v1 / shell-pages-v1 / api-v1）／削除は `lib/audioCache.ts:113-125` と `public/sw.js:26-36` と `lib/swCacheCleanup.ts:16-24` | `lib/audioCache.ts:88-111`／SW の fetch handler `public/sw.js:63-90`／ブラウザ | `public/sw.js:70-72` が「/_audio/・/_audio-meta/ は audioCache.ts が単独管理」と宣言し、`public/sw.js:16-21` が「shell-/api- は SW が管理」と宣言 | **No.** 名前空間の分離は宣言されているが、その境界を表す prefix 文字列 `'shell-'`/`'api-'` が `public/sw.js:23` と `lib/swCacheCleanup.ts:21` に**手で複製**されている（両 file が「変更時は両方を揃えること」と明記）。さらに `lib/audioCache.ts:39-41` が管理する `/_audio-podcast/` prefix は `public/sw.js:72` の素通しリストに**含まれていない**ため、SW の素通し契約と audioCache の key 空間が既に乖離している |
| (f) localStorage key | `lib/config.ts:4-27` の定数経由: `hooks/useAudioPlayer.ts:44,60,71,248`, `contexts/AppContext.tsx:89,103,119`, `lib/sfx.ts:48,59`, `components/ui/ThemeToggle.tsx:32`, `app/(app)/settings/page.tsx:36`／生 literal: `app/layout.tsx:46` `'theme'`, `app/(app)/dashboard/page.tsx:48,65` `'seen_achievement_ids'` | 同上 | `lib/config.ts:1` が "single source of truth to prevent key typos" と明示宣言 | **No.** 宣言された authority を 2 箇所が迂回している。`'theme'` は inline script のため `lib/config.ts:12-15` が意図的に迂回を許容する旨をコメントしているが、`'seen_achievement_ids'` は config.ts に定数自体が存在せず、宣言された authority の外で key が定義されている |

追加評価（依存方向）:

| 依存 | 実体 | 方向の判定 |
|---|---|---|
| lib → lib（network） | `lib/audioCache.ts:20` `import { createApiClient } from '@/lib/api'`、使用は `:68`（downloadAudio が getPodcast を呼ぶ） | **違反。** 「cache という記憶装置」が「network という取得手段」へ依存しており、依存が内向きでない。`lib/api.ts` を除いた単体テストが不可能。同種の逸脱として `lib/reportClientError.ts:22` が `request()` を迂回して raw fetch する（network 経路が 2 系統） |
| contexts → components | `contexts/AudioPlayerContext.tsx:6` `import { useToast } from '@/components/ui/Toast'`、使用は `:78,120,158` | **違反。** 状態層（contexts）が表示層（components）へ依存。Toast を差し替えずに provider をテストできず、失敗の「意味」ではなく「文言」を provider が決めている |

### 4.1 finding records

```yaml
current_findings:
  - id: F1
    quality_scenario_ids: [Q6]
    levels: [local, system, journey]
    observed_symptom: "status === 'unknown'（/auth/me 未解決）の間、4 つの admin ページが管理 UI（ユーザー作成フォーム・招待発行・featured sites 編集・metrics）を描画する。"
    violated_quality_or_target: "QA4 confidentiality / R5（'unknown' 中に保護 UI を描画しない）"
    wrong_responsibility_or_authority: "認可 gating の authority が 4 つの page component に個別複製され、かつ真の authority（server session）の未解決状態を表現していない。"
    structural_cause: "gate 条件が `status === 'authenticated' && !isAdmin` という『否定形の 2 値判定』で書かれ、3 値 AuthStatus（contexts/AuthContext.tsx:16）の unknown が default-allow に落ちる。route 層（app/(app)/layout.tsx:11-21）にも middleware にも gating が無く、component が唯一の防御線になっている。"
    product_or_delivery_impact: "非管理者・未ログイン利用者が管理画面の構造と操作要素を見る。API 自体は backend で拒否される想定だが（未検証）、情報露出と誤操作導線が残る。"
    owner: user
    evidence:
      - status: confirmed
        source: "app/(app)/admin/users/page.tsx:86-98（gate）→ :100 以降が admin UI"
        supports: "unknown が素通りすること。"
      - status: confirmed
        source: "app/(app)/admin/metrics/page.tsx:70, app/(app)/admin/featured-sites/page.tsx:207, app/(app)/admin/invites/page.tsx:142"
        supports: "同一の欠陥が 4 箇所に複製されていること。"
      - status: confirmed
        source: "app/(app)/layout.tsx:11-21（StreakProvider + shell のみ）"
        supports: "route 層の防御が無いこと。"
      - status: unknown
        source: "backend 側の admin API 認可"
        supports: "露出が『UI のみ』か『データも』かを分ける。out_of_scope のため本 package では確定しない。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: high
          impact: "V2（機密性）に直結し、QA4 は constraint（trade-off 不可）。"
          rationale: "認可は他品質と交換してよい対象ではない。"
          evidence: [{status: confirmed, source: "common-brief.md:20（QL4 constraint）", supports: "constraint 指定"}]
        - kind: expected_change
          rating: medium
          impact: "admin 画面は今後も追加されうる。追加のたびに同じ gate が複製される。"
          rationale: "既に 4 回複製されている事実が、複製が既定の追加手順になっていることを示す。"
          evidence: [{status: confirmed, source: "app/(app)/admin/metrics/page.tsx:32 のコメント『AdminUsersPage と同じ認証ゲート様式を踏襲する』", supports: "複製が明示的な慣行であること"}]
        - kind: debt_impact
          rating: high
          impact: "1 箇所を直しても残り 3 箇所が残る。将来の admin ページも既定で同じ欠陥を持つ。"
          rationale: "authority が集約されていないため、修正コストが画面数に比例する。"
          evidence: [{status: confirmed, source: "上記 4 file の同一パターン", supports: "線形に増える修正対象"}]
        - kind: failure_risk
          rating: high
          impact: "unknown は初回ロード時に必ず通る状態であり、稀な条件ではない。"
          rationale: "contexts/AuthContext.tsx:47 の初期値が 'unknown'、:119-123 で isRestoring 完了後に初めて解決する。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:47,118-123", supports: "unknown が常時通る経路であること"}]
        - kind: remediation_cost
          rating: low
          impact: "gate を『authenticated かつ isAdmin の時だけ描画する』肯定形へ反転し、共通 component へ抽出する変更で足りる。data 移行なし。"
          rationale: "state の形も API も変えずに済む（R5 は既存 AuthStatus の 3 値で表現可能）。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:16（3 値 union が既に存在）", supports: "新しい概念を導入せずに直せること"}]
      comparison_rationale: "criticality=high / failure_risk=high / remediation_cost=low の組み合わせは、5 factor の中で最も『少ない投資で constraint 違反を除去できる』位置にある。F2・F3 が high criticality かつ高い remediation_cost であるのに対し、F1 だけが低コストで constraint を回復する。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "priority owner は user。本 review 時点で user の優先度指示を受け取っていないため、AI は候補順位のみ提示する。SG1 で確定する。"
        evidence: [{status: unknown, source: "user からの優先度指示なし", supports: "owner 未確定"}]
    priority: unknown

  - id: F2
    quality_scenario_ids: [Q5]
    levels: [local, system, journey, organization]
    observed_symptom: "認証済み応答を格納する Cache Storage の名前空間境界が、public/sw.js:23 と lib/swCacheCleanup.ts:21 に手で複製された prefix 文字列で表現されている。さらに audioCache が使う /_audio-podcast/ が sw.js:72 の素通しリストに無い。"
    violated_quality_or_target: "QA4 confidentiality / R6（Cache Storage の認証済み応答がセッション失効時に他利用者へ返らない）、QA1 modifiability"
    wrong_responsibility_or_authority: "『どの cache が利用者固有か』という意味の所有者が存在せず、SW（classic script）と lib の 2 実装が同じ規約を独立に持つ。"
    structural_cause: "public/sw.js が classic script で import できない（public/sw.js のコメント、lib/swCacheCleanup.ts:6-10 に明記）ため、共有すべき定数を共有できず複製した。build 時生成や manifest 経由の一元化が採られていない。"
    product_or_delivery_impact: "cache 名規約を片側だけ変更すると、logout 時に利用者 A の podcast 一覧・閲覧済みページが残留し、B に返る。また server 側失効（401）経路（contexts/AuthContext.tsx:59-63）では消去が一切走らない。"
    owner: user
    evidence:
      - status: confirmed
        source: "public/sw.js:20-21 と lib/swCacheCleanup.ts:6-10（双方が『両方を揃えて更新すること』と明記）"
        supports: "複製が既知かつ人手同期に依存すること。"
      - status: confirmed
        source: "lib/audioCache.ts:39-41（podcastKey = /_audio-podcast/）vs public/sw.js:72（/_audio/ と /_audio-meta/ のみ素通し）"
        supports: "名前空間契約が既に乖離していること。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:59-63（全 error → unauthenticated、cache 消去なし）vs :92-101（明示 logout のみ消去）"
        supports: "『セッション失効時』の一部経路で R6 が成立しないこと。"
      - status: confirmed
        source: "public/sw.js:84-87（GET /api/backend/podcasts を URL キーで networkFirst 格納）"
        supports: "利用者固有応答が cache に入ること。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: high
          impact: "V2 に直結。QA4 constraint。"
          rationale: "実データ（利用者固有の一覧・閲覧済み HTML）の他者露出。"
          evidence: [{status: confirmed, source: "lib/swCacheCleanup.ts:2-4", supports: "残留 risk の明記"}]
        - kind: expected_change
          rating: medium
          impact: "SW_VERSION 更新や cache 追加のたびに双方の同期が必要。"
          rationale: "public/sw.js:9-14 が version bump を前提とした運用を記述している。"
          evidence: [{status: confirmed, source: "public/sw.js:9-14", supports: "version 変更が想定運用であること"}]
        - kind: debt_impact
          rating: high
          impact: "乖離が静かに起きる（型・テストで検出されない）。/_audio-podcast/ で既に乖離が発生済み。"
          rationale: "実際に片側だけ更新された痕跡が観測できる。"
          evidence: [{status: confirmed, source: "lib/audioCache.ts:39-41 vs public/sw.js:72", supports: "既発の乖離"}]
        - kind: failure_risk
          rating: medium
          impact: "共有端末かつ SW 有効かつ片側変更、という条件の重なりが必要。ただし 401 失効経路の未消去は条件なしで常時成立する。"
          rationale: "prefix 乖離は条件付きだが、失効経路の未消去は無条件。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:59-63", supports: "無条件で成立する部分があること"}]
        - kind: remediation_cost
          rating: medium
          impact: "prefix の一元化は build 生成 or SW への postMessage 化が必要で、SW 更新ライフサイクル（activate/claim）の検証を伴う。401 失効経路への消去追加は低コスト。"
          rationale: "2 つの修正が別コストを持つため分割できる。"
          evidence: [{status: confirmed, source: "public/sw.js:26-36（activate 時のみ削除）", supports: "SW ライフサイクル依存"}]
      comparison_rationale: "F1 と同じく constraint 違反だが、remediation_cost が medium であり、かつ最も危険な部分（401 失効時の未消去）は F1 並みに安く直せる。したがって F2 は『分割すれば一部は F1 と同等優先、残りは次順』という構造を持つ。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が優先度を確定する（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F3
    quality_scenario_ids: [Q1, Q2, Q3]
    levels: [local, system, future_change]
    observed_symptom: "『現在再生中の Podcast』が playbackQueue.currentIndex / AppContext.currentPodcast / useAudioPlayer.podcastIdRef の 3 箇所に、相互の不変条件なしに保持される。速度は AppContext と audio element の 2 箇所。"
    violated_quality_or_target: "QA1 modifiability, QA3 fault tolerance / R3（source of truth が一意）"
    wrong_responsibility_or_authority: "『現在再生中』という 1 つの概念に semantic owner が居ない。queue は位置を、AppContext は表示用実体を、hook は位置保存の宛先 id を、それぞれ自分の都合で持つ。"
    structural_cause: "contexts/AudioPlayerContext.tsx:91 が loadAndPlay の副作用として AppContext へ dispatch し、hooks/useAudioPlayer.ts:197 が load() の副作用として ref を書く。両者を同時に正しく更新する契約が型でも関数でも表現されていない（`load(url, resume, podcastId)` という 3 引数 primitive 渡しが、Podcast という概念を分解して渡している）。lib/playbackQueue.ts:7-12 の currentIndex は items と無関係な `number | null` であり、範囲外を型が禁止しない。"
    product_or_delivery_impact: "AudioPlayerBar が非表示（components/AudioPlayerBar.tsx:28）の状態で速度が同期されない。queue 操作と AppContext.currentPodcast がずれると、表示中の曲と保存先 podcastId が食い違い、再生位置が別エピソードへ保存されうる（未実証・VAL3 で確認が必要）。仕様（Q-*/RT-*）変更時に 3 箇所を同時に直す必要がある。"
    owner: user
    evidence:
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:85-93（load → play → dispatch の順で 3 系統を更新）"
        supports: "更新が手順依存で、途中で例外が出れば不整合が残ること。"
      - status: confirmed
        source: "hooks/useAudioPlayer.ts:122-129（podcastIdRef.current を宛先に localStorage/server へ保存）"
        supports: "ref が実質の書き込み authority であること。"
      - status: confirmed
        source: "lib/playbackQueue.ts:11（currentIndex: number | null）, :56（currentIndex === -1 ? null : currentIndex）"
        supports: "index が items と独立で、防御的分岐が必要になっていること。"
      - status: confirmed
        source: "components/AudioPlayerBar.tsx:24-26（eslint-disable 付き同期 effect）, :28（早期 return）"
        supports: "速度同期が UI の描画有無に従属すること。"
      - status: confirmed
        source: "lib/playbackQueue.ts:30,35（start / setQueue が contexts/AudioPlayerContext.tsx から呼ばれていない＝未使用の公開 API）"
        supports: "公開面が実際の authority と一致していないこと。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: medium
          impact: "V1（聴取状態の一意な復元）に直結するが、QA1/QA3 は primary/secondary であり constraint ではない。"
          rationale: "誤動作は体験を損なうが、機密性違反のような不可逆な損害ではない。"
          evidence: [{status: confirmed, source: "common-brief.md:20（QL1 primary, QL3 secondary）", supports: "constraint ではないこと"}]
        - kind: expected_change
          rating: high
          impact: "shared-playback-spec の Q-*/RT-* は iOS と共有される正本であり、改訂が繰り返し発生している。"
          rationale: "tests/lib/playbackQueue.conformance.test.ts:8 が『正本と web 実装の乖離（Q-26/Q-28/Q-32）は spec 制定と同時に実装修正済み』と記録している＝乖離と追随が実際に起きた。"
          evidence: [{status: confirmed, source: "tests/lib/playbackQueue.conformance.test.ts:1-8", supports: "仕様追随が反復的作業であること"}]
        - kind: debt_impact
          rating: high
          impact: "3 系統の同時更新が手順に埋まっているため、仕様変更のたびに provider の副作用順序を読み解く必要がある。新しい再生起点（例: 通知からの再生）を足すたびに 3 箇所の更新漏れ risk が増える。"
          rationale: "変更の影響範囲が module 境界ではなく実行順序で決まっている。"
          evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:143-161（playById が queue 操作と loadAndPlay を順に行う）, :112-123（fetchAndPlay が別経路で同じことを行う）", supports: "起点ごとに手順が複製されていること"}]
        - kind: failure_risk
          rating: medium
          impact: "整合が壊れる具体的トリガ（例外時・UI 非表示時）は存在するが、通常操作では順序が守られる。"
          rationale: "AudioPlayerBar 非表示時の速度非同期は確定的、位置の誤保存は未実証。"
          evidence: [{status: inferred, source: "components/AudioPlayerBar.tsx:28 と :24-26 の組み合わせ", supports: "確定的な不整合が 1 つはあること"}]
        - kind: remediation_cost
          rating: high
          impact: "『現在再生中』を 1 つの state authority へ集約するには、queue・AppContext・hook・AudioPlayerBar の 4 者の契約を同時に変える。既存 test（@/lib/api を vi.mock する 25 file を含む）の広範な書き換えを伴う。"
          rationale: "authority 移動は公開 hook の形（useAudioPlayerContext の値）に触れるため、consumer 側も動く。"
          evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:198-208（Player & QueueApi を丸ごと公開）", supports: "consumer 面が広いこと"}]
      comparison_rationale: "F3 は expected_change=high・debt_impact=high で『放置すると最も複利で悪化する』が、criticality=medium かつ remediation_cost=high である。F1/F2 が constraint 違反を低〜中コストで除去できるのに対し、F3 は大きい投資を要する構造改革であり、投資判断（SG2）を user が持つべき対象である。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1/SG2）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F4
    quality_scenario_ids: [Q3]
    levels: [local, system]
    observed_symptom: "lib/audioCache.ts:20 が lib/api.ts を import し、contexts/AudioPlayerContext.tsx:6 が components/ui/Toast を import する。createApiClient() は 21 file / 60 箇所で内部生成される。"
    violated_quality_or_target: "QA2 testability, QA1 modifiability / R7（テストが production 経路を通る）"
    wrong_responsibility_or_authority: "network 取得の contract owner が存在せず、各 consumer が自分で client を生成する。cache（記憶）が network（取得手段）へ、状態層が表示層へ依存している。"
    structural_cause: "注入 seam（port）が無い。createApiClient() は factory だが引数を取らず差し替え点にならない（lib/api.ts:124）。結果、テストは module 全体の vi.mock に頼るしかない。"
    product_or_delivery_impact: "契約テストが production 経路を通らず、api 側の変更がテストをすり抜ける。lib/audioCache.ts の単体テストに network module が必要。lib/reportClientError.ts:22 が request() を迂回する第 2 の network 経路を作っており、CSRF/エラー正規化の規約が適用されない。"
    owner: user
    evidence:
      - status: confirmed
        source: "lib/audioCache.ts:20,68"
        supports: "lib→lib の network 依存。"
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:6,78,120,158"
        supports: "contexts→components 依存。"
      - status: confirmed
        source: "lib/api.ts:124（createApiClient は引数なし）、grep 結果 60 occurrences / 21 files"
        supports: "差し替え点が存在しないこと。"
      - status: confirmed
        source: "lib/reportClientError.ts:22（request() を通らない raw fetch）vs lib/api.ts:69-78（CSRF 注入）, :88-112（ApiError 正規化）"
        supports: "network 経路が 2 系統あり、規約が片方に適用されないこと。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: medium
          impact: "直接の利用者被害ではなく、QA2（primary）を通じた間接的な品質保証能力の低下。"
          rationale: "テストが production 経路を通らないと、他の全 finding の検証も弱くなる。"
          evidence: [{status: confirmed, source: "common-brief.md:29（R7）", supports: "R7 が明示要件であること"}]
        - kind: expected_change
          rating: high
          impact: "api.ts は 554 行・9 ドメインへ成長しており、機能追加のたびに触られる。"
          rationale: "lib/api.ts の行数と関数数が継続的増加を示す。"
          evidence: [{status: confirmed, source: "wc -l lib/api.ts = 554", supports: "規模と成長"}]
        - kind: debt_impact
          rating: high
          impact: "F1–F3 の修正を安全に行うための前提（isolation されたテスト）が成立しない。つまり他 finding の remediation_cost を押し上げる増幅器である。"
          rationale: "21 file に散った生成点を後から seam 化するコストは、file 数に比例する。"
          evidence: [{status: confirmed, source: "grep: createApiClient 21 files", supports: "分散の規模"}]
        - kind: failure_risk
          rating: low
          impact: "実行時の直接的な失敗は起こさない（reportClientError の CSRF 免除は backend 側で意図的、lib/reportClientError.ts:4）。"
          rationale: "構造的負債であり runtime fault ではない。"
          evidence: [{status: confirmed, source: "lib/reportClientError.ts:4（CSRF 免除が意図的である旨）", supports: "現時点で実害が無いこと"}]
        - kind: remediation_cost
          rating: medium
          impact: "port 定義 + 生成点の provider 化は機械的だが 21 file に及ぶ。段階適用が可能（新規経路から port 化、既存は順次）。"
          rationale: "変更が局所的かつ反復的で、1 file ずつ atomic commit にできる。"
          evidence: [{status: inferred, source: "createApiClient の呼び出し形が一様であること（grep 結果）", supports: "機械的移行が可能であること"}]
      comparison_rationale: "F4 は単独では criticality=medium・failure_risk=low だが、debt_impact=high の内実が『他 finding の修正コストを上げる』である点で、順序判断において F3 より前に置く候補になりうる。この順序は投資判断であり user が決める（SG2）。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F5
    quality_scenario_ids: [Q4]
    levels: [local, journey]
    observed_symptom: "lib/resolvePlayback.ts:16 が 'cached' | 'network' | 'unavailable' の 3 値を返すが、contexts/AudioPlayerContext.tsx:104-105 は 'cached' 以外を一律 null に畳み込む。"
    violated_quality_or_target: "QA3 fault tolerance / R4（失敗の意味を消費者が意味として受け取る）"
    wrong_responsibility_or_authority: "『再生元が決まらない理由』の意味所有者が resolvePlayback にあるのに、消費者がその意味を捨てている。"
    structural_cause: "resolveCachedPodcast の戻り値型が `Podcast | null` であり、3 値の情報を運べない型に縮約されている。"
    product_or_delivery_impact: "オフラインかつ未キャッシュの時に、無意味な getPodcast() を試みたうえで『再生できませんでした (0)』という transport 値混じりの文言（contexts/AudioPlayerContext.tsx:120,158）が出る。R4 が禁じる『status:0 への依存』が UI 文言に露出している。"
    owner: user
    evidence:
      - status: confirmed
        source: "lib/resolvePlayback.ts:16,22-27"
        supports: "3 値の意味が定義されていること。"
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:100-105"
        supports: "意味の畳み込み。"
      - status: confirmed
        source: "contexts/AudioPlayerContext.tsx:120,158（`再生できませんでした (${err.status})`）と lib/api.ts:85（network error は ApiError(0)）"
        supports: "transport 値 0 が利用者向け文言へ出ること。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: low
          impact: "体験上の分かりにくさ。データ損失や露出はない。"
          rationale: "QA3 は secondary。"
          evidence: [{status: confirmed, source: "common-brief.md:20", supports: "secondary"}]
        - kind: expected_change
          rating: low
          impact: "オフライン判定規則は安定している。"
          rationale: "lib/resolvePlayback.ts は 27 行の純関数で変更要因が少ない。"
          evidence: [{status: inferred, source: "lib/resolvePlayback.ts 全体", supports: "小さく安定した module"}]
        - kind: debt_impact
          rating: low
          impact: "影響が 1 関数の戻り値型に閉じる。"
          rationale: "resolveCachedPodcast の呼び出しは contexts/AudioPlayerContext.tsx:116,147 の 2 箇所のみ。"
          evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:116,147", supports: "呼び出し点が 2 つ"}]
        - kind: failure_risk
          rating: low
          impact: "誤った再生は起きず、文言が不親切になるだけ。"
          rationale: "失敗時の分岐は全て catch されている。"
          evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:118-121", supports: "catch 済み"}]
        - kind: remediation_cost
          rating: low
          impact: "戻り値を判別可能 union にし、呼び出し 2 箇所で分岐する。"
          rationale: "既存の純関数がそのまま使える。"
          evidence: [{status: confirmed, source: "lib/resolvePlayback.ts:16", supports: "union が既にある"}]
      comparison_rationale: "全 factor が low であり、F1–F4 のいずれよりも後順位。ただし remediation_cost も low のため、F1 修正時の『ついで』としては成立しうる。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F6
    quality_scenario_ids: [Q5, Q6]
    levels: [local, system]
    observed_symptom: "contexts/AuthContext.tsx:46-47 で user と status が独立した 2 つの useState として保持され、`status: 'authenticated'` かつ `user: null` を型が禁止しない。また :59-63 が全 error を 'unauthenticated' に畳み込む。"
    violated_quality_or_target: "QA4 confidentiality, QA3 fault tolerance / R2（不正状態を公開経路から構築できない）, R4"
    wrong_responsibility_or_authority: "認証状態の invariant owner が存在しない。AuthProvider の test-only props（:39-41 initialUser / initialStatus）は、不正な組み合わせを公開経路から注入できる。"
    structural_cause: "状態が判別可能 union（例: {status:'authenticated', user: AuthUser} | {status:'unauthenticated'} | {status:'unknown'}）ではなく直積で表現されている。失敗の意味（network 障害 vs 401）が catch で消される。"
    product_or_delivery_impact: "consumer（app/(app)/admin/*:25 の `user?.role === 'admin'`）は user の存在を optional chaining で防御せざるを得ず、F1 の gate 誤りを誘発する。network 障害時に利用者が『ログアウトされた』と誤認する。"
    owner: user
    evidence:
      - status: confirmed
        source: "contexts/AuthContext.tsx:46-47"
        supports: "直積表現。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:37-42（initialUser / initialStatus を任意の組み合わせで受ける）"
        supports: "不正状態を公開経路（props）から構築できること。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:59-63（catch で全 error を同一扱い）"
        supports: "失敗の意味の消失。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: high
          impact: "QA4 constraint に接続し、F1 の構造的前提でもある。"
          rationale: "認可判定の入力が不正状態を許すなら、判定側をいくら直しても保証にならない。"
          evidence: [{status: confirmed, source: "app/(app)/admin/users/page.tsx:25,86", supports: "consumer が入力の健全性に依存していること"}]
        - kind: expected_change
          rating: medium
          impact: "passkey ログイン（:108-116）等、認証方式の追加のたびに setUser/setStatus のペアが増える（現在 6 経路）。"
          rationale: "更新点が方式数に比例する。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:57-58,61-62,70-71,80-81,102-103,112-113", supports: "6 経路"}]
        - kind: debt_impact
          rating: medium
          impact: "union 化は AuthContextValue の公開形を変えるため consumer（admin 4 画面 + LoginModal 等）が動く。"
          rationale: "公開契約に触れる。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:18-33（公開 interface）", supports: "consumer 影響"}]
        - kind: failure_risk
          rating: medium
          impact: "現在の全 6 経路は常にペアで更新しており、実際の不正状態は観測されていない。将来の追加で壊れうる。"
          rationale: "規律で守られているが型では守られていない。"
          evidence: [{status: confirmed, source: "contexts/AuthContext.tsx の 6 経路が全てペア更新", supports: "現時点では整合していること"}]
        - kind: remediation_cost
          rating: medium
          impact: "union 化 + consumer 追随。data 移行なし。"
          rationale: "型変更に伴う機械的追随が中心。"
          evidence: [{status: inferred, source: "consumer が `user?.role` 形で一様であること", supports: "機械的追随が可能"}]
      comparison_rationale: "F6 は F1 の上流原因である。F1 を単独で直すと『症状の除去』、F6 を直すと『不正状態の構築不能化』になる。criticality=high だが remediation_cost=medium であり、F1（cost=low）より後、F3（cost=high）より前の候補。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F7
    quality_scenario_ids: [Q1]
    levels: [local]
    observed_symptom: "lib/config.ts:1 が localStorage key の single source of truth を宣言するが、app/layout.tsx:46 が 'theme' を、app/(app)/dashboard/page.tsx:48,65 が 'seen_achievement_ids' を生 literal で使う。後者の定数は config.ts に存在しない。"
    violated_quality_or_target: "QA1 modifiability"
    wrong_responsibility_or_authority: "宣言された semantic owner（lib/config.ts）を 2 箇所が迂回している。"
    structural_cause: "'theme' は inline script（app/layout.tsx:46）で module import が使えないため構造的に迂回が必要で、lib/config.ts:12-15 がその旨を明記している（＝意図的）。'seen_achievement_ids' には理由の記録も定数もない（＝未管理）。"
    product_or_delivery_impact: "key 名変更時に検出されない書き漏れが起きる。'seen_achievement_ids' は logout 時の消去対象（contexts/AuthContext.tsx:92-101）にも含まれず、共有端末で達成状況が残る（QA4 への波及、未検証）。"
    owner: user
    evidence:
      - status: confirmed
        source: "lib/config.ts:1,12-15"
        supports: "宣言と、theme 迂回の意図的な例外記録。"
      - status: confirmed
        source: "app/(app)/dashboard/page.tsx:48,65"
        supports: "未管理 key の存在。"
      - status: confirmed
        source: "contexts/AuthContext.tsx:92-101（cache のみ消去、localStorage は対象外）"
        supports: "logout で localStorage が消えないこと。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: low
          impact: "QA1 への局所的影響。QA4 への波及は達成状況という低機密データに限られる。"
          rationale: "露出データが認証情報や本文ではない。"
          evidence: [{status: inferred, source: "app/(app)/dashboard/page.tsx:48（達成 ID の配列）", supports: "低機密"}]
        - kind: expected_change
          rating: low
          impact: "key 追加は稀。"
          rationale: "lib/config.ts は 27 行で 6 key。"
          evidence: [{status: confirmed, source: "lib/config.ts 全体", supports: "小規模"}]
        - kind: debt_impact
          rating: low
          impact: "影響が 2 file に閉じる。"
          rationale: "grep で全数把握済み。"
          evidence: [{status: confirmed, source: "grep localStorage 結果（app/layout.tsx:46, dashboard:48,65 のみが生 literal）", supports: "全数 2 箇所"}]
        - kind: failure_risk
          rating: low
          impact: "現状で壊れていない。"
          rationale: "key 名が変更されていない。"
          evidence: [{status: confirmed, source: "lib/config.ts:16（KEY_THEME='theme' が inline script と一致）", supports: "現在は整合"}]
        - kind: remediation_cost
          rating: low
          impact: "定数を 1 つ追加し 2 箇所を置換。inline script 側は既存コメントの運用を維持。"
          rationale: "機械的。"
          evidence: [{status: confirmed, source: "lib/config.ts:25-27（既存の key builder パターン）", supports: "追加が容易"}]
      comparison_rationale: "全 factor low。F5 と同順位帯の最下位群であり、単独投資の対象にはならない。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown

  - id: F8
    quality_scenario_ids: [Q3]
    levels: [organization, future_change]
    observed_symptom: ".github/workflows/ci.yml:24-27 は lint / typecheck（TS6）/ test のみを実行し、typecheck:ts7 も npm run build も npm audit も実行しない。"
    violated_quality_or_target: "QA2 testability / R8（CI は typecheck:ts7・build を独立ゲートとして実行する）"
    wrong_responsibility_or_authority: "『TS7 互換性を確認する責任』が人手の随時実行に置かれ、CI の gate に無い。"
    structural_cause: "web/agent-rules/70-typescript-version-policy.md:16 は `npm run typecheck:ts7` を『直接パス呼び出しして動作確認する』と定めるだけで、CI 実行を明文で要求していない。R8 は router が置いた要件であり、rule 70 の文言そのものではない（**common-brief の『rule 70 :16』の引用に対する訂正**: :16 は script 定義の説明であって CI ゲート要求ではない）。"
    product_or_delivery_impact: "TS7 で壊れる変更が main に入っても検出されない。build 固有の失敗（Next.js のビルド時型チェック・RSC 制約）も PR で検出されない。"
    owner: user
    evidence:
      - status: confirmed
        source: ".github/workflows/ci.yml:24-27（npm ci / lint / typecheck / test）, :45-46（e2e）, :59-60（gitleaks）"
        supports: "typecheck:ts7・build・audit が無いこと。"
      - status: confirmed
        source: "package.json:11（typecheck:ts7 script は存在する）"
        supports: "gate に足す手段は既にあること。"
      - status: confirmed
        source: "web/agent-rules/70-typescript-version-policy.md:16"
        supports: "rule は script 実行を定めるが CI 実行を明文要求していないこと（R8 の出所は router）。"
    priority_assessment:
      factors:
        - kind: business_criticality
          rating: medium
          impact: "リリース品質の検出能力。利用者への直接影響は間接的。"
          rationale: "build 失敗は deploy 時に必ず露見するため、被害は手戻りコスト。"
          evidence: [{status: inferred, source: ".github/workflows/ci.yml に deploy job が無い（deploy は Vercel 側と推定）", supports: "検出が後段へずれること"}]
        - kind: expected_change
          rating: medium
          impact: "TS7 移行（rule 70 の撤去条件）に向けて typecheck:ts7 の green 維持が必要。"
          rationale: "rule 70 が撤去手順を明記しており、移行が予定されている。"
          evidence: [{status: confirmed, source: "web/agent-rules/70-typescript-version-policy.md:20-24（撤去条件）", supports: "移行が予定作業であること"}]
        - kind: debt_impact
          rating: low
          impact: "CI に 2 行足すだけで解消し、他の finding に波及しない。"
          rationale: "独立した設定変更。"
          evidence: [{status: confirmed, source: ".github/workflows/ci.yml:24-27", supports: "追加位置が明確"}]
        - kind: failure_risk
          rating: medium
          impact: "現在 typecheck:ts7 が green かどうか不明（本 review では未実行）。既に赤い可能性がある。"
          rationale: "実行 Evidence が無い。"
          evidence: [{status: unknown, source: "typecheck:ts7 未実行", supports: "現状不明"}]
        - kind: remediation_cost
          rating: low
          impact: "ci.yml への step 追加。ただし typecheck:ts7 が現在赤なら、赤の解消コストが別途かかる（未知）。"
          rationale: "設定変更自体は最小。"
          evidence: [{status: confirmed, source: "package.json:11", supports: "script が既存"}]
      comparison_rationale: "remediation_cost=low かつ debt_impact=low で独立性が高く、他 finding の順位に影響しない。『安く独立に入れられる gate』として F1 と並行して扱える候補。"
      owner:
        status: unknown
        value: ""
        resolution_or_reason: "user が確定（SG1）。"
        evidence: [{status: unknown, source: "指示なし", supports: "未確定"}]
    priority: unknown
```

### 4.2 debt priority 候補（AI 提示。最終順位は user が SG1 で確定する）

5 factor の比較から、AI は次の順を**候補として**提示する。数値 score は用いない（根拠のない換算を避けるため）。

| 候補順 | finding | criticality | expected_change | debt_impact | failure_risk | remediation_cost | 提示理由 |
|---|---|---|---|---|---|---|---|
| 1 | F1 | high | medium | high | high | **low** | constraint（QA4）違反を最小投資で除去できる唯一の finding |
| 2 | F2 | high | medium | high | medium | medium | 同じく constraint 違反。401 失効経路の消去追加だけなら low cost に分割可能 |
| 3 | F4 | medium | high | high | low | medium | 他 finding の remediation_cost を下げる増幅器。F3 より先に置く合理性がある |
| 4 | F6 | high | medium | medium | medium | medium | F1 の上流原因。F1 を症状対処で終えるか構造対処するかの分岐点 |
| 5 | F3 | medium | high | high | medium | **high** | 最も複利で悪化するが最大投資。投資判断そのものが user 所有 |
| 6 | F8 | medium | medium | low | medium | low | 独立・低コスト。並行投入可 |
| 7 | F5 | low | low | low | low | low | 単独投資不要。F1/F6 のついで |
| 8 | F7 | low | low | low | low | low | 同上 |

---

## 5. options（top 3 debt = F1 / F2 / F4 について、current と do-minimum を含む）

```yaml
options:
  # ---- F1: unknown 中の admin UI 描画 ----
  - id: O1
    kind: do_nothing
    summary: "現状維持。4 つの admin ページが `status === 'authenticated' && !isAdmin` の否定形 gate を持ち続ける。"
    owner: user
    addresses_finding_ids: [F1]
    improves_quality_scenario_ids: []
    degrades_quality_scenario_ids: [Q6]
    scope: ["app/(app)/admin/*"]
    system_effects:
      local: ["変更なし"]
      system: ["認可 gating の authority が分散したまま"]
      journey: ["未解決状態で管理 UI が見える体験が継続"]
      organization: ["admin ページ追加のたびに同じ gate をコピーする慣行が継続（app/(app)/admin/metrics/page.tsx:32 が明示）"]
      future_change: ["画面数に比例して修正コストが増える"]
    costs: ["build: 0", "将来の remediation cost が線形増加"]
    risks: ["QA4 constraint 違反が継続する（common-brief.md:20 で constraint 指定）"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "app/(app)/admin/users/page.tsx:86", supports: "現状の gate 形"}]
    assumption_ids: []
    unknown_ids: [U1]
    validation_ids: [VAL5]
  - id: O2
    kind: do_minimum
    summary: "各 admin ページの gate を肯定形へ反転する（`status !== 'authenticated' || !isAdmin` なら管理 UI を描画しない）。4 file の局所修正のみ。"
    owner: user
    addresses_finding_ids: [F1]
    improves_quality_scenario_ids: [Q6]
    degrades_quality_scenario_ids: []
    scope: ["app/(app)/admin/users/page.tsx", "app/(app)/admin/metrics/page.tsx", "app/(app)/admin/featured-sites/page.tsx", "app/(app)/admin/invites/page.tsx"]
    system_effects:
      local: ["各 page の早期 return 条件が変わる"]
      system: ["authority は依然 4 箇所に分散"]
      journey: ["unknown 中は読み込み表示（または非表示）になり、R5 を満たす"]
      organization: ["コピー慣行は残る"]
      future_change: ["新しい admin ページは再び誤る可能性がある"]
    costs: ["build: 小（4 file の条件式）", "test: 各 page に initialStatus='unknown' の component test を追加"]
    risks: ["新規 admin ページで再発する（構造的には未解決）"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:37-42（AuthProvider が initialStatus を受けるためテストで unknown を注入可能）", supports: "低コストで検証可能なこと"}]
    assumption_ids: []
    unknown_ids: [U1]
    validation_ids: [VAL5]
  - id: O3
    kind: incremental
    summary: "認可 gating を単一の `<RequireAdmin>` boundary component（または route group layout）へ集約し、admin 配下の全ページがそれを通る構造にする。合わせて F6（AuthStatus の union 化）へ接続できる形にする。"
    owner: user
    addresses_finding_ids: [F1, F6]
    improves_quality_scenario_ids: [Q6]
    degrades_quality_scenario_ids: []
    scope: ["app/(app)/admin/ の route layout もしくは共通 component", "contexts/AuthContext.tsx の公開形（F6 と併合する場合）"]
    system_effects:
      local: ["各 page から gate 判定が消える"]
      system: ["認可の state authority が 1 箇所になる"]
      journey: ["unknown / unauthenticated / non-admin の 3 分岐が一様な体験になる"]
      organization: ["新規 admin ページは layout を継承するだけで安全になる"]
      future_change: ["認可ルール追加（role 追加等）が 1 箇所で済む"]
    costs: ["build: 中（layout 追加 + 4 page の改修）", "test: boundary component の unit test + 各 page の回帰"]
    risks: ["route group layout に置く場合、Next.js の client/server 境界の扱いを確認する必要がある（未検証）"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "app/(app)/layout.tsx:11-21（route group layout が既に client component として機能している）", supports: "同様の layout を admin 配下に置ける見込み"}]
    assumption_ids: [P1]
    unknown_ids: [U1, U2]
    validation_ids: [VAL5]

  # ---- F2: cache 名前空間の二重定義と失効時未消去 ----
  - id: O4
    kind: do_nothing
    summary: "現状維持。prefix を public/sw.js:23 と lib/swCacheCleanup.ts:21 に手で同期し続け、cache 消去は明示 logout のみ。"
    owner: user
    addresses_finding_ids: [F2]
    improves_quality_scenario_ids: []
    degrades_quality_scenario_ids: [Q5]
    scope: ["public/sw.js", "lib/swCacheCleanup.ts", "contexts/AuthContext.tsx"]
    system_effects:
      local: ["変更なし"]
      system: ["名前空間契約の乖離（/_audio-podcast/）が残る"]
      journey: ["401 失効時に cache が残る"]
      organization: ["両 file を揃える運用規律に依存し続ける"]
      future_change: ["cache 種別追加のたびに同期漏れ risk"]
    costs: ["build: 0"]
    risks: ["QA4 constraint 違反が継続"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "lib/audioCache.ts:39-41 vs public/sw.js:72", supports: "既に乖離していること"}]
    assumption_ids: []
    unknown_ids: [U3]
    validation_ids: [VAL4]
  - id: O5
    kind: do_minimum
    summary: "『セッション失効の検知点』（contexts/AuthContext.tsx:59-63 の refreshMe catch）からも cache 消去を呼ぶ。prefix の二重定義はそのまま残す。"
    owner: user
    addresses_finding_ids: [F2]
    improves_quality_scenario_ids: [Q5]
    degrades_quality_scenario_ids: []
    scope: ["contexts/AuthContext.tsx"]
    system_effects:
      local: ["refreshMe の失敗経路に消去を追加"]
      system: ["消去 trigger が 2 箇所になるが、いずれも AuthContext 内で一元化できる"]
      journey: ["401 失効後に他利用者へ cache が返らない"]
      organization: ["変更なし"]
      future_change: ["prefix 乖離 risk は残る"]
    costs: ["build: 小", "test: refreshMe 失敗時に消去が呼ばれる unit test"]
    risks: ["**一時的な network 障害でも消去が走り、オフライン保存音声（audio-v1）を失う。** これは QA3（fault tolerance）と QA4 の trade-off であり、F6（失敗の意味の区別）を先に解かないと安全に実施できない。"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:59-63（network 障害と 401 が同一 catch）", supports: "trade-off が実在すること"}]
    assumption_ids: []
    unknown_ids: [U3]
    validation_ids: [VAL4]
  - id: O6
    kind: incremental
    summary: "利用者固有 cache の名前空間を 1 箇所（build 時生成の定数 or SW への postMessage）で定義し、SW と lib が同じ定義を参照する。合わせて F6 で 401 と network 障害を区別したうえで、失効検知点から消去する。"
    owner: user
    addresses_finding_ids: [F2, F6]
    improves_quality_scenario_ids: [Q5]
    degrades_quality_scenario_ids: []
    scope: ["public/sw.js", "lib/swCacheCleanup.ts", "lib/audioCache.ts", "contexts/AuthContext.tsx", "build 設定"]
    system_effects:
      local: ["prefix 定数が 1 箇所"]
      system: ["cache の semantic owner が確立"]
      journey: ["失効経路すべてで残留しない"]
      organization: ["SW 更新と app 更新のリリース順序を意識する運用が必要になる"]
      future_change: ["cache 種別追加が安全になる"]
    costs: ["build: 中〜大（SW は classic script のため build 生成 or 実行時受け渡しが必要）", "operation: SW の activate/claim ライフサイクル検証"]
    risks: ["SW の更新は即時反映されない（activate まで旧 SW が動く）。新旧 SW が異なる prefix 定義を持つ移行期間が発生する。", "build 生成を入れると public/sw.js の『薄く保つ』方針（public/sw.js:4-6）と衝突する"]
    reversibility: costly
    evidence: [{status: confirmed, source: "public/sw.js:4-6（薄く保つ方針）, :9-14（version bump 運用）", supports: "設計方針との衝突と移行期間の存在"}]
    assumption_ids: []
    unknown_ids: [U3, U4]
    validation_ids: [VAL4]

  # ---- F4: network 依存の seam 欠如 / 依存方向違反 ----
  - id: O7
    kind: do_nothing
    summary: "現状維持。createApiClient() を各所で内部生成し、テストは @/lib/api の module mock に依存する。"
    owner: user
    addresses_finding_ids: [F4]
    improves_quality_scenario_ids: []
    degrades_quality_scenario_ids: [Q3]
    scope: ["21 file の createApiClient 呼び出し", "lib/audioCache.ts", "contexts/AudioPlayerContext.tsx"]
    system_effects:
      local: ["変更なし"]
      system: ["依存方向違反（lib→lib network, contexts→components）が残る"]
      journey: ["利用者影響なし"]
      organization: ["テストが production 経路を通らない状態が継続（R7 未達）"]
      future_change: ["F1/F2/F3 の修正時に isolation されたテストを書けない"]
    costs: ["build: 0", "他 finding の remediation cost が上振れする"]
    risks: ["api 契約変更がテストをすり抜ける"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "lib/api.ts:124（引数なし factory）", supports: "差し替え点が無いこと"}]
    assumption_ids: []
    unknown_ids: []
    validation_ids: [VAL2]
  - id: O8
    kind: do_minimum
    summary: "新しく触る経路だけ port 注入にする。まず (1) lib/audioCache.ts の createApiClient import を引数注入へ変える、(2) contexts/AudioPlayerContext.tsx の Toast 依存を通知 port（関数 prop / context 引数）へ変える、の 2 点に限定する。既存 21 file の生成点は触らない。"
    owner: user
    addresses_finding_ids: [F4]
    improves_quality_scenario_ids: [Q3]
    degrades_quality_scenario_ids: []
    scope: ["lib/audioCache.ts", "contexts/AudioPlayerContext.tsx", "各々の呼び出し元"]
    system_effects:
      local: ["2 module の signature が変わる"]
      system: ["lib→lib と contexts→components の 2 つの依存方向違反が解消"]
      journey: ["利用者影響なし"]
      organization: ["以後の新規 module で port 注入が既定になる"]
      future_change: ["F3 に着手する際の前提（provider を isolation でテストできる）が揃う"]
    costs: ["build: 小〜中", "test: 既存テストの呼び出し形の更新"]
    risks: ["部分適用のため、port 注入と直接生成が混在する期間が生じる。混在自体が新たな不整合に見える可能性がある。"]
    reversibility: reversible
    evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:106-116（passkey で既に port 注入パターンが採用されている: client は DI、port は呼び出し側から注入）", supports: "同一 repo 内に手本があり、様式が確立していること"}]
    assumption_ids: []
    unknown_ids: []
    validation_ids: [VAL2]
  - id: O9
    kind: incremental
    summary: "API port を明示 interface として定義し、Provider（React context）で 1 度だけ注入する。21 file の createApiClient 生成点を段階的に port 参照へ移行し、lib/reportClientError.ts:22 の raw fetch も同 port へ寄せる。"
    owner: user
    addresses_finding_ids: [F4]
    improves_quality_scenario_ids: [Q3]
    degrades_quality_scenario_ids: []
    scope: ["lib/api.ts", "21 file の呼び出し点", "lib/reportClientError.ts", "新規 ApiProvider"]
    system_effects:
      local: ["各 file が hook 経由で port を得る"]
      system: ["network の contract owner が 1 つになる。CSRF / ApiError 正規化が全経路へ適用される"]
      journey: ["利用者影響なし（振る舞い不変を目標とする）"]
      organization: ["テストが port 置換だけで成立し、vi.mock が不要になる"]
      future_change: ["api 契約変更の影響が port 定義へ集約される"]
    costs: ["build: 大（21 file）", "test: @/lib/api を vi.mock している test の書き換え", "learning: port 様式の共有"]
    risks: ["移行中は port 経由と直接生成が併存する（temporary path）。", "lib/reportClientError.ts は CSRF 免除が意図的（lib/reportClientError.ts:4）なため、port へ寄せる際に免除を保持する必要がある。"]
    reversibility: costly
    evidence: [{status: confirmed, source: "lib/reportClientError.ts:4（CSRF 免除が意図的である旨）", supports: "統合時に保持すべき例外が存在すること"}]
    assumption_ids: []
    unknown_ids: []
    validation_ids: [VAL2]
```

---

## 6. selection_gates（未決の選択はここに隔離。いずれも pending。target は選択していない）

```yaml
selection_gates:
  - id: SG1
    subject: "F1–F8 の debt priority（now / next / later / do-not-fix）の最終順位。"
    candidate_ids: [F1, F2, F3, F4, F5, F6, F7, F8]
    decision_condition: "user が『次サイクルで security constraint（QA4）の回復を優先するか、保守性（QA1/QA2）の基盤整備を優先するか』を表明したとき。"
    evidence_required:
      - "roadmap または次サイクルの作業目的（未提示）"
      - "共有端末利用の実態（admin 画面を非管理者が開きうるか、共有端末利用が実在するか）"
      - "backend 側 admin API の認可有無（F1 の露出範囲を確定する）"
    evidence_acquisition:
      - "user への確認（roadmap・共有端末の実態）"
      - "backend repository の admin endpoint 認可実装の確認（本 package では out_of_scope）"
    owner: user
    status: pending
    evidence: [{status: unknown, source: "user からの優先度指示なし", supports: "未決であること"}]
  - id: SG2
    subject: "F3（現在再生中 / 速度の source of truth 一意化）へ投資するか、現状の 3 系統保持を許容し続けるか。"
    candidate_ids: [F3]
    decision_condition: "shared-playback-spec の次期改訂範囲が判明し、F3 を放置した場合の追随コストが見積もれたとき。"
    evidence_required:
      - "shared-playback-spec Q-*/RT-* の次期改訂予定"
      - "VAL1（代表変更 simulation）の結果＝速度・位置規則の変更に要する file 数"
      - "VAL3（failure injection）で、位置が別エピソードへ誤保存されうるかの実証または反証"
    evidence_acquisition:
      - "user への確認（spec 改訂予定）"
      - "VAL1 / VAL3 の実行（本 review では未実行）"
    owner: user
    status: pending
    evidence: [{status: unknown, source: "spec 改訂予定・VAL1/VAL3 未実行", supports: "未決であること"}]
  - id: SG3
    subject: "『現在再生中の Podcast』の target authority を playbackQueue に置くか、AudioPlayerContext の単一 state に置くか、AppContext に置くか。"
    candidate_ids: [F3]
    decision_condition: "SG2 が satisfied（投資する）となり、かつ iOS 側の対応する authority 設計（shared-playback-spec）との整合方針が確認できたとき。"
    evidence_required:
      - "shared-playback-spec における currentIndex の位置づけ（iOS と共有される契約かどうか）"
      - "AudioPlayerBar 以外の consumer が currentPodcast をどう読むかの棚卸し"
    evidence_acquisition:
      - "docs/design/shared-playback-spec.md の Q-* 契約読解（本 package では未実施＝時間制約）"
      - "grep による currentPodcast consumer の全数把握"
    owner: user
    status: pending
    evidence: [{status: unknown, source: "spec 未読解", supports: "authority を AI が確定してはならないこと"}]
  - id: SG4
    subject: "cache 名前空間の一元化方式（build 生成 / postMessage / 現状の手動同期の維持）。"
    candidate_ids: [O4, O5, O6]
    decision_condition: "SW の『薄く保つ』方針（public/sw.js:4-6）を維持するか、build 生成を許容するかを user が決めたとき。かつ O5 の trade-off（network 障害で保存音声を失う）を許容するか決めたとき。"
    evidence_required:
      - "オフライン保存音声を失うことの利用者影響（未計測）"
      - "SW 更新の移行期間中に新旧 prefix が併存した場合の実挙動（未検証）"
    evidence_acquisition:
      - "user への確認（保存音声喪失の許容度）"
      - "SW 更新 rehearsal（VAL4 の一部。未実行）"
    owner: user
    status: pending
    evidence: [{status: unknown, source: "user 指示・SW rehearsal 未実施", supports: "未決であること"}]
  - id: SG5
    subject: "network port の導入範囲（O7 現状 / O8 部分 / O9 全面）。"
    candidate_ids: [O7, O8, O9]
    decision_condition: "SG1 で F4 の優先度が確定し、かつ 21 file の移行コストを user が許容するか決めたとき。"
    evidence_required:
      - "@/lib/api を vi.mock している test file の正確な数と書き換え規模（本 review では未計数）"
      - "F3 に着手する予定があるか（あれば O8/O9 は前提投資になる）"
    evidence_acquisition:
      - "grep による vi.mock('@/lib/api') の全数把握"
      - "SG1 / SG2 の結果"
    owner: user
    status: pending
    evidence: [{status: unknown, source: "SG1 未決", supports: "従属する未決であること"}]
```

---

## 7. adr（候補のみ。すべて proposed。approved へ進めない）

```yaml
adr:
  title: "web client の認可 gating boundary を単一化する（候補）"
  lifecycle_status: unknown
  decision_maturity:
    status: proposed
    owner: user
    scope: ["app/(app)/admin/ 配下の認可 gating"]
    evidence_status: confirmed
    approval_evidence: []
    baseline_version: ""
    change_control: ""
  context: "4 つの admin ページが `status === 'authenticated' && !isAdmin` という否定形 gate を個別に持ち、AuthStatus の 'unknown'（初回ロード時に必ず通る）が default-allow に落ちて管理 UI が描画される（app/(app)/admin/users/page.tsx:86, metrics:70, featured-sites:207, invites:142）。route 層（app/(app)/layout.tsx:11-21）にも middleware にも防御が無い。"
  decision: "**未決。** O1 / O2 / O3 のいずれも選択していない。選択は SG1 が satisfied になった後に user が行う。"
  value_and_quality_rationale: ["V2（共有端末での機密性）", "QA4 confidentiality（constraint）"]
  options_considered: [O1, O2, O3]
  tradeoff_decisions: []
  counterevidence:
    - "backend 側で admin API が認可されているなら、露出は UI 構造に限られ criticality の評価が下がる。本 package では backend が out_of_scope のため確認していない（U1）。"
  assumption_ids: [P1]
  unknown_ids: [U1, U2]
  consequences: ["未決のため記載しない。"]
  owner: user
  approvers: [user]
  reevaluate_when: ["SG1 satisfied", "backend admin API の認可が確認できたとき"]

adr_candidates_additional:
  - title: "利用者固有 Cache Storage の名前空間 owner を単一化する（候補）"
    lifecycle_status: unknown
    decision_maturity: {status: proposed, owner: user, scope: ["Cache Storage 名前空間"], evidence_status: confirmed, approval_evidence: [], baseline_version: "", change_control: ""}
    decision: "**未決。** O4 / O5 / O6 は SG4 で選択する。"
    options_considered: [O4, O5, O6]
    unknown_ids: [U3, U4]
    owner: user
    approvers: [user]
  - title: "network 取得を port 経由に統一する（候補）"
    lifecycle_status: unknown
    decision_maturity: {status: proposed, owner: user, scope: ["lib/api.ts の consumer 21 file"], evidence_status: confirmed, approval_evidence: [], baseline_version: "", change_control: ""}
    decision: "**未決。** O7 / O8 / O9 は SG5 で選択する。"
    options_considered: [O7, O8, O9]
    unknown_ids: []
    owner: user
    approvers: [user]
```

---

## 8. target_architecture

```yaml
target_architecture:
  status: not_selected
  reason: "本 package は review mode の conditional design である。データ権限（特に『現在再生中』の authority、cache 名前空間の owner、debt priority）はいずれも user が所有する判断であり（shared-policies『人間が所有する判断』）、AI が選択済み target として確定してはならない。SG1–SG5 が pending の間、target authority を確定値へ丸めない。"
  decisions: []
  conditional_candidates:
    - candidate_id: TC1
      kind: security
      statement_candidate: "認可 gating の state authority を admin route boundary 1 箇所に置く。"
      option_ids: [O2, O3]
      source_of_truth_candidate: "server session（contexts/AuthContext.tsx:12-13 の宣言どおり）。client 側は派生表現に徹する。"
      state_or_transition_authority_candidate: "AuthContext（union 化後）"
      selection_gate_ids: [SG1]
      quality_scenario_ids: [Q6]
    - candidate_id: TC2
      kind: data_authority
      statement_candidate: "利用者固有 cache の名前空間定義を単一の owner が持つ。"
      option_ids: [O5, O6]
      source_of_truth_candidate: unknown
      state_or_transition_authority_candidate: unknown
      selection_gate_ids: [SG4]
      quality_scenario_ids: [Q5]
    - candidate_id: TC3
      kind: data_authority
      statement_candidate: "『現在再生中の Podcast』の source of truth を 1 つに定める。"
      option_ids: []
      source_of_truth_candidate: unknown
      state_or_transition_authority_candidate: unknown
      selection_gate_ids: [SG2, SG3]
      quality_scenario_ids: [Q1, Q2, Q3]
      note: "候補（playbackQueue / AudioPlayerContext / AppContext）は列挙できるが、iOS と共有される shared-playback-spec の契約を読解していないため、AI が候補を絞ること自体を避ける。SG3 の evidence_required を参照。"
    - candidate_id: TC4
      kind: dependency
      statement_candidate: "network 取得の contract owner を port として定め、cache・状態層は port へ依存する（依存を内向きにする）。"
      option_ids: [O8, O9]
      source_of_truth_candidate: not_applicable
      state_or_transition_authority_candidate: not_applicable
      selection_gate_ids: [SG5]
      quality_scenario_ids: [Q3]
```

---

## 9. transition_architecture

```yaml
transition_architecture:
  status: not_applicable_pending_selection
  reason: "transition phase は選択済み target に接続する必要がある（skill workflow.md:299）。target が未選択（SG1–SG5 pending）のため、実行可能な phase を確定できない。ただし O6 と O9 は選択された場合に temporary path を必然的に伴うため、下に phase の骨格のみをスケッチする（**実行しない**）。"
  phases: []
  sketches_if_option_selected:
    - sketch_id: TPS1
      applies_to_option: O6
      from_state: "prefix 'shell-'/'api-' が public/sw.js:23 と lib/swCacheCleanup.ts:21 に二重定義されている。"
      to_state: "単一定義を SW と lib が参照する。"
      deploy_order_sketch:
        - order: 1
          artifact: schema
          change: "prefix 定義の単一 source を作る（build 生成 or 実行時受け渡し）。旧 prefix も認識する互換実装にする。"
          preconditions: ["SG4 satisfied"]
        - order: 2
          artifact: runtime
          change: "SW を新定義へ更新。旧 SW が activate されるまで新旧が併存する。"
          preconditions: ["order 1 が deploy 済み"]
        - order: 3
          artifact: consumer
          change: "lib/swCacheCleanup.ts の手複製 prefix を削除する。"
          preconditions: ["全 client の SW が新版へ activate 済みであることを観測できること"]
      temporary_paths_sketch:
        - artifact: "old-path（旧 prefix の互換認識）"
          owner: user
          introduced_at: "TPS1 order 1 の deploy 時（具体日は未定）"
          purpose: "SW の activate 遅延による新旧併存期間に、旧 prefix の cache も消去対象に含めるため。"
          metric_or_log: "未定義（**unknown**: SW の version 分布を観測する手段が現状無い）。確認方法: SW から postMessage で version を報告させる仕組みの追加要否を user が判断する。"
          removal_condition: "旧 prefix の cache が全 client で観測されなくなったとき。"
          removal_phase: "TPS1 order 3"
      irreversible_point:
        exists: unknown
        description: "order 3（旧 prefix 認識の削除）以降、旧 SW を使い続けている client の cache は消去対象から外れる。これが実質的に不可逆かは、SW の強制更新手段（registration.update / skipWaiting）の採用有無に依存し、現状未確認。"
        approval: {status: unknown, owner: user, evidence: []}
      rollback_or_forward_recovery:
        strategy: unknown
        steps: ["**未確定。** SW は deploy 済みの client 上で動くため、単純な revert では旧 SW へ戻らない。forward recovery（新 SW を再 deploy して修正）が必要になる可能性が高いが、未検証。"]
        owner: user
      abort_conditions_sketch: ["order 2 の deploy 後に cache 消去が機能しないことが観測されたとき"]
      exit_criteria_sketch: ["VAL4 が executed_pass"]
    - sketch_id: TPS2
      applies_to_option: O9
      from_state: "21 file が createApiClient() を内部生成する。"
      to_state: "全 consumer が注入された port を使う。"
      deploy_order_sketch:
        - order: 1
          artifact: producer
          change: "ApiPort interface と Provider を追加（既存経路は無変更）。"
          preconditions: ["SG5 satisfied"]
        - order: 2
          artifact: consumer
          change: "file 単位で port 参照へ移行（1 file = 1 atomic commit）。"
          preconditions: ["order 1 完了"]
        - order: 3
          artifact: producer
          change: "createApiClient() の直接 export を削除。"
          preconditions: ["全 consumer が移行済み（grep で 0 件を確認）"]
      temporary_paths_sketch:
        - artifact: "dual-path（createApiClient 直接生成と port 経由の併存）"
          owner: user
          introduced_at: "TPS2 order 1（未定）"
          purpose: "21 file を一括変更せず、1 file ずつ検証しながら移行するため。"
          metric_or_log: "grep 'createApiClient' の残件数を各 commit で記録する。"
          removal_condition: "残件数 0。"
          removal_phase: "TPS2 order 3"
      irreversible_point:
        exists: false
        description: "全変更が code のみで、data 移行も外部副作用も無い。各 commit は revert 可能。"
        approval: {status: not_required, owner: user, evidence: [{status: confirmed, source: "lib/api.ts:124 の変更は runtime data に触れない", supports: "不可逆点が無いこと"}]}
      rollback_or_forward_recovery:
        strategy: rollback
        steps: ["該当 commit を revert する。"]
        owner: user
      abort_conditions_sketch: ["order 2 の途中でテストが red のまま解消できないとき"]
      exit_criteria_sketch: ["VAL2 が executed_pass、grep 残件 0"]
  note: "O2 / O5 / O8 を選んだ場合は transition phase 自体が not_applicable である（単一 deploy で完了し、temporary path も dual writer も生じない）。理由: いずれも code 局所変更のみで、data 移行・外部副作用・複数 writer の期間を作らない（Evidence: O2 は app/(app)/admin/* の条件式のみ、O5 は contexts/AuthContext.tsx の catch 節のみ、O8 は 2 module の signature のみ）。"
```

---

## 10. validation

```yaml
validation:
  items:
    - id: VAL1
      quality_scenario_ids: [Q1, Q2]
      target_decision_ids: []
      transition_phase_ids: []
      kind: change_simulation
      oracle: "『再生位置の復元規則を変更する』『速度の適用タイミングを変更する』という 2 つの代表変更について、変更が必要な file 数と、UI component（AudioPlayerBar）に触れる必要があるかを数える。UI component に触れる必要があれば Q1/Q2 は fail。"
      owner: user
      execution_conditions: ["変更 scenario を実際に branch 上で試作できること（mutation_authorized が必要）"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence: []
      counterevidence: []
    - id: VAL2
      quality_scenario_ids: [Q3]
      target_decision_ids: []
      transition_phase_ids: [TPS2]
      kind: contract_dependency_test
      oracle: "lib/audioCache.ts と contexts/AudioPlayerContext.tsx の unit test が、@/lib/api の module mock を使わずに（port 置換のみで）成立すること。"
      owner: user
      execution_conditions: ["O8 または O9 の実装後", "vitest 実行環境"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence: []
      counterevidence: []
    - id: VAL3
      quality_scenario_ids: [Q4, Q1]
      target_decision_ids: []
      transition_phase_ids: []
      kind: failure_injection
      oracle: "(a) navigator.onLine=false かつ未キャッシュで再生を試みたとき、'オフライン' の意味の文言が出て getPodcast() が呼ばれないこと。(b) loadAndPlay の途中（player.play() の reject 時）に例外が起きたとき、AppContext.currentPodcast と podcastIdRef が食い違わないこと。"
      owner: user
      execution_conditions: ["vitest + jsdom で navigator.onLine と audio.play() を制御できること", "F5/F3 の修正前でも『現状の失敗を再現する』テストとして実行可能"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence: []
      counterevidence: []
    - id: VAL4
      quality_scenario_ids: [Q5]
      target_decision_ids: []
      transition_phase_ids: [TPS1]
      kind: security_review
      oracle: "logout 後および 401 失効後に caches.keys() が利用者固有の内容を保持しないこと。SW の version 更新をまたいでも消し漏れが無いこと。"
      owner: user
      execution_conditions: ["実ブラウザ（Chromium）で SW を登録した状態", "playwright E2E または手動検証"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence: []
      counterevidence: []
    - id: VAL5
      quality_scenario_ids: [Q6]
      target_decision_ids: []
      transition_phase_ids: []
      kind: contract_dependency_test
      oracle: "AuthProvider に initialStatus='unknown' を注入した状態で 4 つの admin ページを render したとき、管理操作の input / button が 1 つも現れないこと。"
      owner: user
      execution_conditions: ["vitest + @testing-library/react", "contexts/AuthContext.tsx:37-42 の test-only props を利用（既存機構）"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence:
        - status: confirmed
          source: "contexts/AuthContext.tsx:39-41"
          supports: "unknown 状態の注入手段が既に存在し、本 validation が実行可能であること。"
      counterevidence: []
    - id: VAL6
      quality_scenario_ids: []
      target_decision_ids: []
      transition_phase_ids: []
      kind: operation_review
      oracle: "CI で `npm run typecheck:ts7` と `npm run build` が独立 job として実行され、失敗が merge を止めること（R8）。"
      owner: user
      execution_conditions: ["ci.yml への step 追加後", "GitHub Actions"]
      required_platforms: []
      status: planned
      executed_at: ""
      result: ""
      evidence:
        - status: confirmed
          source: ".github/workflows/ci.yml:24-27（現状は lint/typecheck/test のみ）、package.json:11（typecheck:ts7 script は存在）"
          supports: "現状 fail であり、追加手段が既にあること。"
      counterevidence: []
```

---

## 11. architecture_trace

```yaml
architecture_traces:
  - id: AT1
    value_ids: [V2]
    quality_scenario_ids: [Q6]
    current_finding_ids: [F1, F6]
    option_id: O2
    target_decision_ids: []
    transition_phase_ids: []
    validation_ids: [VAL5]
    status: partial
    evidence:
      - status: confirmed
        source: "app/(app)/admin/users/page.tsx:86 → Q6 oracle → O1/O2/O3 → VAL5"
        supports: "value から validation まで各 edge が実在の artifact で接続されること。"
    gaps: ["target_decision が未選択（SG1 pending）。transition は O2 選択時 not_applicable のため欠落ではないが、O3 選択時は phase が必要になる。"]
    connections:
      - {from_kind: requirement, from_id: R5, to_kind: contract, to_id: Q6, rationale: "R5（unknown 中に保護 UI を描画しない）を観測可能な scenario へ正規化した。"}
      - {from_kind: contract, from_id: Q6, to_kind: change, to_id: F1, rationale: "Q6 の oracle に対して現行 gate が fail する。"}
      - {from_kind: change, from_id: F1, to_kind: change, to_id: O2, rationale: "gate の否定形を肯定形へ反転すれば oracle を満たす。"}
      - {from_kind: change, from_id: O2, to_kind: verification, to_id: VAL5, rationale: "initialStatus='unknown' の注入で oracle を反証可能に検証できる。"}
  - id: AT2
    value_ids: [V2]
    quality_scenario_ids: [Q5]
    current_finding_ids: [F2]
    option_id: O5
    target_decision_ids: []
    transition_phase_ids: [TPS1]
    validation_ids: [VAL4]
    status: partial
    evidence:
      - status: confirmed
        source: "lib/swCacheCleanup.ts:21 / public/sw.js:23 → Q5 → O4/O5/O6 → VAL4"
        supports: "接続の実在。"
    gaps: ["O5 は QA3 との trade-off（network 障害時に保存音声を失う）を含み、F6 の解決に依存する。SG4 pending。TPS1 の rollback strategy が unknown。"]
    connections:
      - {from_kind: requirement, from_id: R6, to_kind: contract, to_id: Q5, rationale: "R6 を共有端末 scenario へ正規化した。"}
      - {from_kind: contract, from_id: Q5, to_kind: change, to_id: F2, rationale: "prefix 二重定義と 401 経路の未消去が oracle を満たさない。"}
      - {from_kind: change, from_id: F2, to_kind: verification, to_id: VAL4, rationale: "実ブラウザでの cache 残留観測が反証手段になる。"}
  - id: AT3
    value_ids: [V1, V3]
    quality_scenario_ids: [Q1, Q2]
    current_finding_ids: [F3]
    option_id: ""
    target_decision_ids: []
    transition_phase_ids: []
    validation_ids: [VAL1, VAL3]
    status: missing
    evidence:
      - status: confirmed
        source: "F3 の Evidence 群（contexts/AudioPlayerContext.tsx:85-93, hooks/useAudioPlayer.ts:122-129, lib/playbackQueue.ts:11, components/AudioPlayerBar.tsx:24-26,28）"
        supports: "finding までは接続済み。"
    gaps: ["**option が存在しない。** 『現在再生中』の authority 候補を絞るには shared-playback-spec の Q-* 契約読解が必要であり、本 review では未実施（時間制約）。AI が spec を読まずに authority 候補を提示すると、iOS と共有される契約を壊す提案になりうるため、意図的に option を作らなかった。SG3 の evidence_required を参照。"]
    connections:
      - {from_kind: requirement, from_id: R3, to_kind: contract, to_id: Q1, rationale: "R3 を『位置の復元規則変更』という代表変更へ正規化した。"}
      - {from_kind: requirement, from_id: R3, to_kind: contract, to_id: Q2, rationale: "R3 を『速度の適用タイミング変更』へ正規化した。"}
      - {from_kind: contract, from_id: Q2, to_kind: change, to_id: F3, rationale: "AudioPlayerBar 非表示時に速度が同期しない確定的な不整合が oracle を満たさない。"}
  - id: AT4
    value_ids: [V3]
    quality_scenario_ids: [Q3]
    current_finding_ids: [F4]
    option_id: O8
    target_decision_ids: []
    transition_phase_ids: [TPS2]
    validation_ids: [VAL2]
    status: partial
    evidence:
      - status: confirmed
        source: "lib/audioCache.ts:20 / contexts/AudioPlayerContext.tsx:6 → Q3 → O7/O8/O9 → VAL2"
        supports: "接続の実在。"
    gaps: ["target 未選択（SG5 pending）。@/lib/api を vi.mock する test file の正確な件数が未計数。"]
    connections:
      - {from_kind: requirement, from_id: R7, to_kind: contract, to_id: Q3, rationale: "R7（テストが production 経路を通る）を queue 遷移テストの oracle へ正規化した。"}
      - {from_kind: contract, from_id: Q3, to_kind: change, to_id: F4, rationale: "注入 seam が無く module mock を強制されるため oracle を満たさない。"}
      - {from_kind: change, from_id: O8, to_kind: verification, to_id: VAL2, rationale: "port 置換のみでテストが成立するかが反証可能な判定になる。"}
  - id: AT5
    value_ids: [V1]
    quality_scenario_ids: [Q4]
    current_finding_ids: [F5]
    option_id: ""
    target_decision_ids: []
    transition_phase_ids: []
    validation_ids: [VAL3]
    status: partial
    evidence: [{status: confirmed, source: "lib/resolvePlayback.ts:16 vs contexts/AudioPlayerContext.tsx:104-105", supports: "finding の実在"}]
    gaps: ["option を個別に作っていない（remediation_cost=low で F1/F6 の作業に含められるため）。単独 option が必要かは SG1 の結果次第。"]
  - id: AT6
    value_ids: [V3]
    quality_scenario_ids: [Q3]
    current_finding_ids: [F8]
    option_id: ""
    target_decision_ids: []
    transition_phase_ids: []
    validation_ids: [VAL6]
    status: partial
    evidence: [{status: confirmed, source: ".github/workflows/ci.yml:24-27", supports: "R8 未達の実在"}]
    gaps: ["option を個別に作っていない（ci.yml への step 追加という単一手段しかなく、比較すべき代替が無い）。ただし『typecheck:ts7 が現在 green か』が unknown（U5）であり、追加が即 green になる保証はない。"]
  - id: AT7
    value_ids: [V3]
    quality_scenario_ids: [Q1]
    current_finding_ids: [F7]
    option_id: ""
    target_decision_ids: []
    transition_phase_ids: []
    validation_ids: []
    status: missing
    evidence: [{status: confirmed, source: "app/(app)/dashboard/page.tsx:48,65 vs lib/config.ts:1", supports: "finding の実在"}]
    gaps: ["**validation が無い。** localStorage key の一元化を反証可能に検証する oracle（例: 生 literal を禁止する lint rule）を設計していない。時間制約により未実施。obligation として返す。"]

coverage:
  requirement_denominator: [R1, R2, R3, R4, R5, R6, R7, R8]
  requirement_numerator_with_finding_and_validation: [R3, R4, R5, R6, R7, R8]
  requirement_partial: [R2]
  requirement_uncovered: [R1]
  uncovered_reason:
    - requirement_id: R1
      reason: "R1（業務ルールの lib 単一所有: quota 分類・server-star merge・パスワードポリシー・404=未蓄積）は本 package の依頼 scope（data authority の 6 fact + 2 依存方向）に含まれない。Explorer の既知観測（common-brief.md:43）に対応する finding を独自に検証していないため、確認済みとして数えない。確認方法: app/(app)/feed/page.tsx:15-28,151-158,350-400 と components/ui/AccountSection.tsx:19-55 / app/signup/page.tsx:18-45 の読解。未解決時の影響: QA1 の負債全体像が過小評価される。"
  partial_reason:
    - requirement_id: R2
      reason: "R2（不正状態を公開経路から構築できない）は認証状態について F6 で確認した（contexts/AuthContext.tsx:37-42,46-47）が、再生状態（error≡pause、status:'completed'＋error_message 等）については hooks/useAudioPlayer.ts:25-30 の 4 atom 構造を確認したのみで、backend の Podcast status 型との組み合わせを検証していない。確認方法: types/index.ts の Podcast status 定義と、error 時の state 遷移の網羅。"
```

---

## 12. platform_context / platform_validation

```yaml
platform_context:
  target_platforms: ["web browser (Chromium / WebKit)"]
  rationale: "対象は Next.js web client であり、OS 固有の path 区切り・file lock・process 終了・permission の差が判断を分岐させる箇所が無い。Service Worker と Cache Storage はブラウザ差はあるが OS 差ではない。"

platform_validation:
  required_platforms: []
  executed: []
  unexecuted: []
  parity_result: not_applicable
  parity_not_applicable_reason: "本 package は OS 固有の path / process / shell を扱わない（common-brief.md:54 の指示と一致）。ブラウザ差（Safari の SW Range 処理、lib/audioCache.ts:10-13 に記録）は platform parity ではなく Q5 / VAL4 の実行条件として扱う。"
  platform_specific_risks:
    - "Safari の Service Worker Range-request 処理が不安定であることが lib/audioCache.ts:10-13 に記録されており、O6（SW への cache 一元化を含む案）を選ぶ場合は WebKit での検証が必須になる。Evidence status: confirmed（コード内コメント）。"
```

---

## 13. subject_verdict

```yaml
subject_verdict: incomplete
subject_verdict_reason: |
  対象（web module の data authority 構造）に、Evidence 付きで特定できる欠陥が存在する。
  (1) 依頼された 6 つの fact のうち、target authority が一意なものは 0 件である。(c) 再生位置だけが
  「読み出しの調停規則」を lib/playbackPosition.ts に一意化しているが、書き込み権限は localStorage と
  server に二重化されており reconciliation 規則が無い。
  (2) 宣言された source of truth を実装が迂回している箇所が 2 つある（lib/config.ts:1 の宣言 vs
  app/(app)/dashboard/page.tsx:48,65／public/sw.js:70-72 の素通し宣言 vs lib/audioCache.ts:39-41 の
  /_audio-podcast/ 名前空間）。後者は既に発生済みの契約乖離である。
  (3) QA4（constraint）違反が 2 件確定している（F1: unknown 中の admin UI 描画が 4 画面、
  F2: 401 失効経路での cache 未消去）。constraint は trade-off してよい対象ではない。
  (4) 依存方向違反が 2 件確定している（lib/audioCache.ts:20 の lib→network、
  contexts/AudioPlayerContext.tsx:6 の contexts→components）。
  `conditional` ではなく `incomplete` とする理由: conditional は「選択肢・選択 gate・Evidence 取得方法が
  揃い人間判断だけを待つ」状態を指すが、本 review では F3（最も重要な data authority）について
  option を 1 つも作れていない（AT3 status: missing）。shared-playback-spec の Q-* 契約を読解していない
  ためであり、これは未解決の欠落である。`indeterminate` ではない理由: 対象の欠陥自体は confirmed Evidence で
  特定できており、判定不能ではない。
```

---

## 14. canonical decision（本 package の完成状態。subject_verdict とは別）

```yaml
decision:
  status: revise
  artifact_readiness: incomplete
  engineering_status: not_started
  release_status: not_applicable
  decision_maturity:
    status: proposed
    owner: user
    scope: ["web module 内部の data authority review", "QL1-QL4 品質 portfolio", "debt priority 候補", "F1/F2/F4 の option"]
    evidence_status: confirmed
    approval_evidence: []
    baseline_version: ""
    change_control: ""
  next_phase:
    name: "user による debt priority 確定（SG1）と、F3 の authority 候補作成に必要な spec 読解"
    status: awaiting_approval
    reasons:
      - "SG1–SG5 がすべて pending であり、target authority・priority を AI が確定してはならない。"
      - "AT3（F3 → option）が missing であり、shared-playback-spec の Q-* 読解が前提として必要。"
    human_approvals_required:
      - "F1–F8 の priority 確定（SG1、owner: user）"
      - "F3 への投資判断（SG2、owner: user）"
      - "『現在再生中』の target authority 選択（SG3、owner: user）"
      - "cache 名前空間の一元化方式と、O5 の trade-off 許容（SG4、owner: user）"
      - "network port の導入範囲（SG5、owner: user）"
  evidence:
    - status: confirmed
      source: "本 package で引用した全 path:line を実ファイルの読解で確認した（hooks/useAudioPlayer.ts 全 267 行、contexts/AudioPlayerContext.tsx 全 218 行、contexts/AppContext.tsx 全 143 行、contexts/AuthContext.tsx :1-130、lib/audioCache.ts 全 150 行、lib/swCacheCleanup.ts 全 24 行、lib/resolvePlayback.ts 全 27 行、lib/playbackPosition.ts 全 38 行、lib/config.ts 全 27 行、lib/playbackQueue.ts :1-60、lib/api.ts :1-130、lib/reportClientError.ts 全 34 行、public/sw.js 全 150 行、app/api/backend/[...path]/route.ts 全 151 行、app/(app)/layout.tsx 全 21 行、app/(app)/admin/users/page.tsx :20-110、components/AudioPlayerBar.tsx :1-70、.github/workflows/ci.yml 全 62 行、package.json :1-40、web/agent-rules/70-typescript-version-policy.md :1-30)"
      supports: "Explorer 報告の丸写しではなく一次確認であること。"
  assumptions:
    - id: P1
      statement: "Next.js 16 App Router の route group layout（app/(app)/admin/layout.tsx）を client component として追加すれば、配下の全 page に認可 gate を適用できる。"
      falsification: "実際に layout を追加して 4 page が gate を継承するか確認する。"
      impact_if_false: "O3 の実現方式が変わる（共通 component のラップへ後退する）が、O3 の目的（authority の単一化）自体は達成可能。"
      evidence_status: inferred
  unknowns:
    - id: U1
      subject: "backend 側の admin API に認可が実装されているか。F1 の露出範囲（UI 構造のみか、データもか）を決める。"
      confirmation_method: "backend repository の admin endpoint 実装を読む（本 package では out_of_scope）。または admin API へ非管理者 session で実リクエストする。"
      impact_if_unresolved: "F1 の business_criticality 評価が過大または過小になり、SG1 の順位判断を誤らせる。"
      owner: user
      evidence: [{status: unknown, source: "backend は out_of_scope（common-brief.md:10）", supports: "本 package で確認していないこと"}]
    - id: U2
      subject: "admin route group に layout を追加した場合の Next.js 16 の client/server 境界の挙動。"
      confirmation_method: "実際に app/(app)/admin/layout.tsx を作り、4 page が gate を通ることを test で確認する。"
      impact_if_unresolved: "O3 の cost 見積もりがずれる。"
      owner: user
      evidence: [{status: inferred, source: "app/(app)/layout.tsx:1-21 が 'use client' な route group layout として機能している", supports: "実現可能性は高いが未検証"}]
    - id: U3
      subject: "オフライン保存音声（audio-v1）を network 障害時に失うことの利用者影響。O5 の採否を決める。"
      confirmation_method: "user への確認。オフライン保存機能の利用実態（利用者数・保存件数）の計測。"
      impact_if_unresolved: "O5 を選ぶと QA4 を回復する代わりに QA3 を損なう可能性があり、trade-off の妥当性を判断できない。"
      owner: user
      evidence: [{status: unknown, source: "利用実態の計測なし", supports: "未確認"}]
    - id: U4
      subject: "SW の新旧併存期間中に、旧 SW が旧 prefix の cache を保持し続ける実挙動。TPS1 の irreversible point の有無を決める。"
      confirmation_method: "実ブラウザで SW を version 更新し、activate 前後の caches.keys() を観測する（VAL4 の一部）。"
      impact_if_unresolved: "O6 の rollback 戦略を決められず、不可逆点の有無が不明なまま transition を計画することになる。"
      owner: user
      evidence: [{status: unknown, source: "SW rehearsal 未実施", supports: "未確認"}]
    - id: U5
      subject: "`npm run typecheck:ts7` が現在 green か。"
      confirmation_method: "`cd web && npm run typecheck:ts7` を実行する（read-only ではないため本 review では実行していない — 正確には read-only だが、依頼 scope 外の実行を避けた）。"
      impact_if_unresolved: "F8 の remediation_cost 評価（low）が誤る可能性がある。既に赤ければ解消コストが別途かかる。"
      owner: user
      evidence: [{status: unknown, source: "未実行", supports: "未確認"}]
    - id: U6
      subject: "shared-playback-spec.md の Q-* 契約における currentIndex / 現在再生中の位置づけ。F3 の authority 候補を絞れるかを決める。"
      confirmation_method: "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md の §4.1 と queue 操作契約を読む。"
      impact_if_unresolved: "**AT3 が missing のまま。** F3 に対する option を提示できず、最も影響の大きい data authority 負債に手を付けられない。"
      owner: user
      evidence: [{status: unknown, source: "本 review では時間制約により未読解", supports: "未解決の欠落"}]
    - id: U7
      subject: "@/lib/api を vi.mock している test file の正確な件数。"
      confirmation_method: "`grep -rl \"vi.mock('@/lib/api')\" tests/` を実行する。"
      impact_if_unresolved: "O9 の cost 見積もりが粗いまま。"
      owner: user
      evidence: [{status: unknown, source: "未計数（common-brief.md:47 は 25 file と報告するが一次確認していない）", supports: "未確認"}]
  contradictions:
    - id: C1
      subject: "common-brief.md:30 が R8 の根拠として『rule 70 :16』を挙げるが、web/agent-rules/70-typescript-version-policy.md:16 は `npm run typecheck:ts7` という script の存在と直接パス呼び出しの方法を説明する行であり、CI での独立ゲート実行を要求していない。"
      resolution: "R8 は router が置いた要件として扱い、rule 70 を根拠に引用しない。F8 の structural_cause にこの訂正を明記した。"
      evidence: [{status: confirmed, source: "web/agent-rules/70-typescript-version-policy.md:16", supports: "引用の不一致"}]
    - id: C2
      subject: "common-brief.md:36 が AudioPlayerContext の dispatch を ':90' と記すが、実ファイルでは :91 である。同様に :86-109 / :126-161 等の範囲も 1 行前後ずれている。"
      resolution: "本 package では自分で読んだ実 line を使用した。実害は無いが、以後の引用は本 package の line を使う。"
      evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:91", supports: "実 line"}]
  failed_gates:
    - "architecture trace: AT3（F3 → option → target）と AT7（F7 → validation）が解決しない。skill workflow.md:454 の『value → quality scenario → current finding → option → target decision → transition phase → validation の trace が解決しない』に該当する。"
    - "requirement coverage: R1 が uncovered、R2 が partial。分母 8 / 分子 6 / partial 1 / uncovered 1。"
  unexecuted_validation:
    - id: UV1
      reason: "本 package は review mode（mutation_authorized: false）であり、VAL1（代表変更 simulation）は branch 上での試作を要するため実行できない。"
      required_runner: "実装権限を持つ coder agent"
      planned_commands: []
      owner: user
      evidence: [{status: confirmed, source: "common-brief.md:6（mutation_authorized: false）", supports: "実行不可の理由"}]
    - id: UV2
      reason: "VAL2 / VAL3 / VAL5 は新規テストの作成を要するため、review mode では実行できない。"
      required_runner: "vitest（実装後）"
      planned_commands: ["npx vitest run"]
      owner: user
      evidence: [{status: confirmed, source: "common-brief.md:6", supports: "同上"}]
    - id: UV3
      reason: "VAL4 は実ブラウザでの Service Worker 更新 rehearsal を要する。"
      required_runner: "playwright（Chromium）+ 手動 WebKit 検証"
      planned_commands: ["npm run test:e2e"]
      owner: user
      evidence: [{status: confirmed, source: "lib/audioCache.ts:10-13（Safari 固有挙動の記録）", supports: "WebKit 検証が別途必要なこと"}]
    - id: UV4
      reason: "VAL6（CI gate）は ci.yml の変更を要する。"
      required_runner: "GitHub Actions"
      planned_commands: ["npm run typecheck:ts7", "npm run build"]
      owner: user
      evidence: [{status: confirmed, source: "package.json:11", supports: "script は存在"}]
  platform_validation:
    required_platforms: []
    executed: []
    unexecuted: []
    parity_result: not_applicable
    platform_specific_risks:
      - "Safari の SW Range-request 処理（lib/audioCache.ts:10-13）が O6 の選択時に検証必須になる。"
  residual_risks:
    - "F3 に option を提示できていないため、最も expected_change の高い負債が未着手のまま残る。"
    - "U1 が未解決のため、F1 の criticality 評価が backend の実装次第で変わる。"
    - "O5 を単独で採用すると QA4 の回復と引き換えに QA3 を損なう（U3 未解決）。"
    - "本 package の Q1–Q6 はいずれも measurement plan を持つが数値目標を持たない。性能（QA5）は intentionally_not_optimized であり、計測 Evidence が無い状態で目標を作らなかった。"
  human_approvals_required:
    - "SG1: F1–F8 の priority 確定（owner: user）"
    - "SG2: F3 への投資判断（owner: user）"
    - "SG3: 『現在再生中』の target authority 選択（owner: user）"
    - "SG4: cache 名前空間の一元化方式と O5 の trade-off 許容（owner: user）"
    - "SG5: network port の導入範囲（owner: user）"
```

---

## 15. obligations（router へ返す未解決事項）

```yaml
obligations:
  - kind: architecture_obligation
    id: OB1
    subject: "F3（現在再生中 / 速度の source of truth）の option 作成。"
    blocked_by: [U6]
    required_input: "docs/design/shared-playback-spec.md の Q-* 契約読解（特に currentIndex の位置づけと iOS との共有範囲）。"
    note: "AI が spec 未読で authority 候補を提示することは、共有契約を壊す提案になりうるため意図的に行わなかった。"
  - kind: boundary_obligation
    id: OB2
    subject: "AudioPlayerContext の公開 operation boundary（Player & QueueApi を丸ごと公開している contexts/AudioPlayerContext.tsx:40,198-208）の妥当性。"
    note: "consumer operation boundary は Boundary Package の canonical owner の担当であり、本 package では重複定義しない。router が Boundary Function を呼ぶ場合、本 package の F3 / F4 を入力として渡すこと。"
  - kind: contract_obligation
    id: OB3
    subject: "AuthStatus と user の判別可能 union 化（F6）の契約定義、および『再生位置の dual writer』（localStorage / server）の reconciliation 規則。"
    note: "condition 単位の契約は Contract Package の canonical owner の担当。本 package は authority の不在を指摘するにとどめた。"
  - kind: test_obligation
    id: OB4
    subject: "VAL5（unknown 中の admin UI 非描画）を RED テストとして具体化する。contexts/AuthContext.tsx:39-41 の initialStatus prop が注入手段として既に存在するため、実装前に書ける。"
  - kind: verification_obligation
    id: OB5
    subject: "R1（業務ルールの lib 単一所有）の検証。本 package の scope 外のため未実施（coverage の uncovered として明示）。"
  - kind: model_obligation
    id: OB6
    subject: "F7 の localStorage key 一元化を反証可能に検証する oracle の設計（AT7 が missing）。"
```

---

## 16. 棄却した設計案（trial-log 転記用。オーケストレータが docs/trial-log/ へ転記する）

| 項目 | 内容 |
|---|---|
| **案A: 状態管理ライブラリ（Redux / Zustand）の導入で authority を一元化する** | 目的: 「現在再生中」「速度」の source of truth を単一 store に集約し、F3 を構造的に解消する。／前提（未検証: 現在の React context + useReducer 構成が authority 分散の原因であるという仮定）。／やったこと: F3 の構造原因が「store の不在」ではなく「更新手順が副作用順序に埋まっていること」（contexts/AudioPlayerContext.tsx:85-93）である点を確認した。／結果: 棄却。store を入れても 3 系統（queue / AppContext / podcastIdRef）を同時更新する契約が無ければ同じ不整合が再発するため、技術導入が目的化する。／残課題: 契約（不変条件）を先に定める必要があり、OB1 / OB3 に引き継いだ。 |
| **案B: middleware.ts による route 層での admin gating** | 目的: F1 を route 層で構造的に防ぎ、component 側の gate 複製を不要にする。／前提（未検証: 認証判定に必要な session が Edge middleware から読めるという仮定）。／やったこと: 認証が httpOnly session cookie + backend の /auth/me 応答に依存すること（contexts/AuthContext.tsx:12-13、app/api/backend/[...path]/route.ts:73-78）を確認した。／結果: 棄却（第一候補からは外した）。middleware で admin 判定を行うには backend への同期的な問い合わせが必要で、全 navigation に BFF 往復を足す。O3（client boundary への集約）の方が同じ目的を低コストで達成する。／残課題: backend が role を含む短命な署名付き値を cookie に載せる設計に変われば再評価に値する（SG1 の reevaluate 対象）。 |
| **案C: Service Worker への cache 責務一元化（audio-v1 も SW が管理）** | 目的: F2 の prefix 二重定義を、cache を全て SW 側に寄せることで解消する。／前提（未検証: SW が音声の Range request を正しく扱えるという仮定）。／やったこと: lib/audioCache.ts:10-13 が「Safari の SW Range-request 処理が不安定でシークが壊れる」ため blob: URL 方式を選んだと明記していることを確認した。／結果: 棄却。既知の実測理由で退けられた設計へ戻すことになる。／残課題: 逆方向（prefix 定義を lib 側に一元化し SW が受け取る）は O6 として残した。 |
| **案D: npm overrides による TypeScript サブツリー固定で TS6/TS7 併用を解消する** | 目的: F8 の typecheck:ts7 という二重運用自体を無くす。／前提: なし（既に検証済み事項）。／やったこと: web/docs/trial-log/typescript7-eslint-coexistence.md および web/agent-rules/70-typescript-version-policy.md:13 が「peerDependency のみの関係では物理的なネストインストールを作れないため不可能（確認済み）」と記録していることを確認した。／結果: 棄却（再提案禁止事項のため、そもそも候補に入れていない）。／残課題: なし。typescript-eslint の TS7 対応待ち（rule 70 の撤去条件）。 |
| **案E: 性能（QA5）を品質 portfolio の secondary に含める** | 目的: bundle size や初期描画の改善を portfolio に入れる。／前提（未検証: 性能に問題があるという仮定）。／やったこと: 計測資料・SLO・利用者からの報告のいずれも見つからないことを確認した。／結果: 棄却。未計測の数値目標を作らない規律（skill workflow.md:134）に反する。intentionally_not_optimized として記録した。／残課題: 実利用の latency / bundle 計測が得られたら再評価（QA5 の reevaluate_when）。 |
