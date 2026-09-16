# Contract Package — news-listen-web（mino-design-by-contract / review mode）

```yaml
contract_package:
  subject: "/Users/rio/git/news-listen/web の公開 operation 群（OP-A*/OP-Q*/OP-P*/OP-C*/OP-X*/OP-S*）の契約適合監査"
  mode: review
  mutation_authorized: false
  routing_context:
    requested_by: router
    return_to: router
    requested_artifact: contract_package
    re_routing: prohibited
  upstream_inputs:
    completeness_package:
      path: "scratchpad/packages/completeness-package.md"
      consumed_ids: [OB-C1..OB-C14, OB-T1..OB-T12, G1..G11, ME1..ME44]
      note: "OB-* は契約抽出の入力であり、本 package が CI*/T* の実在 ID を発行して逆 trace する。"
    architecture_strategy_package:
      status: absent_at_read_time
      evidence: {status: confirmed, sources: ["scratchpad/packages/ 直下に architecture-strategy-package.md が存在しない（ls 実施）"]}
      handling: "authority 表・SG* を参照できないため、system-wide な data authority を必要とする CI（CI-Q01/CI-P12/CI-S03）は authoritative_owner を unknown とせず obligation OB-N3 として router へ返す。不在を unknown-by-omission として黙殺しない。"

  platform_context:
    runtime: "Node.js (Next.js 16 Route Handler / vitest) + ブラウザ (React 19 client, Service Worker)"
    required_platforms: [browser, node]
    note: "OS 固有の path/process/shell/line ending を契約が分岐させない。"
  platform_validation:
    parity_result: not_applicable
    rationale: "対象 operation は OS 固有 path/process/shell を扱わず、契約条件が Windows/Linux/macOS で分岐しない。分岐するのは browser 実装差（Cache Storage 有無・autoplay policy・Range handling）であり、これは environment_condition (CI-C07/CI-P09) として別 item 化済み。"
    evidence: {status: confirmed, sources: ["lib/audioCache.ts:54-61", "lib/audioCache.ts:9-13"]}

  change_safety:
    applicability: not_applicable
    not_applicable_reason: "review mode であり公開契約の変更を提案していない（mutation_authorized: false、ブリーフ §5）。本 package は既存契約の充足/欠落の判定のみを行い、差分を発生させない。"
    evidence: {status: confirmed, sources: ["scratchpad/packages/common-brief.md:5", "scratchpad/packages/t3a-contract-brief.md:20"]}

  requirements:
    - {id: R1, evidence: {status: confirmed, sources: ["app/(app)/feed/page.tsx:15-28", "components/ui/AccountSection.tsx:19-55", "lib/config.ts:1,12-16"]}}
    - {id: R2, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:25-30,148-151", "types/index.ts:92,111-112"]}}
    - {id: R3, evidence: {status: confirmed, sources: ["contexts/AppContext.tsx:14-15", "contexts/AudioPlayerContext.tsx:49-54,88-90", "hooks/useAudioPlayer.ts:237-240"]}}
    - {id: R4, evidence: {status: confirmed, sources: ["lib/api.ts:47-57,84-86,110-112"]}}
    - {id: R5, evidence: {status: confirmed, sources: ["app/(app)/admin/users/page.tsx:86-100", "app/(app)/layout.tsx:11-21"]}}
    - {id: R6, evidence: {status: confirmed, sources: ["public/sw.js:50-61,84-87", "lib/swCacheCleanup.ts:16-24", "lib/audioCache.ts:122-125"]}}
    - {id: R7, evidence: {status: confirmed, sources: ["tests/lib/playbackQueue.conformance.test.ts:1-24", "docs/design/shared-playback-spec.md:201-232"]}}
    - {id: R8, evidence: {status: unknown, sources: ["ブリーフ既知観測 :47（CI 未実行）。本 review では CI 定義ファイルを読んでおらず自力確認していない"], confirmation_method: ".github/workflows/*.yml を読み typecheck:ts7 / build job の有無を確認", impact_if_unresolved: "R8 は契約 item を持たず coverage 分母外となる"}}

  operations:
    - id: OP-A1
      name: "request<T>(path, init)"
      caller: "createApiClient() が返す 60 関数すべて（lib/api.ts:124-553）。21 ファイルから 60 回生成。"
      boundary: "browser → 同一 origin BFF (/api/backend/*)"
      contract_owner: "lib/api.ts（API/message boundary の contract owner）"
      initial_state: "document.cookie に csrf_token / nl_session が存在しうる"
      inputs: [path, "init.method", "init.headers", "init.body"]
      expected_result: "2xx なら T、204 なら undefined、非 2xx/送信失敗なら ApiError を throw"
      side_effects: ["credentials:'include' による Cookie 送受信", "非安全 method への X-CSRF-Token 注入"]
      failures: ["fetch reject → ApiError(0,'Network error')", "非 2xx → ApiError(status, detail, retryAfterSeconds?)"]
      evidence: {status: confirmed, sources: ["lib/api.ts:60-122"]}
    - id: OP-A1b
      name: "updatePosition(id, positionSeconds)"
      caller: "AudioPlayerContext の onPositionSave（throttle 経由・useAudioPlayer.ts:121-129,141）"
      boundary: "PATCH /api/backend/podcasts/{id}/position"
      contract_owner: "backend（永続化 state の source of truth）。web 側は use case の呼出順のみ所有。"
      initial_state: "サーバ側に既存 playback_position_seconds"
      inputs: [id, position_seconds]
      expected_result: "更新後 Podcast"
      side_effects: ["サーバ側再生位置の上書き"]
      failures: ["ApiError（呼出側は握りつぶし可能）"]
      evidence: {status: confirmed, sources: ["lib/api.ts:174-181", "hooks/useAudioPlayer.ts:121-129,140-141"]}
    - id: OP-A1c
      name: "markCompleted(id)"
      caller: "AudioPlayerContext の onCompleted（ended 由来・useAudioPlayer.ts:132-146）"
      boundary: "POST /api/backend/podcasts/{id}/completed"
      contract_owner: "backend（ADR-075 決定3 の first-write-wins 保持者）"
      inputs: [id]
      expected_result: "更新後 Podcast"
      side_effects: ["完聴イベントの記録（ストリーク・学習指標へ波及）"]
      failures: [ApiError]
      evidence: {status: confirmed, sources: ["lib/api.ts:189-194", "hooks/useAudioPlayer.ts:134-141"]}
    - id: OP-A1d
      name: "starArticle(id, difficulty?)"
      caller: "feed / starred ページ・一括 star（app/(app)/feed/page.tsx:350-400）"
      boundary: "POST /api/backend/articles/{id}/star"
      contract_owner: "backend（生成 quota の source of truth。remaining を応答で返す）"
      inputs: [id, difficulty]
      expected_result: "{status, article_id, remaining?}"
      side_effects: ["生成 quota の消費", "Podcast 生成ジョブ投入"]
      failures: ["429（Retry-After 付き）", "その他 ApiError"]
      evidence: {status: confirmed, sources: ["lib/api.ts:140-147", "lib/api.ts:108-112"]}
    - id: OP-A1e
      name: "login(username, password)"
      boundary: "POST /api/backend/auth/login"
      contract_owner: backend
      side_effects: ["Set-Cookie 経由のセッション発行（BFF が中継）"]
      failures: [ApiError]
      evidence: {status: confirmed, sources: ["lib/api.ts:312-317", "app/api/backend/[...path]/route.ts:110-121"]}
    - id: OP-A1f
      name: "getMe()"
      caller: "AuthContext.refreshMe"
      boundary: "GET /api/backend/auth/me"
      contract_owner: backend
      failures: ["401 → AuthContext は全 error を unauthenticated へ畳む（contexts/AuthContext.tsx:59-63）"]
      evidence: {status: confirmed, sources: ["lib/api.ts:338-340"]}
    - id: OP-A1g
      name: "deleteAccount(currentPassword)"
      boundary: "DELETE /api/backend/auth/me"
      contract_owner: backend
      expected_result: "204 → undefined"
      side_effects: ["不可逆なアカウント削除"]
      failures: [ApiError]
      evidence: {status: confirmed, sources: ["lib/api.ts:361-366", "lib/api.ts:115-119"]}
    - id: OP-A2
      name: "forward(req, pathSegments)（GET/POST/PUT/PATCH/DELETE）"
      caller: "同一 origin のブラウザ（OP-A1 経由）"
      boundary: "Next.js Route Handler → backend HTTP"
      contract_owner: "app/api/backend/[...path]/route.ts（BFF の API boundary owner）"
      initial_state: "process.env.BACKEND_BASE_URL / BACKEND_API_KEY"
      inputs: ["path segments", "query string", "Cookie", "X-CSRF-Token", body]
      expected_result: "backend 応答の status/body/Set-Cookie を中継"
      side_effects: ["backend への state 変更要求", "ブラウザへの Set-Cookie 中継"]
      failures: ["500（設定不備）", "502（到達不能）", "504（25s timeout / abort）"]
      evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:50-151"]}
    - id: OP-Q1
      name: "lib/playbackQueue.ts の全 export（current/upNext/start/setQueue/add/playNext/jump/advance/remove/reorderUpNext）"
      caller: "contexts/AudioPlayerContext.tsx:49-161"
      boundary: "純粋関数 module（副作用なし）"
      contract_owner: "docs/design/shared-playback-spec.md §2（意味の正本）／lib/playbackQueue.ts（実装の invariant owner）"
      inputs: ["QueueState", "Podcast", "index"]
      expected_result: "新しい QueueState（不変更新）"
      side_effects: []
      failures: ["範囲外 index は無変更で返す（reorderUpNext:99）"]
      evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:1-107", "docs/design/shared-playback-spec.md:201-232"]}
    - id: OP-P1
      name: "useAudioPlayer の load/play/pause/seek/seekRelative/setSpeed/setVolume と timeupdate/ended/error/loadedmetadata 由来の post-condition"
      caller: "contexts/AudioPlayerContext.tsx"
      boundary: "React hook → HTMLAudioElement + localStorage"
      contract_owner: "hooks/useAudioPlayer.ts（再生 session の state authority）"
      initial_state: "audioRef の単一 HTMLAudioElement、podcastIdRef、pendingResumeRef、lastSavedPositionRef"
      inputs: [url, resumePosition, podcastId, time, delta, speed, volume]
      expected_result: "{isPlaying,currentTime,duration,volume} の更新"
      side_effects: ["localStorage 位置/音量書込", "onPositionSave/onCompleted/onEnded/onError コールバック", "createObjectURL の revoke"]
      failures: ["audio error イベント → isPlaying=false のみ", "play() の Promise reject は呼出側へ素通し"]
      evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:92-267"]}
    - id: OP-C1
      name: "lib/audioCache.ts の downloadAudio/getCachedPodcast/getCachedAudioUrl/isCached/deleteAudio/deleteAllAudio/listCachedEpisodes/estimateUsage"
      caller: "設定画面・AudioPlayerContext.playById・AuthContext.logout"
      boundary: "Cache Storage ('audio-v1') + fetch + createApiClient"
      contract_owner: "lib/audioCache.ts（audio-v1 名前空間の source of truth）"
      side_effects: ["Cache Storage への put/delete", "blob URL 発行（解放責務は外部）"]
      failures: ["Cache Storage 非対応 → downloadAudio は throw、読み系は null/[]/false"]
      evidence: {status: confirmed, sources: ["lib/audioCache.ts:59-150"]}
    - id: OP-X1
      name: "resolvePlaybackSource({hasCached,isOnline})"
      boundary: "純粋関数"
      contract_owner: "lib/resolvePlayback.ts（value semantic owner）"
      expected_result: "'cached' | 'network' | 'unavailable'（全域関数）"
      side_effects: []
      failures: []
      evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:22-27"]}
    - id: OP-X2
      name: "resolveResumePosition(serverSeconds, localSeconds)"
      boundary: "純粋関数"
      contract_owner: "lib/playbackPosition.ts（value semantic owner）"
      expected_result: ">= 0 の秒数"
      side_effects: []
      failures: []
      evidence: {status: confirmed, sources: ["lib/playbackPosition.ts:25-38"]}
    - id: OP-S1
      name: "clearManagedServiceWorkerCaches()"
      caller: "contexts/AuthContext.tsx:92-101（logout）"
      boundary: "Cache Storage（'shell-*' / 'api-*' prefix）"
      contract_owner: "lib/swCacheCleanup.ts（cleanup の operational owner）"
      side_effects: ["prefix 一致 cache の全削除"]
      failures: ["caches 未定義環境では no-op"]
      evidence: {status: confirmed, sources: ["lib/swCacheCleanup.ts:16-24"]}
    - id: OP-S2
      name: "public/sw.js の networkFirst / cacheFirst / activate"
      caller: "ブラウザの fetch/activate イベント"
      boundary: "Service Worker → Cache Storage"
      contract_owner: "public/sw.js（shell-*/api-* 名前空間の source of truth）"
      side_effects: ["認証済み応答を含む GET /api/backend/podcasts の Cache Storage 格納"]
      failures: ["network 失敗時に cache へフォールバック、無ければ rethrow"]
      evidence: {status: confirmed, sources: ["public/sw.js:26-90"]}

  contract_items:
    # ---- OP-A1 request<T>() ----
    - {id: CI-A01, operation_id: OP-A1, requirement_ids: [R4], domain_obligation_ids: [], kind: failure_guarantee, statement: "送信失敗（fetch reject）は transport 値ではなく失敗の意味として表現され、消費者は数値 status を比較せずに network/4xx/5xx/rate-limited を判別できる。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: contract_owner, authoritative_owner: "lib/api.ts（ApiError の意味の所有者）", defensive_validations: {status: not_applicable, rationale: "入口 validation ではなく出口の failure 表現の問題であり、防御的検証で代替できない。"}, evidence: {status: confirmed, sources: ["lib/api.ts:84-86", "lib/api.ts:47-57"]}, finding: "ApiError(0,'Network error') は HTTP status を名乗る field に非 HTTP の番兵値 0 を入れており、21 ファイル 60 箇所の消費者が status===0 という transport 語彙で分岐せざるを得ない。"}
    - {id: CI-A02, operation_id: OP-A1, requirement_ids: [R4], kind: postcondition, statement: "429 等でサーバが Retry-After を提示した場合、ApiError.retryAfterSeconds に秒数が載る。", applicability: {status: required}, implementation_compliance: partially_met, contract_level: api, authority_type: contract_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: present, entries: [{location: "lib/api.ts:111", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["lib/api.ts:108-112"]}, finding: "RFC 9110 が許す HTTP-date 形式の Retry-After は /^\\d+$/ に一致せず無言で undefined になる。UI は「次回可能時刻」を表示できないが失敗の区別はつかない。"}
    - {id: CI-A03, operation_id: OP-A1, requirement_ids: [R4], kind: environment_condition, statement: "クライアント側 request は有限の deadline を持ち、backend 無応答時に呼出側の Promise が無期限に未解決のまま残らない。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: operational_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: not_applicable, rationale: "deadline は入力検証ではなく呼出の環境条件。"}, evidence: {status: confirmed, sources: ["lib/api.ts:80-86（signal 指定なし）", "app/api/backend/[...path]/route.ts:94（BFF 側のみ 25s）"]}, finding: "BFF は 25s で打ち切るが、BFF 到達前のネットワーク断ではブラウザ既定タイムアウトに委ねられ契約が無い。"}
    - {id: CI-A04, operation_id: OP-A1, requirement_ids: [R2, R4], kind: postcondition, statement: "204 No Content を返す操作の戻り値型は「値が無い」ことを型で表現し、呼出側が存在しない値を参照できない。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: contract_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: not_applicable, rationale: "型健全性の問題であり実行時検証では回復できない。"}, evidence: {status: confirmed, sources: ["lib/api.ts:115-119"]}, finding: "`return undefined as T` は任意の T へ undefined を注入する unsound cast。request<Podcast>() が 204 を受ければ型上 Podcast だが実体は undefined。"}
    - {id: CI-A05, operation_id: OP-A1, requirement_ids: [R4], kind: precondition, statement: "GET/HEAD/OPTIONS 以外の method では、csrf_token cookie が存在し init.headers に明示指定が無い場合に X-CSRF-Token を付与する。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: contract_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: present, entries: [{location: "lib/api.ts:72-78", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["lib/api.ts:69-78"]}}
    - {id: CI-A06, operation_id: OP-A1, requirement_ids: [R4], kind: postcondition, statement: "全 request は credentials:'include' で同一 origin BFF とセッション Cookie を往復させる。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: contract_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: not_applicable, rationale: "固定値であり検証対象の入力が無い。"}, evidence: {status: confirmed, sources: ["lib/api.ts:82-83"]}}
    - {id: CI-A07, operation_id: OP-A1, requirement_ids: [R4], kind: postcondition, statement: "非 2xx 応答の detail は string 形式と FastAPI validation 配列形式の双方から人間可読文言へ正規化され、'Value error, ' prefix は剥がされる。非 JSON body では 'Unknown error' になる。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: semantic_owner, authoritative_owner: "lib/api.ts", defensive_validations: {status: present, entries: [{location: "lib/api.ts:105-107", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["lib/api.ts:88-107"]}}
    # ---- OP-A1b/c/d/e/f/g ----
    - {id: CI-A10, operation_id: OP-A1b, requirement_ids: [R3], kind: invariant, statement: "同一 podcast への複数の位置更新は、サーバ上で発行順に適用される（後発の古い位置が新しい位置を上書きしない）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: state_authority, authoritative_owner: "contexts/AudioPlayerContext.tsx（呼出順の use case 所有者）。永続 state の source of truth は backend だが順序保証を web が backend へ委譲した Evidence は無い。", defensive_validations: {status: not_applicable, rationale: "順序は単一 request の入力検証で守れない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:121-129", "lib/api.ts:174-181"]}, finding: "throttle 保存は fire-and-forget で、並行 PATCH に sequence number も version も無い。"}
    - {id: CI-A11, operation_id: OP-A1b, requirement_ids: [R2, R3], kind: failure_guarantee, statement: "完聴時の position=0 保存は、それ以前に発行された位置保存より後にサーバへ反映される（完聴後に古い再生位置が復活しない）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: transition_owner, authoritative_owner: "contexts/AudioPlayerContext.tsx", defensive_validations: {status: not_applicable, rationale: "同上。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:132-142"]}, finding: "ended 直前の timeupdate 保存（t≒duration）が in-flight のまま position=0 が送られると、到着順次第で「完聴したのに末尾から再開」になる。CI-A10 と同根だが観測結果が異なるため独立 item にした。"}
    - {id: CI-A12, operation_id: OP-A1c, requirement_ids: [R2], kind: duplicate, statement: "同一 podcast の完聴イベントは、ended が複数回発火しても重複して送信されない（または重複送信が下流指標を二重計上しない）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: transition_owner, authoritative_owner: "hooks/useAudioPlayer.ts（ended → onCompleted の発火所有者）", defensive_validations: {status: not_applicable, rationale: "client に重複抑止が存在しない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:132-146"]}, finding: "handleEnded に「この podcast で既に completed を出した」という記録が無く、同一エピソードを再生し直して最後まで聴けば再送される。backend の first-write-wins（ADR-075 決定3）に依存しているが、その依存は web 側のコメントにもテストにも書かれていない。"}
    - {id: CI-A13, operation_id: OP-A1c, requirement_ids: [R2], kind: postcondition, statement: "ended 時のコールバック順序は onCompleted → savePosition(0) → onPositionSave(0) → currentTime=0 → onEnded である（ADR-075 決定3）。", applicability: {status: required}, implementation_compliance: met, contract_level: use_case, authority_type: transition_owner, authoritative_owner: "hooks/useAudioPlayer.ts", defensive_validations: {status: not_applicable, rationale: "順序は実装構造で保証され入力検証の対象でない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:132-146"]}}
    - {id: CI-A14, operation_id: OP-A1d, requirement_ids: [R1], kind: duplicate, statement: "同一 article への重複 star POST が生成 quota を二重消費しない。", applicability: {status: unknown, rationale: "quota 消費の source of truth は backend にあり、重複 POST の扱い（no-op か再消費か）を web 側コードからも docs/adr からも確認できなかった。ブリーフ out_of_scope に backend 契約妥当性が含まれる。", confirmation_method: "backend の POST /articles/{id}/star ハンドラで既 star 時の quota 消費有無を確認する、または ADR で明文化する", impact_if_unresolved: "一括 star の部分失敗時再試行（app/(app)/feed/page.tsx:350-400）が quota を無駄に消費するか否かを判定できず、CI-A27 の ambiguous outcome と合わせて再試行方針を決められない。"}, contract_level: api, authority_type: unknown, authoritative_owner: unknown, defensive_validations: {status: unknown, rationale: "web 側に重複抑止は無い（lib/api.ts:140-147）が、それが正しいかは backend 契約に依存する。"}, evidence: {status: unknown, sources: ["lib/api.ts:140-147"]}}
    - {id: CI-A15, operation_id: OP-A1g, requirement_ids: [R1], kind: precondition, statement: "退会は現在のパスワードを伴わなければ実行できない。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: contract_owner, authoritative_owner: "backend（認証判定の所有者）。lib/api.ts:361-366 は必須引数として型で前提を表明する defensive な入口。", defensive_validations: {status: present, entries: [{location: "lib/api.ts:361", purpose: early_feedback}]}, evidence: {status: confirmed, sources: ["lib/api.ts:361-366"]}}
    - {id: CI-A16, operation_id: OP-A1g, requirement_ids: [R1], kind: idempotency, statement: "退会が timeout/502/504 で結果不明になった場合の再実行方針（安全に再試行可能か、不可逆点はどこか）。", applicability: {status: unknown, rationale: "deleteAccount は不可逆な副作用を持つが、web 側に再試行も結果確認導線も無く、backend の削除が同期か非同期かを Evidence から判定できない。", confirmation_method: "backend の DELETE /auth/me の削除トランザクション境界と、削除済みアカウントへの再 DELETE の応答（404/401/204）を確認する", impact_if_unresolved: "504 後に利用者が退会ボタンを再押下したときの表示（成功扱い / エラー扱い）を契約として決められない。"}, contract_level: use_case, authority_type: unknown, authoritative_owner: unknown, defensive_validations: {status: not_applicable, rationale: "不可逆点の所在が未確定のため防御位置を決められない。"}, evidence: {status: unknown, sources: ["lib/api.ts:361-366", "app/api/backend/[...path]/route.ts:96-101"]}}
    # ---- OP-A2 forward() ----
    - {id: CI-A20, operation_id: OP-A2, requirement_ids: [R4], kind: precondition, statement: "BACKEND_API_KEY が未設定のとき、BFF は backend へ要求を転送してはならない（fail-closed）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: contract_owner, authoritative_owner: "app/api/backend/[...path]/route.ts", defensive_validations: {status: not_applicable, rationale: "分岐は存在するが「欠落なら続行」であり検証になっていない。"}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:66-72"]}, finding: "`if (apiKey)` は key 欠落を無認証転送へフォールバックさせる fail-open。BACKEND_BASE_URL 欠落は 500 で止まるのに、API key 欠落は止まらないという非対称。"}
    - {id: CI-A21, operation_id: OP-A2, requirement_ids: [R4], kind: postcondition, statement: "利用者へ返す失敗応答は、サーバ内部の環境変数名・設定項目名を含まない。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: contract_owner, authoritative_owner: "app/api/backend/[...path]/route.ts", defensive_validations: {status: not_applicable, rationale: "出力側の情報衛生であり入力検証で代替できない。"}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:53-58"]}, finding: "'Server misconfiguration: BACKEND_BASE_URL is not set' が匿名利用者へ返る。agent-rules/12-security-guidelines の「エラーに内部詳細を含めない」と衝突。"}
    - {id: CI-A22, operation_id: OP-A2, requirement_ids: [R4], kind: precondition, statement: "転送先 URL は BACKEND_BASE_URL の path 配下から脱出しない（catch-all segment による traversal・絶対 URL 化を拒否する）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: invariant_owner, authoritative_owner: "app/api/backend/[...path]/route.ts:24-41（getBackendUrl）", defensive_validations: {status: present, entries: [{location: "app/api/backend/[...path]/route.ts:28-36", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:39-40", "app/api/backend/[...path]/route.ts:63"]}, finding: "scheme 検証はあるが segment 検証が無い。pathSegments は join('/') され文字列連結されるだけで、'..' や encode された traversal を排除する検証が存在しない。SSRF 緩和の意図（:5-7）に対して防御が scheme のみで不完全。"}
    - {id: CI-A23, operation_id: OP-A2, requirement_ids: [R4], kind: environment_condition, statement: "backend fetch は 25 秒で打ち切られ、その値は Function の maxDuration(30s) より短い。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: operational_owner, authoritative_owner: "app/api/backend/[...path]/route.ts:15,94", defensive_validations: {status: not_applicable, rationale: "定数であり検証対象の入力が無い。"}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:12-15,92-95"]}}
    - {id: CI-A24, operation_id: OP-A2, requirement_ids: [R4], kind: failure_guarantee, statement: "TimeoutError/AbortError は 504、その他の fetch reject は 502 として区別され、backend が応答した場合は status/body をそのまま中継する。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: failure_recovery_owner, authoritative_owner: "app/api/backend/[...path]/route.ts:46-48,96-108", defensive_validations: {status: present, entries: [{location: "app/api/backend/[...path]/route.ts:46-48", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:43-48,96-108"]}}
    - {id: CI-A25, operation_id: OP-A2, requirement_ids: [R4], kind: postcondition, statement: "backend の Set-Cookie は getSetCookie() を優先して全件ブラウザへ中継される（単一ヘッダ結合による欠落を起こさない）。", applicability: {status: required}, implementation_compliance: met, contract_level: api, authority_type: contract_owner, authoritative_owner: "app/api/backend/[...path]/route.ts:110-121", defensive_validations: {status: present, entries: [{location: "app/api/backend/[...path]/route.ts:113-118", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:110-121"]}}
    - {id: CI-A26, operation_id: OP-A2, requirement_ids: [R4], kind: postcondition, statement: "中継応答の Content-Type は backend の応答が表明した media type を保つ。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: contract_owner, authoritative_owner: "app/api/backend/[...path]/route.ts:105-108", defensive_validations: {status: not_applicable, rationale: "上書きそのものが問題であり検証では回復しない。"}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:105-108", "app/api/backend/[...path]/route.ts:67-69"]}, finding: "応答も要求も無条件に application/json へ固定される。非 JSON（CSV エクスポート・バイナリ・text/plain のエラー）を backend が返した瞬間、ブラウザは嘘の media type を受け取る。現時点で非 JSON endpoint は確認できていないが、契約としては backend 側の自由度を BFF が無言で奪っている。"}
    - {id: CI-A27, operation_id: OP-A2, requirement_ids: [R4], kind: idempotency, statement: "25 秒 timeout で 504 を返した非冪等要求（POST/PATCH/DELETE）について、backend 側が処理を完了したか否かを呼出側が判定できる。", applicability: {status: required}, implementation_compliance: unmet, contract_level: api, authority_type: failure_recovery_owner, authoritative_owner: "app/api/backend/[...path]/route.ts（打ち切りの発生源）", defensive_validations: {status: not_applicable, rationale: "結果不明性は検証では解消しない。"}, evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:92-101"]}, finding: "AbortSignal.timeout は BFF→backend の接続だけを切り、backend 側の処理は続行しうる。504 を受けた client（starArticle の一括再試行・deleteAccount）は「未実行」と区別できない。冪等キーも要求 ID も無い。"}
    # ---- OP-Q1 playbackQueue ----
    - {id: CI-Q01, operation_id: OP-Q1, requirement_ids: [R2, R7], domain_obligation_ids: [OB-C4], kind: invariant, statement: "QueueState は currentIndex ∈ {null} ∪ [0, items.length-1] を構築時点で保証する。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: invariant_owner, authoritative_owner: "lib/playbackQueue.ts（QueueState の invariant 所有者）", defensive_validations: {status: not_applicable, rationale: "公開 interface が素の object literal を受理するため検証点が存在しない。"}, evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:7-12"]}, finding: "QueueState は readonly field を持つ素の interface で、smart constructor が無い。呼出側は {items:[a], currentIndex: 7} を型検査を通して構築でき、current() が null を返す（:18-21）ことでしか気づけない。各関数は invariant を維持するが、確立はしない。"}
    - {id: CI-Q02, operation_id: OP-Q1, requirement_ids: [R2], kind: precondition, statement: "setQueue(items, startAt) の startAt は有限の整数である。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: invariant_owner, authoritative_owner: "lib/playbackQueue.ts:35-38", defensive_validations: {status: present, entries: [{location: "lib/playbackQueue.ts:37", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:35-38", "docs/design/shared-playback-spec.md:205-207"]}, finding: "Math.max(0, Math.min(startAt, len-1)) は負値・過大値を仕様通り clamp する（Q-05/Q-06）が、NaN は NaN のまま通過し currentIndex=NaN の QueueState を生む。spec §4.1 に NaN 行が無く、テストも無い。"}
    - {id: CI-Q03, operation_id: OP-Q1, requirement_ids: [R7], kind: postcondition, statement: "current/upNext/start/setQueue/add/playNext/jump/advance/remove/moveUpNext の結果は docs/design/shared-playback-spec.md §4.1 の Q-01〜Q-32 と一致する。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: semantic_owner, authoritative_owner: "docs/design/shared-playback-spec.md §2（意味の正本）", defensive_validations: {status: not_applicable, rationale: "純粋関数の結果一致であり入口検証の対象でない。"}, evidence: {status: confirmed, sources: ["docs/design/shared-playback-spec.md:201-232", "tests/lib/playbackQueue.conformance.test.ts:9-23"]}, note: "conformance テストの `reorderUpNext as moveUpNext` alias（tests/lib/playbackQueue.conformance.test.ts:22）は退化 oracle ではない。spec の moveUpNext は「削除前オフセット」方式（SwiftUI onMove 規約）と定義され（docs/design/shared-playback-spec.md:226-232 の ⚠ 行）、実装 lib/playbackQueue.ts:103 の `insertAt = toIndex - (fromIndex < toIndex ? 1 : 0)` はまさにその方式である。アダプタを挟まないことは意味の同一性を前提とした意図的判断としてファイル冒頭 :4-8 に記録されている。"}
    - {id: CI-Q04, operation_id: OP-Q1, requirement_ids: [R2], kind: invariant, statement: "キュー内に同一 Podcast id が二つ以上存在しない（add は重複を無視し、playNext は既存重複を除去してから挿入する）。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: invariant_owner, authoritative_owner: "lib/playbackQueue.ts:41-57", defensive_validations: {status: present, entries: [{location: "lib/playbackQueue.ts:42", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:41-57", "docs/design/shared-playback-spec.md:209,211"]}}
    - {id: CI-Q05, operation_id: OP-Q1, requirement_ids: [R2], kind: idempotency, statement: "（検討したが該当しない）キュー操作に重複実行の抑止機構は不要である。", applicability: {status: not_applicable, rationale: "OP-Q1 の全 export は副作用を持たない純粋関数で、外部 state を変更せず新しい QueueState を返す（lib/playbackQueue.ts:1-107 に fetch/storage/Date/Math.random の呼出が無い）。同じ入力から同じ出力を返す deterministic 性は mutation idempotency とは別概念であり、dedup key や実行記録を設けると存在しない副作用を前提にした機構になる。"}, contract_level: not_applicable, authority_type: not_applicable, authoritative_owner: not_applicable, defensive_validations: {status: not_applicable, rationale: "同上。"}, evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:1-107"]}}
    # ---- OP-P1 useAudioPlayer ----
    - {id: CI-P01, operation_id: OP-P1, requirement_ids: [R2], domain_obligation_ids: [OB-C3], kind: invariant, statement: "再生状態は idle / playing / paused / errored / ended を公開経路から区別できる（error は pause と等価でない）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: state_authority, authoritative_owner: "hooks/useAudioPlayer.ts（再生 session の state authority）", defensive_validations: {status: not_applicable, rationale: "状態表現の欠落であり入口検証では作れない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:25-30", "hooks/useAudioPlayer.ts:148-151", "hooks/useAudioPlayer.ts:132-134"]}, finding: "公開 state は isPlaying/currentTime/duration/volume の 4 atom で status union が無い。error も ended も pause も等しく isPlaying=false に潰れるため、UI は「止まった理由」を再生バーから復元できない。"}
    - {id: CI-P02, operation_id: OP-P1, requirement_ids: [R2], kind: failure_guarantee, statement: "audio 要素の error イベント後、isPlaying は false になり onError が一度呼ばれる。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: failure_recovery_owner, authoritative_owner: "hooks/useAudioPlayer.ts:148-151", defensive_validations: {status: not_applicable, rationale: "イベント駆動であり入力検証の対象でない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:148-151"]}}
    - {id: CI-P03, operation_id: OP-P1, requirement_ids: [R2], domain_obligation_ids: [OB-C14], kind: postcondition, statement: "load は、直前の src が blob: URL のときだけ revoke してから新しい src を設定する（署名付き URL は触らない）。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: operational_owner, authoritative_owner: "hooks/useAudioPlayer.ts:189-194", defensive_validations: {status: present, entries: [{location: "hooks/useAudioPlayer.ts:192", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:189-194"]}}
    - {id: CI-P04, operation_id: OP-P1, requirement_ids: [R2], kind: postcondition, statement: "unmount 時に pause・blob URL revoke・4 リスナ解除がすべて実行される。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: operational_owner, authoritative_owner: "hooks/useAudioPlayer.ts:166-178", defensive_validations: {status: not_applicable, rationale: "cleanup であり入力検証の対象でない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:166-178"]}}
    - {id: CI-P05, operation_id: OP-P1, requirement_ids: [R2, R3], kind: postcondition, statement: "load(url, resumePosition, podcastId) の完了後、再生開始位置は resumePosition と一致する（resumePosition が duration 以上の場合のみ 0）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: state_authority, authoritative_owner: "hooks/useAudioPlayer.ts:181-210", defensive_validations: {status: present, entries: [{location: "hooks/useAudioPlayer.ts:155-158", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:205-207", "hooks/useAudioPlayer.ts:153-159"]}, finding: "audio.currentTime = resumePosition は src 設定直後（:206）、すなわち loadedmetadata 前に実行される。この時点では seekable range が空で、多くのブラウザは代入を無視する。loadedmetadata ハンドラ（:153-159）は pendingResumeRef を「duration 以上なら 0 に戻す」用途でしか使わず、無視された resumePosition を再適用しない。結果、レジューム位置が無言で 0 に落ちうる。CI-P01 と違い、これは公開 state だけを見ても検知できない。"}
    - {id: CI-P06, operation_id: OP-P1, requirement_ids: [R3], kind: postcondition, statement: "timeupdate では、前回保存位置から 10 秒以上進んだときにのみ localStorage 保存と onPositionSave が起き、lastSavedPosition が更新される。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: state_authority, authoritative_owner: "hooks/useAudioPlayer.ts:116-130", defensive_validations: {status: not_applicable, rationale: "throttle であり検証でない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:9-10,116-130"]}, note: "位置ベース throttle のため巻き戻し（seek 後退）では t - lastSaved が負になり保存されない。仕様として意図的かは docs に記述が無いが、観測可能な挙動としては CI-P08 の seek 契約と併せて確認すべき。"}
    - {id: CI-P07, operation_id: OP-P1, requirement_ids: [R2], kind: postcondition, statement: "CI-A13 と同一順序が hook 内部でも観測できる（onCompleted が savePosition(0) より前）。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: transition_owner, authoritative_owner: "hooks/useAudioPlayer.ts:132-146", defensive_validations: {status: not_applicable, rationale: "順序保証であり検証でない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:134-141"]}}
    - {id: CI-P08, operation_id: OP-P1, requirement_ids: [R2], kind: precondition, statement: "seek(time) の time は [0, duration] に収まる（範囲外は clamp される）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: invariant_owner, authoritative_owner: "hooks/useAudioPlayer.ts:224-228", defensive_validations: {status: not_applicable, rationale: "seek には検証が存在しない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:224-228", "hooks/useAudioPlayer.ts:230-235"]}, finding: "seekRelative は Math.max(0, Math.min(..., duration||0)) で clamp するのに、同じ hook の seek は audio.currentTime へ素通しし setCurrentTime も未 clamp 値で更新する。同一概念に二つの異なる契約が同居している。"}
    - {id: CI-P09, operation_id: OP-P1, requirement_ids: [R2], kind: environment_condition, statement: "play() は autoplay policy・メディアデコード失敗により reject しうる。その場合の公開状態と呼出側の義務が定義されている。", applicability: {status: required}, implementation_compliance: unmet, contract_level: aggregate, authority_type: failure_recovery_owner, authoritative_owner: "hooks/useAudioPlayer.ts:212-216", defensive_validations: {status: not_applicable, rationale: "環境由来の reject であり入力検証で防げない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:212-216"]}, finding: "`await audio.play(); setIsPlaying(true)` は reject を素通しし、Promise<void> を返すだけで失敗契約を宣言しない。呼出側が await せずに呼べば unhandled rejection になり、UI 上は CI-P01 の欠落により「停止」と区別がつかない。"}
    - {id: CI-P10, operation_id: OP-P1, requirement_ids: [R2], domain_obligation_ids: [OB-C3], kind: idempotency, statement: "play() の重複呼出が単一の再生状態へ収束する。", applicability: {status: unknown, rationale: "HTMLMediaElement.play() の連続呼出は仕様上 pending な play promise を共有しうるが、CI-P01 の状態表現が欠落しているため「収束したか」を公開経路から観測できず、適用要否を Evidence から判定できない。", confirmation_method: "CI-P01 の status union 導入後に、fake HTMLAudioElement を注入して play() 二回呼出後の公開状態を観測する（tests/hooks/useAudioPlayer.test.ts:98 の describe を拡張）", impact_if_unresolved: "重複再生要求（UI 連打・auto-advance と手動再生の競合）で isPlaying が実体と乖離しても検知できない。"}, contract_level: aggregate, authority_type: unknown, authoritative_owner: unknown, defensive_validations: {status: not_applicable, rationale: "観測手段が無く防御位置も決められない。"}, evidence: {status: unknown, sources: ["hooks/useAudioPlayer.ts:212-216"]}}
    - {id: CI-P11, operation_id: OP-P1, requirement_ids: [R3], kind: postcondition, statement: "setVolume は [0,1] に clamp した値を audio・state・localStorage の三者へ同時反映する。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: state_authority, authoritative_owner: "hooks/useAudioPlayer.ts:242-252", defensive_validations: {status: present, entries: [{location: "hooks/useAudioPlayer.ts:243", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:242-252", "hooks/useAudioPlayer.ts:42-52"]}}
    - {id: CI-P12, operation_id: OP-P1, requirement_ids: [R3], domain_obligation_ids: [OB-C9, OB-C12], kind: invariant, statement: "再生速度の正本は一箇所であり、全 writer が PLAYBACK_SPEEDS の値のみを受理して同一経路で永続化する。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: source_of_truth, authoritative_owner: "未確定。architecture-strategy-package.md 不在のため authority 表を参照できず、OB-N3 として router へ返す。", defensive_validations: {status: not_applicable, rationale: "正本が未確定のため防御位置を決められない。"}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:237-240", "hooks/useAudioPlayer.ts:7", "contexts/AppContext.tsx:15", "components/AudioPlayerBar.tsx:24-26"]}, finding: "setSpeed は audio.playbackRate を書くだけで state を持たず（:237-240）、値域チェックも無い。一方 AppContext.playbackSpeed が別に存在し、AudioPlayerBar:24-26 が eslint-disable 付き effect で両者を同期している。同期 effect の存在自体が正本不在の証拠。"}
    - {id: CI-P13, operation_id: OP-P1, requirement_ids: [R3], kind: environment_condition, statement: "localStorage の読み書き失敗（private browsing・quota 超過）は再生を止めず、位置は 0、音量は 1.0 へ正規化される。", applicability: {status: required}, implementation_compliance: met, contract_level: aggregate, authority_type: operational_owner, authoritative_owner: "hooks/useAudioPlayer.ts:42-75,247-251", defensive_validations: {status: present, entries: [{location: "hooks/useAudioPlayer.ts:46-51", purpose: malformed_input}, {location: "hooks/useAudioPlayer.ts:62-66", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:42-75", "hooks/useAudioPlayer.ts:247-251"]}}
    # ---- OP-C1 audioCache ----
    - {id: CI-C01, operation_id: OP-C1, requirement_ids: [R2, R4], domain_obligation_ids: [OB-C11], kind: precondition, statement: "downloadAudio は fetch 応答が成功（response.ok）であることを確認してからのみ Cache Storage へ格納する。", applicability: {status: required}, implementation_compliance: unmet, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "lib/audioCache.ts:64-85", defensive_validations: {status: not_applicable, rationale: "検証が存在しない。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:68-71"]}, finding: "`const response = await fetch(podcast.audio_url); await cache.put(audioKey(id), response)` の間に ok 判定が無い。署名 URL 期限切れの 403 XML body が「オフライン保存済み音声」として永続化され、isCached() は true を返し、再生時に初めて壊れる。同 module の sw.js 側（public/sw.js:44,54）は ok を確認しており、契約が不揃い。"}
    - {id: CI-C02, operation_id: OP-C1, requirement_ids: [R2], domain_obligation_ids: [OB-C10, OB-C11], kind: postcondition, statement: "getCachedPodcast は「再生可能な audio_url を持つ Podcast」か null のいずれかを返す。", applicability: {status: required}, implementation_compliance: unmet, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "lib/audioCache.ts:88-94", defensive_validations: {status: not_applicable, rationale: "読み出し時の検証も無い。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:80-84", "lib/audioCache.ts:88-94"]}, finding: "downloadAudio が audio_url:'' で永続化する（:83、期限切れ署名 URL を残さない防御）ため、getCachedPodcast は型上 Podcast でありながら再生不能な値を返す。呼出側 AudioPlayerContext が blob URL で必ず上書きするという暗黙の前提に依存しており、その前提は型にも契約にも現れていない。防御が別の invariant を壊している。"}
    - {id: CI-C03, operation_id: OP-C1, requirement_ids: [R2], domain_obligation_ids: [OB-C14], kind: postcondition, statement: "getCachedAudioUrl が発行した blob: URL は、再生に使われなかった経路を含めて必ず revoke される。", applicability: {status: required}, implementation_compliance: unmet, contract_level: repository, authority_type: operational_owner, authoritative_owner: "lib/audioCache.ts:97-104（発行者）。解放は hooks/useAudioPlayer.ts:171-173,192-194 にあり、所有が分離している。", defensive_validations: {status: not_applicable, rationale: "資源所有の分離であり検証では解決しない。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:97-104", "hooks/useAudioPlayer.ts:171-173,192-194", "contexts/AudioPlayerContext.tsx:106-108"]}, finding: "発行者（audioCache）と解放者（useAudioPlayer）が別 module。URL を作ったが load() に渡さずに終わる経路（getCachedPodcast が null を返す等）では、誰も revoke せず blob がタブ生存中リークする。"}
    - {id: CI-C04, operation_id: OP-C1, requirement_ids: [R2], kind: failure_guarantee, statement: "listCachedEpisodes は、列挙中に対象 entry が削除されても例外を投げずに列挙可能な分を返す。", applicability: {status: required}, implementation_compliance: unmet, contract_level: repository, authority_type: failure_recovery_owner, authoritative_owner: "lib/audioCache.ts:128-141", defensive_validations: {status: not_applicable, rationale: "非 null 断言が検証を明示的に放棄している。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:131-139"]}, finding: "cache.keys() で列挙したキーを cache.match() で引き直す間に deleteAudio が走ると response は undefined になるが、`response!.json()` の非 null 断言が TypeError を投げ、設定画面の一覧が丸ごと落ちる。"}
    - {id: CI-C05, operation_id: OP-C1, requirement_ids: [R2], kind: idempotency, statement: "同一 podcastId への downloadAudio の重複実行は単一の cache entry 集合へ収束する。", applicability: {status: required}, implementation_compliance: partially_met, contract_level: repository, authority_type: source_of_truth, authoritative_owner: "lib/audioCache.ts:25-41（audioKey/metaKey/podcastKey が自然キー）", defensive_validations: {status: not_applicable, rationale: "重複実行の抑止は存在しない。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:25-41,64-85"]}, mechanism_note: "冪等キーは新規に発明していない。既存の `/_audio/{id}` `/_audio-meta/{id}` `/_audio-podcast/{id}` という安定 path が実質の自然キーであり、cache.put は同キーを上書きするため最終状態は収束する。ただし 3 回の put が非原子で（:71,78,84）、途中失敗すると audio だけ存在し meta/podcast が古い/欠落した部分状態が残る。isCached() は audio key のみを見る（:106-111）ため、この部分状態を「保存済み」と報告する。"}
    - {id: CI-C06, operation_id: OP-C1, requirement_ids: [R2], kind: postcondition, statement: "deleteAudio は audio / meta / podcast の 3 キーをすべて削除する。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "lib/audioCache.ts:113-119", defensive_validations: {status: not_applicable, rationale: "削除操作に検証対象入力が無い。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:113-119"]}}
    - {id: CI-C07, operation_id: OP-C1, requirement_ids: [R2], kind: environment_condition, statement: "Cache Storage 非対応環境では読み系（getCachedPodcast/getCachedAudioUrl/isCached/listCachedEpisodes）が null/[]/false を返し、downloadAudio は利用者向け文言で throw する。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: operational_owner, authoritative_owner: "lib/audioCache.ts:59-61", defensive_validations: {status: present, entries: [{location: "lib/audioCache.ts:59-61", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:54-61,65-67,89,98,107,114,123,129"]}}
    - {id: CI-C08, operation_id: OP-C1, requirement_ids: [R6], kind: postcondition, statement: "deleteAllAudio は audio-v1 名前空間全体を削除する。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: operational_owner, authoritative_owner: "lib/audioCache.ts:122-125", defensive_validations: {status: not_applicable, rationale: "入力を取らない。"}, evidence: {status: confirmed, sources: ["lib/audioCache.ts:121-125"]}}
    # ---- OP-X1 / OP-X2 ----
    - {id: CI-X01, operation_id: OP-X1, requirement_ids: [R4], kind: postcondition, statement: "resolvePlaybackSource は全域関数であり、任意の {hasCached,isOnline} に対して 'cached'|'network'|'unavailable' のいずれかを返す。キャッシュがあれば常に 'cached'。", applicability: {status: required}, implementation_compliance: met, contract_level: value_object, authority_type: semantic_owner, authoritative_owner: "lib/resolvePlayback.ts:22-27", defensive_validations: {status: not_applicable, rationale: "boolean 2 値の全域関数で不正入力が存在しない。"}, evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:16-27"]}}
    - {id: CI-X02, operation_id: OP-X1, requirement_ids: [R4], domain_obligation_ids: [OB-C6], kind: prohibited_transition, statement: "PlaybackSource が 'unavailable' のとき、呼出側はネットワーク取得（getPodcast）を実行してはならず、transport status を含まないオフライン固有の失敗を利用者へ返す。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: transition_owner, authoritative_owner: "contexts/AudioPlayerContext.tsx:100-120（PlaybackSource の消費者）。lib/resolvePlayback.ts は値の意味だけを所有し、遷移禁止は所有しない。", defensive_validations: {status: not_applicable, rationale: "呼出側の分岐欠落であり値側の検証では防げない。"}, evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:22-27", "contexts/AudioPlayerContext.tsx:100-108,115-120"]}, finding: "3 値を導入した意味が消費側で 2 値に潰れており、'unavailable' が 'network' と同じ経路を通る。純粋関数側は正しく、契約違反は消費側にある。"}
    - {id: CI-X03, operation_id: OP-X2, requirement_ids: [R3], kind: postcondition, statement: "resolveResumePosition は server>0 なら server、そうでなく local>0 なら local、いずれでもなければ 0 を返し、戻り値は常に 0 以上である。", applicability: {status: required}, implementation_compliance: met, contract_level: value_object, authority_type: semantic_owner, authoritative_owner: "lib/playbackPosition.ts:25-38", defensive_validations: {status: present, entries: [{location: "lib/playbackPosition.ts:27,32", purpose: malformed_input}]}, evidence: {status: confirmed, sources: ["lib/playbackPosition.ts:25-38"]}, note: "NaN 入力は `NaN > 0` が false のため 0 へ落ち、事後条件を破らない。"}
    # ---- OP-S1 / OP-S2 ----
    - {id: CI-S01, operation_id: OP-S1, requirement_ids: [R6], domain_obligation_ids: [OB-C1], kind: postcondition, statement: "認証主体が authenticated を離れる全遷移（明示 logout と、getMe 失敗によるセッション失効の双方）の事後に、'shell-*' / 'api-*' / 'audio-v1' に前主体の応答が残らない。", applicability: {status: required}, implementation_compliance: unmet, contract_level: use_case, authority_type: transition_owner, authoritative_owner: "contexts/AuthContext.tsx（認証主体の遷移所有者）", defensive_validations: {status: not_applicable, rationale: "遷移時の後処理欠落であり検証で代替できない。"}, evidence: {status: confirmed, sources: ["contexts/AuthContext.tsx:59-63", "contexts/AuthContext.tsx:92-101", "lib/swCacheCleanup.ts:16-24", "lib/audioCache.ts:122-125"]}, finding: "cache 掃除は logout ハンドラ（:92-101）にのみ結線されており、refreshMe の失敗で unauthenticated へ落ちる経路（:59-63）は掃除しない。「authenticated を離れる」という一つの遷移に二つの実装があり、片方だけが契約を守っている。"}
    - {id: CI-S02, operation_id: OP-S2, requirement_ids: [R6], kind: invariant, statement: "認証済み応答を格納する Cache Storage の key は、応答が属する認証主体を識別できる（別主体へ再利用されない）。", applicability: {status: required}, implementation_compliance: unmet, contract_level: repository, authority_type: source_of_truth, authoritative_owner: "public/sw.js:50-61（api-* 名前空間の所有者）", defensive_validations: {status: not_applicable, rationale: "key 設計の問題。"}, evidence: {status: confirmed, sources: ["public/sw.js:50-61", "public/sw.js:84-87"]}, finding: "networkFirst は cache.put(request.url, ...) で URL のみを key にする。GET /api/backend/podcasts はセッション Cookie に依存する主体固有の一覧だが、key にも Vary にも主体が現れない。CI-S01 の掃除漏れと合成すると、共有端末で前利用者の一覧が次の利用者にオフライン応答として返る経路が成立する。"}
    - {id: CI-S03, operation_id: OP-S1, requirement_ids: [R1, R6], domain_obligation_ids: [OB-C13], kind: environment_condition, statement: "SW 管理 cache の名前空間 prefix（'shell-' / 'api-'）は単一の source から sw.js と swCacheCleanup へ供給され、手動同期に依存しない。", applicability: {status: required}, implementation_compliance: unmet, contract_level: workflow, authority_type: source_of_truth, authoritative_owner: "未確定。ビルド時生成か定数ファイルかの選択は architecture-strategy-package.md の authority 表に属し、本 package では決めない（OB-N3）。", defensive_validations: {status: not_applicable, rationale: "定義の重複であり実行時検証の対象でない。"}, evidence: {status: confirmed, sources: ["public/sw.js:20-24", "lib/swCacheCleanup.ts:6-14,21"]}, finding: "両ファイルが「変更する際は両方を揃えること」とコメントで人間に依頼している。これは契約ではなく願望であり、片方だけ変えても型検査もテストも失敗しない。"}
    - {id: CI-S04, operation_id: OP-S2, requirement_ids: [R6], kind: postcondition, statement: "cacheFirst / networkFirst は response.ok のときにのみ cache.put する。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "public/sw.js:39-61", defensive_validations: {status: present, entries: [{location: "public/sw.js:44,54", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["public/sw.js:39-61"]}}
    - {id: CI-S05, operation_id: OP-S2, requirement_ids: [R6], kind: postcondition, statement: "activate は 'shell-'/'api-' prefix かつ CURRENT_CACHES に無い cache のみを削除し、'audio-*' を削除しない。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "public/sw.js:22-36", defensive_validations: {status: present, entries: [{location: "public/sw.js:22-24", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["public/sw.js:16-36"]}}
    - {id: CI-S06, operation_id: OP-S2, requirement_ids: [R6], kind: prohibited_transition, statement: "SW はクロスオリジン要求と /_audio/ /_audio-meta/ 要求を横取りしない（audio-v1 の単独管理を侵さない）。", applicability: {status: required}, implementation_compliance: met, contract_level: repository, authority_type: invariant_owner, authoritative_owner: "public/sw.js:63-72", defensive_validations: {status: present, entries: [{location: "public/sw.js:68,72", purpose: defense_in_depth}]}, evidence: {status: confirmed, sources: ["public/sw.js:63-90"]}}

  idempotency_assessments:
    - {operation_id: OP-A1b, applicability: required, rationale: "位置更新は throttle により同一 session 中に多数発行され、失敗時に再送されうる。同じ位置の再送は安全だが、順序が保証されないため『最後に適用された値』が最新とは限らない（CI-A10/CI-A11）。", evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:121-129,140-141"]}, contract_item_ids: [CI-A10, CI-A11], mechanism: {key_scope: "podcast_id", key_lifetime: "再生 session", duplicate_result: "同値再送は無害。異値の out-of-order 到着は最後着が勝つ。", fingerprint_rule: "未定義（version/sequence field が要求にも実装にも無い）", retry_rule: "未定義（fire-and-forget、再送しない）"}}
    - {operation_id: OP-A1c, applicability: required, rationale: "ended は同一エピソードで複数回発火しうる（再生し直し・ブラウザ差）。完聴イベントは学習指標へ波及する非冪等な副作用を持つ。", evidence: {status: confirmed, sources: ["hooks/useAudioPlayer.ts:132-146", "lib/api.ts:189-194"]}, contract_item_ids: [CI-A12], mechanism: {key_scope: "user_id + podcast_id", key_lifetime: "永続（完聴は一度きり）", duplicate_result: "ADR-075 決定3 の first-write-wins を backend が実装している前提だが、web 側にその依存を固定する契約もテストも無い。", fingerprint_rule: "not_applicable（自然キーで十分、fingerprint 不要）", retry_rule: "未定義"}}
    - {operation_id: OP-A1d, applicability: unknown, rationale: "CI-A14 参照。quota 消費の重複可否が backend 契約に依存し、本 review の scope 外で確認できない。", confirmation_method: "backend の star ハンドラで既 star 時の quota 消費有無を確認する", impact_if_unresolved: "一括 star の部分失敗再試行方針を契約として決められない。", evidence: {status: unknown, sources: ["lib/api.ts:140-147"]}, contract_item_ids: [CI-A14]}
    - {operation_id: OP-A1g, applicability: unknown, rationale: "CI-A16 参照。不可逆操作の結果不明時の再実行可否が未確定。", confirmation_method: "削除済みアカウントへの再 DELETE の応答を確認する", impact_if_unresolved: "504 後の UI 表示を決められない。", evidence: {status: unknown, sources: ["lib/api.ts:361-366"]}, contract_item_ids: [CI-A16]}
    - {operation_id: OP-A2, applicability: required, rationale: "25s timeout が非冪等 method（POST/PATCH/DELETE）に対して ambiguous outcome を生む。", evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:92-101"]}, contract_item_ids: [CI-A27], mechanism: {key_scope: "未定義（要求 ID も Idempotency-Key ヘッダも転送していない）", key_lifetime: "未定義", duplicate_result: "未定義", fingerprint_rule: "未定義", retry_rule: "BFF は再試行しない（fetch は一度だけ）。client 側の再試行方針も未定義。"}}
    - {operation_id: OP-Q1, applicability: not_applicable, rationale: "CI-Q05 参照。純粋関数であり mutation idempotency の対象となる副作用が存在しない。deterministic 性と混同しない。", evidence: {status: confirmed, sources: ["lib/playbackQueue.ts:1-107"]}, contract_item_ids: [CI-Q05]}
    - {operation_id: OP-X1, applicability: not_applicable, rationale: "boolean 2 値からの全域純粋関数で、外部 state も副作用も持たない（lib/resolvePlayback.ts:1-27 に I/O 呼出が無い）。dedup key を設ける対象が存在しない。", evidence: {status: confirmed, sources: ["lib/resolvePlayback.ts:1-27"]}, contract_item_ids: []}
    - {operation_id: OP-X2, applicability: not_applicable, rationale: "数値 2 引数からの純粋関数で副作用が無い（lib/playbackPosition.ts:1-38）。", evidence: {status: confirmed, sources: ["lib/playbackPosition.ts:1-38"]}, contract_item_ids: []}
    - {operation_id: OP-P1, applicability: unknown, rationale: "CI-P10 参照。play() の重複収束を観測する公開状態が存在しない。", confirmation_method: "CI-P01 導入後に fake audio で二重 play を観測する", impact_if_unresolved: "auto-advance と手動再生の競合時に state が実体と乖離しても検知できない。", evidence: {status: unknown, sources: ["hooks/useAudioPlayer.ts:212-216"]}, contract_item_ids: [CI-P10]}
    - {operation_id: OP-C1, applicability: required, rationale: "downloadAudio は Cache Storage を変更する副作用を持ち、利用者の連打・再試行で重複実行されうる。", evidence: {status: confirmed, sources: ["lib/audioCache.ts:64-85"]}, contract_item_ids: [CI-C05], mechanism: {key_scope: "podcast_id（既存の /_audio/{id} 等の path が自然キー。新規発明ではない）", key_lifetime: "cache entry の生存期間", duplicate_result: "最終状態は収束するが、3 回の put が非原子のため中断時に部分状態が残る（CI-C05 参照）。", fingerprint_rule: "not_applicable（自然キーで一意に定まる）", retry_rule: "未定義（呼出側 UI の再試行方針が docs に無い）"}}
    - {operation_id: OP-S1, applicability: required, rationale: "logout は失敗しても再実行されうる。", evidence: {status: confirmed, sources: ["lib/swCacheCleanup.ts:16-24"]}, contract_item_ids: [CI-S01], mechanism: {key_scope: "not_applicable（削除操作は本質的に冪等）", key_lifetime: not_applicable, duplicate_result: "二回目以降は該当 cache が無く no-op。caches.delete は存在しないキーでも reject しない。", fingerprint_rule: not_applicable, retry_rule: "安全に再試行可能"}}

  public_contract_changes:
    - {id: PCC1, contract_item_ids: [], applicability: not_applicable, not_applicable_reason: "review mode であり公開契約の変更を提案していない。CI-* の unmet は既存実装の契約違反の指摘であって、契約そのものの変更ではない。修正の設計・承認は router 経由で後続 gate が扱う。", evidence: {status: confirmed, sources: ["scratchpad/packages/t3a-contract-brief.md:20"]}}

  tests:
    # 既存テストのみを登録する。未実装の要求テストは obligation（OB-T*/OB-N*）として返し、planned として偽装しない。
    - {id: T1, operation_id: OP-A1, requirement_ids: [R4], verifies: [CI-A02], given: "429 応答に Retry-After: 30 が付く", when: "任意の API 関数を呼ぶ", then: ["ApiError.retryAfterSeconds === 30"], oracle: "throw された ApiError の field を assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/api.test.ts:61"], oracle_quality: "非退化（本番 request() を通る）"}
    - {id: T2, operation_id: OP-A1, requirement_ids: [R4], verifies: [CI-A05], given: "csrf_token cookie が存在する", when: "POST/PATCH/DELETE を発行する", then: ["fetch の headers に X-CSRF-Token が含まれる"], oracle: "fetch mock の第 2 引数 headers を assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/api.test.ts:467-476"], oracle_quality: "非退化"}
    - {id: T3, operation_id: OP-A1, requirement_ids: [R4], verifies: [CI-A06], given: "任意の API 呼出", when: "request が fetch を呼ぶ", then: ["credentials:'include' が渡る"], oracle: "fetch mock の init を assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/api.test.ts:92-102"], oracle_quality: "非退化"}
    - {id: T4, operation_id: OP-A1, requirement_ids: [R4], verifies: [CI-A07], given: "非 2xx かつ {detail:...} / 配列 detail / 非 JSON body", when: "API を呼ぶ", then: ["ApiError.detail が正規化文言になる", "非 JSON では 'Unknown error'"], oracle: "ApiError.detail の文字列比較", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/api.test.ts:635-660"], oracle_quality: "非退化"}
    - {id: T5, operation_id: OP-A1c, requirement_ids: [R2], verifies: [CI-A13, CI-P07], given: "再生中の podcast", when: "ended イベントが発火する", then: ["onCompleted が onPositionSave(id,0) より前に呼ばれる"], oracle: "呼出順を記録する spy 配列の順序 assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:601"], oracle_quality: "非退化（実 HTMLAudioElement のイベントを dispatch）"}
    - {id: T6, operation_id: OP-A2, requirement_ids: [R4], verifies: [CI-A23], given: "route module", when: "maxDuration と fetch の signal を検査する", then: ["maxDuration === 30", "fetch に AbortSignal が渡る"], oracle: "export 値と fetch mock 引数の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/app/api/proxy.test.ts:363,416"], oracle_quality: "非退化"}
    - {id: T7, operation_id: OP-A2, requirement_ids: [R4], verifies: [CI-A24], given: "fetch が TimeoutError / AbortError / 一般 Error で reject、または backend が 401/404/409/500 を返す", when: "forward を呼ぶ", then: ["504 / 504 / 502 / 各 status 素通し"], oracle: "NextResponse の status と detail の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/app/api/proxy.test.ts:129,146,163,347,372,389,403"], oracle_quality: "非退化（実 route handler を import）"}
    - {id: T8, operation_id: OP-A2, requirement_ids: [R4], verifies: [CI-A25], given: "backend が複数 Set-Cookie を返す", when: "forward を呼ぶ", then: ["応答に全 Set-Cookie が現れる"], oracle: "response.headers の getSetCookie を assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/app/api/proxy.test.ts:312"], oracle_quality: "非退化"}
    - {id: T9, operation_id: OP-Q1, requirement_ids: [R7], verifies: [CI-Q03], given: "spec §4.1 各行の初期 QueueState", when: "該当操作を呼ぶ", then: ["spec の期待 items/current/upNext と一致"], oracle: "Q-01〜Q-32 の 32 行すべてを行 ID 付きテスト名で照合", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/playbackQueue.conformance.test.ts:1-24", "docs/design/shared-playback-spec.md:201-232"], oracle_quality: "非退化。spec 側 ID をテスト名に埋めており第三者が表と機械照合できる。alias については CI-Q03 の note 参照。"}
    - {id: T10, operation_id: OP-Q1, requirement_ids: [R2], verifies: [CI-Q04], given: "[*a*,b]", when: "add(b) / playNext(c) を呼ぶ", then: ["重複が作られない"], oracle: "items の id 配列 assert（Q-09/Q-11）", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/playbackQueue.conformance.test.ts（Q-09,Q-11 行）"], oracle_quality: "非退化"}
    - {id: T11, operation_id: OP-P1, requirement_ids: [R2], verifies: [CI-P02], given: "load 済みの audio", when: "error イベントが発火する", then: ["isPlaying === false", "onError が 1 回呼ばれる"], oracle: "hook 戻り値と spy の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:257"], oracle_quality: "非退化"}
    - {id: T12, operation_id: OP-P1, requirement_ids: [R2], verifies: [CI-P03], given: "src が blob: URL", when: "別 URL を load する", then: ["revokeObjectURL が旧 src で呼ばれる", "blob 以外では呼ばれない"], oracle: "URL.revokeObjectURL の spy", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:442"], oracle_quality: "非退化"}
    - {id: T13, operation_id: OP-P1, requirement_ids: [R2], verifies: [CI-P04], given: "マウント済み hook", when: "unmount する", then: ["pause と blob revoke が実行される"], oracle: "spy assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:419"], oracle_quality: "非退化"}
    - {id: T14, operation_id: OP-P1, requirement_ids: [R3], verifies: [CI-P06], given: "load 済み", when: "timeupdate を 10 秒未満 / 10 秒以上の進捗で発火する", then: ["未満では保存されない", "以上で savePosition と onPositionSave が呼ばれる"], oracle: "localStorage と spy の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:196,501"], oracle_quality: "非退化"}
    - {id: T15, operation_id: OP-P1, requirement_ids: [R2], verifies: [CI-P07], given: "再生中", when: "ended が発火する", then: ["isPlaying=false", "position 0 保存", "onEnded 呼出"], oracle: "spy と localStorage の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:223"], oracle_quality: "非退化"}
    - {id: T16, operation_id: OP-P1, requirement_ids: [R3], verifies: [CI-P11], given: "任意の音量値（範囲外含む）", when: "setVolume を呼ぶ", then: ["[0,1] に clamp され localStorage に保存される"], oracle: "hook 戻り値と localStorage の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:289"], oracle_quality: "非退化"}
    - {id: T17, operation_id: OP-P1, requirement_ids: [R3], verifies: [CI-P13], given: "localStorage に不正値／保存済み音量", when: "load する", then: ["既定 1.0 へ正規化 / 保存値を復元"], oracle: "hook の volume を assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/hooks/useAudioPlayer.test.ts:371"], oracle_quality: "非退化"}
    - {id: T18, operation_id: OP-C1, requirement_ids: [R2], verifies: [CI-C06], given: "キャッシュ済み episode", when: "deleteAudio を呼ぶ", then: ["audio/meta/podcast の 3 キーが削除される"], oracle: "fake Cache の delete 呼出 assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/audioCache.test.ts:129"], oracle_quality: "非退化"}
    - {id: T19, operation_id: OP-C1, requirement_ids: [R2], verifies: [CI-C07], given: "caches が undefined", when: "各 API を呼ぶ", then: ["読み系は null/[]/false", "downloadAudio は throw"], oracle: "戻り値と rejects の assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/audioCache.test.ts:192"], oracle_quality: "非退化"}
    - {id: T20, operation_id: OP-C1, requirement_ids: [R6], verifies: [CI-C08], given: "audio-v1 が存在する", when: "deleteAllAudio を呼ぶ", then: ["caches.delete('audio-v1') が呼ばれる"], oracle: "spy assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/audioCache.test.ts:129"], oracle_quality: "非退化"}
    - {id: T21, operation_id: OP-X1, requirement_ids: [R4], verifies: [CI-X01], given: "hasCached/isOnline の 4 通り", when: "resolvePlaybackSource を呼ぶ", then: ["cached/cached/network/unavailable"], oracle: "戻り値の文字列比較", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/resolvePlayback.test.ts"], oracle_quality: "非退化（全入力空間を網羅）"}
    - {id: T22, operation_id: OP-X2, requirement_ids: [R3], verifies: [CI-X03], given: "server/local の正負 0 の組合せ", when: "resolveResumePosition を呼ぶ", then: ["優先順位と >= 0 が守られる"], oracle: "戻り値の数値比較", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/playbackPosition.test.ts"], oracle_quality: "非退化"}
    - {id: T23, operation_id: OP-S2, requirement_ids: [R6], verifies: [CI-S04], given: "fetch が ok/非 ok を返す", when: "cacheFirst/networkFirst が走る", then: ["ok のときだけ cache.put される"], oracle: "fake Cache の put 呼出 assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/public/sw.test.ts:105,148,187"], oracle_quality: "非退化（実 sw.js を評価して event を dispatch）"}
    - {id: T24, operation_id: OP-S2, requirement_ids: [R6], verifies: [CI-S05], given: "shell-*/api-*/audio-v1 の混在した cache 名", when: "activate が走る", then: ["managed かつ旧世代のみ削除、audio-v1 は残る"], oracle: "caches.delete の引数集合 assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/public/sw.test.ts:72"], oracle_quality: "非退化"}
    - {id: T25, operation_id: OP-S2, requirement_ids: [R6], verifies: [CI-S06], given: "クロスオリジン / /_audio/ 要求", when: "fetch イベントが発火する", then: ["respondWith が呼ばれない"], oracle: "event.respondWith の spy 未呼出 assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/public/sw.test.ts:207"], oracle_quality: "非退化"}
    - {id: T26, operation_id: OP-A1g, requirement_ids: [R1], verifies: [CI-A15], given: "現在のパスワード", when: "deleteAccount を呼ぶ", then: ["DELETE /api/backend/auth/me に current_password が載る"], oracle: "fetch mock の body assert", implementation_status: implemented, execution_status: passed, evidence: ["tests/lib/api.auth.test.ts:117"], oracle_quality: "非退化"}

  traceability:
    - {requirement_id: R1, domain_obligation_ids: [OB-C7, OB-C13], operation_ids: [OP-A1d, OP-A1g, OP-S1], contract_item_ids: [CI-A14, CI-A15, CI-S03], test_ids: [T26], status: partial, note: "R1 の中核（quota 分類・server-star merge・パスワードポリシーの lib 単一所有）は app/ ページ内に実装されており本 package の operation inventory 外。T3b boundary package と router へ OB-N1 として返す。"}
    - {requirement_id: R2, domain_obligation_ids: [OB-C3, OB-C4, OB-C10, OB-C11, OB-C14], operation_ids: [OP-P1, OP-Q1, OP-C1, OP-A1c], contract_item_ids: [CI-P01, CI-P02, CI-P03, CI-P04, CI-P05, CI-P07, CI-P08, CI-P09, CI-Q01, CI-Q02, CI-Q04, CI-C01, CI-C02, CI-C03, CI-C04, CI-C05, CI-A12, CI-A04], test_ids: [T5, T10, T11, T12, T13, T15, T18, T19], status: partial}
    - {requirement_id: R3, domain_obligation_ids: [OB-C9, OB-C12], operation_ids: [OP-P1, OP-A1b, OP-X2], contract_item_ids: [CI-P05, CI-P06, CI-P11, CI-P12, CI-P13, CI-A10, CI-A11, CI-X03], test_ids: [T14, T16, T17, T22], status: partial, note: "CI-P12（再生速度の正本一意性）に対応するテストが存在せず、R3 の核心部分は未検証。"}
    - {requirement_id: R4, domain_obligation_ids: [OB-C6], operation_ids: [OP-A1, OP-A2, OP-X1], contract_item_ids: [CI-A01, CI-A02, CI-A03, CI-A05, CI-A06, CI-A07, CI-A20, CI-A21, CI-A22, CI-A23, CI-A24, CI-A25, CI-A26, CI-A27, CI-X01, CI-X02], test_ids: [T1, T2, T3, T4, T6, T7, T8, T21], status: partial, note: "transport 値非依存（CI-A01）と BFF の fail-closed/情報衛生/traversal（CI-A20/21/22）が未検証。"}
    - {requirement_id: R5, domain_obligation_ids: [OB-C5], operation_ids: [], contract_item_ids: [], test_ids: [], status: missing, note: "admin gating は本 package の operation inventory（ブリーフ §対象 operation）に含まれない。契約 item を捏造せず OB-N2 として router へ返す。"}
    - {requirement_id: R6, domain_obligation_ids: [OB-C1, OB-C13], operation_ids: [OP-S1, OP-S2, OP-C1], contract_item_ids: [CI-S01, CI-S02, CI-S03, CI-S04, CI-S05, CI-S06, CI-C08], test_ids: [T20, T23, T24, T25], status: contradictory, note: "既存テスト（T23-T25）は SW の cache 戦略が『設計通り動くこと』を検証しており全て pass するが、その設計自体が CI-S02（主体非依存 key）で R6 に反する。テスト green と要件充足が乖離している。"}
    - {requirement_id: R7, domain_obligation_ids: [OB-C4], operation_ids: [OP-Q1], contract_item_ids: [CI-Q01, CI-Q02, CI-Q03], test_ids: [T9, T10], status: partial, note: "spec Q-01..Q-32 は 32/32 対応（covered）。ただし spec 表に無い不正入力（CI-Q02 の NaN、CI-Q01 の範囲外 currentIndex 構築）は oracle が存在しない。"}
    - {requirement_id: R8, domain_obligation_ids: [], operation_ids: [], contract_item_ids: [], test_ids: [], status: missing, note: "CI 設定は operation 契約ではなく、かつ本 review で .github/workflows を自力確認していない。unknown のまま OB-N4 として返す。"}

  coverage:
    requirement:
      denominator: 8
      numerator: 4
      numerator_definition: "1 件以上の required contract item と、それを verifies する実行済み oracle 付き test へ接続された requirement"
      covered_ids: [R2, R4, R6, R7]
      uncovered_ids: [R1, R3, R5, R8]
      caveat: "numerator に入った 4 件も status は partial / contradictory であり、『要件を満たしている』ことを意味しない。R6 は test が green のまま要件に反する（CI-S02）。"
    contract:
      denominator: 53
      denominator_definition: "applicability: required の contract item 数（全 57 件から not_applicable 1 件・unknown 3 件を除く）"
      numerator: 53
      numerator_definition: "statement・contract level・authority 種別・唯一の authoritative owner・Evidence が揃った required item 数"
      incomplete_item_ids: []
      caveat: "numerator は『契約記述として完備している item 数』であり、実装が契約を満たす item 数ではない。実装適合は implementation_compliance field を参照。met 26 件 / partially_met 2 件（CI-A02, CI-C05）/ unmet 25 件。"
      authority_unresolved_item_ids: [CI-P12, CI-S03]
      authority_unresolved_reason: "architecture-strategy-package.md が読取時点で不在のため authority 表を参照できず、この 2 件の authoritative_owner を本 package では確定しない（OB-N3）。"
    test:
      denominator: 53
      denominator_definition: "applicability: required の contract item 数"
      numerator: 26
      numerator_definition: "verifies と観測可能 oracle を持つ実行済み test へ接続された item 数"
      uncovered_item_ids: [CI-A01, CI-A03, CI-A04, CI-A10, CI-A11, CI-A12, CI-A20, CI-A21, CI-A22, CI-A26, CI-A27, CI-Q01, CI-Q02, CI-P01, CI-P05, CI-P08, CI-P09, CI-P12, CI-C01, CI-C02, CI-C03, CI-C04, CI-C05, CI-X02, CI-S01, CI-S02, CI-S03]
    unknown_item_ids: [CI-A14, CI-A16, CI-P10]
    not_applicable_item_ids: [CI-Q05]
    trace_status: partial

  subject_verdict: insufficient
  subject_verdict_rationale: >-
    Evidence 付きで特定可能な契約欠落が存在するため indeterminate ではなく insufficient。
    最も重いのは (1) BFF の fail-open — BACKEND_API_KEY 欠落時に無認証で転送を続行する（CI-A20, route.ts:66-72）、
    (2) catch-all path segment に traversal 検証が無い（CI-A22, route.ts:39-40,63）、
    (3) 認証済み応答の SW cache key に主体識別が無く、かつセッション失効経路で掃除されない（CI-S02/CI-S01）の 3 点で、
    いずれも QL4 security/confidentiality を直接損なう。
    設計上の欠落としては、再生状態に status union が無いこと（CI-P01）が CI-P09/CI-P10 の失敗契約・冪等性を観測不能にしており、
    単一の型の欠落が 3 つの契約を同時に検証不能にしている点が最も影響が広い。
    正の所見として、playbackQueue は spec §4.1 の 32 行すべてに行 ID 対応した非退化 conformance テストを持ち、
    純粋関数として idempotency N/A を正しく主張できる唯一の領域である（CI-Q03/CI-Q05）。

  decision:
    status: proposed
    artifact_readiness: draft
    engineering_status: not_started
    release_status: not_applicable
    decision_maturity: proposed
    reviewed_by: unresolved
    rationale: "review mode の監査成果物であり、実装・修正は一切行っていない。unknown_item_ids が 3 件残り trace_status が partial のため、coverage 比率のみから ready を宣言しない。"
    gate_blockers:
      - "CI-A14 / CI-A16 / CI-P10 が unknown のまま（idempotency assessment 3 件が未確定）"
      - "authority 未確定 item が 2 件（CI-P12 / CI-S03）。architecture-strategy-package の authority 表が前提。"
      - "CI-A20 / CI-A21 / CI-A22 / CI-S02 は公開されている認可・機密の契約に関わるため、AI が単独で確定せず人間または独立検証の承認を要する。"

obligations_to_router:
  - {id: OB-N1, kind: scope_gap, statement: "R1 の中核（quota 分類・server-star merge・パスワードポリシー・404=未蓄積）は app/ ページ内に実装されており、本 package の operation inventory（ブリーフ §対象 operation）に含まれない。契約 item を捏造せず T3b boundary package または追加 operation 指定を求める。", evidence: {status: confirmed, sources: ["app/(app)/feed/page.tsx:15-28,151-158", "components/ui/AccountSection.tsx:19-55", "app/signup/page.tsx:18-45"]}}
  - {id: OB-N2, kind: scope_gap, statement: "R5（admin gating）の operation が本 package の対象に含まれない。OB-C5 に対応する CI を発行できない。", evidence: {status: confirmed, sources: ["scratchpad/packages/t3a-contract-brief.md:6-13"]}}
  - {id: OB-N3, kind: authority_unresolved, statement: "CI-P12（再生速度の正本）と CI-S03（SW cache prefix の単一 source）の authoritative_owner は system-wide な data authority の決定であり、本 Skill の Authority Boundary 外。architecture-strategy-package.md が読取時点で不在だったため参照できず、router が authority 表または SG* を供給するまで未確定とする。", evidence: {status: confirmed, sources: ["scratchpad/packages/ の ls 結果に architecture-strategy-package.md が無い"]}}
  - {id: OB-N4, kind: evidence_gap, statement: "R8（CI が typecheck:ts7 と build を独立ゲートとして実行する）を本 review では自力確認していない。.github/workflows の確認を router 側で割り当てる必要がある。", evidence: {status: unknown, sources: []}}
  - {id: OB-N5, kind: test_obligation, statement: "未 coverage の 27 件（coverage.test.uncovered_item_ids）のうち、CI-A20 / CI-A21 / CI-A22 / CI-S01 / CI-S02 / CI-C01 / CI-C02 の 7 件は security・data confidentiality に直結するため、RED テストの優先実装対象として先頭に置く。実装権限は本 package に無い。", evidence: {status: confirmed, sources: ["app/api/backend/[...path]/route.ts:53-72", "public/sw.js:50-61", "lib/audioCache.ts:68-84", "contexts/AuthContext.tsx:59-63"]}}
  - {id: OB-N6, kind: upstream_link, statement: "上流 OB-C1..OB-C14 のうち OB-C1→CI-S01、OB-C3→CI-P01/CI-P10、OB-C4→CI-Q01、OB-C6→CI-X02、OB-C9/OB-C12→CI-P12、OB-C10/OB-C11→CI-C01/CI-C02、OB-C13→CI-S03、OB-C14→CI-C03 として実在 CI へ変換済み。OB-C5（admin gating）・OB-C7（localStorage key の単一所有）・OB-C8（AuthSession 判別共用体）は本 package の operation 対象外のため未変換であり、OB-N1/OB-N2 と合わせて router が割当先を決める。", evidence: {status: confirmed, sources: ["scratchpad/packages/completeness-package.md:1213-1292"]}}

rejected_options_for_trial_log:
  - option: "conformance テストの `reorderUpNext as moveUpNext` alias を退化 oracle として指摘する"
    purpose: "spec の moveUpNext と実装の reorderUpNext を alias で同一視している疑いを検証する（ブリーフ既知観測 :47）"
    premise: "spec §2.7 の moveUpNext が『削除前オフセット』方式で定義されていること（確認済み）"
    action: "docs/design/shared-playback-spec.md:226-232 の Q-26/Q-28/Q-32 期待値と lib/playbackQueue.ts:95-106 の insertAt 計算を突き合わせた"
    result: "棄却。実装 :103 の `insertAt = toIndex - (fromIndex < toIndex ? 1 : 0)` は spec が定める削除前オフセット規約そのものであり、Q-26/Q-28/Q-32 の期待値と一致する。alias を置く判断とその理由は conformance テスト冒頭 :4-8 に明記されている。アダプタ層を要求すると、同一の意味に対して二つの名前と変換規則を増やすだけで検証力は上がらない。"
    remaining: "spec 表に無い不正入力（NaN startAt・範囲外 currentIndex の直接構築）は依然として oracle が無く、CI-Q01/CI-Q02 として残した。"
  - option: "全 operation に idempotency key を定義して統一的な重複制御を設計する"
    purpose: "retry / duplicate / ambiguous outcome を一箇所で扱えるようにする"
    premise: "未検証: 対象 operation の副作用が一様であること"
    action: "operation ごとに副作用の有無と外部 state 変更を個別に確認した"
    result: "棄却。OP-Q1 / OP-X1 / OP-X2 は副作用を持たない純粋関数で（lib/playbackQueue.ts:1-107、lib/resolvePlayback.ts:1-27、lib/playbackPosition.ts:1-38 に I/O 呼出が無い）、deterministic 性を mutation idempotency と取り違えて key を発明することは Skill の Rejection Condition に該当する。OP-C1 は既存の path キーが自然キーとして機能しており新規機構が不要。key が要るのは OP-A2 の非冪等 method のみで、それも backend 契約との合意が前提のため本 review では unknown に留めた。"
    remaining: "OP-A2 の冪等キー要否は backend 契約の確認待ち（CI-A27）。"
  - option: "CI-A01 の解決策として ApiError を判別共用体へ置き換える設計を本 package で提示する"
    purpose: "transport 値 status=0 への依存を型で断つ"
    premise: "review mode で mutation_authorized: false（確認済み）"
    action: "ブリーフ §5『公開契約変更は提案しない』と Skill の change_safety 適用条件を照合した"
    result: "棄却。60 関数・21 ファイルの公開契約変更にあたり、approval / compatibility window / migration が必要になる。review mode の scope を超えるため、契約欠落の指摘（CI-A01）と未 coverage の明示に留め、設計は後続 gate へ委ねた。"
    remaining: "CI-A01 の修正設計は Selection Gate 事項として router へ。"
