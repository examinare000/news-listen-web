# Boundary Package — news-listen-web（mino-interface-implementation-separation / review mode）

```yaml
boundary_package:
  id: BP1
  subject: "/Users/rio/git/news-listen/web の consumer 境界 C1..C6（UI→API client / UI→再生 / UI→認証 / UI→設定永続化 / browser→BFF proxy / sw.js↔cache modules）"
  owner: "main session orchestrator（router: mino-reproducible-development）。本 package は proposed のみ。"

  routing_context:
    origin: integrated
    mode: review
    orchestrator: "main session"
    requested_by: router
    requested_artifact: "Boundary Package"
    return_to: router
    mutation_authorized: false

  platform_context:
    applicability: not_applicable
    not_applicable_reason: "境界は browser / Next.js runtime の API（fetch・Cache Storage・localStorage・HTMLAudioElement）のみを扱い、OS 固有 path / process / shell を公開契約へ出さない。"
    evidence:
      - status: confirmed
        source: "lib/audioCache.ts:64-110（caches API のみ）, hooks/useAudioPlayer.ts:42-75（localStorage のみ）, app/api/backend/[...path]/route.ts:50-124（fetch/URL のみ）"
        supports: "公開境界に platform 差が現れない"

  platform_validation:
    required_platforms: []
    parity_result: not_applicable
    not_applicable_reason: "platform_context が not_applicable。OS 別 adapter が存在しない。"

  change_safety:
    applicability: required
    package:
      note: "本 package は review mode の finding のみ。既存 caller を変える migration は M1..M4 に plan として置き、実行は行わない。mutation_authorized: false。"
      temporary_paths: []
      removal_conditions: "M1..M4 の各 step にある旧 path 利用ゼロ確認を、実装フェーズで別途所有者が満たす。"
    evidence:
      - status: confirmed
        source: "common-brief.md:13（mutation_authorized: false）"
        supports: "review mode では plan/finding のみ返す"

  contract_source:
    kind: domain_contract
    artifact_refs:
      - "docs/design/shared-playback-spec.md（再生キュー Q-01..Q-32・相対時刻 RT-*）"
      - "scratchpad/packages/completeness-package.md（OB-C1..OB-C14, IV1..IV11, G1..G11）"
    domain_contract_status: applicable
    confirmation_method: "C5（BFF proxy）のみ generic 技術境界。下記 contract_source_exceptions を参照。"
    impact_if_unresolved: ""
    evidence:
      - status: confirmed
        source: "lib/playbackQueue.ts:1-3（「操作契約の正本は docs/design/shared-playback-spec.md」）"
        supports: "再生境界には authoritative domain contract が存在する"
      - status: confirmed
        source: "scratchpad/packages/completeness-package.md:936-946（IV1..IV11）, :1213-1291（OB-C1..OB-C14）"
        supports: "上流 completeness package の不変条件 ID を参照できる"

  contract_source_exceptions:
    - consumer_id: C5
      kind: consumer_semantic_operation
      domain_contract_status: not_applicable
      not_applicable_reason: "forward() は backend API を素通しする generic transport 境界であり、web 側に業務語彙を持たない。web の責務は「認証情報の付与」「失敗の意味づけ」「内部構成の非開示」に限られる。"
      evidence:
        - status: confirmed
          source: "app/api/backend/[...path]/route.ts:66-124（URL 組立・ヘッダ注入・Cookie 中継・status pass-through のみ）"
          supports: "domain 判断を持たない"

  upstream_dependencies:
    - id: UD1
      artifact: "scratchpad/packages/architecture-strategy-package.md"
      status: absent
      impact: "system-wide な data authority（「現在再生中」「再生速度」の source of truth）と SG*（Selection Gate）を本 package で確定できない。LF6/LF7/LF9 の是正先は候補提示に留める。"
      obligation: OB-B1
    - id: UD2
      artifact: "scratchpad/packages/contract-package.md"
      status: absent
      impact: "operation の deadline / retry / idempotency / duplicate / ambiguous outcome を CI* として参照できない。本 package では operation ごとに applicability だけを判定し、条件本文は obligation として返す。"
      obligation: OB-B2

  # ---------------------------------------------------------------------------
  # Consumers
  # ---------------------------------------------------------------------------
  consumers:
    - id: C1
      name: "page / component（UI）→ API client（lib/api.ts）"
      purpose: "業務操作（フィード取得・Star・Podcast 取得・認証・管理操作）を実行し、失敗を「利用者に説明できる意味」として受け取る"
      must_know: ["操作の意味", "失敗の意味（未蓄積・上限超過・権限なし・通信不可）", "再試行可否と次回可能時刻"]
      must_not_know: ["HTTP status 数値", "CSRF token 注入", "Cookie", "fetch / RequestInit", "BFF proxy path"]
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "lib/api.ts:1-7（doc comment）, :59-122（request()）, :124-553（9 ドメイン関数群）"
          supports: "単一 transport wrapper は存在する（分離の下地はある）"
        - status: confirmed
          source: "app/(app)/settings/page.tsx:77, app/(app)/admin/metrics/page.tsx:54, app/(app)/feed/page.tsx:234,318, app/(app)/podcast/[id]/page.tsx:59"
          supports: "HTTP status 数値 404 が 5 consumer へ漏れている"

    - id: C2
      name: "UI → 再生（contexts/AudioPlayerContext.tsx の Player & QueueApi）"
      purpose: "エピソードを再生開始・停止・キュー操作し、再生位置と現在曲を一貫して見る"
      must_know: ["再生・一時停止・シーク・速度", "キューの現在/待機", "再生できなかった理由（オフライン・未蓄積・取得失敗）"]
      must_not_know: ["HTMLAudioElement", "blob: URL とその revoke", "localStorage のキー体系", "Cache Storage", "QueueState の内部 index"]
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "contexts/AudioPlayerContext.tsx:40（type AudioPlayerContextValue = Player & QueueApi）"
          supports: "公開契約は 1 型に集約されている"
        - status: confirmed
          source: "hooks/useAudioPlayer.ts:58-67（export function getSavedPosition、doc に「Exported so pages can restore position」）"
          supports: "localStorage キー体系が page へ公開されている"

    - id: C3
      name: "UI → 認証（contexts/AuthContext.tsx）"
      purpose: "ログイン・パスキーログイン・登録・ログアウトを行い、認証状態で画面を出し分ける"
      must_know: ["status（unknown/authenticated/unauthenticated）", "user", "失敗の意味"]
      must_not_know: ["WebAuthn transport（WebAuthnBrowserPort）", "Cache Storage / SW キャッシュ消去手順", "/auth/me の呼び出し"]
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "contexts/AuthContext.tsx:28-32（loginWithPasskey: (port: WebAuthnBrowserPort) => Promise<void>）"
          supports: "transport port が consumer 側の引数として公開契約に載っている"

    - id: C4
      name: "UI → 設定永続化（contexts/AppContext.tsx raw dispatch / hooks/useLocalStorage / 直接 localStorage）"
      purpose: "再生速度・時刻表示形式・テーマ・既読実績を保存し復元する"
      must_know: ["設定の意味と許容値"]
      must_not_know: ["reducer の Action 型", "localStorage のキー文字列", "JSON 直列化"]
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "contexts/AppContext.tsx:58-61（AppContextValue が dispatch を公開し、named operation は setTimeFormat のみ）"
          supports: "契約を迂回する direct write 経路が公開されている"

    - id: C5
      name: "browser（信頼できない consumer）→ BFF proxy route forward()"
      purpose: "backend API へ認証済みで到達し、失敗の HTTP 意味を受け取る"
      must_know: ["操作結果の status と body", "Set-Cookie によるセッション"]
      must_not_know: ["BACKEND_BASE_URL 等の環境変数名", "X-API-Key の有無", "backend の到達性実装"]
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "app/api/backend/[...path]/route.ts:50-55（500 body に 'BACKEND_BASE_URL is not set'）"
          supports: "内部構成名が untrusted consumer へ露出する"

    - id: C6
      name: "public/sw.js ↔ lib/swCacheCleanup.ts ↔ lib/audioCache.ts（キャッシュ名前空間の暗黙契約）"
      purpose: "SW 管理キャッシュとアプリ管理キャッシュを、ログアウト時に漏れなく消す"
      must_know: ["どのキャッシュが誰の管理下か", "消去の完了/失敗"]
      must_not_know: []
      subject_verdict: leaky
      evidence:
        - status: confirmed
          source: "public/sw.js:22-24（isManagedBySW: 'shell-'/'api-' prefix）, lib/swCacheCleanup.ts:7-14（同 prefix をコメント付きで複製）"
          supports: "契約が実行可能でなくコメントによる人手同期に依存する"

  # ---------------------------------------------------------------------------
  # Code design
  # ---------------------------------------------------------------------------
  code_design:
    capsules:
      - id: CAP1
        name: "lib/playbackQueue.ts（キュー状態モデル）"
        assessment: "purpose-centered だが不変条件を守れない。exported interface QueueState（:7-12）に smart constructor が無く、currentIndex は items と独立の number|null。任意の importer が範囲外 index を構築でき、current(:18-21) と advance(:67-75) はそれを受理する。"
        upstream_ref: "completeness-package IV5"
        evidence:
          - status: confirmed
            source: "lib/playbackQueue.ts:7-12,18-21,67-75"
            supports: "不変条件の owner が capsule 内に無い"
      - id: CAP2
        name: "contexts/AudioPlayerContext.tsx（再生 orchestration）"
        assessment: "orchestration・domain rule（resume / offline / queue 挿入 / auto-advance）・UI 副作用（showToast）・外部 I/O 起動が同一 capsule に同居する。fetchAndPlay(:190-201) と playById(:221-239) は cached 解決→取得→loadAndPlay の同一手順を二重に持ち、差分は「キューを触るか」のみ。"
        evidence:
          - status: confirmed
            source: "contexts/AudioPlayerContext.tsx:45（useToast）, :190-201, :221-239"
            supports: "責務混在と重複"
      - id: CAP3
        name: "app/api/backend/[...path]/route.ts の forward()"
        assessment: "75 行（:50-124）に、設定解決・URL 組立・API key 注入・Cookie 中継・CSRF 中継・timeout 分類・status pass-through・Set-Cookie 中継の 8 関心が同居する。"
        evidence:
          - status: confirmed
            source: "app/api/backend/[...path]/route.ts:50-124（ファイル全体 151 行）"
            supports: "長大処理"
      - id: CAP4
        name: "components/ui/AccountSection.tsx（722 行）, app/(app)/feed/page.tsx（615 行）"
        assessment: "UI component が業務ルール（パスワードポリシー・429 月/日判定・server-star merge・一括 star 部分失敗方針）を所有している。ルールの owner が UI 層にあるため CS4 が fail する。"
        evidence:
          - status: confirmed
            source: "wc -l: components/ui/AccountSection.tsx=722, app/(app)/feed/page.tsx=615; app/(app)/feed/page.tsx:12-20（generationLimitMessage）, :151-159（server-star merge）"
            supports: "業務ルールの UI 層所有"

    branch_decisions:
      - id: BD1
        location: "app/(app)/feed/page.tsx:15-20"
        branch: "/monthly/i.test(err.detail) || (err.retryAfterSeconds ?? 0) > 86400"
        classification: business_decision_table
        decision: "rule owner を lib へ移す候補。backend の英語 detail 文言に依存する判定が UI にあるのは representation と domain rule の混在。ADR-073 のフォールバック戦略自体は維持する。"
        evidence:
          - status: confirmed
            source: "app/(app)/feed/page.tsx:12-20（ADR-073 コメント付き）"
            supports: "backend 文言への依存が UI 層にある"
      - id: BD2
        location: "contexts/AudioPlayerContext.tsx:98-109"
        branch: "resolvePlaybackSource(...) の結果を `if (source !== 'cached') return null` で潰す"
        classification: implementation_variant
        decision: "'unavailable'（オフラインかつ未キャッシュ）と 'network' が呼出側で同一に畳まれ、consumer には ApiError 由来の文言 `再生できませんでした (status)` しか届かない。offline の意味が境界を越えない。純関数 resolvePlaybackSource の 3 値は設計として正しく、潰しているのは caller。"
        evidence:
          - status: confirmed
            source: "lib/resolvePlayback.ts:16（type PlaybackSource = 'cached'|'network'|'unavailable'）, contexts/AudioPlayerContext.tsx:98-109, :196-198"
            supports: "意味の握り潰し"
      - id: BD3
        location: "contexts/AudioPlayerContext.tsx:148-154"
        branch: "Q.jump が返す {queue, found} を caller が分岐する"
        classification: implementation_variant
        decision: "「キューにあればジャンプ、無ければ次に挿入して再生」は spec 由来の業務ルール（#81 review コメント）。playbackQueue 側に `jumpOrInsertNext(q, podcast)` として置けば caller 分岐が消え、不変条件も capsule 内で守れる。"
        evidence:
          - status: confirmed
            source: "lib/playbackQueue.ts:60-64（jump が {queue,found}）, contexts/AudioPlayerContext.tsx:140-154（WHY(#81 review) コメント）"
            supports: "業務ルールが caller 側分岐として存在"
      - id: BD4
        location: "app/(app)/admin/{users,invites,featured-sites,metrics}/page.tsx"
        branch: "`status === 'authenticated' && !isAdmin` による admin gate"
        classification: business_decision_table
        decision: "4 ページで同型に複製されている（users:86, invites:142, featured-sites:207, metrics:70。metrics:32 のコメントが複製を明示）。status==='unknown' の間は否定条件が偽になるため admin UI が描画される（R5 違反）。gate の owner を 1 箇所へ。"
        evidence:
          - status: confirmed
            source: "app/(app)/admin/users/page.tsx:86, invites/page.tsx:142, featured-sites/page.tsx:207, metrics/page.tsx:32,70"
            supports: "gate 複製と unknown 中の描画"
      - id: BD5
        location: "contexts/AuthContext.tsx:54-64"
        branch: "getMe() の全 error を catch して unauthenticated"
        classification: business_decision_table
        decision: "「理由は伏せる」は正しい UI 方針だが、adapter が semantic failure（401）と transport failure（通信不可）を区別せず domain 判断を確定している。オフライン時に利用者が「ログアウトされた」と観測する。status の意味 owner は AuthContext だが、区別できる入力（ApiError.status===0）を捨てている。"
        evidence:
          - status: confirmed
            source: "contexts/AuthContext.tsx:54-64（catch 全域）, common-brief:41（ApiError status=0 = network）"
            supports: "adapter 内の domain decision"

    naming_decisions:
      - id: ND1
        subject: "createApiClient()"
        assessment: does_not_fit
        rationale: "名前は「client を生成する」という実装手順を表すが、返り値は状態を持たない関数束であり生成の意味がない。consumer は毎回新規生成している。"
        measurement: "`grep -rn \"createApiClient()\" app components contexts hooks lib | wc -l` = 38（定義行 lib/api.ts:124 を含む）、`grep -rln createApiClient ... | wc -l` = 21 files。ブリーフの 34 呼出/19 files とは計数方法（テスト除外範囲・定義行の扱い）が異なる。どちらでも finding の向きは変わらない。"
        evidence:
          - status: confirmed
            source: "上記 grep（2026-09-16 実行）, lib/api.ts:124-130"
            supports: "呼出点の多さと factory の無状態性"
      - id: ND2
        subject: "hooks/useStartPodcast.ts:17-19"
        assessment: fits_but_zero_indirection
        rationale: "`return playById` の純 pass-through。ただし doc コメント（:5-15）が「一覧と詳細で同一フロー（spec §10.3 L209）」という契約意図を保持しており、名前が spec の語彙を持ち込む価値はある。削除は spec 参照の喪失と引き換えになるため、低優先。"
        evidence:
          - status: confirmed
            source: "hooks/useStartPodcast.ts:5-19"
            supports: "pass-through だが契約意図を担う"

    abstraction_decisions:
      - id: AD1
        subject: "createApiClient() factory"
        verdict: unjustified_abstraction
        rationale: "実装は 1 つ、variant の Evidence なし、状態なし、外部障害境界としての隔離も request() が担っている。factory は呼出点 38 か所に生成コストと mock 面を増やすだけ。"
        recommendation: "module-level 関数 export、または Provider 1 箇所で生成した単一 instance を注入。**Strategy / provider selection 階層は提案しない**（rejected_overdesign RO1）。"
      - id: AD2
        subject: "WebAuthnBrowserPort / PushBrowserPort"
        verdict: justified_port
        rationale: "navigator.credentials / Push API という外部障害境界かつ test 注入の品質根拠がコード内に明示されている。過剰抽象ではない。"
        caveat: "ただし注入点が誤っている（LF8）。port は AuthProvider が所有し、consumer 向け operation は `loginWithPasskey(): Promise<void>` であるべき。"
        evidence:
          - status: confirmed
            source: "contexts/AuthContext.tsx:106-107（「port は呼び出し側から注入（テスト可能性を確保）」）"
            supports: "品質根拠は存在する"
      - id: AD3
        subject: "lib/playbackQueue.ts の start(:30) / setQueue(:35)"
        verdict: unused_export
        rationale: "共通ブリーフ記載の未使用 export。公開契約面を広げ、不変条件を壊せる入口を増やす。"
        evidence:
          - status: inferred
            source: "common-brief.md:45（Explorer 報告）。本 review では import 側の全数確認を未実施。"
            supports: "未使用の可能性が高いが未確認"
        confirmation_method: "`grep -rn \"Q.start\\|Q.setQueue\\|from '@/lib/playbackQueue'\" app components contexts hooks` で import 側を全数確認する"
      - id: AD4
        subject: "hooks/useLocalStorage（汎用 storage hook）"
        verdict: do_not_generalize_further
        rationale: "6 経路の raw localStorage を単一の汎用 Storage 抽象へ束ねる案は棄却する。設定ごとに許容値（IV8: speed>0、IV10: 0<=pos<=duration、IV9: theme enum）が異なり、汎用 get/set は検証の owner を再び失う。必要なのは汎用化ではなく設定単位の capsule。"

  # ---------------------------------------------------------------------------
  # Interface part
  # 分母: 本 review が代表として契約化した operation は 6（OP1..OP6）。
  # 母集団は lib/api.ts の 9 ドメイン関数群（lib/api.ts:124-553）+ Player&QueueApi + AuthContextValue の
  # 公開 operation であり、全数の契約化は contract-package.md（未作成 / UD2）の担当。
  # ここでは「境界に現れる意味」を確定するのに必要な operation だけを展開し、残りは obligation とする。
  # ---------------------------------------------------------------------------
  interface_part:
    operation_coverage:
      denominator: "公開 operation 全数（未計数。lib/api.ts:124-553 の client method + AudioPlayerContextValue + AuthContextValue + AppContextValue）"
      numerator: 6
      excluded_reason: "review mode の目的は境界判定であり、全 operation の契約本文は Contract Package の authority（UD2）。捏造した CI* を作らない。"

    operations:
      - id: OP1
        consumer_ids: [C1]
        name: "フィードを取得する"
        current_signature: "createApiClient().getFeed(): Promise<FeedResponse>（lib/api.ts:126-129）"
        intent: "利用者に見せる記事一覧と Star 状態を得る"
        inputs: []
        result: "FeedResponse"
        failures:
          - "現在: ApiError(status: number, detail: string, retryAfterSeconds?: number)（lib/api.ts:47-57,108-112）"
          - "あるべき: 未蓄積 / 上限超過(次回可能時刻) / 権限なし / 通信不可 という意味 union"
        side_effects: []
        invariants: []
        contracts: ["obligation OB-B2（Contract Package 未作成のため CI* 参照不能）"]
        end_to_end_deadline:
          status: unknown
          owner: "未定"
          confirmation_method: "BFF proxy 側 AbortSignal.timeout の値（app/api/backend/[...path]/route.ts の fetch 呼出）を読み、UI 側に end-to-end 期限があるかを製品 owner に確認する"
          impact_if_unresolved: "利用者に見える待ち時間上限が誰の責務か決まらず、proxy の per-attempt timeout が事実上の end-to-end 期限として固定される"
          evidence:
            - status: confirmed
              source: "app/api/backend/[...path]/route.ts:43-48（isTimeoutError が TimeoutError/AbortError を 504 扱い）"
              supports: "per-attempt timeout は transport 側に存在する"
        retry_semantics:
          status: applicable
          allowed_when: ["通信不可（現 ApiError.status===0）", "504"]
          prohibited_when: ["429（上限超過。retryAfterSeconds まで禁止）"]
          owner: "現在は各 page（feed/page.tsx 等）。あるべき owner は API client 境界。"
          evidence:
            - status: confirmed
              source: "lib/api.ts:108-110（Retry-After を retryAfterSeconds として公開）, app/(app)/feed/page.tsx:12-20"
              supports: "retry 可否の判断材料が consumer 側へ渡っている"
        idempotency:
          status: not_applicable
          not_applicable_reason: "read-only GET。mutation ではないため idempotency key / deduplication は対象外（同一入力同一出力の決定性と mutation idempotency を混同しない）。"
          evidence:
            - status: confirmed
              source: "lib/api.ts:126-129（method: 'GET'）"
              supports: "read-only"
        duplicate_semantics:
          status: not_applicable
          not_applicable_reason: "GET の重複実行は副作用を持たない。ただし stale 応答の扱いは別関心で、feed/page.tsx:504-506 の fetchRequestIdRef が consumer 側で所有している（LF3）。"
          evidence:
            - status: confirmed
              source: "app/(app)/feed/page.tsx:504-506（stale request 判定）"
              supports: "並行性の解決が consumer 側にある"
        ambiguous_outcome:
          status: not_applicable
          not_applicable_reason: "read-only のため success/failure が確定できない中間状態を持たない。"
          evidence:
            - status: confirmed
              source: "lib/api.ts:126-129"
              supports: "read-only"
        consistency_boundary: "単一 GET。トランザクション境界なし。"

      - id: OP2
        consumer_ids: [C1]
        name: "記事を Star する（Podcast 生成を要求する）"
        current_signature: "createApiClient().starArticle(...)（lib/api.ts:124-553 内）"
        intent: "記事を Star し、生成枠を消費して Podcast 生成を起動する"
        result: "Star 成功 + 残り生成回数（remaining）"
        failures: ["429 上限超過（月次/日次の別と次回可能時刻）", "通信不可", "重複 Star"]
        side_effects: ["サーバ側の生成枠消費", "Podcast 生成ジョブ起動"]
        contracts: ["obligation OB-B2"]
        end_to_end_deadline:
          status: unknown
          confirmation_method: "生成完了までのポーリング上限（hooks/usePodcastListPolling.ts の停止条件）が end-to-end 期限か、単なる UI 打ち切りかを製品 owner に確認する"
          impact_if_unresolved: "「生成されなかった」と「まだ生成中」の consumer 表示が確定しない"
          owner: "未定"
          evidence:
            - status: confirmed
              source: "hooks/usePodcastListPolling.ts:63-103（POLL_INTERVAL_MS と shouldStopPolling）"
              supports: "打ち切り条件は存在するが意味づけが未確定"
        retry_semantics:
          status: applicable
          allowed_when: ["通信不可"]
          prohibited_when: ["429", "既に Star 済み（枠の二重消費リスク）"]
          owner: "未定（現在は UI 側の一括 star 部分失敗方針 app/(app)/feed/page.tsx:350-400 が実質の owner）"
          confirmation_method: "backend が Star を冪等に扱うかを backend 契約で確認する（out_of_scope のため web 単独では確定不能）"
          impact_if_unresolved: "retry が生成枠を二重消費しうる"
          evidence:
            - status: inferred
              source: "common-brief.md:51（一括 star 部分失敗方針が feed/page.tsx:350-400 にある）"
              supports: "retry 方針が UI に散在する"
        idempotency:
          status: unknown
          key_scope: ""
          confirmation_method: "backend の POST /articles/{id}/star が同一 article に対し冪等か（remaining を二重に減らさないか）を backend 契約で確認する"
          impact_if_unresolved: "ネットワーク断後の再送が利用者の生成枠を失わせる。金銭/枠に相当する不可逆影響のため Selection Gate 隔離が必要。"
          owner: "backend（web の out_of_scope）"
          evidence:
            - status: unknown
              source: "common-brief.md:18（backend の契約妥当性は out_of_scope）"
              supports: "web 側 Evidence では判定できない"
        duplicate_semantics:
          status: unknown
          confirmation_method: "同上（idempotency とは独立に、重複 Star 時の observable result を backend 契約で確認する）"
          impact_if_unresolved: "楽観 Star（feed/page.tsx:510-514）と server 値 merge の整合が保証できない"
          owner: "backend"
          evidence:
            - status: unknown
              source: "app/(app)/feed/page.tsx:508-514（「undefined = 未対応 backend の可能性があり、明示 false と区別できないため解除はしない」）"
              supports: "web 側は重複/未対応を区別できないことを自認している"
        ambiguous_outcome:
          status: applicable
          observable_result: "現在: タイムアウト（504）時、Star が成立したか不明のまま UI は失敗表示になる"
          reconciliation_owner: "未定。次回 getFeed の is_starred merge（feed/page.tsx:508-514）が事実上の reconciliation だが、追加方向のみで解除しないため false negative は解消されない。"
          forward_recovery_owner: "未定"
          confirmation_method: "製品 owner に「Star 不確定時に利用者へ何を見せるか」を確認する"
          impact_if_unresolved: "R4（失敗の意味）と生成枠の整合が保証されない"
          evidence:
            - status: confirmed
              source: "app/(app)/feed/page.tsx:508-514"
              supports: "merge が追加方向のみであることはコード内コメントで確定"
        consistency_boundary: "web 側にトランザクション境界は無い。sever が唯一の authority。"

      - id: OP3
        consumer_ids: [C2]
        name: "エピソードを再生開始する"
        current_signature: "playById(podcastId: string): Promise<void>（contexts/AudioPlayerContext.tsx:143-161）"
        intent: "指定エピソードを、保存位置から、キューの現在として再生する"
        result: "void（成功の観測は Player state の isPlaying / AppContext.currentPodcast）"
        failures:
          - "現在: toast 文言 `再生できませんでした (${err.status})`（:235）で HTTP status が UI 文言へ露出"
          - "あるべき: オフラインで未保存 / 取得失敗 / 再生不能 の意味 union"
        side_effects: ["audio 要素の load+play", "AppContext への SET_PODCAST dispatch（:168）", "キュー状態の更新", "blob: URL の生成（cached 経路）"]
        invariants:
          - "upstream IV5: currentIndex は items の範囲内（現在は保証されない）"
          - "upstream IV11: AppContext.currentPodcast と QueueState.current が一致（現在は fetchAndPlay 失敗時に乖離）"
        contracts: ["docs/design/shared-playback-spec.md Q-*（ID 特定は未実施）", "obligation OB-B2"]
        end_to_end_deadline:
          status: not_applicable
          not_applicable_reason: "再生開始は利用者の即時操作で、待ちは getPodcast の transport timeout に従属する。web に独自の end-to-end 期限を置く要件 Evidence がない。"
          evidence:
            - status: inferred
              source: "contexts/AudioPlayerContext.tsx:143-161（timeout に関する記述が無い）"
              supports: "期限要件の不在"
        retry_semantics:
          status: applicable
          allowed_when: ["取得失敗後に利用者が再度タップする（手動 retry）"]
          prohibited_when: ["自動 retry は現在存在しない。auto-advance(handleEnded:204-211) は失敗しても retry しない。"]
          owner: "AudioPlayerContext"
          evidence:
            - status: confirmed
              source: "contexts/AudioPlayerContext.tsx:126-133（fetchAndPlay 失敗時に queue は既に前進済み）"
              supports: "失敗時 recovery が無く queue だけ進む（IV11）"
        idempotency:
          status: applicable
          key_scope: "podcastId（同一 id の再 playById は「その id が現在」という同一状態へ収束すべき）"
          duplicate_result: "現在は収束しない: Q.jump で found なら jump、found でなければ playNext 挿入（:226-232）。並行に 2 回呼ぶと挿入が二重化しうる（未検証）。"
          owner: "lib/playbackQueue.ts（あるべき owner）"
          confirmation_method: "playById を await せず連続 2 回呼ぶ unit test で queue items の重複を観測する"
          impact_if_unresolved: "待機列に同一エピソードが重複する"
          evidence:
            - status: inferred
              source: "contexts/AudioPlayerContext.tsx:143-154（await 後に queueRef を読むため read-modify-write が非原子）"
              supports: "並行呼出で競合しうる"
        duplicate_semantics:
          status: applicable
          duplicate_result_or_reason: "Q.add(:41-44) は id 重複を無視する設計だが、playById が使う Q.playNext にはその保証を本 review では未確認。"
          owner: "lib/playbackQueue.ts"
          confirmation_method: "lib/playbackQueue.ts の playNext 実装（本 review で未読）を読み、id 重複時の挙動を確認する"
          impact_if_unresolved: "OP3 の idempotency 判定が確定しない"
          evidence:
            - status: confirmed
              source: "lib/playbackQueue.ts:41-44（add は重複無視）"
              supports: "add には重複防止があるが playNext は未確認"
        ambiguous_outcome:
          status: applicable
          observable_result: "loadAndPlay(:162-171) は player.load → await player.play() → dispatch の順。play() が reject すると dispatch に到達せず、キューだけ既に更新済み（:150-153）という中間状態が残る。"
          reconciliation_owner: "未定"
          forward_recovery_owner: "未定"
          confirmation_method: "play() reject（autoplay policy 等）時の期待挙動を製品 owner に確認する"
          impact_if_unresolved: "IV11（現在再生中の二重 source of truth）が恒久化する"
          evidence:
            - status: confirmed
              source: "contexts/AudioPlayerContext.tsx:84-91,148-155"
              supports: "キュー更新と AppContext 更新が非原子"
        consistency_boundary: "QueueState（ref+state）と AppState.currentPodcast の 2 つに跨る。単一の整合境界が存在しない。"

      - id: OP4
        consumer_ids: [C3]
        name: "パスキーでログインする"
        current_signature: "loginWithPasskey(port: WebAuthnBrowserPort): Promise<void>（contexts/AuthContext.tsx:28-32, 320-328）"
        intent: "パスキーで認証し status を authenticated にする"
        result: "void（status/user が更新される）"
        failures: ["throw されたエラーがそのまま UI へ伝播（:321-322 コメント）"]
        side_effects: ["status/user の更新"]
        contracts: ["obligation OB-B2"]
        leakage_ref: LF8
        end_to_end_deadline:
          status: not_applicable
          not_applicable_reason: "WebAuthn の待ちは利用者の生体認証操作に従属し、web 側に期限を置く要件 Evidence がない。"
          evidence:
            - status: inferred
              source: "contexts/AuthContext.tsx:108-114"
              supports: "期限記述の不在"
        retry_semantics:
          status: applicable
          allowed_when: ["利用者が再度ボタンを押す"]
          prohibited_when: ["自動 retry（生体認証プロンプトの再表示は利用者の同意が要る）"]
          owner: "UI（consumer）"
          evidence:
            - status: confirmed
              source: "contexts/AuthContext.tsx:110-111（「失敗時はエラーがそのまま伝播する」）"
              supports: "retry は consumer 所有"
        idempotency:
          status: not_applicable
          not_applicable_reason: "認証セッション発行は backend の authority で、web 側に key scope を持たない。重複ログインは新セッション発行であり web が制御しない。"
          evidence:
            - status: confirmed
              source: "app/api/backend/[...path]/route.ts:100-124（Set-Cookie を中継するのみ）"
              supports: "セッション発行の authority は backend"
        duplicate_semantics:
          status: unknown
          confirmation_method: "backend が同一 credential の連続認証をどう扱うかを backend 契約で確認する（web out_of_scope）"
          impact_if_unresolved: "二重送信時の観測結果が未定"
          owner: "backend"
          evidence:
            - status: unknown
              source: "common-brief.md:18"
              supports: "out_of_scope"
        ambiguous_outcome:
          status: applicable
          observable_result: "passkeyLogin 成功後に setUser/setStatus する（:323-325）ため、サーバは認証済みだがクライアント state 更新前に例外が出ると status が unknown/unauthenticated のまま Cookie だけ有効になる"
          reconciliation_owner: "refreshMe（:285-295）が次回マウント時に解消する"
          forward_recovery_owner: "AuthProvider"
          evidence:
            - status: confirmed
              source: "contexts/AuthContext.tsx:54-64,108-114,119-123"
              supports: "reconciliation 経路が存在する"
        consistency_boundary: "httpOnly Cookie（backend authority）と React state の 2 つ。refreshMe が唯一の突合。"

      - id: OP5
        consumer_ids: [C4]
        name: "既定再生速度を変更する"
        current_signature: "なし。consumer は dispatch({type:'SET_SPEED', speed}) を直接呼ぶ（contexts/AppContext.tsx:60, app/(app)/settings/page.tsx:352）"
        intent: "既定再生速度を保存し、再生へ反映する"
        result: "void"
        failures: ["現在なし。不正値（0/負）を拒否する経路が公開側に無い（upstream IV8）"]
        side_effects: ["AppState.playbackSpeed 更新", "AudioPlayerBar.tsx:22-26 の effect 経由で audio.playbackRate 変更", "（別経路で）localStorage 永続化"]
        invariants: ["upstream IV8: playbackSpeed > 0"]
        contracts: ["obligation OB-B2"]
        leakage_ref: LF9
        end_to_end_deadline: {status: not_applicable, not_applicable_reason: "同期的なローカル state 更新。外部 I/O を伴わない。", evidence: [{status: confirmed, source: "contexts/AppContext.tsx:45-46", supports: "reducer の純粋更新"}]}
        retry_semantics: {status: not_applicable, not_applicable_reason: "同期・非 I/O 操作のため失敗しない。", evidence: [{status: confirmed, source: "contexts/AppContext.tsx:45-46", supports: "純粋 reducer"}]}
        idempotency: {status: not_applicable, not_applicable_reason: "同一値の再設定は同一状態へ収束する state 代入であり、mutation idempotency key の対象ではない（決定性と idempotency を混同しない）。", evidence: [{status: confirmed, source: "contexts/AppContext.tsx:45-46", supports: "冪等な代入"}]}
        duplicate_semantics: {status: not_applicable, not_applicable_reason: "重複 dispatch は同一 state を生む。観測差が無い。", evidence: [{status: confirmed, source: "contexts/AppContext.tsx:45-46", supports: "同上"}]}
        ambiguous_outcome: {status: not_applicable, not_applicable_reason: "同期操作で不確定結果を持たない。", evidence: [{status: confirmed, source: "contexts/AppContext.tsx:45-46", supports: "同上"}]}
        consistency_boundary: "AppState.playbackSpeed（永続値）と audio.playbackRate（useAudioPlayer は state を保持しない: hooks/useAudioPlayer.ts:237-240）の 2 つ。片方向 effect（AudioPlayerBar.tsx:22-26, eslint-disable 付き）でのみ同期する。"

      - id: OP6
        consumer_ids: [C3, C6]
        name: "ログアウトする"
        current_signature: "logout(): Promise<void>（contexts/AuthContext.tsx:20-27, 86-104）"
        intent: "セッションを失効させ、端末に残る利用者固有データを消す"
        result: "void（status が unauthenticated になる）"
        failures: ["現在: 失敗はすべて握り潰され、consumer は成功と区別できない（:302-313）"]
        side_effects: ["backend セッション失効（best effort）", "deleteAllAudio()", "clearManagedServiceWorkerCaches()", "status/user のリセット"]
        invariants: ["R6: Cache Storage に格納した認証済み応答がセッション失効後に他利用者へ返らない"]
        contracts: ["obligation OB-B2"]
        leakage_ref: LF12
        end_to_end_deadline: {status: not_applicable, not_applicable_reason: "best-effort 方針が明文化されており、期限で挙動が分岐しない。", evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:86-89（「ログアウトはベストエフォート」）", supports: "方針が明示されている"}]}
        retry_semantics:
          status: applicable
          allowed_when: ["キャッシュ消去失敗後の再試行"]
          prohibited_when: []
          owner: "未定。現在 retry 経路は存在しない。"
          confirmation_method: "共有端末でキャッシュ消去が失敗した場合の製品要件を owner に確認する"
          impact_if_unresolved: "R6 の保証が「消えたかもしれない」に留まる"
          evidence:
            - status: confirmed
              source: "contexts/AuthContext.tsx:99-101（catch 内コメント「キャッシュ消去の失敗はログアウトを妨げない」）"
              supports: "失敗が観測されない"
        idempotency: {status: applicable, key_scope: "セッション", duplicate_result: "二重 logout は同一の unauthenticated 状態へ収束する", owner: "AuthProvider", evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:102-103", supports: "state 代入は冪等"}]}
        duplicate_semantics: {status: applicable, duplicate_result_or_reason: "重複呼出は追加の観測差を生まない（キャッシュは既に空）", owner: "AuthProvider", evidence: [{status: inferred, source: "lib/swCacheCleanup.ts:16-24（keys()→delete の冪等な形）", supports: "再実行安全"}]}
        ambiguous_outcome:
          status: applicable
          observable_result: "サーバ失効成功・ローカル消去失敗、またはその逆が区別なく「ログアウト成功」として見える"
          reconciliation_owner: "未定"
          forward_recovery_owner: "未定（SW の activate は SW_VERSION 変化時のみ削除するため自動回復しない: public/sw.js:26-36）"
          confirmation_method: "共有端末シナリオの受入条件を security owner に確認する"
          impact_if_unresolved: "R6（QL4 constraint）が未保証のまま残る"
          evidence:
            - status: confirmed
              source: "contexts/AuthContext.tsx:88-101, public/sw.js:26-36"
              supports: "失敗時の残留経路が存在する"
        consistency_boundary: "backend セッション / Cache Storage(audio-v1) / SW キャッシュ(shell-*, api-*) / React state の 4 つ。単一の整合境界は無く、best-effort の並行消去。"

  # ---------------------------------------------------------------------------
  # Implementation part
  # ---------------------------------------------------------------------------
  implementation_part:
    items:
      - id: IP1
        kind: hidden_technology
        operation_ids: [OP1, OP2, OP4]
        description: "fetch、CSRF token cookie 読取と X-CSRF-Token 注入、Content-Type 付与、204 の空応答処理、detail 抽出（Pydantic の 'Value error, ' prefix 剥離）"
        owner: "lib/api.ts の request()（:59-122）"
        assessment: "適切に隠蔽されている。ここは境界として機能している。"
        evidence: [{status: confirmed, source: "lib/api.ts:60-122", supports: "transport 詳細が 1 箇所に集約"}]
      - id: IP2
        kind: hidden_technology
        operation_ids: [OP1, OP2, OP4]
        description: "BFF proxy: backend URL 解決、X-API-Key 注入、Cookie/CSRF 中継、Set-Cookie 中継、timeout→504 / 到達不能→502 の分類"
        owner: "app/api/backend/[...path]/route.ts:50-124"
        assessment: "backend の所在と API key は隠蔽できている。ただし LF10/LF11 で内部構成名と無認証続行が漏れる。"
        evidence: [{status: confirmed, source: "app/api/backend/[...path]/route.ts:66-99,100-124", supports: "隠蔽と漏出が同居"}]
      - id: IP3
        kind: data_access
        operation_ids: [OP3]
        description: "Cache Storage（audio-v1）への音声本体・メタ・Podcast JSON 保存、blob: URL 発行"
        owner: "lib/audioCache.ts:64-110"
        assessment: "漏出あり（LF4/LF5）。永続化する Podcast の audio_url を空にし（:83-84）、読出側が blob URL で patch する前提を持つ。response.ok を確認せず cache.put するため HTTP エラー本文が「キャッシュ済み音声」になる（upstream IV3/IV4）。"
        evidence: [{status: confirmed, source: "lib/audioCache.ts:69-71,83-84,88-94", supports: "検証欠落と表現の跨り"}]
      - id: IP4
        kind: data_access
        operation_ids: [OP3, OP5]
        description: "localStorage への再生位置・音量・既定速度・時刻形式・テーマ・既読実績の保存"
        owner: "hooks/useAudioPlayer.ts:42-75, contexts/AppContext.tsx:84-114, app/layout.tsx:44-49, lib/sfx.ts, hooks/useLocalStorage"
        assessment: "6 経路に分散し、検証の owner が経路ごとに異なる（LF9）。app/layout.tsx:44-49 のインラインスクリプトは KEY_THEME を文字列リテラルで複製し、コメントで「lib/config.ts の KEY_THEME と一致させること」と人手同期を要求している。"
        evidence: [{status: confirmed, source: "app/layout.tsx:42-49", supports: "キー複製と人手同期"}]
      - id: IP5
        kind: operational_concern
        operation_ids: [OP3]
        description: "blob: URL の revoke（リソース lifecycle）"
        owner: "hooks/useAudioPlayer.ts:168-177（unmount 時に audio.src が blob: なら revoke）"
        assessment: "発行は lib/audioCache.ts:103（getCachedAudioUrl の createObjectURL）、解放は別モジュールの unmount cleanup。lifecycle の owner が 2 モジュールに割れている（CS1 fail の主因の一つ）。"
        evidence: [{status: confirmed, source: "lib/audioCache.ts:97-103, hooks/useAudioPlayer.ts:168-177", supports: "発行と解放の owner 分離"}]
      - id: IP6
        kind: hidden_technology
        operation_ids: [OP6]
        description: "SW 管理キャッシュ（'shell-' / 'api-' prefix）の列挙と削除"
        owner: "lib/swCacheCleanup.ts:16-24"
        assessment: "prefix が public/sw.js:22-24 の isManagedBySW と重複定義。クラシックスクリプトで import 不能という理由はコード内に明記されており正当だが、実行可能な契約（共有 fixture による conformance test）は無い（LF13）。"
        evidence: [{status: confirmed, source: "public/sw.js:22-24, lib/swCacheCleanup.ts:7-14", supports: "コメントによる人手同期契約"}]

    transport_implementations:
      - id: TI1
        operation_id: OP1
        provider_or_protocol: "HTTP over fetch → Next.js route handler → backend"
        per_attempt_timeout: "AbortSignal.timeout（route.ts の fetch。値は本 review で未読取）"
        backoff: "なし（自動 retry 機構が存在しない）"
        transport_retry_mechanism: "なし"
        bounded_by_contract: ["OP1.retry_semantics（owner が consumer 側にあるため契約で bound されていない）"]
        owner: "app/api/backend/[...path]/route.ts"
        evidence: [{status: confirmed, source: "app/api/backend/[...path]/route.ts:43-48", supports: "timeout の存在"}]
      - id: TI2
        operation_id: OP2
        provider_or_protocol: "同上"
        per_attempt_timeout: "同上"
        backoff: "なし"
        transport_retry_mechanism: "なし。ただし hooks/usePodcastListPolling.ts:27-45 の polling が生成完了検知として別途存在し、その停止条件は hook と caller（onUpdate → enabled=false）に分割所有されている（LF7）。"
        bounded_by_contract: ["OP2.ambiguous_outcome（未確定）"]
        owner: "app/(app)/podcast/page.tsx + usePodcastListPolling"
        evidence: [{status: confirmed, source: "hooks/usePodcastListPolling.ts:21-23（Flow 3「onUpdate callback is responsible for stopping the hook」）", supports: "停止条件の分割所有"}]

  # ---------------------------------------------------------------------------
  # Ownership
  # ---------------------------------------------------------------------------
  ownership:
    authority_refs:
      - id: AR1
        kind: state_authority
        applicability: required
        artifact_ref: "未解決（UD1: architecture-strategy-package.md 未作成）"
        owner: unknown
        rationale: "「現在再生中の Podcast」の writer が AudioPlayerContext（:168 SET_PODCAST dispatch）と QueueState（:150-155）の 2 つある。どちらが source of truth かは system-wide decision であり Boundary が単独確定してはならない。"
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:49-54,84-91", "scratchpad/packages/completeness-package.md:946（IV11）"]}
      - id: AR2
        kind: state_authority
        applicability: required
        artifact_ref: "未解決（UD1）"
        owner: unknown
        rationale: "「再生速度」の writer が AppState.playbackSpeed と audio.playbackRate の 2 つ。useAudioPlayer.setSpeed(:473-476) は state を持たず audio へ直書きし、AudioPlayerBar.tsx:22-26 の片方向 effect だけが両者を繋ぐ。"
        evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:237-240", "components/AudioPlayerBar.tsx:22-26"]}
      - id: AR3
        kind: invariant_owner
        applicability: required
        artifact_ref: "scratchpad/packages/completeness-package.md IV5, IV8, IV9, IV10"
        owner: "Completeness Package（不変条件の列挙）+ Contract Package（強制条件。未作成 UD2）"
        rationale: "QueueState.currentIndex 範囲・playbackSpeed>0・theme enum・再生位置範囲の強制 owner が現状どのモジュールにも無い。"
        evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:7-12", "contexts/AppContext.tsx:45-46", "app/layout.tsx:44-49", "hooks/useAudioPlayer.ts:58-75"]}
      - id: AR4
        kind: semantic_owner
        applicability: required
        artifact_ref: "docs/design/shared-playback-spec.md"
        owner: "3 platform 共有 spec（web 単独で改訂不能。upstream OB-C4 と同じ制約）"
        rationale: "再生キュー操作の意味の正本。lib/playbackQueue.ts:1-3 が明示参照している。"
        evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:1-3", "scratchpad/packages/completeness-package.md:1579"]}
      - id: AR5
        kind: failure_recovery_owner
        applicability: unknown
        artifact_ref: ""
        owner: unknown
        rationale: "OP2（Star 不確定）・OP3（play 失敗後のキュー前進）・OP6（キャッシュ消去失敗）の reconciliation / forward recovery owner が全て未定。"
        confirmation_method: "製品 owner に 3 シナリオの期待挙動を確認し、Contract Package で CI* 化する"
        impact_if_unresolved: "R4/R6 と IV11 の是正先が決まらない"
        evidence: {status: confirmed, sources: ["contexts/AudioPlayerContext.tsx:126-133", "contexts/AuthContext.tsx:99-101", "app/(app)/feed/page.tsx:508-514"]}
      - id: AR6
        kind: contract_owner
        applicability: required
        artifact_ref: "lib/api.ts（ApiError の意味）"
        owner: "lib/api.ts"
        rationale: "失敗の意味の contract owner は lib/api.ts であるべきだが、現在 ApiError は transport 値（status 数値）をそのまま公開し、意味づけを consumer に委ねている。"
        evidence: {status: confirmed, sources: ["lib/api.ts:47-57,108-112", "app/(app)/feed/page.tsx:12-20"]}

    writers:
      - {state: "AppState.currentPodcast", writers: ["contexts/AudioPlayerContext.tsx:90"], assessment: single_writer_but_derived}
      - {state: "QueueState", writers: ["contexts/AudioPlayerContext.tsx:51-54（setQueueState）"], assessment: single_writer, note: "ただし state と ref の二重保持"}
      - {state: "AppState.playbackSpeed", writers: ["app/(app)/settings/page.tsx:352（raw dispatch）", "contexts/AppContext.tsx:92（restore）"], assessment: multiple_writers_unvalidated}
      - {state: "audio.playbackRate", writers: ["hooks/useAudioPlayer.ts:237-240", "components/AudioPlayerBar.tsx:22-26"], assessment: multiple_writers}
      - {state: "localStorage 再生位置", writers: ["hooks/useAudioPlayer.ts:69-75"], readers: ["hooks/useAudioPlayer.ts:58-67", "page（getSavedPosition 経由）", "contexts/AudioPlayerContext.tsx:86"], assessment: reader_leaked}
      - {state: "Cache Storage audio-v1", writers: ["lib/audioCache.ts:68-84"], readers: ["lib/audioCache.ts:88-103", "contexts/AudioPlayerContext.tsx:98-109"], assessment: unvalidated_write}
      - {state: "Cache Storage shell-*/api-*", writers: ["public/sw.js:79-87"], readers: ["public/sw.js:79-87", "lib/swCacheCleanup.ts:16-24（削除）"], assessment: cross_module_implicit_contract}

  selection_boundaries: []
  selection_boundary_not_applicable_reason: "proven variant の Evidence が無い。transport は fetch 1 実装、storage は Cache Storage 1 実装、認証は WebAuthn+password 1 実装で、roadmap・既存 variant・change history のいずれにも second variant の根拠を見つけられなかった（確認範囲: 本 review が読んだ範囲。全 ADR の網羅確認は未実施）。よって CS2/CS3 は not_applicable とし、selection boundary を先回りして作らない。"

  # ---------------------------------------------------------------------------
  # Leakage findings
  # ---------------------------------------------------------------------------
  leakage_findings:
    - id: LF1
      consumer_ids: [C1]
      operation_ids: [OP1, OP2]
      implementation_part_ids: [IP1]
      status: present
      title: "HTTP status 数値が業務判断として 5 consumer へ漏れている（「404 = 未蓄積」）"
      impact: "transport を変えると 5 ファイルの業務分岐が壊れる。R1（業務ルールの lib 単一所有）と R4（失敗を意味で受け取る）に違反。"
      evidence:
        - status: confirmed
          source: "app/(app)/settings/page.tsx:77, app/(app)/admin/metrics/page.tsx:54, app/(app)/feed/page.tsx:234,318, app/(app)/podcast/[id]/page.tsx:59"
          supports: "`err.status === 404` が 5 箇所 5 ファイル"
      remediation: "ApiError を意味 union（NotAccumulated / QuotaExceeded{resetAt} / Forbidden / Unreachable）へ写す変換を lib/api.ts の境界内に置き、consumer は意味だけを見る。"
    - id: LF2
      consumer_ids: [C1]
      operation_ids: [OP2]
      implementation_part_ids: [IP1]
      status: present
      title: "429 の月次/日次判定が backend の英語 detail 文言の regex として UI にある"
      impact: "backend の文言変更で UI の業務表示が静かに壊れる。ADR-073 のフォールバック方針は妥当だが、置き場所が UI 層である点が漏出。"
      evidence:
        - status: confirmed
          source: "app/(app)/feed/page.tsx:12-20（`/monthly/i.test(err.detail) || (err.retryAfterSeconds ?? 0) > 86400`）"
          supports: "regex による判定が page にある"
        - status: inferred
          source: "`grep -rln 'monthly|Monthly' app components lib` = app/(app)/settings/page.tsx, app/(app)/dashboard/page.tsx, app/(app)/feed/page.tsx（3 files）"
          supports: "同種判定が他 2 ファイルにも存在する可能性。3 ファイル全てが同じ判定を持つかは未確認。"
      remediation: "`classifyQuotaError(err): {period: 'monthly'|'daily', resetAt}` を lib へ。retryAfterSeconds も lib 内に留める。"
    - id: LF3
      consumer_ids: [C1]
      operation_ids: [OP1]
      status: present
      title: "並行 fetch の stale 判定（requestId）が consumer 側に実装されている"
      impact: "同じ並行性問題を持つ全 page が同じ ref パターンを再実装する。"
      evidence: [{status: confirmed, source: "app/(app)/feed/page.tsx:504-506（fetchRequestIdRef による stale 破棄）", supports: "consumer 側の並行性制御"}]
      remediation: "latest-wins が必要な read operation を境界側で提供するか、専用 hook へ。ただし汎用化は 2 例目の Evidence が出てから（現在 1 例のみ確認）。"
    - id: LF4
      consumer_ids: [C2]
      operation_ids: [OP3]
      implementation_part_ids: [IP3]
      status: present
      title: "Cache Storage が audio_url を空にした Podcast DTO を永続化し、読出側が patch する前提を持つ"
      impact: "「Podcast」という同じ型が、境界を跨ぐと不変条件の異なる 2 種類（有効 URL / 空 URL）になる。呼出側が patch を忘れると空 URL のまま再生へ渡る（upstream IV2/IV3）。永続化の理由（署名 URL の期限切れ）は正当だが、型で表現されていない。"
      evidence:
        - status: confirmed
          source: "lib/audioCache.ts:83-84（`const podcastToPersist: Podcast = { ...podcast, audio_url: '' }`）, contexts/AudioPlayerContext.tsx:107-108（`return { ...cachedPodcast, audio_url: cachedUrl }`）"
          supports: "空 URL 永続化と呼出側 patch"
      remediation: "`CachedEpisode`（audio_url を持たない型）を境界の公開型にし、`getCachedEpisode(id): Promise<PlayableEpisode|null>` が blob URL を内部で解決して返す。Podcast DTO を cache 層へ通さない。"
    - id: LF5
      consumer_ids: [C2]
      operation_ids: [OP3]
      implementation_part_ids: [IP3, IP5]
      status: present
      title: "HTTP エラー応答が検証なしにキャッシュされ、blob URL の lifecycle owner が 2 モジュールに割れる"
      impact: "403/404 の本文が「キャッシュ済み音声」として残り、以後オフライン再生が常に失敗する（upstream IV4）。revoke 漏れの責務も分散。"
      evidence:
        - status: confirmed
          source: "lib/audioCache.ts:69-71（`const response = await fetch(...)` 直後に `cache.put` で response.ok 未確認）, :99-104, hooks/useAudioPlayer.ts:168-177"
          supports: "検証欠落と lifecycle 分割"
      remediation: "audioCache 境界内で response.ok を検証し、失敗は保存しない。blob URL は境界が発行と解放の両方を所有する（例: `withCachedAudio(id, fn)` または明示的 release を返す）。"
    - id: LF6
      consumer_ids: [C2]
      operation_ids: [OP3]
      status: present
      title: "resolvePlaybackSource の 'unavailable'（オフライン）が呼出側で 'network' と同一に潰される"
      impact: "利用者はオフラインで未保存のときに「再生できませんでした (0)」という transport 文言を見る。純関数が正しく意味を作っているのに境界を越えない。"
      evidence:
        - status: confirmed
          source: "lib/resolvePlayback.ts:16,23-27, contexts/AudioPlayerContext.tsx:98-109（`if (source !== 'cached') return null`）, :117-119（toast に err.status を埋め込む）"
          supports: "意味の握り潰しと status 文字列化"
      remediation: "resolveCachedPodcast の戻り値を `{kind:'cached',...} | {kind:'needsNetwork'} | {kind:'unavailable'}` にし、OP3 の failure union に 'オフラインのため再生できません（保存すればオフラインでも聴けます）' を載せる。"
    - id: LF7
      consumer_ids: [C1, C2]
      operation_ids: [OP2]
      status: present
      title: "caller 側分岐: Q.jump の {found}、usePodcastListPolling の停止条件、admin gate 4 重複"
      impact: "業務ルールが consumer 側の if として散在し、CS4 が fail する。admin gate は status==='unknown' 中に保護 UI を描画するため R5（QL4）違反でもある。"
      evidence:
        - status: confirmed
          source: "contexts/AudioPlayerContext.tsx:148-154, hooks/usePodcastListPolling.ts:21-23,27-30, app/(app)/admin/{users:86,invites:142,featured-sites:207,metrics:70}/page.tsx"
          supports: "3 種の caller 側分岐"
      remediation: "(a) `Q.jumpOrInsertNext` を playbackQueue へ。(b) polling の停止は hook が所有し onUpdate は通知のみ。(c) `<AdminOnly>` または route-level gate 1 箇所で `status !== 'authenticated' → 非表示`（unknown を fail-closed 側へ倒す）。"
    - id: LF8
      consumer_ids: [C3]
      operation_ids: [OP4]
      status: present
      title: "WebAuthn transport port が consumer 向け operation の引数として公開契約に載っている"
      impact: "consumer（ログイン画面）が WebAuthn transport の存在を知らされる。port 自体は test 注入の品質根拠があり過剰抽象ではないが、注入点が consumer 側にあるのは漏出。"
      evidence:
        - status: confirmed
          source: "contexts/AuthContext.tsx:28-32（公開型）, :106-114（実装と WHY コメント）"
          supports: "port が公開契約にある / port の品質根拠も同時に確定"
      remediation: "AuthProvider の props（既定=本番実装）で port を受け、consumer 契約は `loginWithPasskey(): Promise<void>` にする。テストは Provider に fake を渡す。"
    - id: LF9
      consumer_ids: [C4]
      operation_ids: [OP5]
      implementation_part_ids: [IP4]
      status: present
      title: "AppContext が raw dispatch を公開し、検証を迂回する direct write を許す"
      impact: "restore 経路（:89-93）は `typeof number && speed > 0` を検証するのに、公開 dispatch 経由（settings/page.tsx:352）は無検証。同じ状態に検証あり/なしの 2 入口がある（upstream IV8）。named operation が setTimeFormat 1 件だけ存在する点も capsule の不整合。"
      evidence:
        - status: confirmed
          source: "contexts/AppContext.tsx:58-61（dispatch を公開）, :89-93（restore 側の検証）, :344-345（reducer は無検証）"
          supports: "検証の非対称"
      remediation: "dispatch を公開契約から外し、`setPlaybackSpeed(speed)` / `setTimeFormat(...)` の named command のみ公開。検証を reducer 手前の command に一本化。"
    - id: LF10
      consumer_ids: [C5]
      operation_ids: []
      implementation_part_ids: [IP2]
      status: present
      title: "BFF proxy が 500 応答本文に内部環境変数名を露出する"
      impact: "untrusted consumer へ内部構成名（BACKEND_BASE_URL）が伝わる。QL4 constraint / R4 に違反。"
      evidence: [{status: confirmed, source: "app/api/backend/[...path]/route.ts:50-55", supports: "`{ detail: 'Server misconfiguration: BACKEND_BASE_URL is not set' }`"}]
      remediation: "consumer へは汎用の 500 を返し、環境変数名は server ログのみへ。"
    - id: LF11
      consumer_ids: [C5]
      implementation_part_ids: [IP2]
      status: present
      title: "API key 欠落時に無認証でリクエストを転送し続ける（fail-open）"
      impact: "設定ミスが「認証ヘッダなしで backend を叩く」形で静かに継続する。fail-closed であるべき境界が fail-open。"
      evidence: [{status: confirmed, source: "app/api/backend/[...path]/route.ts:70-72（`if (apiKey) { forwardedHeaders['X-API-Key'] = apiKey }` のみで欠落時の分岐なし）", supports: "無認証続行"}]
      remediation: "apiKey 未設定なら 500 で即時失敗（本文は汎用）。起動時 config 検証でさらに前倒し。"
    - id: LF12
      consumer_ids: [C3, C6]
      operation_ids: [OP6]
      status: present
      title: "ログアウト時のキャッシュ消去失敗が consumer から観測できない"
      impact: "共有端末で利用者 A のデータが残ったまま「ログアウトしました」と表示される。R6（QL4 constraint）が best-effort 止まりで、reconciliation owner も無い。"
      evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:88-101（Promise.all を try/catch で黙殺）, public/sw.js:26-36（activate は SW_VERSION 変化時のみ削除）", supports: "失敗の観測不能と自動回復の不在"}]
      remediation: "logout の result を `{ sessionRevoked: boolean, localDataCleared: boolean }` にし、未消去なら UI で明示（および次回起動時の再試行）。方針の決定は security owner（Selection Gate 対象）。"
    - id: LF13
      consumer_ids: [C6]
      implementation_part_ids: [IP6]
      status: present
      title: "sw.js とアプリ側でキャッシュ名前空間の契約がコメントによる人手同期になっている"
      impact: "prefix を片側だけ変更すると、ログアウト時に消えないキャッシュが静かに生まれる（R6 の静かな破壊）。import 不能という制約の説明は両ファイルに明記されており、制約自体は正当。"
      evidence: [{status: confirmed, source: "public/sw.js:22-24, lib/swCacheCleanup.ts:7-10（「変更する際は両方を揃えること」）", supports: "実行可能な契約の不在"}]
      remediation: "prefix を単一の生成元（例: ビルド時に sw.js へ注入、または両者が読む JSON）に置くか、最低限「sw.js が作るキャッシュ名が clearManagedServiceWorkerCaches の対象になる」ことを検証する conformance test を置く。"
    - id: LF14
      consumer_ids: [C1]
      status: present
      title: "reportClientError が request() を迂回して raw fetch する"
      impact: "transport 方針（CSRF・Content-Type・エラー正規化・proxy path）の例外が 1 箇所だけ存在し、境界の唯一性が崩れる。keepalive/credentials が必要という技術的理由はあるが、その理由が境界の外に置かれている。"
      evidence: [{status: confirmed, source: "lib/reportClientError.ts:17-30（`void fetch('/api/backend/client-errors', { ... keepalive: true })`）", supports: "境界迂回"}]
      remediation: "request() に keepalive 対応の beacon 経路を追加し、reportClientError は lib/api.ts の operation を使う。"
    - id: LF15
      consumer_ids: [C1]
      status: present
      title: "createApiClient() が状態を持たない factory として 38 呼出点に散在する"
      impact: "変更時の置換面が広く、テストでは `vi.mock('@/lib/api')` 25 ファイル（共通ブリーフ:55）というモジュール mock に依存する。差し替え seam が DI ではなく module mock である点が QL2 を下げる。"
      evidence:
        - status: confirmed
          source: "`grep -rn \"createApiClient()\" app components contexts hooks lib | wc -l` = 38（定義 lib/api.ts:124 を含む）, `grep -rln createApiClient ... | wc -l` = 21 files"
          supports: "呼出点の分散（計数は 2026-09-16 実行）"
        - status: contradiction
          source: "t3b-brief への訂正指示は「34 call sites / 19 source files」"
          supports: "計数方法の差（除外 glob・定義行の扱い）。finding の向きは変わらないが、正確な母数は計数条件を固定して再測定が必要。"
      remediation: "Provider で 1 度生成した client instance を context 経由で注入し、テストは fake client を渡す。**factory を Strategy 化しない**（RO1）。"

    leakage_absent:
      - id: LF-A1
        subject: "lib/api.ts の request() による CSRF / Content-Type / 204 / detail 正規化の隠蔽"
        status: absent
        rationale: "consumer はこれらを一切知らない。境界として正しく機能している。"
        evidence: [{status: confirmed, source: "lib/api.ts:60-122", supports: "transport 隠蔽"}]
      - id: LF-A2
        subject: "lib/resolvePlayback.ts の純関数設計"
        status: absent
        rationale: "fetch/Cache API/navigator に触れず、caller が hasCached/isOnline を解決してから渡す。単体テスト可能で、doc コメントがその WHY を明示している。潰しているのは caller 側（LF6）。"
        evidence: [{status: confirmed, source: "lib/resolvePlayback.ts:1-7", supports: "純粋性の意図的設計"}]
      - id: LF-A3
        subject: "BFF proxy が backend URL と X-API-Key をブラウザから隠蔽していること"
        status: absent
        rationale: "lib/api.ts:1-7 の doc どおり、client は backend と直接話さない。境界の主目的は達成されている。"
        evidence: [{status: confirmed, source: "lib/api.ts:1-7, app/api/backend/[...path]/route.ts:65-72", supports: "隠蔽の成立"}]
      - id: LF-A4
        subject: "hooks/usePodcastListPolling.ts:30 の `NodeJS.Timeout` 型"
        status: unknown
        rationale: "ref の型注釈であり、hook の公開 API（引数・戻り値）には現れない。公開契約への漏出かは戻り値型の確認を要する。"
        confirmation_method: "usePodcastListPolling の戻り値型宣言（:124 以降）を読み、NodeJS.Timeout が consumer へ出るか確認する"
        impact_if_unresolved: "低。内部 ref に留まるなら実装詳細として正当。"
        evidence: [{status: confirmed, source: "hooks/usePodcastListPolling.ts:30", supports: "内部 ref であることは確認済み"}]
      - id: LF-A5
        subject: "ブリーフが挙げた `components/Menu.tsx:15` の `React.ReactNode` prop"
        status: unknown
        rationale: "`components/Menu.tsx` は存在しない（実体は `components/ui/Menu.tsx`）。本 review では :15 を未確認。なお `React.ReactNode` の children prop は React component の標準契約であり、それ自体は技術漏出ではない。"
        confirmation_method: "`sed -n '1,25p' components/ui/Menu.tsx` で該当 prop を確認する"
        impact_if_unresolved: "低。finding の総体を変えない。"
        evidence: [{status: confirmed, source: "`find . -name '*Menu*'` → ./components/ui/Menu.tsx, ./tests/components/ui/Menu.test.tsx", supports: "path の不一致"}]

  # ---------------------------------------------------------------------------
  # Dependency direction
  # ---------------------------------------------------------------------------
  dependency_direction:
    - id: DD1
      edge: "lib/audioCache.ts → lib/api.ts（createApiClient().getPodcast）"
      status: questionable
      rationale: "キャッシュ層が「保存前に署名 URL を取り直す」という業務手順を所有している。infrastructure が use-case orchestration を含む。"
      evidence: [{status: confirmed, source: "lib/audioCache.ts:69", supports: "cache module から API client 呼出"}]
      remediation: "downloadAudio(podcast: Podcast) のように解決済み入力を受け取り、取得は use case（呼出側）が所有する。"
    - id: DD2
      edge: "contexts/AudioPlayerContext.tsx → contexts/ToastContext（useToast）"
      status: violation
      rationale: "orchestration 層が表示手段（toast）に直接依存する。失敗の意味を返すのではなく文言を出すため、consumer は失敗を扱えず、テストでは toast の観測が必要になる（QL2 低下）。"
      evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:45, :117-119, :155-157", supports: "orchestration→presentation 依存"}]
      remediation: "OP3 の failure を戻り値/例外の意味 union として返し、toast は UI 層が行う。"
    - id: DD3
      edge: "hooks/useStartPodcast.ts → contexts/AudioPlayerContext.tsx"
      status: acceptable
      rationale: "pass-through だが spec §10.3 の語彙を保持する薄い naming layer。内向き（UI→orchestration）で方向は正しい。"
      evidence: [{status: confirmed, source: "hooks/useStartPodcast.ts:5-19", supports: "方向と意図"}]
    - id: DD4
      edge: "app/layout.tsx（インラインスクリプト文字列）→ lib/config.ts の KEY_THEME（コメント上の依存）"
      status: violation
      rationale: "型で追跡できない文字列複製。コンパイラも lint も破綻を検知しない。"
      evidence: [{status: confirmed, source: "app/layout.tsx:42-49", supports: "キー複製"}]
    - id: DD5
      edge: "public/sw.js ↔ lib/swCacheCleanup.ts"
      status: constrained_violation
      rationale: "クラシックスクリプト制約により import 不能。制約は正当だが、契約が実行不能（LF13）。"
      evidence: [{status: confirmed, source: "lib/swCacheCleanup.ts:7-10", supports: "制約の明示"}]

  # ---------------------------------------------------------------------------
  # Change scenarios
  # ---------------------------------------------------------------------------
  change_scenarios:
    - id: CS1
      name: "Replace implementation（fetch→別 transport / Cache Storage→IndexedDB / HTMLAudioElement→別再生系）"
      status: fail
      rationale: "3 つとも consumer 契約が不変で済まない。(a) transport: HTTP status 数値と retryAfterSeconds が 5+ の consumer 分岐に現れる（LF1/LF2）。(b) Cache Storage: 公開型が blob: URL 前提で、audio_url の patch（LF4）と revoke（LF5/IP5）が境界外に露出している。(c) Audio: getSavedPosition が page へ export され（hooks/useAudioPlayer.ts:58-67。LF15 と同種の seam 漏出だが別 finding として LF 未採番。C2 の must_not_know 違反）、setSpeed が state を持たず AudioPlayerBar の effect に依存する（AR2）。"
      evidence:
        - status: confirmed
          source: "LF1 / LF2 / LF4 / LF5 の path:line、hooks/useAudioPlayer.ts:58-67,237-240, components/AudioPlayerBar.tsx:22-26"
          supports: "3 技術すべてで consumer 側変更が必要"
    - id: CS2
      name: "Add a proven variant"
      status: not_applicable
      rationale: "second transport / storage / 再生系の Evidence（roadmap・既存 variant・change history）を本 review の確認範囲で見つけられなかった。根拠のない variant のために selection boundary や factory 階層を先回りして作らない。"
      evidence:
        - status: inferred
          source: "lib/api.ts に実装は 1 つ（request()）、lib/audioCache.ts に Cache Storage 実装のみ、hooks/useAudioPlayer.ts に HTMLAudioElement 実装のみ"
          supports: "単一実装"
      confirmation_method: "docs/adr/ 全件と issue backlog で「別 transport / 別 storage」の計画有無を確認する（本 review 未実施）"
    - id: CS3
      name: "Change one proven variant"
      status: not_applicable
      rationale: "CS2 と同じ理由。proven variant が存在しない。"
      evidence: [{status: inferred, source: "CS2 と同じ", supports: "単一実装"}]
    - id: CS4
      name: "Change one business rule"
      status: fail
      rationale: "4 ルール中 3 つが複数ファイルへ波及し、rule owner 内で完結しない。"
      rule_spread:
        - rule: "「404 = 未蓄積」"
          files: 5
          sites: 5
          paths: ["app/(app)/settings/page.tsx:77", "app/(app)/admin/metrics/page.tsx:54", "app/(app)/feed/page.tsx:234", "app/(app)/feed/page.tsx:318", "app/(app)/podcast/[id]/page.tsx:59"]
          evidence_status: confirmed
          measurement: "`grep -rn 'status === 404' app components hooks lib`"
          verdict: fail
        - rule: "429 の月次/日次判定"
          files: 3
          paths: ["app/(app)/feed/page.tsx:12-20（確定）", "app/(app)/settings/page.tsx（grep hit・内容未確認）", "app/(app)/dashboard/page.tsx（grep hit・内容未確認）"]
          evidence_status: inferred
          measurement: "`grep -rln 'monthly\\|Monthly' app components lib` = 3 files。feed のみ判定ロジックを目視確認済み。"
          verdict: fail
          confirmation_method: "settings/dashboard の hit 箇所を読み、同じ判定か単なる文言かを確定する"
        - rule: "パスワードポリシー"
          files: 2
          paths: ["components/ui/AccountSection.tsx:19-55", "app/signup/page.tsx:18-45"]
          evidence_status: confirmed
          measurement: "共通ブリーフ:51 + `grep -rln password` で両ファイルを確認"
          verdict: fail
        - rule: "server-star merge（追加方向のみ）"
          files: 1
          paths: ["app/(app)/feed/page.tsx:151-159（実体は :508-514 の setStarredIds）"]
          evidence_status: confirmed
          measurement: "`grep -rn 'is_starred' app components` = feed/page.tsx のみ"
          verdict: pass
          note: "単一箇所に局在しており、この 1 ルールだけは owner 内で完結する。"
      evidence:
        - status: confirmed
          source: "上記 measurement 欄の grep（2026-09-16 実行）"
          supports: "4 ルール中 3 つが 2〜5 ファイルへ波及"

  # ---------------------------------------------------------------------------
  # Migration（review mode: plan のみ。実行しない）
  # ---------------------------------------------------------------------------
  migration:
    - id: M1
      title: "失敗の意味を lib/api.ts の境界内へ移す"
      contract_ids: ["OB-B2 で CI* 化後に確定"]
      consumer_ids: [C1]
      leakage_finding_ids: [LF1, LF2]
      compatibility_window: "ApiError は当面 export したまま、意味 union を追加 export する（並存期）"
      steps:
        - "1. lib に `classifyApiFailure(err: ApiError): ApiFailure` を追加（RED: 404→NotAccumulated、429+Retry-After>86400→QuotaExceeded{period:'monthly'} の unit test）"
        - "2. consumer を 1 ファイルずつ classifyApiFailure へ移す（5+3 ファイル）"
        - "3. ApiError.status の consumer 参照ゼロを grep で確認"
        - "4. ApiError を lib 内部へ降格（export 削除）"
      rollback_or_recovery: ["各 step は単独 revert 可能。step 4 のみ公開契約変更であり、直前に grep 結果を Evidence として残す。"]
      temporary_path_ids: [TP1]
    - id: M2
      title: "再生境界の意味を閉じる（audio_url patch・blob lifecycle・offline の意味）"
      consumer_ids: [C2]
      leakage_finding_ids: [LF4, LF5, LF6]
      compatibility_window: "getCachedPodcast/getCachedAudioUrl を残したまま新 operation を追加し、移行後に旧を削除"
      steps:
        - "1. audioCache に response.ok 検証を追加（RED: 403 応答が保存されないこと）"
        - "2. `getPlayableEpisode(id): Promise<{episode, release()}|null>` を追加し blob lifecycle を境界内へ"
        - "3. resolveCachedPodcast の戻り値を 3 値 union にし、OP3 の failure へ offline を載せる"
        - "4. 旧 2 関数の import ゼロを確認して削除"
      rollback_or_recovery: ["step 2 は useAudioPlayer.ts:168-177 の revoke と一時的に二重になる。二重 revoke の安全性を test で固定してから旧 cleanup を外す。"]
      temporary_path_ids: [TP2]
    - id: M3
      title: "AppContext の raw dispatch を named command へ置換"
      consumer_ids: [C4]
      leakage_finding_ids: [LF9]
      compatibility_window: "dispatch と named command を並存させ、consumer 移行後に dispatch を context 値から外す"
      steps: ["1. setPlaybackSpeed を追加（RED: speed<=0 を拒否）", "2. settings/page.tsx:352 を移行", "3. dispatch 参照ゼロを grep 確認", "4. AppContextValue から dispatch を削除"]
      rollback_or_recovery: ["step 4 のみ公開契約変更。step 3 の grep 出力を Evidence に残す。"]
      temporary_path_ids: [TP3]
    - id: M4
      title: "BFF proxy の fail-closed 化と内部情報の非開示"
      consumer_ids: [C5]
      leakage_finding_ids: [LF10, LF11]
      compatibility_window: "不要（consumer 契約は「500 が返る」まま。本文のみ変わる）"
      steps: ["1. 500 本文を汎用化し、詳細は server ログへ（RED: 応答 body に 'BACKEND_BASE_URL' を含まない）", "2. apiKey 未設定時に転送せず 500（RED: fetch が呼ばれないこと）"]
      rollback_or_recovery: ["step 2 は運用中に API key 未設定の環境があると全 API が落ちる。deploy 前に各環境の env 設定を確認する（運用 owner の責務）。"]
      temporary_path_ids: []

  temporary_paths:
    - id: TP1
      migration_id: M1
      purpose: "ApiError と ApiFailure の並存"
      owner: "未定（実装フェーズで割当）"
      introduced_on: "未実施"
      observation: "`grep -rn 'err.status' app components hooks` の件数を各 step で記録"
      removal_condition: "consumer からの ApiError.status 参照が 0 件"
      removal_phase: "M1 step 4"
    - id: TP2
      migration_id: M2
      purpose: "旧 cache 読出 API と新 playable API の並存"
      owner: "未定"
      introduced_on: "未実施"
      observation: "`grep -rn 'getCachedPodcast\\|getCachedAudioUrl' app components contexts hooks` の件数"
      removal_condition: "旧 2 関数の import が 0 件"
      removal_phase: "M2 step 4"
    - id: TP3
      migration_id: M3
      purpose: "raw dispatch と named command の並存"
      owner: "未定"
      introduced_on: "未実施"
      observation: "`grep -rn \"dispatch({ *type: *'SET_\" app components\" の件数"
      removal_condition: "AppContext の dispatch 参照が Provider 内部のみ"
      removal_phase: "M3 step 4"

  # ---------------------------------------------------------------------------
  # Traces
  # ---------------------------------------------------------------------------
  boundary_traces:
    - id: BT1
      requirement_ids: [R1]
      consumer_ids: [C1]
      operation_ids: [OP1, OP2]
      ownership_refs: [AR6]
      implementation_part_ids: [IP1]
      leakage_finding_ids: [LF1, LF2]
      change_scenario_ids: [CS4]
      migration_ids: [M1]
      verification_ids: []
      status: missing
      rationale: "業務ルールが lib に単一所有されていない。CS4 で 3 ルールが fail。"
      evidence: [{status: confirmed, source: "CS4.rule_spread", supports: "波及計測"}]
    - id: BT2
      requirement_ids: [R2, R3]
      consumer_ids: [C2, C4]
      operation_ids: [OP3, OP5]
      ownership_refs: [AR1, AR2, AR3, AR4]
      implementation_part_ids: [IP3, IP4, IP5]
      leakage_finding_ids: [LF4, LF5, LF6, LF9]
      change_scenario_ids: [CS1]
      migration_ids: [M2, M3]
      verification_ids: []
      status: missing
      rationale: "現在再生中・再生速度の source of truth が二重（AR1/AR2）。不正状態が公開経路から構築できる（upstream IV5/IV8/IV11）。"
      evidence: [{status: confirmed, source: "AR1/AR2 の path:line", supports: "二重 writer"}]
    - id: BT3
      requirement_ids: [R4]
      consumer_ids: [C1, C2]
      operation_ids: [OP1, OP2, OP3]
      ownership_refs: [AR5, AR6]
      leakage_finding_ids: [LF1, LF6]
      change_scenario_ids: [CS1]
      migration_ids: [M1, M2]
      status: missing
      rationale: "consumer が transport 値（status 数値・status 0）に依存している。"
      evidence: [{status: confirmed, source: "LF1, LF6", supports: "transport 依存"}]
    - id: BT4
      requirement_ids: [R5]
      consumer_ids: [C3]
      operation_ids: [OP4]
      leakage_finding_ids: [LF7, LF8]
      status: missing
      rationale: "admin gate が `status === 'authenticated' && !isAdmin` の否定形で、unknown 中に保護 UI を描画する。4 ページに複製。"
      evidence: [{status: confirmed, source: "app/(app)/admin/{users:86,invites:142,featured-sites:207,metrics:70}/page.tsx", supports: "gate の形と複製数"}]
    - id: BT5
      requirement_ids: [R6]
      consumer_ids: [C3, C6]
      operation_ids: [OP6]
      ownership_refs: [AR5]
      implementation_part_ids: [IP6]
      leakage_finding_ids: [LF12, LF13]
      migration_ids: []
      status: partial
      rationale: "logout が deleteAllAudio + clearManagedServiceWorkerCaches を実行する設計は R6 を意図している（AuthContext.tsx:93-97 のコメントが根拠を明示）。ただし失敗が観測不能（LF12）で、名前空間契約が人手同期（LF13）のため保証にならない。"
      evidence: [{status: confirmed, source: "contexts/AuthContext.tsx:88-101, lib/swCacheCleanup.ts:7-24, public/sw.js:22-36", supports: "意図と穴の双方"}]
    - id: BT6
      requirement_ids: [R7]
      consumer_ids: [C1]
      leakage_finding_ids: [LF15]
      status: partial
      rationale: "`vi.mock('@/lib/api')` 25 ファイルという module mock 依存は production 経路を通す rule 11 の要請と緊張する。createApiClient の DI 化（M1 の延長）で fake 注入へ移せる。本 review ではテストファイル自体を未読のため partial。"
      evidence: [{status: inferred, source: "common-brief.md:55（Explorer 報告）", supports: "module mock の広がり。本 review 未検証。"}]
      confirmation_method: "`grep -rln \"vi.mock('@/lib/api')\" tests` で件数を確定する"
    - id: BT7
      requirement_ids: [R8]
      status: not_applicable
      rationale: "CI ゲート構成（typecheck:ts7・build）は consumer 境界の関心ではなく、Architecture / プロセスの領分。本 Function の authority 外。"
      evidence: [{status: confirmed, source: "本 Skill の Authority Boundary（system-wide decision は Architecture が canonical owner）", supports: "authority 分離"}]

    trace_coverage:
      denominator: 8
      denominator_definition: "Requirement Catalog seed R1..R8"
      numerator_covered: 0
      partial: 2
      missing: 5
      not_applicable: 1
      uncovered_ids: [R1, R2, R3, R4, R5]
      note: "covered が 0 件なのは、本 review が是正前の現状を評価しているため。verification_ids が全て空なのは Contract Package（UD2）未作成で T* を参照できないことによる。捏造しない。"

  # ---------------------------------------------------------------------------
  # Rejected overdesign
  # ---------------------------------------------------------------------------
  rejected_overdesign:
    - id: RO1
      option: "createApiClient を transport Strategy / provider factory 階層にする"
      purpose: "transport 差し替えを容易にする"
      assumption: "未検証: 将来 fetch 以外の transport が必要になる"
      rejection_reason: "proven variant の Evidence が無い（CS2 not_applicable）。現在の問題は差し替え可能性ではなく、意味が漏れていること（LF1）。Strategy は漏出を直さず面だけ増やす。"
      residual: "必要なのは単一 instance の DI と ApiFailure union であり、階層ではない。"
    - id: RO2
      option: "PlaybackSource を Strategy パターン（CachedStrategy / NetworkStrategy）にする"
      purpose: "再生ソース選択の拡張性"
      assumption: "未検証: 第 3 のソースが増える"
      rejection_reason: "resolvePlaybackSource は純関数 3 分岐で、状態遷移でも variant でもない。state transition を variant abstraction へ逃がす hard gate 違反になる。"
      residual: "直すべきは caller が 3 値を 2 値へ潰している点だけ（LF6）。"
    - id: RO3
      option: "6 経路の localStorage を汎用 Storage port へ統合する"
      purpose: "永続化の一元化"
      assumption: "未検証: 全設定が同じ読み書き契約を共有する"
      rejection_reason: "設定ごとに不変条件が違う（IV8 speed>0 / IV9 theme enum / IV10 位置範囲）。汎用 get/set は検証 owner を再び失い、現状と同じ欠落を別の場所で再現する。"
      residual: "設定単位の capsule（setPlaybackSpeed 等）で検証を持つのが正しい粒度。app/layout.tsx のインラインスクリプトは FOUC 防止の制約上 capsule 化できないため、キー定数の生成元一元化のみ対象。"
    - id: RO4
      option: "hooks/useStartPodcast の pass-through を削除する"
      purpose: "無駄な間接の除去"
      assumption: "確認済み: 実体は `return playById` のみ"
      rejection_reason: "doc コメント（:5-15）が spec §9 L151 / §10.3 L201,L209 への対応を保持しており、名前が契約の索引として働いている。削除は仕様追跡性の損失と引き換えで、漏出は直さない。"
      residual: "優先度は低い。M1..M4 完了後に再評価する。"
    - id: RO5
      option: "WebAuthnBrowserPort / PushBrowserPort を削除する（過剰抽象として）"
      purpose: "port 数の削減"
      assumption: "確認済み: 実装は各 1 つ"
      rejection_reason: "外部障害境界かつテスト注入という品質根拠がコード内に明示されている（AuthContext.tsx:106-107）。abstraction gate の「別の品質根拠がある場合の小さな port」に該当する。"
      residual: "port は残し、注入点だけを consumer から Provider へ移す（LF8）。"
    - id: RO6
      option: "forward() を middleware（middleware.ts）へ移して横断化する"
      purpose: "proxy 責務の集約"
      assumption: "未検証: middleware が Cookie/Set-Cookie 中継と timeout 分類を同等に扱える"
      rejection_reason: "現在 middleware/proxy.ts は存在せず、移設は runtime 制約（Edge での fetch timeout 挙動）の再検証を要する。LF10/LF11 は forward() 内の 2 行修正で直り、移設は不要。"
      residual: "forward() 内の関心分割（M4 の後段）は別途検討余地あり。"

  # ---------------------------------------------------------------------------
  # Verdicts
  # ---------------------------------------------------------------------------
  subject_verdict: leaky
  subject_verdict_by_consumer:
    C1: leaky
    C2: leaky
    C3: leaky
    C4: leaky
    C5: leaky
    C6: leaky
  subject_verdict_rationale: "6 境界すべてで、consumer が知る必要のない技術（HTTP status 数値・blob URL lifecycle・WebAuthn port・reducer Action・環境変数名・cache prefix）が公開側に現れ、逆に consumer が知るべき意味（未蓄積・上限の種別・オフライン・消去失敗）が境界で失われている。overabstracted ではない: 過剰抽象の候補（createApiClient factory）は 1 件のみで、port 2 件には品質根拠がある。indeterminate でもない: 主要 finding は path:line で confirmed。"

  decision:
    status: revise
    artifact_readiness: incomplete
    engineering_status: not_started
    release_status: not_applicable
    decision_maturity:
      status: proposed
      owner: "main session orchestrator"
      scope: ["C1..C6 の境界判定", "LF1..LF15", "M1..M4 の移行計画"]
      evidence_status: confirmed
      approval_evidence: []
      baseline_version: ""
      change_control: "未設定"
    artifact_readiness_reason: "operation 契約の denominator が未確定（6/未計数）で、verification_ids が全て空。Contract Package（UD2）と Architecture Strategy Package（UD1）が未作成のため、CI* / SG* / authority_refs の参照先を解決できない。"
    next_phase:
      name: "Contract Package 作成（OB-C* → CI*/T*）と Architecture Strategy の data authority 決定"
      status: blocked
      reasons:
        - "UD1: architecture-strategy-package.md 未作成のため AR1/AR2（現在再生中・再生速度の source of truth）を確定できない"
        - "UD2: contract-package.md 未作成のため OP1..OP6 の条件本文と T* を参照できない"
        - "OP2 の idempotency / duplicate semantics が backend 契約依存（web out_of_scope）"
      human_approvals_required:
        - "OP2（Star）の不確定時挙動: 生成枠という不可逆資源に触れるため人間の決定が要る"
        - "OP6（ログアウト時の残留データ）の受入条件: QL4 constraint。security owner の決定が要る"
        - "M1 step 4 / M3 step 4 の公開契約削除"
    evidence:
      - status: confirmed
        source: "本 package の LF1..LF15、CS4.rule_spread の grep 出力（2026-09-16 実行）"
        supports: "境界判定の根拠"
    assumptions:
      - "共通ブリーフの Explorer 観測のうち、本 review が path:line で再確認していない項目（playbackQueue の start/setQueue 未使用、vi.mock 25 ファイル）は assumption として扱い、confirmation_method を付した。"
    unknowns:
      - id: U1
        subject: "OP2（Star）の backend 側 idempotency / duplicate semantics"
        confirmation_method: "backend の Star endpoint 契約を確認する（web の out_of_scope のため別 owner）"
        impact_if_unresolved: "再送が生成枠を二重消費しうる。R4 と OP2 の retry 契約が書けない。"
        owner: "backend owner"
        evidence: [{status: unknown, source: "common-brief.md:18", supports: "out_of_scope"}]
      - id: U2
        subject: "「現在再生中の Podcast」と「再生速度」の source of truth"
        confirmation_method: "Architecture Strategy Package（UD1）で data authority を決定する"
        impact_if_unresolved: "LF6/LF9 と AR1/AR2 の是正先が決まらず、M2/M3 の設計が確定しない"
        owner: "Architecture（別 Function）"
        evidence: [{status: confirmed, source: "contexts/AudioPlayerContext.tsx:49-91, components/AudioPlayerBar.tsx:22-26", supports: "二重 writer の存在"}]
      - id: U3
        subject: "429 月次判定の実際の波及ファイル数（3 files のうち 2 は grep hit のみ）"
        confirmation_method: "app/(app)/settings/page.tsx と app/(app)/dashboard/page.tsx の該当行を読む"
        impact_if_unresolved: "CS4 の波及数が 2〜3 の幅を持つ。fail 判定自体は変わらない。"
        owner: "本 Function（次 turn で解消可能）"
        evidence: [{status: inferred, source: "`grep -rln 'monthly\\|Monthly' app components lib`", supports: "3 files hit"}]
      - id: U4
        subject: "lib/playbackQueue.ts の playNext における id 重複時の挙動"
        confirmation_method: "lib/playbackQueue.ts の playNext 実装を読む（本 review 未読）"
        impact_if_unresolved: "OP3 の idempotency / duplicate_semantics が applicable のまま内容未確定"
        owner: "本 Function"
        evidence: [{status: confirmed, source: "lib/playbackQueue.ts:41-44（add には重複防止あり）", supports: "playNext は別関数"}]
      - id: U5
        subject: "createApiClient の正確な呼出点数（本測定 38 呼出/21 files vs ブリーフ訂正 34/19）"
        confirmation_method: "除外 glob（tests/ e2e/ 除外の有無）と定義行の扱いを固定して再測定する"
        impact_if_unresolved: "低。LF15 の向きは変わらない。"
        owner: "orchestrator"
        evidence: [{status: contradiction, source: "本 review の grep と t3b ブリーフ訂正指示", supports: "計数方法の差"}]
    contradictions:
      - id: X1
        subject: "createApiClient 呼出点数（U5 と同一）"
        resolution: "計数条件の明示で解消する。finding には影響しない。"
      - id: X2
        subject: "ブリーフ記載の `components/Menu.tsx:15`"
        resolution: "実在 path は components/ui/Menu.tsx。当該 finding は LF-A5 に unknown として保持した。"
    failed_gates: []
    unexecuted_validation:
      - id: UV1
        reason: "review mode（mutation_authorized: false）のためテスト実行・ビルドを行っていない"
        required_runner: "npm test（vitest run）/ npm run build"
        planned_commands: ["npm test", "npm run lint", "npm run build"]
        owner: "実装フェーズの coder / orchestrator"
        evidence: [{status: confirmed, source: "common-brief.md:13", supports: "read-only 指定"}]
      - id: UV2
        reason: "U3/U4 の確認読取が turn budget 内に収まらなかった"
        required_runner: "sed / grep"
        planned_commands: ["sed -n '1,60p' lib/playbackQueue.ts | grep -n -A8 playNext", "grep -n -B2 -A6 'onthly' 'app/(app)/settings/page.tsx' 'app/(app)/dashboard/page.tsx'"]
        owner: "本 Function または orchestrator"
        evidence: [{status: confirmed, source: "本 package の U3/U4", supports: "未実行項目"}]
    platform_validation:
      required_platforms: []
      parity_result: not_applicable
      not_applicable_reason: "OS 固有 path / process / shell を公開境界で扱わない（platform_context 参照）"

  obligations:
    - id: OB-B1
      to: "Architecture Strategy（未作成 / UD1）"
      request: "「現在再生中の Podcast」「再生速度」「再生位置」の data authority と source of truth を SG* 付きで決定する。AR1/AR2 はその決定を参照する。"
      blocking_for: [M2, M3, U2]
    - id: OB-B2
      to: "Contract Package（未作成 / UD2）"
      request: "OP1..OP6 の事前/事後条件・不変条件・失敗保証を CI* 化し、RED テスト T* を付す。特に upstream IV2/IV3/IV4/IV5/IV8/IV11 に対応する条件。本 package は条件本文を確定しない。"
      blocking_for: [BT1, BT2, BT3, "全 boundary_traces の verification_ids"]
    - id: OB-B3
      to: "human owner（security）"
      request: "OP6 のログアウト時残留データの受入条件（LF12）と、admin gate を unknown 中に fail-closed へ倒す方針（LF7/BT4）を決定する。QL4 constraint に触れるため AI が確定しない。"
      blocking_for: [M4, BT4, BT5]
    - id: OB-B4
      to: "backend owner"
      request: "Star endpoint の idempotency と重複時の observable result（U1）。生成枠という不可逆資源に関わる。"
      blocking_for: [OP2, U1]
    - id: OB-B5
      to: "orchestrator（trial-log 転記）"
      request: "rejected_overdesign RO1..RO6 を docs/trial-log/ へ転記する。特に RO1（transport Strategy）RO2（PlaybackSource Strategy）RO3（汎用 Storage port）は、境界改善の議論で再提案されやすい。"
      blocking_for: []
```
