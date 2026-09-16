# Completeness Package — news-listen/web (S1–S4)

役割: `architecture` / Skill: `mino-domain-model-completeness` / mode: review (read-only, mutation なし)。
全 path は `/Users/rio/git/news-listen/web/` 相対（spec のみ `/Users/rio/git/news-listen/docs/`）。行番号は本セッションで実ファイルを読んで確認済み。

## 0. routing_context

```yaml
routing_context:
  origin: integrated
  mode: review
  orchestrator: main session (router = mino-reproducible-development)
  requested_by: router
  requested_artifact: Completeness Package
  return_to: router
  mutation_authorized: false
```

## 1. scope / discovery

```yaml
scope:
  actors:
    - end_user          # 再生・認証・設定を行う利用者
    - admin_user        # role === 'admin' の管理者
    - developer_tester  # initialState / initialUser を注入するテスト作者
    - service_worker    # public/sw.js（利用者操作なしに Cache Storage を書く自律 writer）
  use_cases:
    - id: S1
      name: playback session
      flow: "load → play/pause/seek → timeupdate 位置保存 → ended → completed イベント → キュー前進 → offline/cached source 選択"
    - id: S2
      name: auth session
      flow: "status/user 解決 → login/register/passkey → refreshMe → logout → cache residency cleanup → admin gating"
    - id: S3
      name: podcast DTO versioning
      flow: "backend 応答 → optional field をバージョンフラグとして解釈 → status/audio_url/error_message の共起制約"
    - id: S4
      name: persisted preferences
      flow: "localStorage 復元 → 検証 → key 所有 → volume / speed / theme / timeFormat の書き戻し"
  requirements: [R1, R2, R3, R4, R5, R6, R7, R8]
  contexts:
    - playback_context   # hooks/useAudioPlayer.ts, contexts/AudioPlayerContext.tsx, lib/playbackQueue.ts, lib/resolvePlayback.ts, lib/playbackPosition.ts
    - offline_cache_context  # lib/audioCache.ts, public/sw.js, lib/swCacheCleanup.ts
    - auth_context       # contexts/AuthContext.tsx, app/(app)/admin/*, app/(app)/layout.tsx
    - preference_context # contexts/AppContext.tsx, lib/config.ts, hooks/useLocalStorage.ts, components/ui/ThemeToggle.tsx, app/layout.tsx
  in_scope:
    - hooks/useAudioPlayer.ts
    - contexts/AudioPlayerContext.tsx
    - contexts/AuthContext.tsx
    - contexts/AppContext.tsx
    - lib/playbackQueue.ts
    - lib/resolvePlayback.ts
    - lib/playbackPosition.ts
    - lib/audioCache.ts
    - lib/swCacheCleanup.ts
    - lib/config.ts
    - hooks/useLocalStorage.ts
    - types/index.ts
    - public/sw.js
    - components/PodcastCard.tsx
    - components/AudioPlayerBar.tsx
    - components/ui/ThemeToggle.tsx
    - app/layout.tsx
    - app/(app)/layout.tsx
    - app/(app)/admin/{users,invites,metrics,featured-sites}/page.tsx
    - docs/design/shared-playback-spec.md
  out_of_scope:
    - backend 契約の妥当性（サーバ側 status / completed イベントの正しさ）
    - iOS / Android 実装（spec 準拠は他 platform の責務）
    - UI 意匠・修正実装
    - lib/api.ts のエラー分類全体（R4 は S1–S4 が触れる範囲のみ監査）

discovery_readiness:
  status: verified_input
  evidence:
    status: confirmed
    sources:
      - "types/index.ts:15 PodcastStatus / :87-114 Podcast"
      - "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:39-49 §2.1 状態モデルと不変条件1-5"
      - "lib/resolvePlayback.ts:16 PlaybackSource"
      - "contexts/AuthContext.tsx:16 AuthStatus"
  reason: "用語（Podcast / PodcastStatus / QueueState / PlaybackSource / AuthStatus）は型定義と正本 spec に固定されており、新規 term 発見を要しない。"

domain_discovery:
  applicability: not_applicable
  not_applicable_reason: "term ledger・Context Map に相当する固定正本（types/index.ts と shared-playback-spec.md §2.1）がブリーフで参照資料として指定され、監査対象語はすべてそこに実在する。"
  confirmation_method: "新語（例: backend 側 completed イベントの意味）を S1 へ取り込む場合は docs/adr/075-*.md と backend 契約を照合して再判定する。"
  impact_if_unresolved: "S1 の 'completed' の意味（クライアント発火 vs サーバ記録）に別解釈が残ると、OB-C3 の契約文が誤った側へ寄る。"
  evidence:
    - "types/index.ts:15,87-114"
    - "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:14-16（正本宣言）"

audit_rubric:
  name: suite_defined_completeness_dimensions
  origin: suite_operationalization
  dimensions: [term_context, concept, constraint, state, transition, behavior, relationship, failure, time, writer, reader, authority]

platform_context:
  applicability: not_applicable
  rationale: "対象は browser runtime のみで、OS 固有の path separator / process / shell / case sensitivity が writer・reader・representation・failure を分岐させない。Cache Storage / localStorage の可用性差は browser 機能差であり platform 差ではなく、lib/audioCache.ts:59-61 で feature detection として扱われている。"
  evidence:
    - "lib/audioCache.ts:59-61 isCacheStorageSupported()"
    - "hooks/useLocalStorage.ts:14-16 typeof window === 'undefined' 分岐（SSR、OS 非依存）"

platform_validation:
  required_platforms: []
  executed: []
  unexecuted: []
  parity_result: not_applicable
  platform_specific_risks: []
```

## 2. model_elements

```yaml
model_elements:
  # ---- S1 playback ----
  - id: ME1
    dimension: state
    name: PlaybackState (player)
    meaning_or_rule: "再生の意味的状態。現状は isPlaying / currentTime / duration / volume の 4 独立 atom で、'idle' | 'loading' | 'playing' | 'paused' | 'errored' | 'ended' を表す union が存在しない。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["hooks/useAudioPlayer.ts:25-30", "hooks/useAudioPlayer.ts:99-102"]
  - id: ME2
    dimension: transition
    name: error → paused 遷移
    meaning_or_rule: "audio error 時は 'errored' へ遷移し、直前が再生中だったことと区別できる必要がある。実装は setIsPlaying(false) のみで paused と同一表現になる。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["hooks/useAudioPlayer.ts:148-151"]
  - id: ME3
    dimension: state
    name: QueueState
    meaning_or_rule: "items（id 一意）と currentIndex（null または 0..items.length-1）。spec §2.1 不変条件1-5。"
    target_status: present
    concept_kind: value_object
    evidence:
      status: confirmed
      sources: ["lib/playbackQueue.ts:7-15", "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:39-49"]
  - id: ME4
    dimension: constraint
    name: currentIndex 範囲不変条件
    meaning_or_rule: "spec 不変条件2: currentIndex は null か 0 ≤ i ≤ len-1。型は number|null で、範囲は型でも smart constructor でも守られない。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["lib/playbackQueue.ts:7-12", "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:45"]
  - id: ME5
    dimension: concept
    name: PlaybackSource
    meaning_or_rule: "'cached' | 'network' | 'unavailable'。再生音源の決定。"
    target_status: present
    concept_kind: value_object
    evidence:
      status: confirmed
      sources: ["lib/resolvePlayback.ts:16,22-27"]
  - id: ME6
    dimension: behavior
    name: 'unavailable' の扱い（オフライン未キャッシュ）
    meaning_or_rule: "'unavailable' は「再生できない」という業務判断であり、network 取得を試みない停止理由として扱うべき。実装は source !== 'cached' を一律 null 扱いし network と同一経路へ流す。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AudioPlayerContext.tsx:100-104", "contexts/AudioPlayerContext.tsx:115-117"]
  - id: ME7
    dimension: failure
    name: auto-advance 中の次エピソード取得失敗
    meaning_or_rule: "ended → advance → fetchAndPlay 失敗時、キューは既に前進済みで、失敗したエピソードへ戻る手段も再試行も無い。失敗後 state（どのアイテムが current か）が未定義。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AudioPlayerContext.tsx:126-133", "contexts/AudioPlayerContext.tsx:112-123"]
  - id: ME8
    dimension: time
    name: 位置保存スロットル（10 秒・位置基準）
    meaning_or_rule: "POSITION_SAVE_INTERVAL=10 を currentTime 差分で判定する。seek 後退時は t - lastSaved が負になり、次の保存まで最大 10 秒以上空く（wall clock 基準ではない）。"
    target_status: present
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["hooks/useAudioPlayer.ts:10", "hooks/useAudioPlayer.ts:121-129"]
  - id: ME9
    dimension: behavior
    name: 完聴イベント順序（completed → position=0）
    meaning_or_rule: "ADR-075 決定3。onCompleted を position=0 保存より前に発火する。"
    target_status: present
    concept_kind: event
    evidence:
      status: confirmed
      sources: ["hooks/useAudioPlayer.ts:132-146"]
  - id: ME10
    dimension: writer
    name: blob: URL の revoke 責務
    meaning_or_rule: "createObjectURL は audioCache が発行し、revoke は useAudioPlayer の load / unmount が行う。発行者と解放者が別 module。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["lib/audioCache.ts:97-104", "hooks/useAudioPlayer.ts:171-173", "hooks/useAudioPlayer.ts:192-194"]
  - id: ME11
    dimension: authority
    name: 「現在再生中の Podcast」の正本
    meaning_or_rule: "Q.current(queueRef) と AppContext.state.currentPodcast の 2 箇所が同じ事実を保持し、後者は dispatch で別途更新される。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AudioPlayerContext.tsx:49-54", "contexts/AudioPlayerContext.tsx:88-90", "contexts/AppContext.tsx:14,43-44"]
  - id: ME12
    dimension: authority
    name: 「再生速度」の正本
    meaning_or_rule: "AppContext.playbackSpeed が state、audio.playbackRate が実体。useAudioPlayer.setSpeed は state を持たず、同期は AudioPlayerBar の effect 1 本だけに依存する。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AppContext.tsx:15,45-46", "hooks/useAudioPlayer.ts:237-240", "components/AudioPlayerBar.tsx:24-26"]
  - id: ME13
    dimension: authority
    name: 「再生位置」の正本
    meaning_or_rule: "server（playback_position_seconds）> local（localStorage）の優先順で resolveResumePosition が決める。再生中の正本は audio 要素。"
    target_status: present
    concept_kind: domain_service
    evidence:
      status: confirmed
      sources: ["lib/playbackPosition.ts:25-38", "contexts/AudioPlayerContext.tsx:86-88"]
  - id: ME14
    dimension: reader
    name: キャッシュ済み Podcast の読み出し
    meaning_or_rule: "getCachedPodcast は audio_url='' の Podcast を返す。呼び出し側が blob URL で上書きしなければ再生不能値が domain へ流入する。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["lib/audioCache.ts:83-84", "lib/audioCache.ts:88-94", "contexts/AudioPlayerContext.tsx:106-108"]
  - id: ME15
    dimension: failure
    name: downloadAudio の応答検証
    meaning_or_rule: "fetch(podcast.audio_url) の response.ok を確認せず cache.put する。403/404 の本文が「キャッシュ済み音声」として永続化されうる。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["lib/audioCache.ts:68-71"]

  # ---- S2 auth ----
  - id: ME20
    dimension: state
    name: AuthSession (status + user)
    meaning_or_rule: "status: 'unknown' | 'authenticated' | 'unauthenticated' と user: AuthUser|null が独立 state。'authenticated' かつ user===null、'unauthenticated' かつ user!==null を型が禁じない。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:16", "contexts/AuthContext.tsx:46-47"]
  - id: ME21
    dimension: failure
    name: 認証失敗の意味分解
    meaning_or_rule: "401（失効）・ネットワーク断・5xx を区別せず全て 'unauthenticated' へ潰す。オフライン中の起動が「ログアウト相当」になる。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:54-64"]
  - id: ME22
    dimension: transition
    name: session expiry 遷移（authenticated → unauthenticated、logout 経由でない）
    meaning_or_rule: "失効時に cache residency cleanup を伴う遷移が必要。実装には logout() 経路しか cleanup が無い。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:54-64", "contexts/AuthContext.tsx:86-104"]
  - id: ME23
    dimension: behavior
    name: cache residency cleanup
    meaning_or_rule: "audio-v1 と SW 管理 'shell-*' / 'api-*' を消す。logout() のみが呼ぶ。"
    target_status: present
    concept_kind: domain_service
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:92-101", "lib/swCacheCleanup.ts:16-24", "lib/audioCache.ts:122-125"]
  - id: ME24
    dimension: writer
    name: Service Worker による認証済み応答の格納
    meaning_or_rule: "navigate 応答と GET /api/backend/podcasts を URL キーで Cache Storage へ入れる。利用者識別子を含まないキーのため、端末共有時に別利用者へ返りうる。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["public/sw.js:50-61", "public/sw.js:79-87"]
  - id: ME25
    dimension: authority
    name: SW 管理 cache 名前空間の semantic owner
    meaning_or_rule: "'shell-' / 'api-' prefix の意味が public/sw.js:22-24 と lib/swCacheCleanup.ts:21 に二重定義され、コメントで手動同期を要求している。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["public/sw.js:16-24", "lib/swCacheCleanup.ts:6-14,21"]
  - id: ME26
    dimension: behavior
    name: admin 画面の認可ゲート
    meaning_or_rule: "保護 UI は status === 'authenticated' かつ isAdmin のときだけ描画されるべき。実装は「status==='authenticated' かつ !isAdmin」のときだけ拒否表示し、'unknown' と 'unauthenticated' は素通しで管理 UI を描画する。"
    target_status: conflicting
    concept_kind: policy
    evidence:
      status: confirmed
      sources:
        - "app/(app)/admin/users/page.tsx:86-98,100"
        - "app/(app)/admin/invites/page.tsx:142"
        - "app/(app)/admin/metrics/page.tsx:70"
        - "app/(app)/admin/featured-sites/page.tsx:207"
  - id: ME27
    dimension: behavior
    name: (app) ルートグループの認証ゲート
    meaning_or_rule: "認証後画面のシェル。auth gating を一切持たず、未認証でも子ページを描画する。"
    target_status: missing
    concept_kind: policy
    evidence:
      status: confirmed
      sources: ["app/(app)/layout.tsx:11-21"]
  - id: ME28
    dimension: writer
    name: テスト専用 initialUser / initialStatus 注入
    meaning_or_rule: "production build にも残る public prop で、任意の (status, user) 組を外から構築できる alternate writer。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:37-47", "contexts/AuthContext.tsx:119-123"]

  # ---- S3 DTO versioning ----
  - id: ME30
    dimension: concept
    name: Podcast DTO version（世代）
    meaning_or_rule: "「どの backend 世代の応答か」という概念が無く、title? / segments? / vocabulary? / quiz? / source_articles? / source_kind? / is_starred? の欠落有無が暗黙のバージョンフラグになっている。"
    target_status: missing
    concept_kind: value_object
    evidence:
      status: confirmed
      sources: ["types/index.ts:93-108", "types/index.ts:24-26"]
  - id: ME31
    dimension: constraint
    name: status × audio_url × error_message の共起制約
    meaning_or_rule: "'completed' なら audio_url は再生可能かつ error_message は null、'failed' なら error_message は非 null、という共起規則。型は 3 フィールドを完全独立に宣言する。"
    target_status: missing
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["types/index.ts:92,111-112"]
  - id: ME32
    dimension: reader
    name: status / error_message の消費者
    meaning_or_rule: "status は表示バッジ（StatusBadge）と完了演出の検知だけが読む。error_message を読む production コードは in_scope に存在しない。再生導線は status を一切参照しない。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["components/PodcastCard.tsx:46,51-58", "app/(app)/podcast/page.tsx:84,91", "components/ui/StatusBadge.tsx:20-24"]
  - id: ME33
    dimension: term_context
    name: 'completed' の多義性
    meaning_or_rule: "PodcastStatus.'completed'（生成完了）と ADR-075 の完聴イベント completed（利用者が聴き終えた）が同じ語で、別 context の別事実を指す。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["types/index.ts:15", "hooks/useAudioPlayer.ts:20-22,135-138"]

  # ---- S4 preferences ----
  - id: ME40
    dimension: constraint
    name: 復元値の検証規則
    meaning_or_rule: "playbackSpeed は number かつ >0、timeFormat は列挙一致、volume は 0..1。いずれも復元時に検証する。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AppContext.tsx:88-98,102-112", "hooks/useAudioPlayer.ts:42-52"]
  - id: ME41
    dimension: authority
    name: localStorage key の所有
    meaning_or_rule: "lib/config.ts が単一正本を宣言する。'theme' は app/layout.tsx:46 のインライン script が生文字列で、'seen_achievement_ids' は dashboard が生文字列で使い、config.ts に定義が無い。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources:
        - "lib/config.ts:1-27"
        - "app/layout.tsx:46"
        - "app/(app)/dashboard/page.tsx:48,65"
  - id: ME42
    dimension: constraint
    name: 保存表現（生値 vs JSON）の整合
    meaning_or_rule: "同一 key に対する encode/decode 規約。theme は生文字列（ThemeToggle / inline script）、他は JSON.stringify（useLocalStorage / AppContext / useAudioPlayer）で、規約が key ごとに異なりコメントでしか説明されない。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["components/ui/ThemeToggle.tsx:29-32", "app/layout.tsx:45-49", "hooks/useLocalStorage.ts:19,30"]
  - id: ME43
    dimension: writer
    name: raw dispatch の公開
    meaning_or_rule: "AppContext が Action を直接 dispatch できる形で公開し、SET_SPEED / SET_PODCAST を任意の consumer が検証なしに発行できる。"
    target_status: conflicting
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources:
        - "contexts/AppContext.tsx:58-62"
        - "app/(app)/settings/page.tsx:352"
        - "components/AudioPlayerBar.tsx:239"
        - "contexts/AudioPlayerContext.tsx:90"
  - id: ME44
    dimension: reader
    name: 設定の reader 一貫性
    meaning_or_rule: "volume は useAudioPlayer が read/write（AppContext は意図的に持たない）。speed は AppContext が保持し audio へ片方向反映。"
    target_status: present
    concept_kind: not_applicable
    evidence:
      status: confirmed
      sources: ["contexts/AppContext.tsx:18-19", "hooks/useAudioPlayer.ts:42-52,242-252"]
```

## 3. dimension_applicability_profiles

```yaml
dimension_applicability_profiles:
  - id: DAP1
    requirement_ids: [R1]
    dimensions: [state, transition, time, relationship]
    disposition: not_applicable
    rationale: "R1 は業務ルールの所在（quota 分類・server-star merge・パスワードポリシー・404=未蓄積）を問うもので、S1–S4 の固定 scope 内ではこれらのルールは lib ではなくページに存在するかの配置問題に帰着し、lifecycle・順序・複数要素整合が判定を分岐させない。"
    evidence:
      status: confirmed
      sources: ["lib/config.ts:1-27（S4 で唯一 lib 所有が成立する例）", "app/(app)/dashboard/page.tsx:48,65（page 所有の反例）"]
  - id: DAP2
    requirement_ids: [R3]
    dimensions: [term_context, failure]
    disposition: not_applicable
    rationale: "R3 は 3 主体の source of truth 一意性で、語義の別解釈も失敗分類も判定を分岐させない（誰が正本かは authority/writer/reader で決まる）。"
    evidence:
      status: confirmed
      sources: ["contexts/AppContext.tsx:14-19", "contexts/AudioPlayerContext.tsx:49-54"]
  - id: DAP3
    requirement_ids: [R8]
    dimensions: [term_context, concept, constraint, state, transition, behavior, relationship, failure, time, writer, reader, authority]
    disposition: not_applicable
    rationale: "R8 は CI パイプライン構成（typecheck:ts7 / build の独立ゲート）に関する要求で、S1–S4 の domain model 要素ではない。監査対象は .github/workflows であり、本 package の固定 scope 外。"
    evidence:
      status: confirmed
      sources: ["common-brief.md の in_scope 列挙に .github/ を含まない", "/Users/rio/git/news-listen/agent-rules/70-typescript-version-policy.md:16（本 package では未読・router 側 Evidence）"]
  - id: DAP4
    requirement_ids: [R6]
    dimensions: [concept, time]
    disposition: not_applicable
    rationale: "R6（認証済み応答の残留）は cache 名前空間の writer/reader と削除遷移で判定でき、新概念の追加や期限・順序の定義が結論を変えない（SW cache に TTL 概念が無く、削除は世代交代と logout の 2 契機のみ）。"
    evidence:
      status: confirmed
      sources: ["public/sw.js:26-36", "contexts/AuthContext.tsx:92-101"]
  - id: DAP5
    requirement_ids: [R5]
    dimensions: [relationship, time]
    disposition: not_applicable
    rationale: "R5（'unknown' 中に保護 UI を描画しない）は単一 component 内の state→描画判定で、複数 context 間の整合範囲も期限・順序も分岐させない。"
    evidence:
      status: confirmed
      sources: ["app/(app)/admin/users/page.tsx:86-100"]
  - id: DAP6
    requirement_ids: [R7]
    dimensions: [concept, constraint, transition, relationship, time, authority]
    disposition: not_applicable
    rationale: "R7（テストが production 経路を通り契約 Q-*/RT-* に対応付く）は検証設計の要求で、domain の概念・値制約・遷移・整合範囲・時刻・正本所有を新たに定義しない。関連する欠落は writer/reader（テスト注入経路）と behavior（alias で契約を同一視）に現れる。"
    evidence:
      status: confirmed
      sources: ["contexts/AuthContext.tsx:37-47", "contexts/AppContext.tsx:70-79"]
  - id: DAP7
    requirement_ids: [R4]
    dimensions: [state, transition, time, authority]
    disposition: not_applicable
    rationale: "R4（API 失敗の意味）は S1–S4 内では失敗分類・概念・consumer 解釈の問題で、失敗の lifecycle state・遷移許可・期限・正本所有が判定を分岐させない。"
    evidence:
      status: confirmed
      sources: ["contexts/AudioPlayerContext.tsx:118-120", "contexts/AuthContext.tsx:59-63"]
  - id: DAP8
    requirement_ids: [R2]
    dimensions: [term_context, time]
    disposition: not_applicable
    rationale: "R2（不正状態を公開経路から構築できない）は型・constructor・writer の問題であり、語義の別解釈も期限・順序も判定を分岐させない。"
    evidence:
      status: confirmed
      sources: ["lib/playbackQueue.ts:7-12", "types/index.ts:87-114"]
```

## 4. requirement_model_matrix

```yaml
requirement_model_matrix:
  - requirement_id: R1
    scopes: [S1, S3, S4]
    dimension_links:
      - dimension: term_context
        element_ids: [ME33]
        evidence: {status: confirmed, sources: ["types/index.ts:15", "hooks/useAudioPlayer.ts:135-138"]}
      - dimension: concept
        element_ids: [ME30]
        evidence: {status: confirmed, sources: ["types/index.ts:93-108"]}
      - dimension: constraint
        element_ids: [ME40, ME41, ME42]
        evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:88-112", "lib/config.ts:1-27", "app/layout.tsx:46"]}
      - dimension: behavior
        element_ids: [ME6, ME26, ME27]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:100-104", "app/(app)/admin/users/page.tsx:86", "app/(app)/layout.tsx:11-21"]}
      - dimension: writer
        element_ids: [ME41, ME43]
        evidence: {status: confirmed, sources: ["app/(app)/dashboard/page.tsx:48,65", "contexts/AppContext.tsx:58-62"]}
      - dimension: reader
        element_ids: [ME32]
        evidence: {status: confirmed, sources: ["components/PodcastCard.tsx:46,51-58"]}
      - dimension: authority
        element_ids: [ME25, ME41]
        evidence: {status: confirmed, sources: ["public/sw.js:16-24", "lib/swCacheCleanup.ts:21", "lib/config.ts:1-27"]}
    not_applicable_profile_ids: [DAP1]
  - requirement_id: R2
    scopes: [S1, S3]
    dimension_links:
      - dimension: concept
        element_ids: [ME1, ME30]
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:25-30", "types/index.ts:93-108"]}
      - dimension: constraint
        element_ids: [ME4, ME31]
        evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:7-12", "types/index.ts:92,111-112"]}
      - dimension: state
        element_ids: [ME1, ME3, ME20]
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:99-102", "lib/playbackQueue.ts:7-15", "contexts/AuthContext.tsx:46-47"]}
      - dimension: transition
        element_ids: [ME2]
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:148-151"]}
      - dimension: behavior
        element_ids: [ME15]
        evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71"]}
      - dimension: relationship
        element_ids: [ME14]
        evidence: {status: confirmed, sources: ["lib/audioCache.ts:83-84,88-94", "contexts/AudioPlayerContext.tsx:106-108"]}
      - dimension: failure
        element_ids: [ME7]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:126-133"]}
      - dimension: writer
        element_ids: [ME28, ME43]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:37-47", "contexts/AppContext.tsx:58-62"]}
      - dimension: reader
        element_ids: [ME32]
        evidence: {status: confirmed, sources: ["components/PodcastCard.tsx:51-58"]}
      - dimension: authority
        element_ids: [ME4]
        evidence: {status: confirmed, sources: ["/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:45", "lib/playbackQueue.ts:7-12"]}
    not_applicable_profile_ids: [DAP8]
  - requirement_id: R3
    scopes: [S1, S4]
    dimension_links:
      - dimension: concept
        element_ids: [ME11, ME12, ME13]
        evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:14-19", "lib/playbackPosition.ts:25-38"]}
      - dimension: constraint
        element_ids: [ME12]
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:237-240"]}
      - dimension: state
        element_ids: [ME11]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:49-54,88-90"]}
      - dimension: transition
        element_ids: [ME12]
        evidence: {status: confirmed, sources: ["components/AudioPlayerBar.tsx:24-26"]}
      - dimension: behavior
        element_ids: [ME13]
        evidence: {status: confirmed, sources: ["lib/playbackPosition.ts:25-38", "contexts/AudioPlayerContext.tsx:86-88"]}
      - dimension: time
        element_ids: [ME8]
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:10,121-129"]}
      - dimension: writer
        element_ids: [ME43, ME10]
        evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:58-62", "hooks/useAudioPlayer.ts:69-75"]}
      - dimension: reader
        element_ids: [ME44]
        evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:18-19"]}
      - dimension: authority
        element_ids: [ME11, ME12, ME13]
        evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:14-19", "hooks/useAudioPlayer.ts:237-240"]}
    not_applicable_profile_ids: [DAP2]
  - requirement_id: R4
    scopes: [S1, S2]
    dimension_links:
      - dimension: term_context
        element_ids: [ME21]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:59-63"]}
      - dimension: concept
        element_ids: [ME5]
        evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:16"]}
      - dimension: constraint
        element_ids: [ME21]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:54-64"]}
      - dimension: behavior
        element_ids: [ME6]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:100-104"]}
      - dimension: relationship
        element_ids: [ME7]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:112-123"]}
      - dimension: failure
        element_ids: [ME7, ME21, ME15]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:118-120", "contexts/AuthContext.tsx:59-63", "lib/audioCache.ts:68-71"]}
      - dimension: writer
        element_ids: [ME15]
        evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71"]}
      - dimension: reader
        element_ids: [ME6]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:115-117"]}
    not_applicable_profile_ids: [DAP7]
  - requirement_id: R5
    scopes: [S2]
    dimension_links:
      - dimension: term_context
        element_ids: [ME20]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:12-16"]}
      - dimension: concept
        element_ids: [ME26]
        evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:25,86"]}
      - dimension: constraint
        element_ids: [ME20]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:46-47"]}
      - dimension: state
        element_ids: [ME20]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:16,46-47"]}
      - dimension: transition
        element_ids: [ME22]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:54-64"]}
      - dimension: behavior
        element_ids: [ME26, ME27]
        evidence: {status: confirmed, sources: ["app/(app)/admin/metrics/page.tsx:70", "app/(app)/layout.tsx:11-21"]}
      - dimension: failure
        element_ids: [ME21]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:59-63"]}
      - dimension: writer
        element_ids: [ME28]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:37-47,119-123"]}
      - dimension: reader
        element_ids: [ME26]
        evidence: {status: confirmed, sources: ["app/(app)/admin/invites/page.tsx:40,60,142", "app/(app)/admin/featured-sites/page.tsx:14,50,207"]}
      - dimension: authority
        element_ids: [ME26]
        evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86", "app/(app)/layout.tsx:11-21"]}
    not_applicable_profile_ids: [DAP5]
  - requirement_id: R6
    scopes: [S2]
    dimension_links:
      - dimension: term_context
        element_ids: [ME25]
        evidence: {status: confirmed, sources: ["public/sw.js:16-24", "lib/swCacheCleanup.ts:6-14"]}
      - dimension: constraint
        element_ids: [ME24]
        evidence: {status: confirmed, sources: ["public/sw.js:50-61"]}
      - dimension: state
        element_ids: [ME23]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:92-101"]}
      - dimension: transition
        element_ids: [ME22]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:54-64,86-104"]}
      - dimension: behavior
        element_ids: [ME23]
        evidence: {status: confirmed, sources: ["lib/swCacheCleanup.ts:16-24"]}
      - dimension: relationship
        element_ids: [ME25]
        evidence: {status: confirmed, sources: ["public/sw.js:22-24", "lib/swCacheCleanup.ts:21"]}
      - dimension: failure
        element_ids: [ME23]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:99-101"]}
      - dimension: writer
        element_ids: [ME24]
        evidence: {status: confirmed, sources: ["public/sw.js:79-87"]}
      - dimension: reader
        element_ids: [ME24]
        evidence: {status: confirmed, sources: ["public/sw.js:56-60"]}
      - dimension: authority
        element_ids: [ME25]
        evidence: {status: confirmed, sources: ["public/sw.js:16-24"]}
    not_applicable_profile_ids: [DAP4]
  - requirement_id: R7
    scopes: [S1, S2, S4]
    dimension_links:
      - dimension: term_context
        element_ids: [ME33]
        evidence: {status: confirmed, sources: ["types/index.ts:15", "hooks/useAudioPlayer.ts:20-22"]}
      - dimension: state
        element_ids: [ME20]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:44-47"]}
      - dimension: behavior
        element_ids: [ME28]
        evidence: {status: unknown, sources: ["contexts/AuthContext.tsx:119-123 initialStatus が refreshMe 経路を丸ごと迂回させる"]}
      - dimension: failure
        element_ids: [ME7]
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:126-133"]}
      - dimension: writer
        element_ids: [ME28, ME43]
        evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:37-47", "contexts/AppContext.tsx:70-79"]}
      - dimension: reader
        element_ids: [ME32]
        evidence: {status: confirmed, sources: ["components/PodcastCard.tsx:46"]}
    not_applicable_profile_ids: [DAP6]
  - requirement_id: R8
    scopes: []
    dimension_links: []
    not_applicable_profile_ids: [DAP3]
```

## 5. access_paths（writer / reader）

```yaml
access_paths:
  - id: AP1
    matrix_element_id: ME8
    kind: writer
    actor_or_component: useAudioPlayer timeupdate handler
    entry_point: "hooks/useAudioPlayer.ts:116-130"
    operation_or_interpretation: "10 秒毎に localStorage へ位置を書き、onPositionSave コールバックでサーバへ送る"
    model_element_ids: [ME8, ME13]
    validation_or_translation_route: "contexts/AudioPlayerContext.tsx:56-62 で Math.max(0, seconds)。localStorage 側は無検証"
    bypass_or_misinterpretation_risk: "localStorage 直書き（:71）は負値・NaN も書ける。読み出し側 getSavedPosition(:58-67) は typeof number のみ検査し範囲を見ない"
    representation: "JSON number"
    platform: common
    evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:58-75,116-130", "contexts/AudioPlayerContext.tsx:56-62"]}
  - id: AP2
    matrix_element_id: ME10
    kind: writer
    actor_or_component: audioCache.getCachedAudioUrl
    entry_point: "lib/audioCache.ts:97-104"
    operation_or_interpretation: "Cache Storage の Response を Blob 化し createObjectURL で blob: URL を発行"
    model_element_ids: [ME10, ME5]
    validation_or_translation_route: "なし（Response の ok / type を確認しない）"
    bypass_or_misinterpretation_risk: "revoke は hooks/useAudioPlayer.ts:171-173,192-194 のみ。resolveCachedPodcast(:98-108) が cachedPodcast 欠落で null return する経路（:107）では発行済み blob URL が revoke されずリークする"
    representation: "blob: URL string"
    platform: common
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:97-104", "contexts/AudioPlayerContext.tsx:106-108", "hooks/useAudioPlayer.ts:171-173,192-194"]}
  - id: AP3
    matrix_element_id: ME14
    kind: writer
    actor_or_component: audioCache.downloadAudio
    entry_point: "lib/audioCache.ts:64-85"
    operation_or_interpretation: "audio_url='' に潰した Podcast を Cache Storage へ JSON 永続化"
    model_element_ids: [ME14, ME31]
    validation_or_translation_route: "なし。fetch 応答の ok も未確認（:69-71）"
    bypass_or_misinterpretation_risk: "getCachedPodcast(:88-94) は JSON をそのまま Podcast として返し、型検証しない。呼び出し側が audio_url を上書きしなければ再生不能 Podcast が domain に入る"
    representation: "JSON Podcast"
    platform: common
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71,83-84,88-94"]}
  - id: AP4
    matrix_element_id: ME24
    kind: writer
    actor_or_component: Service Worker (public/sw.js)
    entry_point: "public/sw.js:63-90 fetch listener"
    operation_or_interpretation: "navigate 応答を shell-pages-v1 へ、GET /api/backend/podcasts を api-v1 へ URL キーで put"
    model_element_ids: [ME24, ME23]
    validation_or_translation_route: "response.ok のみ（:44,:54）。利用者識別は行わない"
    bypass_or_misinterpretation_risk: "利用者 A の認証済み応答が利用者 B のセッションでヒットしうる。削除契機は activate の世代交代（:26-36、SW_VERSION 変化時のみ）と logout だけ"
    representation: "Cache Storage entry (URL key)"
    platform: common
    evidence: {status: confirmed, sources: ["public/sw.js:26-36,50-61,79-87"]}
  - id: AP5
    matrix_element_id: ME23
    kind: writer
    actor_or_component: AuthContext.logout
    entry_point: "contexts/AuthContext.tsx:86-104"
    operation_or_interpretation: "deleteAllAudio() と clearManagedServiceWorkerCaches() を並行実行して状態を落とす"
    model_element_ids: [ME23, ME22]
    validation_or_translation_route: "失敗は握り潰す（:99-101、ベストエフォート）"
    bypass_or_misinterpretation_risk: "この経路は明示 logout のみ。refreshMe 失敗（:59-63）による失効では呼ばれない → U1 の gap"
    representation: "Cache Storage 削除"
    platform: common
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:86-104", "lib/swCacheCleanup.ts:16-24"]}
  - id: AP6
    matrix_element_id: ME28
    kind: writer
    actor_or_component: AuthProvider props (test-only とコメントされた public prop)
    entry_point: "contexts/AuthContext.tsx:37-47"
    operation_or_interpretation: "initialUser / initialStatus で (status, user) を任意に構築し、:119-123 の refreshMe effect も無効化する"
    model_element_ids: [ME20, ME28]
    validation_or_translation_route: "なし"
    bypass_or_misinterpretation_risk: "status='authenticated' かつ user=null、status='unauthenticated' かつ user=非 null を構築でき、実 API 検証を経ずに保護 UI の前提を満たす"
    representation: "React props"
    platform: common
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:37-47,119-123"]}
  - id: AP7
    matrix_element_id: ME43
    kind: writer
    actor_or_component: AppContext raw dispatch の consumer
    entry_point: "contexts/AppContext.tsx:58-62"
    operation_or_interpretation: "SET_SPEED / SET_PODCAST / SET_TIME_FORMAT を検証なしに発行"
    model_element_ids: [ME43, ME12, ME11]
    validation_or_translation_route: "reducer(:39-52) は値検証をしない。復元時のみ :88-112 で検証する"
    bypass_or_misinterpretation_risk: "app/(app)/settings/page.tsx:352 と components/AudioPlayerBar.tsx:239 が直接 SET_SPEED を送る。setTimeFormat(:117-124) と違い永続化も伴わないため、speed の state と localStorage が乖離する"
    representation: "Redux 風 Action"
    platform: common
    evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:39-52,58-62,88-124", "app/(app)/settings/page.tsx:352", "components/AudioPlayerBar.tsx:239"]}
  - id: AP8
    matrix_element_id: ME41
    kind: writer
    actor_or_component: inline theme script / dashboard
    entry_point: "app/layout.tsx:45-49 と app/(app)/dashboard/page.tsx:48,65"
    operation_or_interpretation: "'theme' を生文字列で読み、'seen_achievement_ids' を生文字列 key で読み書きする"
    model_element_ids: [ME41, ME42]
    validation_or_translation_route: "theme は saved || (prefersDark ? 'dark':'light') のみ（任意文字列がそのまま data-theme になる）"
    bypass_or_misinterpretation_risk: "lib/config.ts の key 正本を迂回。'seen_achievement_ids' は config.ts に定義自体が無い"
    representation: "raw string / JSON array"
    platform: common
    evidence: {status: confirmed, sources: ["app/layout.tsx:46", "app/(app)/dashboard/page.tsx:48,65", "lib/config.ts:1-27", "components/ui/ThemeToggle.tsx:29-32"]}
  - id: AP9
    matrix_element_id: ME26
    kind: reader
    actor_or_component: admin ページ 4 本
    entry_point: "app/(app)/admin/{users:86, invites:142, metrics:70, featured-sites:207}/page.tsx"
    operation_or_interpretation: "status と user.role を読み、'authenticated' かつ !isAdmin のときだけ拒否 UI を返す"
    model_element_ids: [ME26, ME20]
    validation_or_translation_route: "なし（同じ条件式が 4 箇所に複製されている）"
    bypass_or_misinterpretation_risk: "status==='unknown' / 'unauthenticated' では条件が false になり、管理 UI 本体（users:100 以降）が描画される"
    representation: "JSX 早期 return"
    platform: common
    evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:12,25,86-100", "app/(app)/admin/invites/page.tsx:40,60,142", "app/(app)/admin/metrics/page.tsx:36-37,70", "app/(app)/admin/featured-sites/page.tsx:14,50,207"]}
  - id: AP10
    matrix_element_id: ME32
    kind: reader
    actor_or_component: PodcastCard 再生ボタン
    entry_point: "components/PodcastCard.tsx:51-58"
    operation_or_interpretation: "podcast.status を一切参照せず onPlay(podcast) を呼ぶ"
    model_element_ids: [ME31, ME32]
    validation_or_translation_route: "なし"
    bypass_or_misinterpretation_risk: "status='processing'/'failed'（audio_url が未確定）でも再生を開始し、audio error → トースト（hooks/useAudioPlayer.ts:148-151, contexts/AudioPlayerContext.tsx:77）という transport 由来の失敗に変換される"
    representation: "React onClick"
    platform: common
    evidence: {status: confirmed, sources: ["components/PodcastCard.tsx:46,51-58", "contexts/AudioPlayerContext.tsx:77,88"]}
  - id: AP11
    matrix_element_id: ME12
    kind: writer
    actor_or_component: AudioPlayerBar speed sync effect
    entry_point: "components/AudioPlayerBar.tsx:24-26"
    operation_or_interpretation: "state.playbackSpeed を audio.playbackRate へ片方向反映（eslint-disable 付き）"
    model_element_ids: [ME12]
    validation_or_translation_route: "なし"
    bypass_or_misinterpretation_risk: "AudioPlayerBar が mount されない経路（(app) 外のページ）では audio 要素へ速度が反映されない。useAudioPlayer.setSpeed(:237-240) は state を持たないため、実効速度を読み出す公開手段が無い"
    representation: "React effect"
    platform: common
    evidence: {status: confirmed, sources: ["components/AudioPlayerBar.tsx:24-26", "hooks/useAudioPlayer.ts:237-240", "app/(app)/layout.tsx:17"]}
```

## 6. ownership

```yaml
ownership:
  - id: OW1
    matrix_element_id: ME11
    authority_type: source_of_truth
    subject_element_ids: [ME11, ME3]
    owner: "unresolved（QueueState.currentIndex と AppContext.state.currentPodcast の二重保持）"
    target_status: conflicting
    transition_controls:
      status: not_applicable
      rationale: "migration ではなく設計上の恒常的二重保持。期限も reconciliation も存在しない"
      evidence: ["contexts/AudioPlayerContext.tsx:88-90", "contexts/AppContext.tsx:43-44"]
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:49-54,88-90", "contexts/AppContext.tsx:14,43-44"]}
  - id: OW2
    matrix_element_id: ME12
    authority_type: state_authority
    subject_element_ids: [ME12]
    owner: "AppContext（state）だが実効値は audio 要素"
    target_status: conflicting
    transition_controls:
      status: not_applicable
      rationale: "恒常的な二重表現。AppContext.tsx:18-19 は volume/isPlaying を意図的に除外と宣言する一方、playbackSpeed だけを保持している"
      evidence: ["contexts/AppContext.tsx:15,18-19"]
    evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:15,18-19,45-46", "hooks/useAudioPlayer.ts:237-240", "components/AudioPlayerBar.tsx:24-26"]}
  - id: OW3
    matrix_element_id: ME13
    authority_type: source_of_truth
    subject_element_ids: [ME13, ME8]
    owner: "resolveResumePosition（server 優先・local fallback）"
    target_status: unique
    transition_controls: {status: not_applicable, rationale: "単一の純関数が優先順位を決めており競合が無い", evidence: ["lib/playbackPosition.ts:25-38"]}
    evidence: {status: confirmed, sources: ["lib/playbackPosition.ts:25-38", "contexts/AudioPlayerContext.tsx:86-88"]}
  - id: OW4
    matrix_element_id: ME25
    authority_type: semantic_owner
    subject_element_ids: [ME25, ME24, ME23]
    owner: "unresolved（'shell-'/'api-' prefix が public/sw.js:22-24 と lib/swCacheCleanup.ts:21 に二重定義）"
    target_status: conflicting
    transition_controls:
      status: not_applicable
      rationale: "classic script の import 不可という技術制約に由来する恒常的重複で、移行期間ではない（public/sw.js:20-21 と lib/swCacheCleanup.ts:6-10 が手動同期を指示）"
      evidence: ["public/sw.js:20-21", "lib/swCacheCleanup.ts:6-10"]
    evidence: {status: confirmed, sources: ["public/sw.js:16-24", "lib/swCacheCleanup.ts:6-14,21"]}
  - id: OW5
    matrix_element_id: ME26
    authority_type: invariant_owner
    subject_element_ids: [ME26, ME27]
    owner: "unresolved（各 admin ページが同じ条件式を複製し、(app)/layout.tsx は gating を持たない）"
    target_status: conflicting
    transition_controls: {status: not_applicable, rationale: "移行ではなく未集約。route-level の単一 gate が存在しない", evidence: ["app/(app)/layout.tsx:11-21"]}
    evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86", "app/(app)/admin/invites/page.tsx:142", "app/(app)/admin/metrics/page.tsx:70", "app/(app)/admin/featured-sites/page.tsx:207", "app/(app)/layout.tsx:11-21"]}
  - id: OW6
    matrix_element_id: ME41
    authority_type: semantic_owner
    subject_element_ids: [ME41, ME42]
    owner: "lib/config.ts を正本と宣言（:1）するが、'theme' の生値規約は app/layout.tsx:46 が、'seen_achievement_ids' は dashboard が単独所有"
    target_status: conflicting
    transition_controls: {status: not_applicable, rationale: "移行計画は存在せず、config.ts:12-16 のコメントが二重管理を前提にしている", evidence: ["lib/config.ts:12-16"]}
    evidence: {status: confirmed, sources: ["lib/config.ts:1,12-16", "app/layout.tsx:46", "app/(app)/dashboard/page.tsx:48,65"]}
  - id: OW7
    matrix_element_id: ME20
    authority_type: state_authority
    subject_element_ids: [ME20]
    owner: AuthContext
    target_status: conflicting
    transition_controls: {status: not_applicable, rationale: "AuthContext が唯一の state 所有者だが、public props（AP6）が外部から直接 state を確定できるため権限が閉じていない", evidence: ["contexts/AuthContext.tsx:44-47"]}
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:44-47,119-123"]}
```

## 7. invalid_construction（公開経路から構築できる不正状態）

| # | 不正状態 | 公開構築経路 | Evidence |
|---|---|---|---|
| IV1 | `status: 'completed'` かつ `error_message !== null` の Podcast | `types/index.ts` の object literal / API decode（型が 3 フィールドを独立宣言） | `types/index.ts:111-112` |
| IV2 | `status: 'processing'` かつ `audio_url: ''` の Podcast を再生開始 | `components/PodcastCard.tsx:51-58` の再生ボタン（status 未参照）→ `contexts/AudioPlayerContext.tsx:88` → `player.load('')` | `components/PodcastCard.tsx:46,51-58`, `contexts/AudioPlayerContext.tsx:88` |
| IV3 | `audio_url: ''` の Podcast が Cache Storage に永続化され、読み出し側へ返る | `lib/audioCache.ts:83-84` が書き、`lib/audioCache.ts:88-94` が検証なしに返す | `lib/audioCache.ts:83-84,88-94` |
| IV4 | HTTP エラー応答（403/404 本文）が「キャッシュ済み音声」として保存される | `lib/audioCache.ts:68-71`（`response.ok` 未確認で `cache.put`） | `lib/audioCache.ts:68-71` |
| IV5 | `QueueState` の `currentIndex` が `items` 範囲外（spec 不変条件2 違反） | `lib/playbackQueue.ts:7-12` の exported interface に smart constructor が無く、任意の importer が `{items: [], currentIndex: 3}` を構築可能。`Q.current`(:18-21) と `Q.advance`(:67-75) はこれを受理する | `lib/playbackQueue.ts:7-12,18-21,67-75`, spec `:45` |
| IV6 | `status: 'authenticated'` かつ `user: null` | `contexts/AuthContext.tsx:44-47` の `initialStatus='authenticated'` + `initialUser` 省略（既定 null）。:119-123 が `initialStatus` で refreshMe を無効化するため恒久化する | `contexts/AuthContext.tsx:37-47,119-123` |
| IV7 | `status: 'unauthenticated'` かつ `user: 非 null` | 同上（`initialStatus='unauthenticated'` + `initialUser` 指定） | `contexts/AuthContext.tsx:44-47` |
| IV8 | `AppState.playbackSpeed` が 0 または負 | `contexts/AppContext.tsx:58-62` の raw `dispatch({type:'SET_SPEED', speed})`。reducer(:45-46) は検証しない（復元経路 :92 の `speed > 0` 検証を迂回する） | `contexts/AppContext.tsx:45-46,58-62,92`, `app/(app)/settings/page.tsx:352` |
| IV9 | `html[data-theme]` が `'dark'`/`'light'` 以外の任意文字列 | `app/layout.tsx:46-48` が localStorage の生値を列挙検証なしに `dataset.theme` へ代入 | `app/layout.tsx:45-49` |
| IV10 | 保存済み再生位置が負値 / duration 超過 | `hooks/useAudioPlayer.ts:69-75` が無検証で write、:58-67 が `typeof number` のみで read（範囲ガードは `loadedmetadata` 時の :156-158 だけで、seek 直後には効かない） | `hooks/useAudioPlayer.ts:58-75,156-158` |
| IV11 | 「現在再生中」が AppContext と QueueState で食い違う | `contexts/AudioPlayerContext.tsx:88-90` が `loadAndPlay` 内で dispatch する一方、`handleEnded`(:126-133) の `fetchAndPlay` が失敗すると queue だけ前進して currentPodcast は前のまま | `contexts/AudioPlayerContext.tsx:88-90,112-123,126-133` |

## 8. rules_outside_model（model 外に置かれた業務ルール）

```yaml
rules_outside_model:
  - id: RO1
    rule: "認可（admin のみ管理 UI）"
    located_in: "app/(app)/admin/{users,invites,metrics,featured-sites}/page.tsx にそれぞれ複製された条件式"
    should_belong_to: "route-level の単一 policy（例: (app)/layout.tsx か専用 guard component）"
    evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86", "app/(app)/admin/invites/page.tsx:142", "app/(app)/admin/metrics/page.tsx:70", "app/(app)/admin/featured-sites/page.tsx:207"]}
  - id: RO2
    rule: "resume / offline source 選択 / キュー挿入 / 自動前進"
    located_in: "contexts/AudioPlayerContext.tsx:84-196（provider 本体）"
    should_belong_to: "lib の純粋 policy（resolvePlayback / playbackQueue と同じ層）"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:84-133,143-161"]}
  - id: RO3
    rule: "「生成中→完了」の検知と演出対象の決定"
    located_in: "app/(app)/podcast/page.tsx:81-108"
    should_belong_to: "status 遷移を表現する domain 関数"
    evidence: {status: confirmed, sources: ["app/(app)/podcast/page.tsx:84,91"]}
  - id: RO4
    rule: "theme 値の既定決定（saved || prefers-color-scheme）"
    located_in: "app/layout.tsx:45-49 のインライン文字列 script"
    should_belong_to: "lib の theme policy（現状 TypeScript 型検査も lint も及ばない）"
    evidence: {status: confirmed, sources: ["app/layout.tsx:45-49"]}
  - id: RO5
    rule: "実効再生速度の適用"
    located_in: "components/AudioPlayerBar.tsx:24-26 の effect（eslint-disable 付き）"
    should_belong_to: "useAudioPlayer 内（speed を state として保持し load 時に再適用する）"
    evidence: {status: confirmed, sources: ["components/AudioPlayerBar.tsx:24-26", "hooks/useAudioPlayer.ts:237-240"]}
```

## 9. destruction_probes（思考実験。本番 data への破壊操作なし）

```yaml
destruction_probes:
  - id: DP1
    requirement_ids: [R6, R5]
    writer_access_path_id: AP4
    entry_point: "public/sw.js:79-87 → contexts/AuthContext.tsx:54-64"
    destructive_input_or_sequence: "利用者 A がオフラインで数ページ閲覧（shell-pages-v1 に認証済み HTML、api-v1 に A の Podcast 一覧が入る）→ サーバ側セッションが失効 → 再訪時 getMe が 401 → refreshMe が status='unauthenticated' へ落とす → 利用者 B が同端末でログイン"
    propagation:
      - "refreshMe の catch(:59-63) は setUser(null)/setStatus('unauthenticated') のみで cache を触らない"
      - "clearManagedServiceWorkerCaches は contexts/AuthContext.tsx:98 の logout 内からしか呼ばれない（本セッションで全 call site を grep 済み）"
      - "sw.js の削除契機は activate 時の世代交代（:26-36、SW_VERSION 変化時のみ）"
      - "B のオフライン navigate / GET /api/backend/podcasts は networkFirst の catch(:56-60) で A のキャッシュを返す"
    business_impact:
      - "利用者 A の認証済みページ HTML と Podcast 一覧が利用者 B に開示される（QL4 security/confidentiality 違反）"
    expected_invariant: "認証主体が変わる全経路（logout と失効の両方）で、SW 管理 'api-*' / 'shell-*' が消える"
    observed_result:
      status: constructed
      evidence: ["contexts/AuthContext.tsx:54-64", "contexts/AuthContext.tsx:86-104", "lib/swCacheCleanup.ts:16-24", "public/sw.js:26-36,50-61,79-87"]
    defense_assessment:
      status: absent
      mechanisms: ["logout 経路のみ（AP5）"]
      evidence: ["contexts/AuthContext.tsx:92-101"]
    gap: {kind: missing_transition, element_ids: [ME22, ME23, ME24]}
    obligations:
      applicability: required
      rationale: "失効遷移に cleanup 後置条件が無く、共有端末での情報開示が成立する"
      confirmation_method: "vitest で refreshMe 失敗時に clearManagedServiceWorkerCaches が呼ばれることを検証（tests/contexts/AuthContext.test.tsx:33-36 の既存 mock 方式を流用可能）"
      impact_if_unresolved: "R6 を満たせない"
      contract_obligation_ids: [OB-C1]
      test_obligation_ids: [OB-T1]
  - id: DP2
    requirement_ids: [R2, R4, R7]
    writer_access_path_id: AP10
    entry_point: "contexts/AudioPlayerContext.tsx:126-133"
    destructive_input_or_sequence: "キューに [A, B] があり A が ended → handleEnded が Q.advance でキューを B へ前進 → fetchAndPlay(B) の getPodcast が 5xx / オフラインで失敗"
    propagation:
      - "advance の結果は :128 で先に確定し、失敗しても巻き戻さない"
      - "fetchAndPlay の catch(:118-120) はトーストのみ。currentPodcast は A のまま（:90 は成功時しか dispatch しない）"
      - "isPlaying は ended で false、UI は A を表示、キューの current は B"
    business_impact: ["利用者は「A が終わったが何も再生されず、キューから B が消えた」状態になり、B へ戻る操作も再試行も無い"]
    expected_invariant: "auto-advance が失敗したら currentIndex は前進しないか、失敗した item を再試行可能な位置に保つ"
    observed_result:
      status: constructed
      evidence: ["contexts/AudioPlayerContext.tsx:126-133", "contexts/AudioPlayerContext.tsx:112-123"]
    defense_assessment: {status: absent, mechanisms: [], evidence: ["contexts/AudioPlayerContext.tsx:118-120"]}
    gap: {kind: missing_failure, element_ids: [ME7, ME11]}
    obligations:
      applicability: required
      rationale: "失敗後 state と retry 可否が未定義"
      confirmation_method: "AudioPlayerContext のテストで getPodcast を reject させ、queue.currentIndex と currentPodcast の事後状態を assert する"
      impact_if_unresolved: "R2（不正状態）と R4（失敗の意味）を同時に損なう"
      contract_obligation_ids: [OB-C2]
      test_obligation_ids: [OB-T2]
  - id: DP3
    requirement_ids: [R2, R3]
    writer_access_path_id: AP1
    entry_point: "hooks/useAudioPlayer.ts:212-216"
    destructive_input_or_sequence: "play() を連続 2 回呼ぶ（UI の二度押し、または AudioPlayerBar:39 と別導線の同時発火）"
    propagation:
      - "play(:212-216) は audio.play() の Promise を await するだけで、進行中の再生要求を追跡しない"
      - "2 回目の play() が 1 回目の pause 割り込みで AbortError を throw すると handlePlayPause(components/AudioPlayerBar.tsx:32-41)には catch が無く、未処理 rejection になる"
      - "setIsPlaying(true) は await 後なので、reject 時は isPlaying=false のまま音は鳴る/鳴らないが不定"
    business_impact: ["UI の再生表示と実際の音が食い違い、利用者が状態を判断できない"]
    expected_invariant: "play は冪等で、重複要求は無視されるか単一の結果に収束する"
    observed_result:
      status: partially_observed
      evidence: ["hooks/useAudioPlayer.ts:212-216", "components/AudioPlayerBar.tsx:32-41"]
    defense_assessment:
      status: unknown
      mechanisms: ["jsdom では audio.play() が実挙動を再現しないため、既存テストでは検出できない"]
      evidence: ["hooks/useAudioPlayer.ts:212-216"]
    gap: {kind: missing_behavior, element_ids: [ME1, ME2]}
    obligations:
      applicability: required
      rationale: "冪等性と失敗後 state が未定義"
      confirmation_method: "play() を fake audio（reject する play）で 2 回連続呼び、isPlaying と未処理 rejection の有無を検証"
      impact_if_unresolved: "R2 の「error≡pause を公開経路から作れない」を満たせない"
      contract_obligation_ids: [OB-C3]
      test_obligation_ids: [OB-T3]
  - id: DP4
    requirement_ids: [R2]
    writer_access_path_id: AP7
    entry_point: "lib/playbackQueue.ts:78-88 → :67-75"
    destructive_input_or_sequence: "currentIndex=2 の 3 要素キューで、末尾要素を remove → remove(:86) が currentIndex を min(2, 1)=1 に丸め、現在再生中でない item を current にする。続けて advance を呼ぶ"
    propagation:
      - "remove(:86) は idx===currentIndex のとき「次の item に追従」ではなく範囲クランプするため、current の指す Podcast が実際に鳴っている音声と乖離する"
      - "その状態で ended → advance(:72-74) が index 2 を返す → 削除済みのはずの位置で停止判定になる"
      - "さらに exported interface に smart constructor が無いため（IV5）、任意の importer が最初から範囲外 currentIndex を渡せる"
    business_impact: ["再生中エピソードとキュー表示・自動前進先が食い違う"]
    expected_invariant: "spec §2.1 不変条件2/4（currentIndex は範囲内、current は実際の再生対象）"
    observed_result:
      status: partially_observed
      evidence: ["lib/playbackQueue.ts:78-88", "lib/playbackQueue.ts:67-75", "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:45-48"]
    defense_assessment:
      status: present
      mechanisms: ["Q.current(:20) の `?? null`、Q.remove(:86) のクランプ（範囲外化は防ぐが、意味的な追従は保証しない）"]
      evidence: ["lib/playbackQueue.ts:18-21,84-87"]
    gap: {kind: invalid_state, element_ids: [ME4, ME3]}
    obligations:
      applicability: required
      rationale: "型では範囲外を構築でき、remove の事後条件（current が何を指すか）が spec にも実装にも明示されない"
      confirmation_method: "spec §2 の remove 節と tests/lib/playbackQueue.conformance.test.ts を突き合わせ、現在再生中要素を削除した場合の期待 current を確定する"
      impact_if_unresolved: "R2 と spec 準拠（R7）を同時に損なう"
      contract_obligation_ids: [OB-C4]
      test_obligation_ids: [OB-T4]
  - id: DP5
    requirement_ids: [R5]
    writer_access_path_id: AP9
    entry_point: "app/(app)/admin/users/page.tsx:86-100"
    destructive_input_or_sequence: "未ログイン（または restore 中で status='unknown'）のまま /admin/users を直接開く"
    propagation:
      - "gate 条件 status==='authenticated' && !isAdmin が false → :100 以降の管理 UI 本体（ユーザー作成フォーム・一覧）が描画される"
      - "(app)/layout.tsx:11-21 に auth gating が無く、route-level の防御も無い"
      - "データ取得は :38-41 で status==='authenticated' && isAdmin のときだけ走るため一覧は空だが、管理者専用の操作 UI と情報構造は露出する"
    business_impact: ["未認証・未解決状態で管理者 UI が描画され、QL4 の認可境界が視覚的に破れる"]
    expected_invariant: "status !== 'authenticated' || !isAdmin の全場合で保護 UI を描画しない"
    observed_result:
      status: constructed
      evidence: ["app/(app)/admin/users/page.tsx:38-41,86-100", "app/(app)/layout.tsx:11-21"]
    defense_assessment: {status: absent, mechanisms: [], evidence: ["app/(app)/layout.tsx:11-21"]}
    gap: {kind: missing_behavior, element_ids: [ME26, ME27]}
    obligations:
      applicability: required
      rationale: "'unknown' と 'unauthenticated' が gate から抜けている"
      confirmation_method: "4 ページそれぞれで status='unknown' / 'unauthenticated' を注入し、管理 UI の主要要素が描画されないことを assert"
      impact_if_unresolved: "R5 を満たせない"
      contract_obligation_ids: [OB-C5]
      test_obligation_ids: [OB-T5]
  - id: DP6
    requirement_ids: [R1, R4]
    writer_access_path_id: AP2
    entry_point: "contexts/AudioPlayerContext.tsx:98-108"
    destructive_input_or_sequence: "オフライン かつ 未キャッシュのエピソードを再生（resolvePlaybackSource が 'unavailable' を返す）"
    propagation:
      - ":104 の `source !== 'cached'` により 'unavailable' と 'network' が同一分岐に潰れ null を返す"
      - ":116 / :147 が createApiClient().getPodcast() を実行し、必ずネットワーク失敗する"
      - ":119 / :157 が `再生できませんでした (${err.status})` を表示。lib/api.ts の network 失敗は status=0 のため「(0)」という transport 値が利用者へ出る"
    business_impact: ["「オフラインで未保存」という業務的失敗が transport 数値に翻訳され、利用者が原因を判断できない"]
    expected_invariant: "'unavailable' は network 試行前に停止し、オフライン固有の文言を返す"
    observed_result:
      status: constructed
      evidence: ["contexts/AudioPlayerContext.tsx:100-108,115-120,146-157", "lib/resolvePlayback.ts:22-27"]
    defense_assessment: {status: absent, mechanisms: [], evidence: ["contexts/AudioPlayerContext.tsx:104"]}
    gap: {kind: missing_behavior, element_ids: [ME6, ME5]}
    obligations:
      applicability: required
      rationale: "定義済み概念 'unavailable' に対応する behavior が実装されていない"
      confirmation_method: "navigator.onLine=false・未キャッシュで playById を呼び、getPodcast が呼ばれないこととオフライン文言を assert"
      impact_if_unresolved: "R4（transport 値への依存排除）を満たせない"
      contract_obligation_ids: [OB-C6]
      test_obligation_ids: [OB-T6]
  - id: DP7
    requirement_ids: [R1, R3]
    writer_access_path_id: AP8
    entry_point: "app/layout.tsx:45-49"
    destructive_input_or_sequence: "localStorage.setItem('theme', '\"light\"')（JSON 形式で書かれた値）または任意文字列を仕込む"
    propagation:
      - "inline script(:47) は生値をそのまま dataset.theme に代入 → `data-theme='\"light\"'` となり CSS セレクタに一致しない"
      - "ThemeToggle.tsx:26-28 は current==='dark' 以外を全て 'dark' 扱いするため、次のクリックで dark に固定される"
      - "ThemeToggle.tsx:29-32 のコメントが示すとおり、useLocalStorage(JSON) との規約差がこの経路を生む"
    business_impact: ["テーマ設定が沈黙して既定へ戻り、原因が型検査にも lint にも現れない"]
    expected_invariant: "'theme' の encode/decode 規約が単一 owner に固定され、不正値は既定へ正規化される"
    observed_result:
      status: constructed
      evidence: ["app/layout.tsx:45-49", "components/ui/ThemeToggle.tsx:25-34"]
    defense_assessment:
      status: present
      mechanisms: ["ThemeToggle:27 の `current === 'dark' ? 'light' : 'dark'` が結果的に列挙内へ戻す（意図的な正規化ではない）"]
      evidence: ["components/ui/ThemeToggle.tsx:25-34"]
    gap: {kind: missing_constraint, element_ids: [ME41, ME42]}
    obligations:
      applicability: required
      rationale: "key 所有と表現規約が config.ts 外に漏れている"
      confirmation_method: "'theme' の read/write を lib の単一 module へ集約し、inline script がその規約を参照していることを test で固定"
      impact_if_unresolved: "R1（ルールの lib 単一所有）を満たせない"
      contract_obligation_ids: [OB-C7]
      test_obligation_ids: [OB-T7]
  - id: DP8
    requirement_ids: [R2, R7]
    writer_access_path_id: AP6
    entry_point: "contexts/AuthContext.tsx:37-47"
    destructive_input_or_sequence: "<AuthProvider initialStatus='authenticated'> を initialUser 無しで描画（テストでも production でも同じ public API）"
    propagation:
      - "status='authenticated'、user=null が確定し、:119-120 が refreshMe を永久にスキップする"
      - "admin gate（AP9）は isAdmin=false と評価し拒否 UI を返すが、user!==null を前提に user.username 等を読む他の consumer は null 参照になる"
      - "テストがこの経路を使うと、production の refreshMe 経路（:54-64）を一度も通らない"
    business_impact: ["テストが production 経路を検証しない（R7 違反）ことと、不正 state の恒久化が同時に起きる"]
    expected_invariant: "(status, user) は判別共用体で、'authenticated' は必ず user を伴う"
    observed_result:
      status: constructed
      evidence: ["contexts/AuthContext.tsx:37-47,119-123"]
    defense_assessment: {status: absent, mechanisms: [], evidence: ["contexts/AuthContext.tsx:46-47"]}
    gap: {kind: invalid_state, element_ids: [ME20, ME28]}
    obligations:
      applicability: required
      rationale: "型が不正組合せを許し、public prop が外部から構築できる"
      confirmation_method: "AuthStatus を判別共用体化した場合の型エラー箇所を tsc で列挙する"
      impact_if_unresolved: "R2 と R7 を同時に損なう"
      contract_obligation_ids: [OB-C8]
      test_obligation_ids: [OB-T8]
  - id: DP9
    requirement_ids: [R2, R3]
    writer_access_path_id: AP7
    entry_point: "contexts/AppContext.tsx:58-62"
    destructive_input_or_sequence: "dispatch({type:'SET_SPEED', speed: 0})（公開 dispatch を持つ任意の consumer から）"
    propagation:
      - "reducer(:45-46) は無検証で state を更新"
      - "AudioPlayerBar.tsx:24-26 の effect が audio.playbackRate=0 を設定"
      - "復元経路(:88-98)の `speed > 0` 検証は迂回され、localStorage にも書かれないため state と永続値が乖離する"
    business_impact: ["再生が事実上停止し、再読み込みすると別の速度に戻るため利用者が再現できない"]
    expected_invariant: "playbackSpeed は PLAYBACK_SPEEDS（hooks/useAudioPlayer.ts:7）の範囲内で、全 writer が同じ検証を通る"
    observed_result:
      status: constructed
      evidence: ["contexts/AppContext.tsx:45-46,58-62,88-98", "components/AudioPlayerBar.tsx:24-26", "hooks/useAudioPlayer.ts:7"]
    defense_assessment:
      status: absent
      mechanisms: ["setTimeFormat(:117-124) だけが検証＋永続化を伴う専用 setter を持ち、speed には同等物が無い"]
      evidence: ["contexts/AppContext.tsx:117-124"]
    gap: {kind: invalid_state, element_ids: [ME43, ME40, ME12]}
    obligations:
      applicability: required
      rationale: "writer ごとに検証が異なり、raw dispatch が検証を迂回する"
      confirmation_method: "dispatch を公開から外し setSpeed(speed) 専用 setter へ集約したときの呼び出し箇所差分を確認"
      impact_if_unresolved: "R2・R3 を損なう"
      contract_obligation_ids: [OB-C9]
      test_obligation_ids: [OB-T9]
```

## 10. obligations（CI*/T* は未作成のため OB* のみを返す）

```yaml
contract_obligations:
  - id: OB-C1
    requirement_ids: [R6]
    model_element_ids: [ME22, ME23, ME24]
    required_contract_kind: postcondition
    statement: "認証主体が authenticated から離れる全遷移（logout・refreshMe 失敗による失効）の事後に、'shell-*' / 'api-*' / audio-v1 に前主体の応答が残らない。"
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:54-64,86-104", "lib/swCacheCleanup.ts:16-24"]}
  - id: OB-C2
    requirement_ids: [R2, R4]
    model_element_ids: [ME7, ME11]
    required_contract_kind: failure_guarantee
    statement: "auto-advance の音源取得が失敗した場合、キューの currentIndex と AppContext.currentPodcast は同一エピソードを指し続け、失敗したエピソードは再試行可能な位置に残る。"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:126-133,112-123"]}
  - id: OB-C3
    requirement_ids: [R2]
    model_element_ids: [ME1, ME2]
    required_contract_kind: idempotency
    statement: "play() は冪等であり、重複呼び出しは単一の再生状態に収束する。audio error 後は 'errored' が paused と区別できる形で観測できる。"
    evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:148-151,212-216"]}
  - id: OB-C4
    requirement_ids: [R2, R7]
    model_element_ids: [ME3, ME4]
    required_contract_kind: invariant
    statement: "QueueState は currentIndex ∈ {null} ∪ [0, items.length-1] を構築時点で保証し（smart constructor）、remove の事後に current が指す Podcast の意味を spec §2 が明示する。"
    evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:7-12,78-88", "/Users/rio/git/news-listen/docs/design/shared-playback-spec.md:45-48"]}
  - id: OB-C5
    requirement_ids: [R5]
    model_element_ids: [ME26, ME27]
    required_contract_kind: precondition
    statement: "admin 保護 UI の描画前提は status === 'authenticated' かつ user.role === 'admin' であり、'unknown' と 'unauthenticated' では保護 UI を描画しない。判定は単一の policy が所有する。"
    evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86-100", "app/(app)/layout.tsx:11-21"]}
  - id: OB-C6
    requirement_ids: [R4]
    model_element_ids: [ME5, ME6]
    required_contract_kind: prohibited_transition
    statement: "PlaybackSource が 'unavailable' のとき、getPodcast などのネットワーク取得を実行してはならず、利用者へ transport status を含まないオフライン固有の失敗を返す。"
    evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:22-27", "contexts/AudioPlayerContext.tsx:100-108,115-120"]}
  - id: OB-C7
    requirement_ids: [R1]
    model_element_ids: [ME41, ME42]
    required_contract_kind: environment_condition
    statement: "localStorage の全 key と各 key の encode/decode 規約は lib/config.ts が単一所有し、inline script を含む全 writer/reader がそこを参照する。列挙外の値は既定へ正規化される。"
    evidence: {status: confirmed, sources: ["lib/config.ts:1,12-16", "app/layout.tsx:45-49", "app/(app)/dashboard/page.tsx:48,65"]}
  - id: OB-C8
    requirement_ids: [R2, R7]
    model_element_ids: [ME20, ME28]
    required_contract_kind: invariant
    statement: "AuthSession は判別共用体であり、'authenticated' は必ず AuthUser を伴い、'unauthenticated' / 'unknown' は user を持たない。テスト用注入も同じ不変条件を通る。"
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:16,37-47"]}
  - id: OB-C9
    requirement_ids: [R2, R3]
    model_element_ids: [ME12, ME40, ME43]
    required_contract_kind: precondition
    statement: "playbackSpeed の全 writer は PLAYBACK_SPEEDS 内の値のみを受理し、同一経路で永続化する。raw dispatch は公開しない。"
    evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:45-46,58-62,88-98", "hooks/useAudioPlayer.ts:7"]}
  - id: OB-C10
    requirement_ids: [R2, R3]
    model_element_ids: [ME30, ME31, ME32]
    required_contract_kind: invariant
    statement: "Podcast の status と audio_url / error_message の共起規則を型で表現し（'completed' ⟺ 再生可能 audio_url かつ error_message===null）、再生導線はこの規則を前提条件として参照する。"
    evidence: {status: confirmed, sources: ["types/index.ts:92,111-112", "components/PodcastCard.tsx:51-58"]}
  - id: OB-C11
    requirement_ids: [R2, R4]
    model_element_ids: [ME14, ME15]
    required_contract_kind: postcondition
    statement: "downloadAudio は成功応答（response.ok）のみをキャッシュし、getCachedPodcast は再生可能な audio_url を持つ Podcast か null のいずれかを返す。"
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71,83-84,88-94"]}
  - id: OB-C12
    requirement_ids: [R3]
    model_element_ids: [ME11]
    required_contract_kind: invariant
    statement: "「現在再生中の Podcast」の正本は 1 箇所とし、UI はそこから導出する（AppContext.currentPodcast と QueueState の二重保持を解消する）。"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:49-54,88-90", "contexts/AppContext.tsx:14"]}
  - id: OB-C13
    requirement_ids: [R1, R6]
    model_element_ids: [ME25]
    required_contract_kind: environment_condition
    statement: "SW 管理 cache 名前空間の prefix 定義は単一 source（ビルド時生成等）から sw.js と swCacheCleanup へ供給され、手動同期に依存しない。"
    evidence: {status: confirmed, sources: ["public/sw.js:20-24", "lib/swCacheCleanup.ts:6-14,21"]}
  - id: OB-C14
    requirement_ids: [R2]
    model_element_ids: [ME10]
    required_contract_kind: postcondition
    statement: "createObjectURL で発行した blob: URL は、再生に使われなかった場合を含めて必ず revoke される（発行者と解放者の責務を同一 module に閉じる）。"
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:97-104", "contexts/AudioPlayerContext.tsx:106-108", "hooks/useAudioPlayer.ts:171-173,192-194"]}

test_obligations:
  - id: OB-T1
    requirement_ids: [R6]
    model_element_ids: [ME22, ME23]
    contract_obligation_ids: [OB-C1]
    scenario: "refreshMe が 401 で失敗したとき、clearManagedServiceWorkerCaches と deleteAllAudio が呼ばれる"
    required_oracle: "既存 mock（tests/contexts/AuthContext.test.tsx:26-36）で両関数の呼び出しを assert"
    evidence: {status: confirmed, sources: ["tests/contexts/AuthContext.test.tsx:26-36,127,140"]}
  - id: OB-T2
    requirement_ids: [R2, R4]
    model_element_ids: [ME7]
    contract_obligation_ids: [OB-C2]
    scenario: "ended 発火中に次エピソードの getPodcast が reject したとき、queue の current と currentPodcast が乖離しない"
    required_oracle: "AudioPlayerContext のレンダリングテストで upNext と表示中トラックを assert"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:126-133"]}
  - id: OB-T3
    requirement_ids: [R2]
    model_element_ids: [ME1, ME2]
    contract_obligation_ids: [OB-C3]
    scenario: "play() 二重呼び出し / audio error 後に、状態が 'errored' と 'paused' を区別できる"
    required_oracle: "fake audio を注入した useAudioPlayer の単体テストで公開状態を assert"
    evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:148-151,212-216"]}
  - id: OB-T4
    requirement_ids: [R2, R7]
    model_element_ids: [ME3, ME4]
    contract_obligation_ids: [OB-C4]
    scenario: "範囲外 currentIndex の構築が型または factory で拒否され、現在再生中要素の remove 後の current が spec と一致する"
    required_oracle: "tests/lib/playbackQueue.conformance.test.ts へ spec §2 の該当ケースを追加"
    evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:78-88"]}
  - id: OB-T5
    requirement_ids: [R5]
    model_element_ids: [ME26, ME27]
    contract_obligation_ids: [OB-C5]
    scenario: "status='unknown' / 'unauthenticated' で admin 4 ページの保護 UI が描画されない"
    required_oracle: "各ページのテストで管理 UI 固有要素の非存在を assert"
    evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86-100"]}
  - id: OB-T6
    requirement_ids: [R4]
    model_element_ids: [ME5, ME6]
    contract_obligation_ids: [OB-C6]
    scenario: "オフライン・未キャッシュで playById を呼ぶと getPodcast が呼ばれず、オフライン固有文言が出る"
    required_oracle: "createApiClient mock の未呼び出しとトースト文言を assert"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:100-108,146-157"]}
  - id: OB-T7
    requirement_ids: [R1]
    model_element_ids: [ME41, ME42]
    contract_obligation_ids: [OB-C7]
    scenario: "'theme' に列挙外・JSON 引用符付きの値が入っていても data-theme が列挙内に正規化される"
    required_oracle: "theme policy module の単体テスト＋inline script が同 module を参照する構造検査"
    evidence: {status: confirmed, sources: ["app/layout.tsx:45-49", "components/ui/ThemeToggle.tsx:25-34"]}
  - id: OB-T8
    requirement_ids: [R2, R7]
    model_element_ids: [ME20, ME28]
    contract_obligation_ids: [OB-C8]
    scenario: "'authenticated' かつ user=null が型レベルで構築できない"
    required_oracle: "tsc の型エラー（expect-type / @ts-expect-error）で固定"
    evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:16,44-47"]}
  - id: OB-T9
    requirement_ids: [R2, R3]
    model_element_ids: [ME12, ME43]
    contract_obligation_ids: [OB-C9]
    scenario: "範囲外の playbackSpeed が公開 API から設定できず、設定値が永続化される"
    required_oracle: "AppContext の公開 setter テストと localStorage の assert"
    evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:45-46,88-98"]}
  - id: OB-T10
    requirement_ids: [R2, R3]
    model_element_ids: [ME30, ME31, ME32]
    contract_obligation_ids: [OB-C10]
    scenario: "status !== 'completed' の Podcast で再生導線が起動しない（または明示的に未完成として拒否する）"
    required_oracle: "PodcastCard のテストで onPlay 未呼び出しを assert"
    evidence: {status: confirmed, sources: ["components/PodcastCard.tsx:51-58"]}
  - id: OB-T11
    requirement_ids: [R2, R4]
    model_element_ids: [ME14, ME15]
    contract_obligation_ids: [OB-C11]
    scenario: "fetch が 403 を返したとき downloadAudio が cache.put せずエラーになる / getCachedPodcast が audio_url='' を返さない"
    required_oracle: "tests/lib/audioCache.test.ts へ非 ok 応答ケースを追加"
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71,88-94"]}
  - id: OB-T12
    requirement_ids: [R2]
    model_element_ids: [ME10]
    contract_obligation_ids: [OB-C14]
    scenario: "resolveCachedPodcast が cachedPodcast 欠落で null を返す経路でも blob URL が revoke される"
    required_oracle: "URL.revokeObjectURL の spy で呼び出しを assert"
    evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:106-108", "lib/audioCache.ts:97-104"]}

existing_downstream_links: []
```

## 11. gaps

```yaml
gaps:
  - id: G1
    requirement_ids: [R6]
    element_ids: [ME22, ME23, ME24]
    kind: missing_transition
    evidence: ["contexts/AuthContext.tsx:54-64", "contexts/AuthContext.tsx:86-104", "lib/swCacheCleanup.ts:16-24", "public/sw.js:79-87"]
    impact: "セッション失効時に SW cache が残り、共有端末で前利用者の認証済み応答が返る"
    severity: blocker
    contract_obligation_ids: [OB-C1]
    test_obligation_ids: [OB-T1]
  - id: G2
    requirement_ids: [R5]
    element_ids: [ME26, ME27]
    kind: missing_behavior
    evidence: ["app/(app)/admin/users/page.tsx:86-100", "app/(app)/admin/invites/page.tsx:142", "app/(app)/admin/metrics/page.tsx:70", "app/(app)/admin/featured-sites/page.tsx:207", "app/(app)/layout.tsx:11-21"]
    impact: "'unknown' / 'unauthenticated' で管理 UI が描画される。route-level gate も無い"
    severity: blocker
    contract_obligation_ids: [OB-C5]
    test_obligation_ids: [OB-T5]
  - id: G3
    requirement_ids: [R2, R3]
    element_ids: [ME1, ME2, ME11, ME12]
    kind: invalid_state
    evidence: ["hooks/useAudioPlayer.ts:25-30,148-151", "contexts/AudioPlayerContext.tsx:88-90", "contexts/AppContext.tsx:14-15,58-62"]
    impact: "error≡pause が区別できず、現在再生中と再生速度の正本が二重化している"
    severity: major
    contract_obligation_ids: [OB-C3, OB-C9, OB-C12]
    test_obligation_ids: [OB-T3, OB-T9]
  - id: G4
    requirement_ids: [R2, R3]
    element_ids: [ME30, ME31, ME32]
    kind: missing_constraint
    evidence: ["types/index.ts:92-114", "components/PodcastCard.tsx:51-58"]
    impact: "status × audio_url × error_message の共起制約が型にも導線にも無く、未完成 Podcast の再生を開始できる。optional field 群が暗黙のバージョンフラグとして未概念化"
    severity: major
    contract_obligation_ids: [OB-C10]
    test_obligation_ids: [OB-T10]
  - id: G5
    requirement_ids: [R4, R1]
    element_ids: [ME5, ME6]
    kind: missing_behavior
    evidence: ["lib/resolvePlayback.ts:16,22-27", "contexts/AudioPlayerContext.tsx:100-108,115-120"]
    impact: "定義済みの 'unavailable' が使われず、オフラインの業務的失敗が status=0 の transport 表現になる"
    severity: major
    contract_obligation_ids: [OB-C6]
    test_obligation_ids: [OB-T6]
  - id: G6
    requirement_ids: [R2, R4]
    element_ids: [ME7]
    kind: missing_failure
    evidence: ["contexts/AudioPlayerContext.tsx:126-133,112-123"]
    impact: "auto-advance 失敗後の state・retry・duplicate が未定義"
    severity: major
    contract_obligation_ids: [OB-C2]
    test_obligation_ids: [OB-T2]
  - id: G7
    requirement_ids: [R2, R7]
    element_ids: [ME3, ME4, ME20, ME28]
    kind: invalid_state
    evidence: ["lib/playbackQueue.ts:7-12", "contexts/AuthContext.tsx:37-47"]
    impact: "QueueState の範囲不変条件と AuthSession の (status,user) 組合せを公開経路から破れる"
    severity: major
    contract_obligation_ids: [OB-C4, OB-C8]
    test_obligation_ids: [OB-T4, OB-T8]
  - id: G8
    requirement_ids: [R1]
    element_ids: [ME41, ME42, ME43]
    kind: leakage
    evidence: ["app/layout.tsx:45-49", "app/(app)/dashboard/page.tsx:48,65", "contexts/AppContext.tsx:58-62", "components/AudioPlayerBar.tsx:24-26"]
    impact: "key 所有・表現規約・速度適用・認可判定が lib の外（page / component / inline script）へ分散"
    severity: major
    contract_obligation_ids: [OB-C7, OB-C9]
    test_obligation_ids: [OB-T7, OB-T9]
  - id: G9
    requirement_ids: [R2, R4]
    element_ids: [ME14, ME15, ME10]
    kind: missing_failure
    evidence: ["lib/audioCache.ts:68-71,83-84,88-94,97-104"]
    impact: "非 ok 応答のキャッシュ、audio_url='' の Podcast 流出、blob URL の revoke 漏れ"
    severity: major
    contract_obligation_ids: [OB-C11, OB-C14]
    test_obligation_ids: [OB-T11, OB-T12]
  - id: G10
    requirement_ids: [R1, R6]
    element_ids: [ME25]
    kind: authority_conflict
    evidence: ["public/sw.js:16-24", "lib/swCacheCleanup.ts:6-14,21"]
    impact: "cache 名前空間の意味が二重定義で手動同期依存。片方の変更で cleanup が静かに無効化される"
    severity: major
    contract_obligation_ids: [OB-C13]
    test_obligation_ids: []
  - id: G11
    requirement_ids: [R1]
    element_ids: [ME33]
    kind: missing_concept
    evidence: ["types/index.ts:15", "hooks/useAudioPlayer.ts:20-22,135-138"]
    impact: "'completed' が生成完了と完聴の二義を持ち、context 分離が語彙に現れていない"
    severity: minor
    contract_obligation_ids: []
    test_obligation_ids: []
```

## 12. coverage

```yaml
coverage:
  audit_screen_denominator: 96      # 8 requirements × 12 suite-defined dimensions
  audit_screen_resolved_numerator: 96
  applicable_model_denominator: 58  # 96 − 38（DAP1:4 + DAP2:2 + DAP3:12 + DAP4:2 + DAP5:2 + DAP6:6 + DAP7:4 + DAP8:2 = 34）… 下記 note 参照
  present_model_numerator: 9
  note: >
    N/A cell は DAP1..DAP8 の展開で 34 件。96 − 34 = 62 が applicable。
    そのうち R7 の behavior cell は evidence.status: unknown のため applicable_model_denominator からは外さず、
    present にも数えない。applicable_model_denominator を 58 と記したのは誤りで、正しくは 62。
    present（target_status: present かつ evidence が unknown/contradiction でない element へ接続した cell）は
    ME3・ME5・ME8・ME9・ME13・ME23・ME44 が関与する 9 cell。
  applicable_model_denominator_corrected: 62
  present_model_ratio: "9/62"
  uncovered_cell_reason: >
    残り 53 cell は target_status が missing / conflicting の element へ接続する（G1..G11 と invalid_construction IV1..IV11 が対応）。
    coverage 比率は「12 dimension screening をどれだけ埋めたか」ではなく「applicable な観点のうち健全な model element が存在する割合」を示す。
```

## 13. unknowns の解決

```yaml
resolved_unknowns:
  - id: U1
    subject: "セッション失効（明示 logout でない）時に sw.js の 'api-*' / 'shell-*' cache を消す経路が存在するか"
    answer: "存在しない。"
    evidence:
      status: confirmed
      sources:
        - "lib/swCacheCleanup.ts:16-24 が 'shell-' / 'api-' prefix の唯一の削除実装"
        - "contexts/AuthContext.tsx:98 が clearManagedServiceWorkerCaches の唯一の production 呼び出し（grep 済み。他の hit は lib/swCacheCleanup.ts:16 の定義と tests/ のみ）"
        - "contexts/AuthContext.tsx:86-104 logout のみがその経路"
        - "contexts/AuthContext.tsx:54-64 refreshMe は catch で setUser(null)/setStatus('unauthenticated') のみ、cache に触れない"
        - "public/sw.js:26-36 activate の削除は SW_VERSION 変化に伴う世代交代のみで、認証主体の変化とは無関係"
    conclusion: "失効経路（getMe 401 → refreshMe catch）では api-v1 / shell-pages-v1 が残る。public/sw.js:50-61 networkFirst の catch は残留 cache を返すため、共有端末で前利用者の認証済み応答が返りうる（DP1 / G1）。"
```

## 14. subject_verdict

```yaml
subject_verdicts:
  - scope: S1
    verdict: incomplete
    blockers: [G3, G5, G6, G9]
    rationale: "PlaybackState の意味 state（ME1）と error 遷移（ME2）、'unavailable' の behavior（ME6）、auto-advance 失敗後 state（ME7）が欠落し、blob URL の解放責務（ME10）と現在再生中の正本（ME11）が競合する。QueueState と resolveResumePosition は spec 準拠で present。"
  - scope: S2
    verdict: incomplete
    blockers: [G1, G2, G7, G10]
    rationale: "失効遷移に cache cleanup が無く（U1 / G1）、admin gate が 'unknown' / 'unauthenticated' を素通しし（G2）、(status,user) の不正組合せを public prop から構築できる（G7）。cache 名前空間の意味が二重所有（G10）。"
  - scope: S3
    verdict: incomplete
    blockers: [G4, G11]
    rationale: "DTO 世代という概念が無く optional field が暗黙のバージョンフラグになっており、status × audio_url × error_message の共起制約が型にも消費者にも存在しない。error_message を読む production reader が in_scope に無く、再生導線は status を参照しない。"
  - scope: S4
    verdict: incomplete
    blockers: [G8]
    rationale: "key 所有（lib/config.ts）を 'theme' の inline script と 'seen_achievement_ids' が迂回し、encode/decode 規約が key ごとに異なる。raw dispatch が speed の検証を迂回する。restore 時検証（AppContext:88-112）と volume 検証（useAudioPlayer:42-52）は present。"

subject_verdict: incomplete
overall_rationale: >
  4 scope すべてで、判定に十分な Evidence（実コードの path:line）を持って missing / invalid / leakage / authority conflict を特定できた。
  blocker は G1（失効時の cache 残留・QL4）と G2（'unknown' 中の admin UI 描画・QL4）。
```

## 15. decision（この package 自体の readiness）

```yaml
decision:
  status: pass
  artifact_readiness: ready
  engineering_status: not_started
  release_status: not_applicable
  decision_maturity:
    status: proposed
    owner: "main session orchestrator（承認権限は人間 owner）"
    scope: [S1, S2, S3, S4]
    evidence_status: confirmed
    approval_evidence: []
    baseline_version: ""
    change_control: "本 package は review artifact であり baseline ではない"
  next_phase:
    name: "contract 抽出（OB-C* → CI*/T*）と修正実装"
    status: blocked
    reasons:
      - "G1 / G2 は security 影響を持つため、修正方針の選択は人間 owner の承認を要する"
      - "OB-C4 は docs/design/shared-playback-spec.md（3 platform の正本）の改訂を伴うため、web 単独で確定できない"
      - "OB-C10 は backend の DTO 契約に依存し、本 package の out_of_scope"
    human_approvals_required:
      - "G1 / G2 の修正方針（失効検知の置き場所・route-level gate の導入）"
      - "spec §2 remove 事後条件の改訂（iOS / Android への波及）"
  evidence:
    - "本 package の全 path:line は本セッションで実ファイルを読んで確認済み"
    - "U1 は grep による全 call site 列挙で確定"
  assumptions:
    - id: A1
      statement: "lib/api.ts の network 失敗が ApiError(status=0) になるという前提は router のブリーフ由来で、本 package では lib/api.ts を読んでいない"
      verification: "lib/api.ts:60-122 を読んで status=0 の生成箇所を確認する"
  unknowns:
    - id: U2
      subject: "audio 要素の playbackRate が load()（src 差し替え）後も保持されるか"
      confirmation_method: "実ブラウザで src 変更前後の playbackRate を観測する（jsdom では再現しない）"
      impact_if_unresolved: "OB-C9 の契約文が「load 時に再適用する」を含むべきかが決まらない"
      owner: "実装担当"
      evidence: ["hooks/useAudioPlayer.ts:181-210,237-240", "components/AudioPlayerBar.tsx:24-26"]
    - id: U3
      subject: "R7 の behavior dimension（テストが production 経路を通るか）の網羅度"
      confirmation_method: "vi.mock('@/lib/api') を使う 25 ファイルを列挙し、各々が迂回する production 判断を対応付ける"
      impact_if_unresolved: "R7 の coverage cell が present か missing か確定しない（現状 evidence.status: unknown として present に数えていない）"
      owner: "spec-review ロール"
      evidence: ["contexts/AuthContext.tsx:119-123"]
    - id: U4
      subject: "backend が status='failed' の Podcast に対して audio_url に何を返すか"
      confirmation_method: "backend の Podcast serializer を読む（本 package の out_of_scope）"
      impact_if_unresolved: "IV2 の実害（空文字か無効 URL か）の severity が確定しない"
      owner: "backend 担当"
      evidence: ["types/index.ts:92,111-112"]
  contradictions: []
  failed_gates: []
  unexecuted_validation:
    - id: UV1
      reason: "本 package は read-only review であり、テスト実行・ビルドを行わない"
      required_runner: "vitest（npm test）"
      planned_commands: ["npm test", "npm run build"]
      owner: "実装フェーズの coder"
      evidence: ["routing_context.mutation_authorized: false"]
  platform_validation:
    required_platforms: []
    executed: []
    unexecuted: []
    parity_result: not_applicable
    platform_specific_risks: []
  residual_risks:
    - "G1 は現行 production で成立しうる情報開示。共有端末利用の実頻度は未計測"
    - "G2 の admin UI 露出はデータ取得を伴わないため情報開示は UI 構造に限られるが、認可境界の設計としては破れている"
```
