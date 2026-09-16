# news-listen-web Implementation Spec — Use Case・目的別ドメインモデル・カプセル化（design mode）

日付: 2026-09-16 ／ mode: design（read-only、実装は別フェーズ）／ owner: user ／ decision_maturity: **approved（2026-09-16 user 承認。SG8=一括切替、SG9=採用、SG7=8〜20 文字）**
入力: `docs/research-reports/2026-09-16-code-design-review.md`（finding RF*・§8 人間判断）と同ディレクトリの Function package（G*/IV*/OB-C*/CI*/LF*/F*/SG*）。
位置づけ: 親リポ `docs/design/web-design.md` §6〜§9 の**target 版**。実装が進んだ節から web-design.md を書き換える（本書は移行中の設計正本）。

> 設計原則（本書の判断順）: actor の目的 → use case → その判断に必要な概念・不変条件 → 契約 → カプセル（公開操作と隠す技術）→ 依存方向 → 移行。pattern 名・class 数は成果にしない。1 実装しかない箇所に factory / Strategy を作らない（Boundary RO1〜RO6 を踏襲）。


> **追記（2026-09-16・共有仕様 §6.7 の確定による上書き）**: 親 docs `shared-playback-spec.md` §6.7 の Selection Gate が user 判断で確定し、本書の次の記述を上書きする（本書は改訂せず、この追記と各 slice の order `docs/plan/2026-09-16-design-review-refactor/` を優先する）。
> - SG-X1: 完聴時にサーバーへ送る位置は **`duration`**（§3.1 Coordinator `onEnded` の「位置 0 保存」、CI-T8 の「完聴の 0 は最終」を置換。順序は onCompleted → `duration` → advance）。
> - SG-X2: resume は **末尾 2 秒窓**（共有仕様 §4.3 RS-01〜07）。CI-T3 の「duration 以上なら 0」を置換。
> - SG-X4: 位置同期の周期送信は再生中のみ（web は現行どおり）。
> - パスワード（SG7）: **12〜20 文字**（ADR-101。本書の「8〜20」を置換）。

## 0. Decision frame と function_plan

```yaml
decision_frame:
  mode: design
  requested_outcome: Implementation Spec（use case catalog・context 分割・model・契約・capsule・移行・検証計画）
  decision_owner: user
  mutation_authorized: false
  in_scope: [web/ の lib/ contexts/ hooks/ app/ components/ の責務再配置, 契約と test obligation, 移行手順]
  out_of_scope: [backend 契約変更, iOS, 意匠, 学習機能の詳細 model（context 境界と obligation まで）]
  reversibility: reversible（slice 単位・特性テストで保護）
  public_contract_change_allowed: false   # backend API・共有再生仕様 §2 は不変
  decision_maturity: {status: proposed, owner: user, scope: [web/], evidence_status: confirmed, approval_evidence: ["review §8（SG1〜SG5 satisfied）"]}
function_plan:
  - {function: architecture, run_if: "context 分割・data authority・依存方向", status: completed, note: "§2・§5。SG3/SG5 の決定を target に反映"}
  - {function: completeness, run_if: "model の概念・状態・失敗", status: completed, note: "§3。G1〜G11 / IV1〜IV11 を target model で閉じる"}
  - {function: contract, run_if: "capsule の公開操作", status: completed, note: "§4。既存 CI* を再利用し、target 固有は CI-T*"}
  - {function: boundary, run_if: "capsule の interface / implementation 分離", status: completed, note: "§5・§6。LF1〜LF15 の解消先を明示"}
  - {function: change_safety, run_if: "既存挙動の変更", status: completed, note: "§7。slice・特性テスト・temporary path"}
  - {function: discovery, status: not_applicable, not_applicable_reason: "用語は §1.2 の term ledger で確定（既存 types・共有仕様由来）"}
```

## 1. Use Case catalog と用語

### 1.1 actor と目的

| actor | 目的（product value） |
|---|---|
| Listener（聴く人） | 移動中・オフラインでも英語ニュース音声を途切れず聴き、前回の続きから再開できる |
| Learner（学ぶ人） | 自分の難易度で記事を選び、聴いた内容を理解・語彙として定着させ、継続を可視化する |
| Account owner | 自分の認証手段・端末・設定を安全に管理する |
| Admin | 招待制サービスの利用者・招待・おすすめサイト・指標を管理する |
| System（SW・ポーリング） | オフライン時のシェル提供、生成状態の反映、通知、エラー通報 |

### 1.2 Use Case（UC）

| UC | actor | 内容 | 主要な判断（=ドメインルール） | context |
|---|---|---|---|---|
| UC-P1 エピソードを再生する | Listener | 一覧／詳細の▶で再生開始 | 再開位置（server / local）、音源（cached / network / unavailable）、キュー挿入規則（現在の次に挿入して jump）、再生可能性（status） | Playback ← Catalog |
| UC-P2 再生を操作する | Listener | play / pause / seek / ±秒 / 速度 / 音量 | seek の範囲、速度の値域、セッション速度 vs 既定速度 | Playback |
| UC-P3 連続再生 | Listener | ended → 完聴イベント → 次へ or 停止 | 完聴の記録順序（ADR-075 決定3）、次の取得失敗時は停止して手動再試行（§8 Q6） | Playback |
| UC-P4 キューを編成する | Listener | 追加・次に再生・削除・並べ替え・スキップ | 共有仕様 §2（Q-01〜Q-32） | Playback |
| UC-P5 オフライン保存 | Listener | 保存・削除・保存一覧・使用量 | 成功応答のみ保存、保存済み＝再生可能、blob の解放 | Playback（OfflineLibrary） |
| UC-P6 再生位置の復元 | Listener | 別端末／同端末で続きから | server 優先・local 次点（`resolveResumePosition`）、書込順序 | Playback |
| UC-L1 記事を選ぶ | Learner | Feed で Star / Dismiss、Star 済み一覧 | 生成 quota（残回数・上限到達の月次/日次） | Catalog |
| UC-L2 理解度クイズ | Learner | 回答→サーバ採点 | 正解キーはクライアントに無い | Learning |
| UC-L3 語彙 | Learner | 保存・一覧・テスト | — | Learning |
| UC-L4 継続の可視化 | Learner | ストリーク・ダッシュボード・実績 | staleness 5 分、実績の既読 | Learning |
| UC-L5 難易度 | Learner | 既定難易度・自動提案 | — | Learning / Preferences |
| UC-A1 認証 | Account owner | password / passkey ログイン、招待登録、ログアウト、失効 | AuthSession の遷移と、主体が離れるときのキャッシュ消去 | Account |
| UC-A2 アカウント管理 | Account owner | 表示名・パスワード・passkey・セッション・退会 | パスワード規則（単一） | Account |
| UC-A3 設定 | Account owner | 既定速度・難易度・digest・週目標（server）／時刻表記・テーマ・効果音（local）／Push | 各設定の値域と保存先の単一所有 | Preferences / Notifications |
| UC-M1〜M4 管理 | Admin | ユーザー・招待・おすすめサイト・指標 | 認可: `granted` のときだけ描画・操作 | Admin ← Account |
| UC-S1 生成状態の反映 | System | 一覧ポーリング、生成中→完了の検知 | 停止条件の単一所有 | Catalog |
| UC-S2 オフラインシェル | System | SW の shell/api キャッシュ、Push 受信 | 名前空間の単一 source、主体が離れたら消す | Platform |
| UC-S3 エラー通報 | System | render / global / unhandled | gateway 経由（CSRF・正規化） | Platform |

### 1.3 term ledger（意味を分ける語）

| term | 意味 | 区別する別義 | 正本 |
|---|---|---|---|
| Episode | 聴く対象（backend の `Podcast` DTO をドメインで読んだもの） | DTO そのもの | Catalog `Episode` 型（§3.2） |
| 再生可能（Playable） | `status='completed'` かつ `audio_url` 非空かつ `error_message` null | 生成中・失敗 | Catalog |
| 現在再生中 | `Queue.current`（共有仕様 §2.1 不変条件 4） | audio 要素に load 済みの src | Playback Queue |
| 完聴（completed listen） | ended 到達の事象 | 生成完了（`PodcastStatus 'completed'`） | Playback（`ListenCompleted`）／Catalog（`GenerationStatus`）で語を分ける（G11） |
| 既定速度 | 新しい再生の初期速度（設定・永続） | セッション速度（今回の再生・非永続） | Preferences ／ Playback |
| 認証済み | `/auth/me` 成功で `user` を伴う状態 | Cookie の存在 | Account `AuthSession` |
| 失敗の意味（ApiFailure） | network / timeout / unauthorized / forbidden / not_found / rate_limited / validation / server | HTTP status 数値 | Platform ApiGateway |

## 2. Bounded context と依存方向（Architecture target）

```text
app/ (pages・server components)        …… 画面。use case hook を呼び、結果を描く。ルールを持たない
  ↓
hooks/ (use case hooks)                 …… UC 単位の orchestration。context 由来の capsule を組み合わせる
  ↓
contexts/ (composition root / providers) …… adapter を生成し capsule を配線。React 配線のみ
  ↓ owns                       ↑ implements
lib/<context>/ (domain model・policy)   ←  lib/platform/ (ports の adapter: localStorage / Cache Storage / Audio / fetch)
```

| context | purpose | 所有する概念（source of truth） | 置き場（target） |
|---|---|---|---|
| **Playback** | 聴き続ける | `PlaybackSession`（transport 状態）, `Queue`（現在再生中・待機列）, `PlaybackSource`, `ResumeRule`, `OfflineLibrary` | `lib/playback/`、`contexts/PlaybackProvider.tsx`、`hooks/usePlayback*.ts` |
| **Catalog** | 聴く対象を選ぶ | `Episode`（Playable/Generating/Failed）, `Article`（star/dismiss）, `GenerationQuota`, `Source`/`FeaturedSource`, 生成状態の遷移検知 | `lib/catalog/` |
| **Learning** | 定着・継続 | quiz, vocabulary, streak, dashboard, achievement 既読 | `lib/learning/`（本書では境界と obligation のみ） |
| **Account** | 誰であるか・何ができるか | `AuthSession`（判別共用体）, `AdminAccess` policy, `PasswordPolicy`（単一）, credentials / sessions | `lib/account/`、`contexts/AuthProvider.tsx` |
| **Preferences** | 自分の使い方 | 設定レジストリ（key・codec・値域・保存先）。server 設定と local 設定を同じ registry で宣言 | `lib/preferences/`、`contexts/PreferencesProvider.tsx` |
| **Admin** | 運営 | 一覧・作成・更新・失効（generic。ルールは backend） | `lib/api/admin.ts`（gateway 呼出のみ）+ `hooks/useAdminGate.ts` |
| **Notifications** | 通知 | `PushSubscriptionState`（既存の状態機械を維持） | 現状維持 |
| **Platform** | 技術境界 | `ApiGateway`（request＋`ApiFailure`）, `KeyValueStore`, `CacheStore`, `AudioElement`, BFF proxy（server） | `lib/api/gateway.ts`、`lib/platform/*`、`app/api/backend/[...path]/route.ts` |

**依存方向の禁止事項（prohibited_structures）**
- `lib/<context>/` は React・`fetch`・`localStorage`・`caches`・`Audio` を import しない（port 経由のみ）。
- `lib/playback/` は `lib/api/` を import しない（Explorer/Architecture の違反 `audioCache.ts → api.ts` を解消。取得は Coordinator が Catalog gateway から受け取って渡す）。
- `contexts/` は `components/` を import しない（`AudioPlayerContext → Toast` の逆依存を解消。通知は use case の結果として返し、hook 側で Toast に写す）。
- `app/` は `ApiError.status` や `localStorage` を直接参照しない（`ApiFailure` と Preferences registry を使う）。

**port を置く根拠（abstraction gate）**: 4 つだけ。いずれも「1 実装だが品質根拠あり」。

| port | 根拠 | 既存の萌芽 |
|---|---|---|
| `ApiGateway` | SG5（テスト隔離・本番経路同一）、LF1/LF15 | `lib/api.ts request()` |
| `AudioElement` | テストで `MockAudio` を差している事実（`tests/helpers/mockAudio.ts`）を公開 seam に昇格 | `useAudioPlayer` の `new Audio()` |
| `KeyValueStore` | OB-C7（6 経路の localStorage を単一 owner に）、private browsing 失敗の正規化（CI-P13） | `hooks/useLocalStorage`, `lib/config.ts` |
| `CacheStore` | `tests/helpers/mockCaches.ts` の seam 昇格、OB-C11/C14 の不変条件を capsule 内に閉じる | `lib/audioCache.ts` |

`Clock` port・Strategy 階層・汎用 Storage port（RO3）は作らない（根拠なし）。

## 3. ドメインモデル（Completeness target）

### 3.1 Playback

**PlaybackSession（transport 状態の正本）** — 排他 union。4 atom（isPlaying/currentTime/duration/volume）は派生値。

| 状態 | 保持する値 | 遷移（コマンド／イベント） |
|---|---|---|
| `idle` | — | `start(episode, resume)` → `loading` |
| `loading` | `episode: PlayableEpisode`, resumePosition, speed | `loadedmetadata` → `paused`（resume 適用済み）／`error` → `errored` |
| `paused` | episode, position, duration, speed | `play()` → `playing`／`seek`／`start` |
| `playing` | 同上 | `pause()` → `paused`／`ended` → `ended`／`error` → `errored`／`timeupdate`（位置更新。保存は CP9 が事象を受けて行う） |
| `ended` | episode, duration | Coordinator が `ListenCompleted` を記録し `advance` |
| `errored` | episode（取得前の失敗は `episodeRef: {id}` のみ）, position, `reason: media \| autoplay_blocked \| source_unavailable \| fetch_failed(ApiFailure)` | `play()`（手動再試行）→ `loading`／`start` |

**「現在再生中」の二重表現の解消（gate 指摘 2）**: `Queue`（共有仕様 §2.1、`items` は `Podcast` DTO のまま）は「順序と現在位置」の正本、`PlaybackSession` は「現在位置の decode 済み `PlayableEpisode`（再生に必要な payload）」の保持者。不変条件 **INV-P1**: `session` が `idle` でないとき `session.episode.id === Queue.current(queue).id`。UI が「何が再生中か」を問う唯一の入口は Coordinator の `nowPlaying()` query（`Queue.current` から id、`session.episode` から title / difficulty / createdAt / duration を導出した view model）。`AppContext.currentPodcast` と `AudioPlayerBar` の DTO 直読み（`components/AudioPlayerBar.tsx:16,28-30,65-66,139,160`）はこの query に置き換える。

遷移表の分母（T-T1 用に固定）: idle→loading, loading→paused, loading→errored, paused→playing, paused→paused(seek), paused→loading(start), playing→paused, playing→ended, playing→errored, playing→playing(timeupdate), ended→loading(advance), errored→loading(retry), errored→loading(start) の **13 遷移**。表外の遷移（例: idle→playing、ended→playing）は禁止。

不変条件: `position ∈ [0, duration]`（seek / seekRelative とも clamp、CI-P08）。速度は `PLAYBACK_SPEEDS` 内（OB-C9）。`start` 時のセッション速度は Preferences の既定速度で初期化し、以後はセッション内で保持・`load` 後に再適用（§8 Q5、CI-P12）。`play()` の reject は `errored(autoplay_blocked | media)` へ遷移し、呼出側は状態で観測する（CI-P09/P10）。

**Queue** — 共有仕様 §2 の `QueueState` と公開操作をそのまま採用（`items` は `Podcast` DTO。iOS/Android と共有する契約なので型を変えない）。公開操作は §2 どおり **正規化** する（`setQueue` の `startAt` clamp §2.4、`add`/`playNext` の dedupe §2.5/2.6、範囲外 `moveUpNext` の no-op §2.7）。**入力を拒否しない**。追加するのは内部の不変条件 gate `Queue.create(items, currentIndex)`（不変条件 1〜3 を検査し、違反は **programmer error として throw**。全公開操作の戻り値がこれを通る。OB-C4 / CI-Q01）。公開操作は throw しない。`Queue.current` を「現在再生中（の位置）」の唯一の正本と宣言する（SG3、OB-C12）。`AppContext.currentPodcast` は削除。`start`/`setQueue` は conformance（Q-*）が検証する §2.3/2.4 の操作なので **残す**（SG6 default。削除は Q-spec 準拠を壊す）。`reorderUpNext` → `moveUpNext` の rename は挙動不変の純粋 rename として **独立コミット**（引数意味＝upNext 基準・削除前オフセット、conformance 行 ID は不変。影響: `lib/playbackQueue.ts:95`, `contexts/AudioPlayerContext.tsx:188`, テスト 3 ファイル）。

**PlaybackSource / ResumeRule** — 既存の純関数（`resolvePlaybackSource`, `resolveResumePosition`）を `lib/playback/` に置く。`'unavailable'` は Coordinator が `errored(source_unavailable)` に写し、ネットワーク取得を行わない（CI-X02 / OB-C6）。

**OfflineLibrary** — Cache Storage 上の「再生可能なエピソードの保存庫」。

| 操作 | 事後条件 |
|---|---|
| `save(episode: PlayableEpisode)` | 応答 `ok` のときだけ格納（CI-C01）。audio → meta → episode の順に書き、最後の書込が完了するまで `has()` は false（CI-C05 の原子性を「manifest 最後書き」で実現）。重複 save は収束 |
| `get(id) → PlayableEpisode & {audioHandle} \| null` | 返す Episode は再生可能（`audioUrl` は blob handle。CI-C02）。`audioHandle.release()` で revoke。発行者＝解放者（CI-C03 / OB-C14。Session は `start` 時に前 handle を release） |
| `remove(id)` / `clear()` / `list()` / `usage()` | `list()` は列挙中の削除で例外を投げない（CI-C04） |

失敗の意味: 非対応環境は `unsupported`、quota 超過は `storage_full`、応答非 ok は `download_failed(ApiFailure)`。UI 文言は hook 側で写像。

**PlaybackCoordinator（use case orchestration・`contexts/PlaybackProvider` 内の非 React 関数群）**

- `startEpisode(id)`: `source = resolvePlaybackSource({hasCached: library.has(id), isOnline})` → `cached` なら `library.get` ／ `network` なら Catalog gateway の `getEpisode` ／ `unavailable` なら `errored(source_unavailable)`。取得した Episode が Playable でなければ `errored(source_unavailable)`（IV2 を閉じる、OB-C10）。Queue は `jump` 済みならそのまま、無ければ `playNext`→`jump`（現状の挿入規則を維持）。`resume = resolveResumePosition(server, local)`。`session.start(episode, resume, speed: prefs.defaultSpeed)`。
- `onEnded`: `ListenCompleted(episodeId)` を Catalog gateway へ fire-and-forget（ADR-075 決定3。重複抑止は「同一 episodeId の ended を 1 セッション内で 1 回」に限定し、backend first-write-wins 依存をコメントとテストに明記、CI-A12）→ 位置 0 保存（順序 CI-A13 維持）→ `Queue.advance` → `next` があれば `startEpisode(next.id)`、失敗時は **停止**: `current` は失敗エピソードのまま、`errored(reason)`、手動 `play()` で再試行（§8 Q6、OB-C2）。
- 位置保存は Coordinator の責務ではなく **`PositionReporter`（CP9）** が単独所有する（gate 指摘 3）。Session は `positionChanged(episodeId, seconds)` と `listenCompleted(episodeId)` の事象を公開し、CP9 が 10 秒 throttle・local 書込・server 書込・単調性（最終書込より古い位置を送らない。完聴の 0 は例外として最後）・順序（CI-A13）を一手に持つ。CP1 は storage を持たない。

### 3.2 Catalog

**Episode** — `Podcast` DTO の decode 結果。判別共用体。

| 種別 | 条件（decode 規則） | 保持 |
|---|---|---|
| `PlayableEpisode` | `status==='completed'` ∧ `audio_url!==''` ∧ `error_message===null` | id, title(fallback: japanese_intro_text), audioUrl, duration, difficulty, createdAt, serverPosition, 任意: transcript, vocabulary, quiz, sources(source_kind による帰属表示可否) |
| `GeneratingEpisode` | `status==='processing'` | id, title, difficulty, createdAt |
| `FailedEpisode` | `status ∈ {'failed','partial_failed'}` | id, title, errorMessage |
| （矛盾 DTO） | 上記に当たらない組合せ（例: completed かつ error_message 非 null） | `FailedEpisode(errorMessage ?? 'inconsistent')` に fail-closed。decode 時に警告を計測（IV1 を型で閉じる） |

optional field 群は「DTO 世代」ではなく `PlayableEpisode` の任意付加物として吸収する（G4）。UI の▶は `PlayableEpisode` にしか付かない（`PodcastCard` の props を Episode 種別で分ける）。

**GenerationQuota / 上限到達** — `rate_limited` 失敗の `scope: 'monthly' | 'daily' | 'unknown'` を Catalog policy が決める（`/monthly/i` regex と `retryAfter > 86400` の ADR-073 フォールバックはここに 1 箇所。LF2）。文言は hook。

**生成状態の遷移検知**（`podcast/page.tsx:81-108` の RO3）— `detectCompleted(prev: Episode[], next: Episode[]) → id[]` を純関数として Catalog に置く。ポーリング停止条件は `usePodcastListPolling` が単一所有（caller の `enabled` 分割を解消）。

### 3.3 Account

**AuthSession** — 判別共用体（OB-C8、IV6/IV7 を閉じる）。

| 状態 | 値 | 遷移 |
|---|---|---|
| `resolving` | — | `getMe` 成功 → `authenticated(user)`／`unauthorized` → `anonymous`／それ以外の失敗 → `unavailable(failure)` |
| `authenticated` | `user: AuthUser` | `logout` → `anonymous`／`getMe` が `unauthorized` → `anonymous`（**失効**） |
| `anonymous` | — | `login`/`register`/`passkey` 成功 → `authenticated` |
| `unavailable` | `failure: ApiFailure` | 再試行 → `resolving`（一時障害でログアウト表示しない。RF15） |

`authenticated → anonymous` の全遷移（logout・失効）の事後条件: SW 管理キャッシュ（`shell-*`/`api-*`）を消す（CI-S01 / OB-C1、§8 SG4）。`audio-v1` は明示 logout のみ消す（失効時は保存音声を残す。ユーザー判断 Q2 で共有端末なし）。消去失敗は `CleanupIncomplete` として観測可能に返す（LF12）。

**AdminAccess policy** — `adminAccess(session) → 'loading' | 'login_required' | 'denied' | 'granted'`。`AdminGate` component が 4 ページ共通で `loading` は読み込み中表示、`login_required` はログインモーダル、`denied` は文言、`granted` のみ children（§8 Q7、OB-C5）。

**PasswordPolicy** — `lib/account/password.ts` に 1 実装。**SG7 確定（user 2026-09-16）: 長さは 8〜20 文字**（文字種規則は現行 `countPasswordCharacterClasses` を維持）。現状の 12 文字下限（`AccountSection` / `signup`）は 8 へ緩和、`admin/users` の 8 に上限 20 を追加する挙動変更を伴う。backend 側の検証値との整合は S4 着手時に確認（OB-A1。backend が 12 を要求していれば web 側 8 は 422 になるため、backend 契約の確認を先行）。

### 3.4 Preferences

設定レジストリ: 各設定を `{ key, scope: 'local' | 'server', codec(encode/decode/validate), default }` で宣言（OB-C7 / OB-C9、IV8/IV9 を閉じる）。

| 設定 | scope | 値域 | 現状の迂回（解消先） |
|---|---|---|---|
| defaultPlaybackSpeed | local（`KEY_DEFAULT_PLAYBACK_SPEED`）＋ server（`UserPreferences.default_playback_speed`） | `PLAYBACK_SPEEDS` | `settings/page.tsx:349-352` の二重書込、`AppContext` raw dispatch |
| timeFormat | local | `'absolute' \| 'relative'` | `AppContext` |
| theme | local | `'dark' \| 'light'` | `app/layout.tsx:45-49` inline script（**temporary path TP3**: import 不可のため key 文字列と列挙を複製し、テストで一致を pin） |
| sfxEnabled | local | boolean | `lib/sfx.ts` |
| seenAchievementIds | local | `string[]` | `dashboard/page.tsx:48,65` の生 key |
| volume | local | `[0,1]` | `useAudioPlayer` 内 |
| default_difficulty / digest_* / weekly_goal | server | 型どおり | `settings/page.tsx` |

`PreferencesProvider` は registry から `get(setting)` / `set(setting, value)`（validate 済みのみ受理）だけを公開。raw dispatch は公開しない。

### 3.5 Learning / Admin / Notifications（境界と obligation のみ）

- Learning: `quiz`・`vocabulary`・`streak`・`dashboard` は gateway 呼出＋表示が主で、ルールは「staleness 5 分」「ストリーク増加時の効果音」「実績既読」の 3 つ。`StreakContext` の効果音は use case hook 側の副作用へ移す（Provider から UI 副作用を外す）。詳細 model は学習機能サイクル（§8 保留）で作る。OB-L1: `lib/learning/` に上記 3 ルールの純関数を置く。
- Admin: ルールは backend。web 側は `AdminGate` と gateway 呼出のみ。
- Notifications: `PushSubscriptionState` は既存維持。変更なし（finding 対応が無いため本 Spec の対象外）。

## 4. 契約（Contract target）

既存 Contract Package の CI*（`docs/research-reports/2026-09-16-code-design-review/contract-package.md`）を再利用し、target 固有の契約を CI-T* として追加する。テスト仕様 T-T* は Given-When-Then と oracle。

**失敗の表現（gate 指摘 9）**: `ApiGateway` は throw せず `Result<T, ApiFailure>` を返す。`Result` は `{ ok: true, value: T } | { ok: false, failure: ApiFailure }` の判別共用体。`ApiFailure` は `kind` で判別（network / timeout / unauthorized / forbidden / not_found(subject) / conflict / rate_limited(retryAfterSeconds, scope) / validation(detail) / server(status) / unknown(status)）。呼出側が `kind` 以外（数値 status）で分岐することを eslint ルール（T-T7 と同じ仕組み）で禁止する。`Queue.create` の不変条件違反は programmer error として throw（公開操作は throw しない）。

| CI | 対象 capsule | statement（要約） | 由来 | test（oracle は公開 API 経由） |
|---|---|---|---|---|
| CI-T1 | PlaybackSession | 状態は §3.1 の union のみ。13 遷移以外は起きない。`errored` は `paused` と区別できる | CI-P01, OB-C3 | T-T1: 13 遷移を `AudioElement` port の double でイベント駆動し `state()` を観測（分母 13） |
| CI-T2 | PlaybackSession | `play()` reject → `errored(autoplay_blocked\|media)`。重複 `play()` は 1 状態に収束 | CI-P09, CI-P10 | T-T2 |
| CI-T3 | PlaybackSession | `start` 後の位置は resume（duration 以上なら 0）。`loadedmetadata` 後に再適用 | CI-P05 | T-T3（unit）＋ UV3（e2e 実ブラウザ） |
| CI-T4 | PlaybackSession | セッション速度は `start` で既定速度に初期化、以後保持、`load` 後に再適用（HTML の load アルゴリズムは `playbackRate` を `defaultPlaybackRate` に戻すため、Session は両方を設定する）。既定速度は Preferences のみが書く | CI-P12, OB-C9, §8 Q5 | T-T4 |
| CI-T5 | Coordinator | `unavailable` → network 取得なし、`errored(source_unavailable)` | CI-X02, OB-C6 | T-T5: gateway double が呼ばれない＋状態 |
| CI-T6 | Coordinator | advance 失敗後: `Queue.current` = 失敗エピソード、`errored(fetch_failed)`、`retry()` が `startEpisode` を再実行 | OB-C2, §8 Q6 | T-T6 |
| CI-T7 | Coordinator | INV-P1（`session.episode.id === Queue.current.id`）。「何が再生中か」の唯一の読出口は `nowPlaying()`。`AppContext.currentPodcast` と `Podcast` DTO の直読みは存在しない | OB-C12, SG3 | T-T7a: INV-P1 を全 Coordinator 操作後に検査（unit）。T-T7b: eslint `no-restricted-properties`/`no-restricted-imports` で `currentPodcast` 参照と `contexts/` → `components/` import を禁止し CI（S3）で実行 |
| CI-T8 | PositionReporter | 同一 episode の `ListenCompleted` は 1 セッション内 1 回。server 位置書込は単調非減少（完聴の 0 は最終）。順序 = onCompleted → local 0 → server 0（CI-A13） | CI-A10, A11, A12 | T-T8: gateway double の呼出列を観測 |
| CI-T9 | Queue | 公開操作は §2 どおり正規化（clamp / dedupe / no-op）し throw しない。全戻り値は不変条件 1〜3 を満たす。Q-01〜Q-32 不変 | CI-Q01, CI-Q03 | 既存 conformance 32 件（不変）＋ T-T9: 公開操作の戻り値に対する不変条件 property test（items 一意・index 範囲・空⇒null） |
| CI-T10 | OfflineLibrary | `save` は ok 応答のみ・完了前は `has()` false・重複収束。`get` は Playable か null。handle は release で revoke | CI-C01, C02, C03, C05 | T-T10: `put()` の解決をテスト側が制御する deferred-put `CacheStore` double（`MockCaches` 拡張）で途中状態を公開 API `has()` から観測 |
| CI-T11 | EpisodeDecoder | DTO → 判別共用体。矛盾 DTO は `FailedEpisode` に fail-closed。▶は Playable のみ | OB-C10, IV1, IV2 | T-T11（表駆動 status 4 × audio_url 2 × error_message 2 = 16） |
| CI-T12 | ApiGateway | 失敗は `Result` の `ApiFailure`。`rate_limited` は `retryAfterSeconds` と `scope` を持つ。204 は `Result<void>` | CI-A01, A02, A04 | T-T12（既存 `tests/lib/api.*.test` を Result 形式へ移植） |
| CI-T13 | ApiGateway | 有限 deadline（30s）で `timeout` になる | CI-A03 | T-T13（fake timer） |
| CI-T14 | BFF | `BACKEND_API_KEY` 欠落は 500・generic 本文（`BACKEND_BASE_URL` と同じ）。`BACKEND_BASE_URL` が path を持つ場合も設定不正として 500（A1 の契約化） | CI-A20, A21, A22(部分) | T-T14（`tests/app/api/proxy.test.ts` へ追加。path 付き BASE_URL の負例を含む） |
| CI-T15 | AuthSession | 4 状態のみ。`getMe` の `unauthorized` 以外は `unavailable`。`authenticated→anonymous` の事後に `shell-*`/`api-*` が空。消去失敗は `CleanupIncomplete` として観測可能 | OB-C8, CI-S01, OB-C1 | T-T15（`CacheStore` double＋gateway double） |
| CI-T16 | AdminAccess | 4 値 policy。`AdminGate` は `granted` 以外で children を描画しない | OB-C5 | T-T16（各状態で `queryByRole` null） |
| CI-T17 | Preferences | registry 外の key・列挙外の値は拒否／既定へ正規化。raw dispatch なし | OB-C7, OB-C9, IV8, IV9 | T-T17 |
| CI-T18 | SW 名前空間 | `sw.js` と cleanup の prefix 集合が一致 | CI-S03 | T-T18: 例外的に fs 読み比較（capsule API 外）。TP2 の削除条件として限定 |

coverage（design 時点）: CI-T 18 件すべてに test 仕様あり（実行は未）。既存 CI のうち target で `met` へ変わる見込み: A01/A03/A04/A20/A21, Q01, P01/P05/P08/P09/P12, C01〜C05, X02, S01/S03（計 19 件）。**変えない**: A22（A1 確認待ち）, A26/A27, S02（主体付き key は不採用・SG4）。

## 5. カプセルと公開操作（Boundary / code design）

```yaml
code_design:
  capsules:
    - {id: CP1, name: PlaybackSession, owns: [transport 状態 union, 位置 clamp, セッション速度, 音量, AudioElement port], hides: [Audio API, blob handle の release タイミング], emits: [positionChanged, listenCompleted, stateChanged]}
    - {id: CP2, name: Queue, owns: [QueueState と不変条件 1〜3（内部 gate create）], hides: [配列操作], note: "共有仕様 §2 の公開操作をそのまま"}
    - {id: CP3, name: OfflineLibrary, owns: [保存庫の不変条件, blob handle lifecycle], hides: [Cache Storage key 体系, 3 entry 構成]}
    - {id: CP4, name: PlaybackCoordinator, owns: [UC-P1/P3/P4 の判断: source 選択・挿入規則・失敗方針・INV-P1], hides: [gateway 呼出, ports]}
    - {id: CP5, name: EpisodeDecoder, owns: [DTO→Episode 判別], hides: [optional field の世代差]}
    - {id: CP6, name: ApiGateway, owns: [request, CSRF 付与, ApiFailure 正規化, deadline], hides: [fetch, cookie, status 数値]}
    - {id: CP7, name: AuthSession + AdminAccess, owns: [認証状態 union, 失効時 cleanup, 認可 policy], hides: [getMe, WebAuthn port の注入]}
    - {id: CP8, name: PreferencesRegistry, owns: [key・codec・値域・保存先], hides: [localStorage, JSON encode]}
    - {id: CP9, name: PositionReporter, owns: [UC-P6 の書込: 10 秒 throttle, local 書込, server 書込の単調性, 完聴 1 回, 順序 CI-A13], hides: [KeyValueStore, gateway], note: "gate 指摘 3。CP1/CP4 から位置 writer を集約"}
  public_operations:
    - {capsule: CP1, ops: [start(episode, resume, speed), play, pause, seek, seekRelative, setSpeed, setVolume, state()]}
    - {capsule: CP2, ops: [emptyQueue, current, upNext, start, setQueue, add, playNext, jump, advance, remove, moveUpNext]}
    - {capsule: CP3, ops: [save, get, has, remove, clear, list, usage]}
    - {capsule: CP4, ops: [startEpisode, retry, addToQueue, playNext, removeFromQueue, reorder, skipToNext, nowPlaying(), upNext()]}
    - {capsule: CP5, ops: [decodeEpisode, isPlayable]}
    - {capsule: CP6, ops: ["get/post/put/patch/delete<T>(path, body?) → Promise<Result<T, ApiFailure>>"]}
    - {capsule: CP7, ops: [session(), login, loginWithPasskey, register, logout, retry, adminAccess()]}
    - {capsule: CP8, ops: [get(setting), set(setting, value)]}
    - {capsule: CP9, ops: [attach(session)]}
  branch_decisions:
    - {branch: "resolvePlaybackSource の 3 値", meaning: business decision table, decision: "Coordinator が全 3 値を扱う（caller 側で潰さない）"}
    - {branch: "Q.jump の {found}", meaning: short input guard, decision: "Coordinator 内に留め、UI には公開しない"}
    - {branch: "admin gate 4 重複", meaning: policy, decision: "AdminAccess policy 1 箇所 + AdminGate component"}
    - {branch: "ApiError.status===0 / 404 / 429", meaning: business decision table, decision: "ApiFailure union に変換。404 の意味（subject）は endpoint ごとの gateway 関数が付与"}
    - {branch: "isRestoring", meaning: lifecycle state, decision: "PreferencesProvider の `ready` として保持。AuthSession の `resolving` 開始条件"}
  naming_decisions:
    - {from: AudioPlayerContext, to: PlaybackProvider, reason: "audio 要素ではなく再生セッションとキューの use case を提供する"}
    - {from: useAudioPlayer, to: usePlaybackSession（内部）, reason: "公開は Coordinator 経由"}
    - {from: audioCache, to: offlineLibrary, reason: "技術（cache）ではなく目的（保存庫）"}
    - {from: ApiError, to: ApiFailure, reason: "例外ではなく意味を持つ値"}
    - {from: reorderUpNext, to: moveUpNext, reason: "共有仕様 §2.7 の名に揃える。挙動不変の独立コミット"}
    - {from: "PodcastStatus 'completed'", to: "GenerationStatus（Catalog）/ ListenCompleted（Playback）", reason: "G11 の二義解消。DTO 名は変えず decode 側で語を分ける"}
  abstraction_decisions:
    - {subject: ApiGateway port, decision: adopt, rationale: "SG5・テスト隔離。1 実装"}
    - {subject: AudioElement / KeyValueStore / CacheStore port, decision: adopt, rationale: "既存 test double（tests/helpers/mockAudio.ts, mockCaches.ts）の seam 昇格。1 実装"}
  rejected_overdesign:
    - {subject: createApiClient factory の階層化, rationale: "RO1。差し替え可能性ではなく意味の漏出が問題"}
    - {subject: Strategy for PlaybackSource, rationale: "RO2。3 分岐の純関数で十分"}
    - {subject: 汎用 Storage port, rationale: "RO3。設定ごとに不変条件が異なる（registry で代替）"}
    - {subject: Clock port, rationale: "staleness は学習サイクルで再判定"}
    - {subject: "CP8.subscribe", rationale: "要件・finding なし（gate 指摘 11）"}
    - {subject: "lib/api の context 別 6 分割を S1 で行う", rationale: "SG5『最小注入点』を超える。S4 以降へ送る（gate 指摘 5）"}
    - {subject: "QueueState の branded type 化", rationale: "iOS/Android と共有する型表現の乖離。内部 gate create で代替"}
    - {subject: "旧 AudioPlayerProvider と新 PlaybackProvider の併存移行", rationale: "SG3（正本一意）と二重 owner が両立せず、併存期間の方が回復不能。特性テスト追加で保護（gate 検討案）"}
  dependency_direction: ["app → hooks → contexts → lib/<context> ← lib/platform", "lib/playback ↛ lib/api（Coordinator が gateway 関数を注入で受ける）", "contexts ↛ components（eslint で禁止・T-T7b）"]
  change_scenarios:
    - {id: CS1, name: replace implementation（Audio → 別再生技術 / Cache Storage → IndexedDB / fetch → 別 transport）, expected: pass, evidence: "port の adapter 差替えで CP1/CP3/CP6 の contract test が不変"}
    - {id: CS4, name: change one business rule（挿入規則・失敗方針・パスワード規則・rate_limited scope）, expected: pass（1 ファイル）, evidence: "CP4 / lib/account/password.ts / lib/catalog policy に閉じる"}
    - {id: CS2/CS3, name: add/change variant, status: not_applicable, rationale: "proven variant なし"}
```

**interface が露出してはならないもの（leakage guard）**: `HTMLAudioElement`、`Response`、`RequestInit`、`NodeJS.Timeout`、`React.*` 型（hooks 以外）、`WebAuthnBrowserPort` を UI が組み立てること（Provider が注入する）、`status` 数値、localStorage key 文字列、blob URL 文字列（handle で包む）、`Podcast` DTO を UI が「再生中」の意味で読むこと（`nowPlaying()` を使う）。

## 6. 移行（Change Safety）— §8 の着手順に沿った slice

原則: slice ごとに **特性テスト（現行挙動の pin）→ RED（CI-T*）→ 実装 → 旧 path 削除条件の確認**。1 slice = 1 PR 目安。temporary path は owner・導入日・削除条件を持つ。

| slice | 内容 | 特性テスト（baseline） | RED（T-T*） | temporary path |
|---|---|---|---|---|
| S0 constraint | BFF fail-closed（CI-T14）、失効時 cleanup（現 `AuthContext` 内・CI-T15 の cleanup 部分のみ先行）、`AdminAccess` + `AdminGate`（CI-T16） | `tests/app/api/proxy.test.ts`（40）、`tests/contexts/AuthContext*.test.tsx`、admin 4 page test、`tests/components/NavigationBar.test.tsx` | T-T14, T-T15(部分), T-T16 | なし |
| S1 gateway（**SG5 どおり最小**） | `lib/api/gateway.ts`（`Result`/`ApiFailure`、deadline）と `ApiClientProvider`（1 client を保持）。既存 `createApiClient()` の関数群は **そのまま**（内部で gateway を使う）。Provider 経由に切り替えるのは **再生系 4 箇所**（`contexts/AudioPlayerContext.tsx` の 4 呼出）と `lib/audioCache.ts:20` の import 解消（gateway 関数を引数で受ける）のみ。context 別分割・page 側 15 ファイルは S4 以降 | `tests/lib/api.*.test`（378）、`tests/contexts/AudioPlayerContext.*.test.tsx`、`tests/lib/audioCache.test.ts` | T-T12, T-T13 | **TP1** `ApiError` 互換（`ApiFailure` から生成して throw する薄い adapter を旧関数群に残す）。owner: user、導入: S1、削除条件: `app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時（grep 0） |
| S2 playback（**一括切替・SG8**） | `lib/playback/{session,queue,source,resume,offlineLibrary,coordinator,positionReporter}`、`PlaybackProvider`（旧 `AudioPlayerProvider` を置換）、`AppContext.currentPodcast` 削除、速度 2 概念、状態 union、失敗方針、`EpisodeDecoder`（Coordinator 内）、**`AudioPlayerBar` と `podcast/page.tsx:199` の「再生中」判定を `nowPlaying()` へ置換**、`useStartPodcast` 削除（Coordinator の `startEpisode` を直接）、`moveUpNext` rename（独立コミット） | **7 + 5 ファイル**: `tests/contexts/AudioPlayerContext.{queue,offline,completion}.test.tsx`、`tests/hooks/useAudioPlayer.test.ts`、`tests/lib/audioCache.test.ts`、`tests/lib/playbackQueue.{test,conformance.test}.ts`、`tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/app-group-layout.test.tsx`、`tests/contexts/AppContext.test.tsx`、`tests/app/settings/page.test.tsx`（速度）、e2e `offline-playback` / `queue-autoadvance` / `main-flow` | T-T1〜T-T11 | **TP2** `sw.js` prefix 複製の pin テスト（T-T18）。owner: user、導入: S2、削除条件: ビルド時注入か SW を module 化した時 |
| S3 gates | CI に `typecheck:ts7` と独立 build、T-T7b の eslint ルール | — | ci.yml / eslint.config 差分 | なし |
| S4 catalog/prefs（学習サイクルで） | `Episode` を `PodcastCard`/`podcast` pages へ展開、`PreferencesRegistry`（theme inline script は **TP3**）、`rate_limited.scope`、`PasswordPolicy` 単一化（SG7）、`lib/api` の context 別分割と page 側注入点移行 | page tests | T-T11（UI 側）, T-T17 | **TP3** inline theme script の key/列挙複製（pin テスト）。owner: user、導入: S4、削除条件: `beforeInteractive` script を module から生成できた時 |
| S5 learning（保留） | `lib/learning/` の 3 ルール、StreakContext の副作用移動 | — | OB-L1 | — |

**S2 の scope 上の注意（gate 指摘 1）**: `AudioPlayerBar` は `Podcast` DTO の field（`duration_seconds`/`difficulty`/`created_at`）を直読みしているため、`AppContext.currentPodcast` 削除と同時に必ず型が変わる。`nowPlaying()` の view model（title, difficulty, createdAt, durationSeconds, episodeId）を S2 で定義し、`AudioPlayerBar` の変更を S2 に含める（S4 に送らない）。

**§8 からの逸脱（gate 指摘 6 → SG9）**: review §8.3 で「記録のみ・変更しない」とした RF16（完聴重複・位置順序）、RF18（Queue 不変条件 gate）、RF19（依存方向）、RF20（SW prefix pin テスト）を、本 Spec は S2 の一部として作業化している。理由: CP9 / `Queue.create` / 依存禁止 / T-T18 は S2 の構造変更に付随し、後から入れる方が高い。追加コストは小（各 1 テスト＋数十行）。**RF4・RF14・RF22 は本 Spec で扱わない**。RF17 は UV3 の観測のみ。採否は SG9。

**不可逆点**: なし（UI 内部構造のみ。backend 契約・localStorage key 名・Cache 名前空間・共有仕様 §2 は不変）。
**rollback**: slice 単位の revert。S2 は一括切替（SG8 default）だが、上記 12 特性テスト＋e2e 3 本が **すべて追加・green になってから** 切替に入る（それ以前は revert 以外の回復手段がないため）。

## 7. Requirement → UC → model → contract → test の trace

| R | UC | model / capsule | CI | test | status（design） |
|---|---|---|---|---|---|
| R1 業務ルール単一所有 | UC-P1/P3, UC-L1, UC-A2, UC-M* | CP4, Catalog policy, PasswordPolicy, AdminAccess | CI-T5/T6/T16, CS4 | T-T5/6/16 | covered（PasswordPolicy は SG7 待ち） |
| R2 再生の不正状態なし | UC-P1〜P6 | CP1, CP2, CP3, CP5 | CI-T1/T2/T3/T9/T10/T11 | T-T1〜3, 9〜11 | covered |
| R3 正本一意 | UC-P1/P2/P6 | Queue.current + INV-P1, CP9, PreferencesRegistry | CI-T4/T7/T8 | T-T4/7a/7b/8 | covered |
| R4 失敗の意味 | 全 UC | CP6 Result/ApiFailure, errored(reason) | CI-T5/T12/T13/T14 | T-T5/12/13/14 | covered |
| R5 unknown で保護 UI なし | UC-M* | AdminAccess, AdminGate | CI-T16 | T-T16 | covered |
| R6 主体離脱でキャッシュ残留なし | UC-A1, UC-S2 | AuthSession 事後条件, TP2 | CI-T15, CI-T18 | T-T15/18 | covered（S02 主体付き key は不採用を明記） |
| R7 本番経路のテスト | — | ApiGateway seam, ports | CI-T12 + 各 T-T が real gateway＋fetch double | 各 slice に real `request()` 経由の integration 1 本以上。E2E の `page.route` stub は本 Spec では変えない（backend 実接続は環境が無く out_of_scope と明記） | partial（E2E は据置） |
| R8 CI ゲート | — | — | — | ci.yml | covered（S3） |

**UC 側の coverage 分母（gate 指摘 10）**: UC 21 件のうち CI-T を持つのは UC-P1〜P6, UC-A1, UC-M*（gate）, UC-S2 の 10 件。**CI 対象外 11 件と理由**: UC-L1〜L5（学習サイクル S5 で model 化。今回は gateway 呼出＋表示で、web 側の判断が「文言」以外に無い）、UC-M1〜M4 の操作本体（ルールは backend。web は表示と送信のみ）、UC-A2/A3（S4 の Preferences / PasswordPolicy で扱う）、UC-S1（`usePodcastListPolling` の停止条件単一化は S4）、UC-S3（`reportClientError` の gateway 経由化は S4）。

## 8. 検証計画と decision

```yaml
verification_plan:
  per_slice: ["特性テスト green（baseline）", "T-T* RED → GREEN", "npm test / lint / typecheck / typecheck:ts7 / build", "S2 のみ: e2e offline-playback / queue-autoadvance / main-flow、UV3（resume 位置の実ブラウザ観測）"]
  independent: ["slice ごとに code-review ロール 1 回（consolidated）", "S2 完了時に adversarial-review で CI-T1〜T11 の oracle を検算"]
  unexecuted_now: [UV1 e2e, UV2 T-T* 実装, UV3]
  pre_implementation_gate: {role: architecture, result: revise → 本版で 11 件反映, artifact: "docs/research-reports/2026-09-16-code-design-review/spec-gate.md"}
selection_gates:
  - {id: SG6, subject: "Queue.start / setQueue を公開操作として残す", owner: user, status: satisfied_by_default, decision: "残す（conformance Q-* が両操作を検証しており、削除は Q-spec 準拠を壊す）"}
  - {id: SG7, subject: "パスワード長の統一値", owner: user, status: satisfied, decision: "8〜20 文字（2026-09-16）。S4 で 1 実装化。backend 検証値との整合を先に確認（OB-A1）"}
  - {id: SG8, subject: "S2 の切替方式", owner: user, status: satisfied, decision: "一括切替（2026-09-16）。特性テスト 12＋e2e 3 が green になってから"}
  - {id: SG9, subject: "RF16/RF18/RF19/RF20 を S2 で作業化する逸脱", owner: user, status: satisfied, decision: "採用（2026-09-16）"}
decision:
  status: pass
  artifact_readiness: ready
  engineering_status: planned
  release_status: not_applicable
  decision_maturity: {status: approved, owner: user, approval_evidence: ["2026-09-16 user: Spec 承認・SG8 一括切替・SG9 採用・SG7 8〜20 文字"], baseline_version: "2026-09-16", change_control: "本書を更新して再承認"}
  next_phase: {name: "S0 実装（tdd-implementation ロール）", status: allowed, human_approvals_required: []}
  resolved_unknowns:
    - {id: A1, resolution: "BACKEND_BASE_URL は origin のみ（docs/operations/2026-06-11-deployment-status.md:121 の Cloud Run URL、web-local-dev.md:30 の http://api:8080）。path prefix なし → RF4 の無害判定は成立。S0 で『BASE_URL に path があれば起動時 500』の guard を CI-T14 に含め、assumption を契約へ昇格する"}
    - {id: UV3, resolution: "HTML 仕様上、readyState=HAVE_NOTHING での currentTime 代入は default playback start position として metadata 読込後に適用される（現行コードは仕様どおり動く見込み）。ただし iOS Safari の既知の非準拠歴があるため、Session は loadedmetadata で resume を冪等に再適用する設計（CI-T3）にし、ブラウザ依存を消す。実ブラウザ観測は S2 の e2e（Chromium）＋ iOS Safari 手動 1 回に縮小"}
  unknowns: [OB-A1（backend のパスワード検証値）]
  residual_risks: ["S2 は一括切替のため、特性テスト追加を先行させないと回復手段が revert のみ", "ApiFailure 導入で文言ラダーが一時的に二重化する（TP1 の削除条件で回収）", "R7 の E2E は backend stub のまま（実接続環境なし）"]
```
