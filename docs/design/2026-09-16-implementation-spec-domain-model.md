# news-listen-web Implementation Spec — Use Case・目的別ドメインモデル・カプセル化（design mode）

日付: 2026-09-16 ／ mode: design（read-only、実装は別フェーズ）／ owner: user ／ decision_maturity: **approved（2026-09-16 user 承認。SG9=採用。SG7 は ADR-101 で 12〜20 文字へ、SG8 の一括切替は 2026-09-23 の再スライスで 3 段分割へ改めた）** ／ 最終更新: 2026-09-30（本文の表を現行値へ更新。末尾「改訂履歴」）
入力: `docs/research-reports/2026-09-16-code-design-review.md`（finding RF*・§8 人間判断）と同ディレクトリの Function package（G*/IV*/OB-C*/CI*/LF*/F*/SG*）。
位置づけ: 親リポ `docs/design/web-design.md` §6〜§9 の**target 版**。実装が進んだ節から web-design.md を書き換える（本書は移行中の設計正本）。
運用（2026-09-30 改訂）: 本文の表は 2026-09-30 に現行値へ更新した。**本文が現在有効な契約**である。冒頭の追記節は改訂の経緯として残す（追記が「置換」「上書き」と書く内容は本文へ反映済み）。以後は本文を直し、末尾の「改訂履歴」に 1 行足す。決定 ID の台帳は親 docs `research-reports/2026-09-23-design-docs-mino-audit.md` の §5（SG-* = user が承認した決定）と §5.0（W-* = 承認済みの決定からの導出）。採用済みで未実装の決定は「target（決定 ID・未実装）」と書く。slice の進捗は `docs/plan/2026-09-16-design-review-refactor/README.md` の状態欄が正本で、本書には書かない。

> 設計原則（本書の判断順）: actor の目的 → use case → その判断に必要な概念・不変条件 → 契約 → カプセル（公開操作と隠す技術）→ 依存方向 → 移行。pattern 名・class 数は成果にしない。1 実装しかない箇所に factory / Strategy を作らない（Boundary RO1〜RO6 を踏襲）。


> **追記（2026-09-16・共有仕様 §6.7 の確定による上書き）**: 親 docs `shared-playback-spec.md` §6.7 の Selection Gate が user 判断で確定し、本書の次の記述を上書きする（2026-09-30 に本文へ反映済み。この追記は経緯として残す）。
> - SG-X1: 完聴時にサーバーへ送る位置は **`duration`**（§3.1 Coordinator `onEnded` の「位置 0 保存」、CI-T8 の「完聴の 0 は最終」を置換。順序は onCompleted → `duration` → advance）。
> - SG-X2: resume は **末尾 2 秒窓**（共有仕様 §4.3 RS-01〜07）。CI-T3 の「duration 以上なら 0」を置換。
> - SG-X4: 位置同期の周期送信は再生中のみ（web は現行どおり）。
> - パスワード（SG7）: **12〜20 文字**（ADR-101。本書の「8〜20」を置換）。
>
> **追記（2026-09-30・wave 1 完了後の前提点検による上書き）**: 再生の停止の扱いを user 判断で確定した（親 docs 監査レポート §5 の SG-C24・SG-C25、共有仕様 §6.6）。本書の次の記述を上書きする（2026-09-30 に本文へ反映済み。この追記は経緯として残す）。
> - SG-C24: `PlaybackSession` の公開操作に **`stop`** を足す（§5 CP1 の ops を置換）。`stop` は §3.1 の遷移表の外の**リセット**で、どの状態からでも `idle` へ戻し、分母 13 には数えない。契約 **CI-T1b**: 任意の状態で `stop` → `idle`・`AudioElement` が一時停止し音源を外す（`pause()` → `src` を空に → `load()`）・`idle` での `stop` は何もしない。検証 T-T1b は `AudioElement` double の状態（`paused` と `src`）で観測し、呼出回数は問わない（W-S2a）。
> - `AudioElement` port は変えない（停止は既存の `pause` / `src` / `load` で表せる）。
> - 主体離脱時の再生停止 `stopForSubjectLeave()`（W-S5）はこの `stop` を使う。W-S5 は Session を変更しない。
>
> **追記（2026-09-30・wave 3 の前提点検による上書き）**: W-S2a の実装後に、続く slice の指示書を現行コードと照合して user 判断で確定した（親 docs 監査レポート §5 の SG-C50・C52〜C57・C61〜C63、共有仕様 §2.4・§2.11・§2.12・§6.4・§6.6、親 docs `adr/105-playback-session-out-of-table-operations-and-shared-rules.md`、`design/web-design.md` §12.6）。本書の次の記述を上書きする（2026-09-30 に本文へ反映済み。この追記は経緯として残す）。
> - **取得前・開始前の失敗**（SG-C52。§3.1 の `errored` 行「取得前の失敗は `episodeRef: {id}` のみ」を実現する入口）: `PlaybackSession` に遷移表の外の公開操作「失敗にする」を足す（§5 CP1 の ops を置換）。どの状態からでも、id だけの参照と理由（`fetch_failed` / `source_unavailable`）を渡して `errored` に入れる。13 遷移の分母には数えない。`errored` の `episode` は「再生可能なエピソード」か「id だけの参照」のどちらかを取る。契約 **CI-T1f**: 任意の状態から `errored(理由)` になり、音声要素は一時停止して音源を外す。W-S2a の実装にはこの入口が無いため、**W-S2a の修正 slice** を W-S2a2 の前に入れる。
> - **`setQueue` の重複 id**（SG-C50）: 開始位置は元の入力で clamp して id を決め、先勝ちで重複を除いた後のその id の位置を現在にする（実装済み。準拠テストに共有仕様 Q-33 を足す）。
> - **手動で選んだエピソードが開始前に再生できないと分かる場合**（SG-C62。§3.1 Coordinator の `startEpisode`）: キューもセッションも変えず、通知だけを返す。`errored` にするのは、キューが既にそのエピソードを現在にしている場合（`onEnded` 後の advance・`retry()`）だけ。
> - **完聴時の順序**（SG-C61。§3.1 Coordinator `onEnded`・CI-T8）: 完聴の記録と総時間の位置書込をこの順で送り始める。次の再生開始は応答を待たない。
> - **総時間の正本**（SG-C54）: 音声要素の値（0 より大きい）→ `PlayableEpisode.durationSeconds`（0 より大きい）→ 不明。再開位置の計算は開始前なので `durationSeconds` を使う。完聴時に送る値は優先順で得た値、不明なら完聴時点の現在位置、それも 0 なら送らない。Session の実装（総時間は音声要素から取り、不明な間は上限で丸めない）は変えない。
> - **位置同期の契機**（SG-C53。§3.1 PositionReporter・CI-T8）: 再生中の周期送信に加え、一時停止・停止への遷移で即時 1 回送る（共有仕様 §6.4 どおり。現行は周期保存だけなので変わる挙動）。周期送信は状態が `playing` のときだけ行う。タブを閉じる・隠すときの送信は保留。
> - **OfflineLibrary の保存**（SG-C55。§3.1 の `save(episode: PlayableEpisode)` を置換）: `save(id)`。取得関数は保存庫の生成時に渡し、保存の直前に新しい署名付き URL を取り直す。永続化するときは署名付き URL を空にする（現行 `downloadAudio` と同じ）。
> - **再生失敗の通知**（SG-C56。§2 の「通知は use case の結果として返し、hook 側で Toast に写す」を具体化）: 後から届く失敗（再生中の音声エラー、自動で次へ進んだ後の失敗）は状態の変化として届くので、再生の状態を購読して `errored` に入ったときに toast を 1 回出す部品を `components/` 側に置く。`PlaybackProvider` は `components/` を import しない。文言は 3 種類（現行の 2 種類に、手動の開始がオフラインで未保存のときの「オフラインのため再生できません」を足す。SG-C69 で改訂）。
> - **音量**（SG-C57。§5 CP1 の「音量」）: Session は音声要素へ設定する唯一の入口。値の保持・`player_volume` への保存・起動時の復元は `PlaybackProvider` が持つ（保存 key の宣言は W-S4b で登録簿へ移す）。
> - **次へ送り**（SG-C63。CP4 の `skipToNext`）: 共有仕様 §2.12 のとおり（次が再生できれば今を止めて次を再生、次が再生不可と分かれば何も変えない、待機列が空なら何もしない）。
> - **決定から導いた宣言**（監査レポート §5.0 の導出 W-1〜W-15。導出の正本は本書（§2・§3.1・§4・§5）と台帳 §5.0。order は切り出し）: `OfflineLibrary.get(id)` は保存した DTO・blob URL・解放用の handle を返し、`PlayableEpisode` への変換は Coordinator が行う（W-1。§3.1 の `get(id) → PlayableEpisode & {audioHandle}` を置換）。blob URL の発行と保存領域の見積もりは `lib/platform` の adapter を注入する（W-2）。`has(id)` は最後に書く entry で判定する（W-3）。gateway のパスを組み立てる関数は `lib/playback/gatewayFns.ts` に置き、Coordinator・Reporter・保存庫は関数を注入で受ける（W-4）。Coordinator は読み取り側の通知 `subscribe` を持ち、9 操作には数えない（W-5）。PositionReporter の規則（エピソードごとの基準の戻し方・同じ位置を再送しない・完聴は 1 回・Reporter が完聴の記録を送る・Coordinator が Reporter を先に attach する）（W-6）。Cache Storage が無い環境では保存庫の各操作が安全に縮退する（W-7）。`startEpisode(id)` は結果（開始した／通知の種類）を返す（W-8）。保存庫は Provider の外から消すための `clearOfflineAudio(cacheStore)` を export する（W-10）。`addToQueue` / `playNext` も結果を返す（W-11）。`nowPlaying()` / `upNext()` の `title` は `podcastTitle` を通した表示用の文字列（W-12）。toast は `components/PlaybackToasts.tsx` が出す: `errored` に入ったとき 1 回出す部品と、開始の 4 操作の結果を toast に写す hook（W-13）。再生ボタンは `errored` なら `retry()`、`ended` なら現在のエピソードを開始し直す（W-14）。利用者の開始を自動で次へ進む開始より優先する（W-15・SG-C73）。
> - **2026-09-30 夜の確認**（監査レポート §5 の SG-C64〜C79）: 巻き戻した位置も保存する（SG-C67。W-6 の「同じ再生の中で小さい位置は送らない」を取りやめ、§4 CI-T8 の「server 位置書込は単調非減少」を置換）。toast はオフラインで未保存の場合の文言を足して 3 種類（SG-C69。SG-C56 を改める）。`partial_failed` は再生不可のまま（SG-C64）。位置同期の新しい規則（記録時刻の新しい方を正とする・オフラインで記録した位置を後から同期する・再開時の確認。SG-C74〜C79・親 docs ADR-109）は、§3.1 の PositionReporter・resume の合成（Q12=A）・「backend の契約は変えない」（位置の書込の 1 点）を改めるが、web への反映は W-S2c の後の別の slice で行う。

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
  public_contract_change_allowed: false   # backend API・共有再生仕様 §2 は不変。例外は backend 側の変更へ web が追随する 2 点: 位置の書込の recorded_at（ADR-109 決定 1〜4・SG-C74。target・未実装 = backend B-S7 の後に web の位置同期 slice）と user_id の公開（ADR-104 決定 15・SG-C15。backend B-S5a で公開済み。web の利用は W-S5 = target・未実装）
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
| UC-P4 キューを編成する | Listener | 追加・次に再生・削除・並べ替え・スキップ | 共有仕様 §2（Q-01〜Q-33。SG-C50） | Playback |
| UC-P5 オフライン保存 | Listener | 保存・削除・保存一覧・使用量 | 成功応答のみ保存、保存済み＝再生可能、blob の解放 | Playback（OfflineLibrary） |
| UC-P6 再生位置の復元 | Listener | 別端末／同端末で続きから | 候補位置の合成 `server > 0 ? server : local` → `resolveResumePosition(candidate, durationSeconds)`（末尾 2 秒窓。SG-B5・SG-X2）、書込順序 | Playback |
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
| **Playback** | 聴き続ける | `PlaybackSession`（transport 状態）, `Queue`（現在再生中・待機列）, `PlaybackSource`, `ResumeRule`, `OfflineLibrary` | `lib/playback/`、`contexts/PlaybackProvider.tsx`、`hooks/usePlayback*.ts`、`components/PlaybackToasts.tsx`（toast を出す部品と hook。W-13） |
| **Catalog** | 聴く対象を選ぶ | `Episode`（Playable/Generating/Failed）, `Article`（star/dismiss）, `GenerationQuota`, `Source`/`FeaturedSource`, 生成状態の遷移検知 | `lib/catalog/` |
| **Learning** | 定着・継続 | quiz, vocabulary, streak, dashboard, achievement 既読 | `lib/learning/`（本書では境界と obligation のみ） |
| **Account** | 誰であるか・何ができるか | `AuthSession`（判別共用体）, `AdminAccess` policy, `PasswordPolicy`（単一）, credentials / sessions | `lib/account/`、`contexts/AuthProvider.tsx` |
| **Preferences** | 自分の使い方 | 設定レジストリ（key・codec・値域・保存先）。server 設定と local 設定を同じ registry で宣言 | `lib/preferences/`、`contexts/PreferencesProvider.tsx` |
| **Admin** | 運営 | 一覧・作成・更新・失効（generic。ルールは backend） | `lib/api/admin.ts`（gateway 呼出のみ）+ `hooks/useAdminGate.ts` |
| **Notifications** | 通知 | `PushSubscriptionState`（状態機械は購読 hook が維持）。端末の購読とサーバ登録の整合は `PushRegistration`（5 操作: `resolve` / `subscribe` / `unsubscribe` / `reregister` / `detachFromSubject`）が持つ。認証状態が `authenticated` に変わるたびに既存の購読を backend へ再送し、logout ではサーバ行だけを解除する（ADR-104 決定 18〜24・SG-C5・C6。W-0 で実装済み） | `lib/push/pushRegistration.ts`、`components/PushReregistration.tsx`、`hooks/useWebPushSubscription.ts` |
| **Platform** | 技術境界 | `ApiGateway`（request＋`ApiFailure`）, `KeyValueStore`, `CacheStore`, `AudioElement`, BFF proxy（server） | `lib/api/gateway.ts`、`lib/platform/*`、`app/api/backend/[...path]/route.ts` |

**依存方向の禁止事項（prohibited_structures）**
- `lib/<context>/` は React・`fetch`・`localStorage`・`caches`・`Audio` を import しない（port 経由のみ）。
- `lib/playback/` は `lib/api/` を import しない（Explorer/Architecture の違反 `audioCache.ts → api.ts` を解消。取得は Coordinator が Catalog gateway から受け取って渡す）。gateway のパス・method・body を組み立てる関数は `lib/playback/gatewayFns.ts`（`lib/api/gateway` からは型の import だけ）に置き、Coordinator・PositionReporter・OfflineLibrary は `Result` を返す関数を注入で受ける（W-4）。ブラウザのグローバル（blob URL の発行・解放、保存領域の見積もり）も直接使わず、`lib/platform` の adapter（`objectUrl.ts`・`storageEstimate.ts`）を注入で受ける（W-2）。
- `contexts/` は `components/` を import しない（`AudioPlayerContext → Toast` の逆依存を解消。通知は use case の結果として返し、hook 側で Toast に写す。toast を出すのは `components/PlaybackToasts.tsx`: SG-C56・W-13。§3.1）。
- `app/` は `ApiError.status` や `localStorage` を直接参照しない（`ApiFailure` と Preferences registry を使う）。

**port を置く根拠（abstraction gate）**: 4 つだけ。いずれも「1 実装だが品質根拠あり」。

| port | 根拠 | 既存の萌芽 |
|---|---|---|
| `ApiGateway` | SG5（テスト隔離・本番経路同一）、LF1/LF15 | `lib/api/legacyRequest.ts request()`（W-S1b で `lib/api.ts` から移設） |
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
| `ended` | episode, duration | 完聴の記録と位置の書込は PositionReporter が送り（W-6）、Coordinator は `advance` する。再生ボタンは現在のエピソードを開始し直す（W-14） |
| `errored` | episode（「再生可能なエピソード」か「id だけの参照 `{id}`」のどちらか。取得前・開始前の失敗は id だけの参照: SG-C52）, position, `reason: media \| autoplay_blocked \| source_unavailable \| fetch_failed(ApiFailure)` | `episode` が再生可能なエピソードのとき `play()` → `loading`（読み込み直す）。id だけの参照のとき `play()` は何もしない（音源を持たないので読み込み直せない。W-9）。再試行の入口は Coordinator の `retry()`（再生元の解決からやり直す。W-14）／`start` |

**遷移表の外の操作**（下の分母 13 に数えない）
- `stop`（SG-C24・C25。実装済み: W-S2a）: どの状態からでも `idle` へ戻すリセット。`AudioElement` を一時停止し音源を外す（`pause()` → `src` を空に → `load()`）。`idle` での `stop` は何もしない。`AudioElement` port は変えない（停止は既存の `pause` / `src` / `load` で表せる）。契約は CI-T1b。
- `fail`（「失敗にする」。SG-C52。target・未実装: W-S2a1）: 取得前・開始前の失敗を表す入口。どの状態からでも、id だけの参照と理由（`fetch_failed` / `source_unavailable`）を渡して `errored` に入れる。音声要素は一時停止して音源を外す。`fail` の後の `errored` は `position` が 0、`speed` は直前の値（無ければ 1.0）（W-9）。契約は CI-T1f。
- 読み取り側の通知 `subscribe`（実装済み: `lib/playback/session.ts`）: `stateChanged` / `positionChanged` / `listenCompleted` を届ける。完聴時は `listenCompleted` → `stateChanged(ended)` の順で emit する。

**「現在再生中」の二重表現の解消（gate 指摘 2）**: `Queue`（共有仕様 §2.1、`items` は `Podcast` DTO のまま）は「順序と現在位置」の正本、`PlaybackSession` は「現在位置の decode 済み `PlayableEpisode`（再生に必要な payload）」の保持者。不変条件 **INV-P1**: `session` が `idle` でないとき `session.episode.id === Queue.current(queue).id`。UI が「何が再生中か」を問う唯一の入口は Coordinator の `nowPlaying()` query（`Queue.current` から id、`session.episode` から title / difficulty / createdAt / duration を導出した view model）。`AppContext.currentPodcast` と `AudioPlayerBar` の DTO 直読み（`components/AudioPlayerBar.tsx:16,28-30,65-66,139,160`）はこの query に置き換える。`nowPlaying()` と `upNext()` の `title` は `podcastTitle` を通した表示用の文字列（50 字・40 字。現行の再生バーの表示を変えない。日本語イントロの原文は持たせない。W-12）。

遷移表の分母（T-T1 用に固定）: idle→loading, loading→paused, loading→errored, paused→playing, paused→paused(seek), paused→loading(start), playing→paused, playing→ended, playing→errored, playing→playing(timeupdate), ended→loading(advance), errored→loading(retry), errored→loading(start) の **13 遷移**。表外の遷移（例: idle→playing、ended→playing）は禁止。

不変条件: `position ∈ [0, duration]`（seek / seekRelative とも clamp、CI-P08）。速度は `PLAYBACK_SPEEDS` 内（OB-C9）。`start` 時のセッション速度は Preferences の既定速度で初期化し、以後はセッション内で保持・`load` 後に再適用（§8 Q5、CI-P12）。`play()` の reject は `errored(autoplay_blocked | media)` へ遷移し、呼出側は状態で観測する（CI-P09/P10）。総時間の正本は「音声要素の値（0 より大きい）→ `PlayableEpisode.durationSeconds`（0 より大きい）→ 不明」で、不明な間は位置を上限で丸めない（SG-C54）。音量は、Session が音声要素へ設定する唯一の入口で、値の保持・`player_volume` への保存・起動時の復元は `PlaybackProvider` が持つ（SG-C57）。

**Queue** — 共有仕様 §2 の `QueueState` と公開操作をそのまま採用（`items` は `Podcast` DTO。iOS/Android と共有する契約なので型を変えない）。公開操作は §2 どおり **正規化** する（`setQueue` の `startAt` clamp §2.4 と重複 id の扱い = 開始位置を元の入力で clamp して id を決め、先勝ちで重複を除いた後のその id の位置を現在にする: SG-C50・Q-33・実装済み、`add`/`playNext` の dedupe §2.5/2.6、範囲外 `moveUpNext` の no-op §2.7）。**入力を拒否しない**。追加するのは内部の不変条件 gate `Queue.create(items, currentIndex)`（不変条件 1〜3 を検査し、違反は **programmer error として throw**。全公開操作の戻り値がこれを通る。OB-C4 / CI-Q01）。公開操作は throw しない。`Queue.current` を「現在再生中（の位置）」の唯一の正本と宣言する（SG3、OB-C12）。`AppContext.currentPodcast` は削除。`start`/`setQueue` は conformance（Q-*）が検証する §2.3/2.4 の操作なので **残す**（SG6 default。削除は Q-spec 準拠を壊す）。`reorderUpNext` → `moveUpNext` の rename は挙動不変の純粋 rename として **独立コミット**（引数意味＝upNext 基準・削除前オフセット、conformance 行 ID は不変。影響: `lib/playbackQueue.ts:95`, `contexts/AudioPlayerContext.tsx:188`, テスト 3 ファイル）。

**PlaybackSource / ResumeRule** — 既存の純関数（`resolvePlaybackSource`, `resolveResumePosition`）を `lib/playback/` に置く。`resolveResumePosition(candidate, durationSeconds)` の入力は候補位置と総時間で、候補位置の合成（`server > 0 ? server : local`）は Coordinator の 1 箇所で行う（SG-B5）。`'unavailable'` のとき Coordinator はネットワーク取得を行わない（CI-X02 / OB-C6）。手動の開始ではキューもセッションも変えずに通知を返し（SG-C62）、`errored(source_unavailable)` に写すのは、キューが既にそのエピソードを現在にしている場合（自動で次へ進んだ後・`retry()`）だけ（SG-C52）。

**OfflineLibrary** — Cache Storage 上の「再生可能なエピソードの保存庫」。

| 操作 | 事後条件 |
|---|---|
| `save(id)`（SG-C55） | 取得関数は保存庫の生成時に渡し、保存の直前に新しい署名付き URL を取り直す（現行 `downloadAudio` と同じ挙動）。応答 `ok` のときだけ格納（CI-C01）。audio → meta → episode の順に書き、最後の書込が完了するまで `has()` は false（CI-C05 の原子性を「manifest 最後書き」で実現）。永続化するときは署名付き URL を空にする。重複 save は収束 |
| `get(id)` → 保存した DTO・blob URL・解放用の handle（無ければ null）（W-1） | `PlayableEpisode` への変換は Coordinator が行う（保存庫が Coordinator を import すると循環する。保存済みの DTO は `audio_url` が空。CI-C02 の「再生可能」は変換後に成り立つ）。handle の `release()` で revoke。発行者＝解放者（CI-C03 / OB-C14。Session は `start` 時に前 handle を release）。blob URL の発行・解放は `lib/platform` の adapter を注入で受ける（W-2） |
| `has(id)` | 最後に書く entry（`/_audio-podcast/{id}`）で判定する（W-3） |
| `remove(id)` / `clear()` / `list()` / `usage()` | `list()` は列挙中の削除で例外を投げない（CI-C04）。`usage()` は保存領域の見積もりの adapter を注入で受ける（W-2） |

失敗の意味: 非対応環境は `unsupported`、quota 超過は `storage_full`、応答非 ok は `download_failed(ApiFailure)`。UI 文言は hook 側で写像。

Cache Storage が無い環境（`createBrowserCacheStore()` が `null`）では、`save` は `unsupported`、`has` は false、`get` は null、`list` は空、`remove` / `clear` は何もしない（W-7）。保存庫は `clearOfflineAudio(cacheStore)` を export する（`clear()` の実体。logout は `PlaybackProvider` の外側の認証 Provider が行い、保存庫の生成に要る依存を持たないため。W-10）。Cache の名前と主体別化は §3.3。

**PlaybackCoordinator（use case orchestration・`lib/playback/coordinator.ts` の非 React 関数群。`contexts/PlaybackProvider` が配線する）**

- 依存（W-5）: `session`・`offline`・`positionReporter`・`fetchEpisode`・`keyValueStore`・`isOnline`・`defaultSpeed`。gateway の関数は注入で受ける（W-4）。Coordinator は PositionReporter を先に attach し、その後で Session を購読する（完聴時に Reporter が先に事象を受ける。W-6）。公開操作は 9 つ（§5 CP4）。これとは別に読み取り側の通知 `subscribe` を持ち、9 操作には数えない（自動で次へ進んだときに Provider が再描画できるようにする。W-5）。
- `startEpisode(id)`（id を受け、結果（開始した／通知の種類）を返す。W-8）: `source = resolvePlaybackSource({hasCached: library.has(id), isOnline})` → `cached` なら `library.get`（DTO から `PlayableEpisode` への変換は Coordinator: W-1）／ `network` なら注入された取得関数（W-4）。`unavailable` のとき、または取得した Episode が Playable でないとき（IV2 を閉じる、OB-C10）など、**開始前に再生できないと分かった場合は、キューもセッションも変えず、通知だけを返す**（再生中のものは続く。SG-C62）。再生できる場合、Queue は `jump` 済みならそのまま、無ければ `playNext`→`jump`（現状の挿入規則を維持）。`candidate = server > 0 ? server : local`、`resume = resolveResumePosition(candidate, durationSeconds)`（合成はこの 1 箇所だけ: SG-B5。開始前なので総時間は `PlayableEpisode.durationSeconds` を使う: SG-C54）。`session.start(episode, resume, speed: prefs.defaultSpeed)`。
- `addToQueue` / `playNext` も、開始の結果を同じ形で返す（何も再生していないときの即再生が失敗したことを、呼んだ側が toast にできるようにする。W-11）。
- `skipToNext`（SG-C63。共有仕様 §2.12）: 次が再生できれば今を止めて次を再生する。次が再生不可と分かれば何も変えない。待機列が空なら何もしない。
- 利用者の開始の優先（SG-C73・W-15）: 利用者が起こした開始の待ちが残っている間、自動で次へ進む処理を始めない。自動の待ちの間に利用者の開始が来たら、自動の側を捨てる。
- `onEnded`: 完聴の記録と総時間の位置書込は PositionReporter が送り始める（下の CP9）。Coordinator は応答を待たずに `Queue.advance` → `next` があれば開始する（SG-C61）。この経路ではキューが既に次を現在にしているので、再生できないと分かった場合・取得に失敗した場合は、Session の `fail` で `errored(reason)` に入れて **停止** する（SG-C52）: `current` は失敗エピソードのまま残り、再試行は `retry()`（§8 Q6、OB-C2）。`retry()` は再生元の解決からやり直し、失敗したら同じく `errored` にする（SG-C62）。
- 通知（SG-C56・SG-C69・W-13）: toast は `components/PlaybackToasts.tsx` の 2 つが出す。`errored` に入ったとき 1 回出す部品（後から届く失敗 = 再生中の音声エラー、自動で次へ進んだ後の失敗）と、開始の 4 操作を包んで `{ ok: false }` を toast に写す hook（手動の開始の失敗は状態を変えないので、状態の購読だけでは拾えない）。`PlaybackProvider` は `components/` を import しない。文言は 3 種類: 現行の 2 種類と、手動の開始がオフラインで未保存のときの「オフラインのため再生できません」（SG-C69）。自動で次へ進んだ後のオフラインは区別しない（保留。SG-C69）。
- 再生ボタン（W-14）: `errored` なら `retry()`、`ended` なら現在のエピソードを開始し直す（Session の `play()` は、`ended` と id だけの `errored` では何もしない。再生可能なエピソードを持つ `errored` では読み込み直す = 現行実装。W-9）。
- 位置保存は Coordinator の責務ではなく **`PositionReporter`（CP9）** が単独所有する（gate 指摘 3）。Session は `positionChanged(episodeId, seconds)` と `listenCompleted(episodeId)` の事象を公開し、CP9 が 10 秒 throttle・local 書込・server 書込・順序（CI-A13）を一手に持つ。CP1 は storage を持たない。規則は次のとおり。
  - 周期送信は状態が `playing` のときだけ行う（SG-X4）。
  - 一時停止・停止への遷移で即時 1 回送る（SG-C53）。同じ位置は再送しない（W-6）。タブを閉じる・隠すときの送信は保留（SG-C53）。
  - 巻き戻した位置も保存する（SG-C67）。「server 位置書込は単調非減少」「最終書込より古い位置を送らない」は廃止した。
  - エピソードごとの基準は `stateChanged(loading)` で戻す（W-6）。
  - 完聴は 1 回の再生の中で 1 回。完聴の記録（`ListenCompleted`。ADR-075 決定 3。backend first-write-wins 依存をコメントとテストに明記: CI-A12）も Reporter が送る（W-6）。順序は「完聴の記録 → local に 0 → server へ総時間」（SG-X1）で、これは送信を始める順であり、次の再生開始は応答を待たない（SG-C61）。
  - 完聴時に server へ送る値は、総時間の優先順（音声要素の値 → `durationSeconds`）で得た値。不明なら完聴時点の現在位置、それも 0 なら送らない（SG-C54）。
  - 主体離脱の後始末では位置同期を送らない（SG-C16。§3.3）。

**target（未実装・slice は未起票）: 位置同期のクライアント側**（SG-C74・C76・C77、親 docs ADR-109 決定 7〜14）。位置の書込に記録時刻を付け、記録時刻の新しい方を正とする（SG-C74）。端末はエピソードごとに最後に記録した位置と時刻を永続保存し、送れなかった記録を、接続が戻ったとき・起動時・次に位置を送るときに送る。再開位置の候補は、端末の記録とサーバーの値のうち時刻が新しい方にする（上の `server > 0 ? server : local` の合成を置き換える）。主体離脱では、未送信のものも含めて送らずに消す（SG-C76）。サーバーの記録の方が新しく、位置の差が 15 秒以上なら、前面の画面の再生ボタンで再開するときに、どちらの位置から続けるかを尋ねる（SG-C77）。slice は W-S2c と backend B-S7 の後に起こす（SG-C79）。それまでは上の規則のまま（候補は `server > 0 ? server : local`。サーバーは届いた順に上書きする）。

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
| `authenticated` | `user: AuthUser` | `logout` → `anonymous`（遷移①）／`getMe`・任意 API が `unauthorized` → `anonymous`（遷移②。**失効**。検知点は 1 箇所）／別の主体の `login`/`register`/`passkey` 成功 → `authenticated(B)`（遷移④。主体の直接交代。未認証を経由しない）。離脱はこの 3 つで全数（ADR-104 決定 3） |
| `anonymous` | — | `login`/`register`/`passkey` 成功 → `authenticated` |
| `unavailable` | `failure: ApiFailure` | 再試行 → `resolving`（一時障害でログアウト表示しない。RF15） |

**主体離脱の後始末**（ADR-104 決定 1〜3、共有仕様 §6.3・§6.5。準拠テストは共有仕様 §4.4 の SL-01〜SL-10）: 離脱は遷移①②④。`authenticated → unavailable`（通信断・5xx）は離脱ではない（SL-03）。次の主体の確立（状態遷移）は、前の主体の後始末を待たない（決定 1）。事後条件は共有仕様 §6.5 の Web 列のとおり: SW 管理キャッシュ（`shell-*`/`api-*`）を消す（CI-S01 / OB-C1）、再生セッションを停止して Queue を空にする（位置同期は送らない: SG-C16）、主体依存の端末設定を消す（§3.4 の `subjectScoped`。SG-A6）。logout では Web Push のサーバ行も解除する（決定 20〜23）。logout の backend 呼出は httpOnly cookie の提示で行う（SG-A2）。各手順は独立に試み、消去失敗は `CleanupIncomplete` として観測可能に返す（LF12・SL-04）。

**音声キャッシュ**（ADR-104 決定 27・SG-A1）: 主体別のキャッシュ名 `audio-v1-{user_id}` に分け、起動時に現在の主体以外を回収する（未認証なら全主体）。旧 `audio-v1` は初回起動で全削除し、移行しない（SG-A1）。失効時は主体別キャッシュを残してよい（次の主体へ漏れず、起動時回収が拾う。SL-02）。回収は主体が確定した時点で、起動につき 1 回だけ走らせる。確定の契機は `getMe` 成功・`getMe` の 401・未確定後の login / register / passkey 成功（SG-C13）。`unavailable` の間は走らせない（SG-B3）。`user_id` が欠落・形式不正のときは、キャッシュを無効にして動作を続け、回収は未認証と同じ扱いにする（SG-B6）。（旧: 「`audio-v1` は明示 logout のみ消す。失効時は保存音声を残す」「主体付き key は不採用（SG4）」。共有端末なしの前提で決めたもので、ADR-104 決定 27 で撤回）

**現状と target**: 実装済み（W-S0・W-0。`contexts/AuthContext.tsx`）= `getMe` の 401 で `shell-*`/`api-*` を消す。logout で `audio-v1` を全削除し、`shell-*`/`api-*` を消し、Push のサーバ行を解除する。target（未実装）= `AuthSession` 判別共用体と `unavailable`（W-S4c）、任意 API の `unauthorized` での失効検知（W-S4d3）、主体別キャッシュ・起動時回収・遷移④・離脱時の再生停止・主体依存 key の削除（W-S5。backend の `user_id` 公開は B-S5a で済み）。

**AdminAccess policy** — `adminAccess(session) → 'loading' | 'login_required' | 'denied' | 'granted'`。`AdminGate` component が 4 ページ共通で `loading` は読み込み中表示、`login_required` はログインモーダル、`denied` は文言、`granted` のみ children（§8 Q7、OB-C5）。

**PasswordPolicy** — `lib/account/password.ts` に 1 実装（target・未実装: W-S4c）。**新規設定の長さは 12〜20 文字**（親 docs ADR-101。2026-09-16 の SG7「8〜20 文字」を改めた。最小 12 は backend が正本で、上限 20 は新しく設定する経路だけに掛かる）。文字種規則は現行 `countPasswordCharacterClasses` を維持。`signup` / `AccountSection`（最小 12）と `admin/users`（最小 8・上限なし）を 12〜20 へ揃える挙動変更を伴う。backend 側の検証値との整合（OB-A1）は ADR-101 で確定済み。

### 3.4 Preferences

設定レジストリ: 各設定を `{ key, scope: 'local' | 'server', codec(encode/decode/validate), default, subjectScoped }` で宣言（OB-C7 / OB-C9、IV8/IV9 を閉じる）。`subjectScoped` は主体依存か（主体離脱の後始末で消すか）の宣言で、分類は共有仕様 §6.5 の分類表に従う（SG-A6）。表に無い key を足すときは共有仕様の表を先に更新する。registry の実装は W-S4b（target・未実装）。

| 設定 | scope | 値域 | 現状の迂回（解消先） | 主体依存（SG-A6） |
|---|---|---|---|---|
| defaultPlaybackSpeed | local（`KEY_DEFAULT_PLAYBACK_SPEED`）＋ server（`UserPreferences.default_playback_speed`） | `PLAYBACK_SPEEDS` | `settings/page.tsx:349-352` の二重書込、`AppContext` raw dispatch | 主体依存（消す） |
| timeFormat | local | `'absolute' \| 'relative'` | `AppContext` | 端末設定（残す） |
| theme | local | `'dark' \| 'light'` | `app/layout.tsx:45-49` inline script（**temporary path TP3**: import 不可のため key 文字列と列挙を複製し、テストで一致を pin） | 端末設定（残す） |
| sfxEnabled | local | boolean | `lib/sfx.ts` | 端末設定（残す） |
| seenAchievementIds | local | `string[]` | `dashboard/page.tsx:48,65` の生 key | 主体依存（消す） |
| volume | local（`player_volume`） | `[0,1]` | `useAudioPlayer` 内。値の保持・保存・起動時の復元は `PlaybackProvider` へ（SG-C57。W-S2b）。保存 key の宣言は W-S4b で registry へ | 端末設定（残す） |
| podcastPosition（prefix） | local（`podcast_position:{id}`。共有仕様の `podcast_position_*` 表記はこの prefix を指す: `lib/config.ts`） | 秒 | 読み書きは PositionReporter（CP9）と Coordinator。registry は分類を宣言する | 主体依存（消す） |
| default_difficulty / digest_* / weekly_goal | server | 型どおり | `settings/page.tsx` | —（server のみ。端末にコピーを持たない） |

`PreferencesProvider` は registry から `get(setting)` / `set(setting, value)`（validate 済みのみ受理）だけを公開。raw dispatch は公開しない。

### 3.5 Learning / Admin / Notifications（境界と obligation のみ）

- Learning: `quiz`・`vocabulary`・`streak`・`dashboard` は gateway 呼出＋表示が主で、ルールは「staleness 5 分」「ストリーク増加時の効果音」「実績既読」の 3 つ。`StreakContext` の効果音は use case hook 側の副作用へ移す（Provider から UI 副作用を外す）。詳細 model は学習機能サイクル（§8 保留）で作る。OB-L1: `lib/learning/` に上記 3 ルールの純関数を置く。
- Admin: ルールは backend。web 側は `AdminGate` と gateway 呼出のみ。
- Notifications: `PushSubscriptionState` の状態機械は維持する。ADR-104 決定 18〜24 で、再登録（`authenticated` に変わるたびに既存の購読を再送）と logout 時のサーバ行の解除を足した（W-0 で実装済み。置き場は §2 の表）。

## 4. 契約（Contract target）

既存 Contract Package の CI*（`docs/research-reports/2026-09-16-code-design-review/contract-package.md`）を再利用し、target 固有の契約を CI-T* として追加する。テスト仕様 T-T* は Given-When-Then と oracle。

**失敗の表現（gate 指摘 9）**: `ApiGateway` は throw せず `Result<T, ApiFailure>` を返す。`Result` は `{ ok: true, value: T } | { ok: false, failure: ApiFailure }` の判別共用体。`ApiFailure` は `kind` で判別（network / timeout / unauthorized / forbidden / not_found(subject) / conflict / rate_limited(retryAfterSeconds, scope) / validation(detail) / server(status) / unknown(status)）。呼出側が `kind` 以外（数値 status）で分岐することを eslint ルール（T-T7 と同じ仕組み）で禁止する。`Queue.create` の不変条件違反は programmer error として throw（公開操作は throw しない）。

| CI | 対象 capsule | statement（要約） | 由来 | test（oracle は公開 API 経由） |
|---|---|---|---|---|
| CI-T1 | PlaybackSession | 状態は §3.1 の union のみ。13 遷移以外は起きない（`stop`・`fail` は表の外の操作: CI-T1b・CI-T1f）。`errored` は `paused` と区別できる | CI-P01, OB-C3 | T-T1: 13 遷移を `AudioElement` port の double でイベント駆動し `state()` を観測（分母 13） |
| CI-T1b | PlaybackSession | 任意の状態で `stop` → `idle`。`AudioElement` が一時停止し音源を外す。`idle` での `stop` は何もしない。分母 13 に数えない | SG-C24・C25 | T-T1b: `AudioElement` double の状態（`paused` と `src`）で観測し、呼出回数は問わない |
| CI-T1f | PlaybackSession | 任意の状態から「失敗にする」で `errored(理由)` になる（`episode` は id だけの参照、`position` は 0、`speed` は直前の値）。音声要素は一時停止して音源を外す。id だけの参照の `errored` で `play()` は何もしない。分母 13 に数えない | SG-C52・W-9 | T-T1f（target・未実装: W-S2a1） |
| CI-T2 | PlaybackSession | `play()` reject → `errored(autoplay_blocked\|media)`。重複 `play()` は 1 状態に収束 | CI-P09, CI-P10 | T-T2 |
| CI-T3 | PlaybackSession | `start` 後の位置は resume（末尾 2 秒窓: 候補位置が「総時間 − 2」以上なら 0。共有仕様 §4.3 RS-01〜RS-07。SG-X2）。`loadedmetadata` 後に再適用 | CI-P05 | T-T3（unit）＋ UV3（e2e 実ブラウザ） |
| CI-T4 | PlaybackSession | セッション速度は `start` で既定速度に初期化、以後保持、`load` 後に再適用（HTML の load アルゴリズムは `playbackRate` を `defaultPlaybackRate` に戻すため、Session は両方を設定する）。既定速度は Preferences のみが書く | CI-P12, OB-C9, §8 Q5 | T-T4 |
| CI-T5 | Coordinator | `unavailable` → network 取得なし。手動の開始ではキューもセッションも変えず、通知を返す（SG-C62）。`errored(source_unavailable)` になるのは、自動で次へ進んだ後と `retry()`（SG-C52） | CI-X02, OB-C6 | T-T5: gateway double が呼ばれない＋状態（手動は不変、advance 後は `errored`） |
| CI-T6 | Coordinator | advance 失敗後: `Queue.current` = 失敗エピソード、`errored(fetch_failed)`、`retry()` が再生元の解決からやり直す。利用者の開始を、自動で次へ進む開始より優先する（SG-C73・W-15） | OB-C2, §8 Q6 | T-T6 |
| CI-T7 | Coordinator | INV-P1（`session.episode.id === Queue.current.id`）。「何が再生中か」の唯一の読出口は `nowPlaying()`。`AppContext.currentPodcast` と `Podcast` DTO の直読みは存在しない | OB-C12, SG3 | T-T7a: INV-P1 を全 Coordinator 操作後に検査（unit）。T-T7b: eslint `no-restricted-properties`/`no-restricted-imports` で `currentPodcast` 参照と `contexts/` → `components/` import を禁止し CI（S3）で実行 |
| CI-T8 | PositionReporter | 同一 episode の `ListenCompleted` は 1 回の再生の中で 1 回。完聴時は「完聴の記録 → local 0 → server へ総時間」の順で送り始め（SG-X1・SG-C54。CI-A13）、次の開始は応答を待たない（SG-C61）。周期送信は `playing` のときだけ（SG-X4）。一時停止・停止への遷移で 1 回送り、同じ位置は再送しない（SG-C53・W-6）。巻き戻した位置も書く（SG-C67。「server 位置書込は単調非減少」は廃止） | CI-A10, A11, A12、共有仕様 PS-05・PS-05b・PS-06 | T-T8: gateway double の呼出列を観測 |
| CI-T9 | Queue | 公開操作は §2 どおり正規化（clamp / dedupe / no-op）し throw しない。全戻り値は不変条件 1〜3 を満たす。`setQueue` の重複 id は先勝ち（SG-C50）。Q-01〜Q-33 不変 | CI-Q01, CI-Q03 | conformance（Q-01〜Q-32 は実装済み。Q-33 の行は W-S2a1 で足す）＋ T-T9: 公開操作の戻り値に対する不変条件 property test（items 一意・index 範囲・空⇒null） |
| CI-T10 | OfflineLibrary | `save(id)` は ok 応答のみ・完了前は `has()` false（最後に書く entry で判定: W-3）・重複収束。`get` は保存した DTO・blob URL・handle か null（W-1）。handle は release で revoke。Cache Storage が無い環境では安全に縮退する（W-7） | CI-C01, C02, C03, C05 | T-T10: `put()` の解決をテスト側が制御する deferred-put `CacheStore` double（`MockCaches` 拡張）で途中状態を公開 API `has()` から観測 |
| CI-T11 | EpisodeDecoder | DTO → 判別共用体。矛盾 DTO は `FailedEpisode` に fail-closed。▶は Playable のみ | OB-C10, IV1, IV2 | T-T11（表駆動 status 4 × audio_url 2 × error_message 2 = 16） |
| CI-T12 | ApiGateway | 失敗は `Result` の `ApiFailure`。`rate_limited` は `retryAfterSeconds` と `scope` を持つ。204 は `Result<void>` | CI-A01, A02, A04 | T-T12（既存 `tests/lib/api.*.test` を Result 形式へ移植） |
| CI-T13 | ApiGateway | 有限 deadline（30s）で `timeout` になる | CI-A03 | T-T13（fake timer） |
| CI-T14 | BFF | `BACKEND_API_KEY` 欠落は 500・generic 本文（`BACKEND_BASE_URL` と同じ）。`BACKEND_BASE_URL` が path を持つ場合も設定不正として 500（A1 の契約化） | CI-A20, A21, A22(部分) | T-T14（`tests/app/api/proxy.test.ts` へ追加。path 付き BASE_URL の負例を含む） |
| CI-T15 | AuthSession・主体離脱 | 4 状態のみ。`getMe` の `unauthorized` 以外は `unavailable`。主体離脱（遷移①②④）の後始末・起動時回収・`user_id` 不正時の扱いは、共有仕様 §4.4 の SL-01〜SL-10 を準拠テストの行とする（§3.3）。消去失敗は `CleanupIncomplete` として観測可能。次の主体の確立は後始末を待たない | OB-C8, CI-S01, OB-C1, ADR-104, SG-A1・A6・B3・B6・C13 | T-T15（`CacheStore` double＋gateway double。テスト名に SL の行 ID を含める）。W-S0 = SL-03・SL-05 と後始末の骨格、W-S4c = 4 状態、W-S4d3 = 検知点、W-S5 = SL-01・SL-02・SL-04・SL-06〜SL-10 |
| CI-T16 | AdminAccess | 4 値 policy。`AdminGate` は `granted` 以外で children を描画しない | OB-C5 | T-T16（各状態で `queryByRole` null） |
| CI-T17 | Preferences | registry 外の key・列挙外の値は拒否／既定へ正規化。raw dispatch なし | OB-C7, OB-C9, IV8, IV9 | T-T17 |
| CI-T18 | SW 名前空間 | `sw.js` と cleanup の prefix 集合が一致 | CI-S03 | T-T18: 例外的に fs 読み比較（capsule API 外）。TP2 の削除条件として限定 |

coverage（design 時点）: CI-T 18 件すべてに test 仕様あり（実行は未。2026-09-30 に CI-T1b・CI-T1f を足して 20 件）。既存 CI のうち target で `met` へ変わる見込み: A01/A03/A04/A20/A21, Q01, P01/P05/P08/P09/P12, C01〜C05, X02, S01/S03（計 19 件）。**変えない**: A22（A1 確認待ち）, A26/A27。S02（主体付き key）は W-S5 で満たす（ADR-104 決定 27。「不採用・SG4」は撤回）。

## 5. カプセルと公開操作（Boundary / code design）

```yaml
code_design:
  capsules:
    - {id: CP1, name: PlaybackSession, owns: [transport 状態 union, 位置 clamp, セッション速度, 音声要素への音量設定の唯一の入口（値の保持と保存は PlaybackProvider: SG-C57）, AudioElement port], hides: [Audio API, blob handle の release タイミング], emits: [positionChanged, listenCompleted, stateChanged]}
    - {id: CP2, name: Queue, owns: [QueueState と不変条件 1〜3（内部 gate create）], hides: [配列操作], note: "共有仕様 §2 の公開操作をそのまま"}
    - {id: CP3, name: OfflineLibrary, owns: [保存庫の不変条件, blob handle lifecycle], hides: [Cache Storage key 体系, 3 entry 構成], note: "get は保存した DTO・blob URL・handle を返す（W-1）。clearOfflineAudio(cacheStore) を export する（W-10）"}
    - {id: CP4, name: PlaybackCoordinator, owns: [UC-P1/P3/P4 の判断: source 選択・挿入規則・失敗方針・INV-P1], hides: [gateway 呼出, ports], note: "依存 7 つと読み取り側の通知 subscribe（W-5）。開始系は結果を返す（W-8・W-11）。利用者の開始を優先（W-15）"}
    - {id: CP5, name: EpisodeDecoder, owns: [DTO→Episode 判別], hides: [optional field の世代差]}
    - {id: CP6, name: ApiGateway, owns: [request, CSRF 付与, ApiFailure 正規化, deadline], hides: [fetch, cookie, status 数値]}
    - {id: CP7, name: AuthSession + AdminAccess, owns: [認証状態 union, 主体離脱の後始末 SubjectCleanup（遷移①②④。ADR-104）, 認可 policy], hides: [getMe, WebAuthn port の注入]}
    - {id: CP8, name: PreferencesRegistry, owns: [key・codec・値域・保存先・主体依存の宣言 subjectScoped（SG-A6）], hides: [localStorage, JSON encode]}
    - {id: CP9, name: PositionReporter, owns: [UC-P6 の書込: 10 秒 throttle, local 書込, server 書込（一時停止・停止への遷移で 1 回。巻き戻した位置も書く: SG-C53・C67）, 完聴 1 回と完聴の記録の送信（W-6）, 順序 CI-A13], hides: [KeyValueStore, gateway], note: "gate 指摘 3。CP1/CP4 から位置 writer を集約"}
  public_operations:
    - {capsule: CP1, ops: [start(episode, resume, speed), play, pause, seek, seekRelative, setSpeed, setVolume, state(), stop, fail, subscribe]}   # stop = SG-C24（実装済み）。fail = SG-C52（target: W-S2a1）。subscribe は読み取り側の通知
    - {capsule: CP2, ops: [emptyQueue, current, upNext, start, setQueue, add, playNext, jump, advance, remove, moveUpNext]}
    - {capsule: CP3, ops: [save(id), get, has, remove, clear, list, usage]}   # save(id) = SG-C55
    - {capsule: CP4, ops: [startEpisode, retry, addToQueue, playNext, removeFromQueue, reorder, skipToNext, nowPlaying(), upNext()]}   # 9 操作。読み取り側の通知 subscribe は 9 に数えない（W-5）。主体離脱時の再生停止は Session の stop を使い（SG-C24・C25）、位置同期は送らない（SG-C16）。それを CP4 の操作 stopForSubjectLeave() として足す形は W-S5 の order の提案（導出 ID なし）
    - {capsule: CP5, ops: [decodeEpisode, isPlayable]}
    - {capsule: CP6, ops: ["get/post/put/patch/delete<T>(path, body?) → Promise<Result<T, ApiFailure>>"]}
    - {capsule: CP7, ops: [session(), login, loginWithPasskey, register, logout, retry, adminAccess()]}
    - {capsule: CP8, ops: [get(setting), set(setting, value), ready]}   # ready は branch_decisions の isRestoring（PreferencesProvider が持つ）
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
    - {subject: "lib/api の context 別 6 分割を W-S1（旧 S1）で行う", rationale: "SG5『最小注入点』を超える。W-S1b（リソース単位の分割）と W-S4d1 以降（旧 S4 以降）へ送る（gate 指摘 5）"}
    - {subject: "QueueState の branded type 化", rationale: "iOS/Android と共有する型表現の乖離。内部 gate create で代替"}
    - {subject: "旧 AudioPlayerProvider と新 PlaybackProvider の併存移行", rationale: "SG3（正本一意）と二重 owner が両立せず、併存期間の方が回復不能。特性テスト追加で保護（gate 検討案）"}
  dependency_direction: ["app → hooks → contexts → lib/<context> ← lib/platform", "lib/playback ↛ lib/api（Coordinator が gateway 関数を注入で受ける。関数の置き場は lib/playback/gatewayFns.ts: W-4）", "contexts ↛ components（eslint で禁止・T-T7b）"]
  change_scenarios:
    - {id: CS1, name: replace implementation（Audio → 別再生技術 / Cache Storage → IndexedDB / fetch → 別 transport）, expected: pass, evidence: "port の adapter 差替えで CP1/CP3/CP6 の contract test が不変"}
    - {id: CS4, name: change one business rule（挿入規則・失敗方針・パスワード規則・rate_limited scope）, expected: pass（1 ファイル）, evidence: "CP4 / lib/account/password.ts / lib/catalog policy に閉じる"}
    - {id: CS2/CS3, name: add/change variant, status: not_applicable, rationale: "proven variant なし"}
```

**interface が露出してはならないもの（leakage guard）**: `HTMLAudioElement`、`Response`、`RequestInit`、`NodeJS.Timeout`、`React.*` 型（hooks 以外）、`WebAuthnBrowserPort` を UI が組み立てること（Provider が注入する）、`status` 数値、localStorage key 文字列、blob URL 文字列（handle で包む）、`Podcast` DTO を UI が「再生中」の意味で読むこと（`nowPlaying()` を使う）。

## 6. 移行（Change Safety）— slice

原則: slice ごとに **特性テスト（現行挙動の pin）→ RED（CI-T*）→ 実装 → 旧 path 削除条件の確認**。1 slice = 1 PR 目安。temporary path は owner・導入日・削除条件を持つ。

slice ID は、親 docs `plan/2026-09-16-design-review-refactor.md`（2026-09-23 再スライス版）と `docs/plan/2026-09-16-design-review-refactor/README.md` の接頭辞付き ID `W-*` を使う（2026-09-30 に旧 ID S0〜S5 から置き換えた。対応は「旧 ID」列）。**進捗の正本は README の状態欄**で、本書には書かない。依存と投入順も README と親 plan が正本。

| slice | 旧 ID | 内容 | 特性テスト（baseline） | RED（T-T*） | temporary path |
|---|---|---|---|---|---|
| W-S0 constraint | S0 | BFF fail-closed（CI-T14）、失効時 cleanup（現 `AuthContext` 内・CI-T15 の cleanup 部分のみ先行）、`AdminAccess` + `AdminGate`（CI-T16） | `tests/app/api/proxy.test.ts`（40）、`tests/contexts/AuthContext*.test.tsx`、admin 4 page test、`tests/components/NavigationBar.test.tsx` | T-T14, T-T15(部分: SL-03・SL-05 と後始末の骨格), T-T16 | なし |
| W-0 push | —（2026-09-23 新設） | Web Push の再登録と logout 時のサーバ行の解除（ADR-104 決定 18〜24）。既存購読の取得を `getRegistration()` 系へ（SG-C5） | — | `tests/contexts/AuthContext.push.test.tsx`（SG-C6） | なし |
| W-S1 gateway（**SG5 どおり最小**） | S1 | `lib/api/gateway.ts`（`Result`/`ApiFailure`、deadline）と `ApiClientProvider`（1 client を保持）。既存 `createApiClient()` の関数群は **そのまま**（内部で gateway を使う）。Provider 経由に切り替えるのは **再生系 4 箇所**（`contexts/AudioPlayerContext.tsx` の 4 呼出）と `lib/audioCache.ts` の `@/lib/api` import 解消（取得関数を引数で受ける。SG-W1）のみ。リソース単位の分割は W-S1b、page 側は W-S4d1 | `tests/lib/api.*.test`（378）、`tests/contexts/AudioPlayerContext.*.test.tsx`、`tests/lib/audioCache.test.ts` | T-T12, T-T13 | **TP1** `ApiError` 互換（`ApiFailure` から生成して throw する薄い adapter を旧関数群に残す）。owner: user、導入: W-S1、削除: W-S4d3。削除条件: `app/`・`components/`・`hooks/` が `ApiError` を import しなくなった時（grep 0） |
| W-S1b api-split | S4 の一部（2026-09-23 に独立） | `lib/api.ts` を backend リソース単位の 10 ファイル（`lib/api/*.ts`）へ分割。関数名・型・呼出側は不変。`request()` と `ApiError` は `lib/api/legacyRequest.ts` | `tests/lib/api.*.test` ほか（挙動不変） | —（特性テストのみ） | TP1 を継続 |
| W-S2a playback-domain | S2 の ① | `lib/playback/{ports,session,queue,source,resume}` と `lib/platform/{audioElement,cacheStore,keyValueStore}`。Session の `stop`（SG-C24）、速度 2 概念、状態 union を含む。既存コードから呼ばない | —（新規コードのみ） | T-T1〜T-T4・T-T1b・T-T9、RS-01〜RS-07 | なし |
| W-S2a1 session-fail-entry | S2 の ①（2026-09-30 新設） | Session に「失敗にする」入口 `fail` を足す（SG-C52・W-9）。準拠テストに Q-33 を足す（SG-C50）。既存コードから呼ばない | W-S2a の Session・Queue のテスト | T-T1f・Q-33 | なし |
| W-S2a2 playback-coordination | S2 の ① | `lib/playback/{offlineLibrary,coordinator,positionReporter,gatewayFns}`、`lib/platform/{objectUrl,storageEstimate}`、`EpisodeDecoder`（Coordinator 内）、`nowPlaying()` の view model（W-1〜W-8・W-10〜W-12・W-15）。既存コードから呼ばない | —（新規コードのみ） | T-T5〜T-T8・T-T10・T-T11 | なし |
| W-S2b playback-entry | S2 の ② | `PlaybackProvider`（旧 `AudioPlayerProvider` を置換）、`components/PlaybackToasts.tsx`（W-13）、**`AudioPlayerBar` と `podcast/page.tsx:199` の「再生中」判定を `nowPlaying()` へ置換**、`useStartPodcast` を使わない（Coordinator の `startEpisode` を直接）、失敗方針、再生ボタン（W-14）、音量（SG-C57）。共有仕様 §2・Q-* は挙動不変。変わる挙動は決定済みの行だけ（PS-01〜PS-06・PS-08、RS-03〜05、SG-C53・C63・C67・C69、W-14） | 旧再生実装を参照するテスト（2026-09-30 実測で 19 ファイル。集合は order が実測で固定する）と e2e `offline-playback` / `queue-autoadvance` / `main-flow` | 準拠テスト（行 ID をテスト名に含む）、T-T18 | **TP2** `sw.js` prefix 複製の pin テスト（T-T18）。owner: user、導入: W-S2b、削除条件: ビルド時注入か SW を module 化した時 |
| W-S2c playback-cleanup | S2 の ③ | 旧再生実装と `AppContext.currentPodcast` の削除、`reorderUpNext` の削除（`moveUpNext` へ統一）、依存方向 eslint（T-T7b のルール本体） | —（削除のみ。参照 0 件を grep で判定） | T-T7b | なし |
| W-S3 gates | S3 | CI に `typecheck:ts7` と独立 build、T-T7b の eslint ルールの実行 | — | ci.yml / eslint.config 差分 | なし |
| W-S4a catalog（学習サイクルで） | S4 | `Episode` を `PodcastCard`/`podcast` pages へ展開、`error_message` の文言写像、`rate_limited.scope`。**保留**: `error_message` の値域は親 docs ADR-108 で 3 値になり、「一部失敗」の表示を消す作業をどの slice が持つかは決まっていない（解除条件 = W-S4a の投入前点検で決める） | page tests | T-T11（UI 側）・PS-07 | なし |
| W-S4b prefs（学習サイクルで） | S4 | `PreferencesRegistry`（`subjectScoped` の宣言: SG-A6）、`AppContext` の解体の完了 | page tests | T-T17 | **TP3** inline theme script の key/列挙複製（pin テスト）。owner: user、導入: W-S4b、削除条件: `beforeInteractive` script を module から生成できた時 |
| W-S4c account（学習サイクルで） | S4 | `PasswordPolicy` 12〜20 の単一化（ADR-101）、`AuthSession` 判別共用体 | 認証・account のテスト | T-T15（4 状態）・T-T16 | なし |
| W-S4d2a / W-S4d2b tests（学習サイクルで） | S4 | page テストを gateway double へ移植する（production は不変） | —（oracle 不変） | — | なし |
| W-S4d1 context-gateway（学習サイクルで） | S4 | `lib/api/<resource>` の `Result` 化と page 側の注入点移行。TP1 は残す。再生系の gateway 関数の置き場は `lib/playback/gatewayFns.ts`（W-4）までが確定で、この slice 以降の置き場は判断待ち | page tests | T-T12（呼出側） | TP1 を継続 |
| W-S4d3 tp1-removal（学習サイクルで） | S4 | TP1 の削除、HTTP status 数値分岐の eslint、任意 API の `unauthorized` での失効検知 | — | T-T15（検知点）・SL-05 | TP1 を削除 |
| W-S5 subject-cache | —（2026-09-23 新設。旧表の「S5 learning」とは別） | 主体別音声キャッシュ `audio-v1-{user_id}`、起動時の回収、旧 `audio-v1` の初回全削除、主体依存 key の削除、主体離脱時の再生停止（ADR-104 決定 27・SG-A1・A6・B3・B6・C13）。backend の `user_id` 公開（B-S5a）の後 | 認証 Provider のテスト、e2e `offline-playback` | SL-01・SL-02・SL-04・SL-06〜SL-10 | なし（不可逆点: Cache 名前空間の変更） |
| （learning。保留・order 未作成） | S5 | `lib/learning/` の 3 ルール、StreakContext の副作用移動。学習機能サイクルで着手 | — | OB-L1 | — |
| （位置同期のクライアント側。target・未起票） | — | SG-C74・C76・C77、親 docs ADR-109 決定 7〜14（§3.1 の target）。W-S2c と backend B-S7 の後に slice を起こす（SG-C79） | — | — | — |

**3 段分割**（旧: 「S2 は一括切替・SG8」。2026-09-23 の再スライスで改訂）: 旧 S2 は ① ドメイン層の新設（W-S2a・W-S2a1・W-S2a2）→ ② 入口の差し替え（W-S2b）→ ③ 旧実装の削除（W-S2c）に分けた（親 plan「一括切替を 3 段に割る」）。① は新規コードだけ、② は「挙動不変＋決定済みの行だけが変わる」、③ は削除だけで判定する。旧新 Provider の併存移行はしない（§5 rejected_overdesign。② の入口の切替は 1 PR で行う）。

**W-S2b の scope 上の注意（gate 指摘 1）**: `AudioPlayerBar` は `Podcast` DTO の field（`duration_seconds`/`difficulty`/`created_at`）を直読みしているため、`AppContext.currentPodcast` の参照をやめると同時に必ず型が変わる。`nowPlaying()` の view model（title, difficulty, createdAt, durationSeconds, episodeId。`title` は表示用の文字列: W-12）を W-S2a2 で定義し、`AudioPlayerBar` の変更を W-S2b に含める（W-S4a 以降に送らない）。

**§8 からの逸脱（gate 指摘 6 → SG9）**: review §8.3 で「記録のみ・変更しない」とした RF16（完聴重複・位置順序）、RF18（Queue 不変条件 gate）、RF19（依存方向）、RF20（SW prefix pin テスト）を、本 Spec は W-S2a〜W-S2c（旧 S2）の一部として作業化している。理由: CP9 / `Queue.create` / 依存禁止 / T-T18 は再生の構造変更に付随し、後から入れる方が高い。追加コストは小（各 1 テスト＋数十行）。**RF4・RF14・RF22 は本 Spec で扱わない**。RF17 は UV3 の観測のみ。採否は SG9。

**不可逆点**: W-S5 の Cache 名前空間の変更（`audio-v1` → `audio-v1-{user_id}`。旧キャッシュは初回起動で全削除し、移行しない: SG-A1）。それ以外は UI 内部構造のみで、localStorage key 名・共有仕様 §2 の挙動は不変。backend 契約は、位置の書込の `recorded_at`（ADR-109。target・未実装）と `user_id` の公開（ADR-104 決定 15）を除き不変。
**rollback**: slice 単位の revert。入口の差し替え（W-S2b）は、特性テストと e2e 3 本が green になってから着手する。旧ファイルは W-S2c まで残すので、巻き戻しは W-S2b の PR の revert で済む。

## 7. Requirement → UC → model → contract → test の trace

| R | UC | model / capsule | CI | test | status（design） |
|---|---|---|---|---|---|
| R1 業務ルール単一所有 | UC-P1/P3, UC-L1, UC-A2, UC-M* | CP4, Catalog policy, PasswordPolicy, AdminAccess | CI-T5/T6/T16, CS4 | T-T5/6/16 | covered（PasswordPolicy は ADR-101 で 12〜20 文字に確定） |
| R2 再生の不正状態なし | UC-P1〜P6 | CP1, CP2, CP3, CP5 | CI-T1/T2/T3/T9/T10/T11 | T-T1〜3, 9〜11 | covered |
| R3 正本一意 | UC-P1/P2/P6 | Queue.current + INV-P1, CP9, PreferencesRegistry | CI-T4/T7/T8 | T-T4/7a/7b/8 | covered |
| R4 失敗の意味 | 全 UC | CP6 Result/ApiFailure, errored(reason) | CI-T5/T12/T13/T14 | T-T5/12/13/14 | covered |
| R5 unknown で保護 UI なし | UC-M* | AdminAccess, AdminGate | CI-T16 | T-T16 | covered |
| R6 主体離脱でキャッシュ残留なし | UC-A1, UC-S2 | AuthSession の遷移①②④と後始末、主体別音声キャッシュと起動時回収（§3.3）, TP2 | CI-T15（SL-01〜SL-10）, CI-T18 | T-T15/18 | covered（S02 主体付き key は W-S5 で満たす: ADR-104 決定 27。W-S5 までは target） |
| R7 本番経路のテスト | — | ApiGateway seam, ports | CI-T12 + 各 T-T が real gateway＋fetch double | 各 slice に real `request()` 経由の integration 1 本以上。E2E の `page.route` stub は本 Spec では変えない（backend 実接続は環境が無く out_of_scope と明記） | partial（E2E は据置） |
| R8 CI ゲート | — | — | — | ci.yml | covered（W-S3） |

**UC 側の coverage 分母（gate 指摘 10）**: UC 21 件のうち CI-T を持つのは UC-P1〜P6, UC-A1, UC-M*（gate）, UC-S2 の 10 件。**CI 対象外 11 件と理由**: UC-L1〜L5（学習サイクル（§6 の learning 行。旧 S5）で model 化。今回は gateway 呼出＋表示で、web 側の判断が「文言」以外に無い）、UC-M1〜M4 の操作本体（ルールは backend。web は表示と送信のみ）、UC-A2/A3（W-S4b の Preferences / W-S4c の PasswordPolicy で扱う）、UC-S1（`usePodcastListPolling` の停止条件単一化は旧 S4 の範囲）、UC-S3（`reportClientError` の gateway 経由化は旧 S4 の範囲）。

## 8. 検証計画と decision

```yaml
verification_plan:
  per_slice: ["特性テスト green（baseline）", "T-T* RED → GREEN", "npm test / lint / typecheck / typecheck:ts7 / build", "W-S2b のみ: e2e offline-playback / queue-autoadvance / main-flow、UV3（resume 位置の実ブラウザ観測）"]
  independent: ["slice ごとに code-review ロール 1 回（consolidated）", "W-S2a〜W-S2c（旧 S2）完了時に adversarial-review で CI-T1〜T11 の oracle を検算"]
  unexecuted_now: [UV1 e2e, UV2 T-T* 実装, UV3]
  pre_implementation_gate: {role: architecture, result: revise → 本版で 11 件反映, artifact: "docs/research-reports/2026-09-16-code-design-review/spec-gate.md"}
selection_gates:
  - {id: SG6, subject: "Queue.start / setQueue を公開操作として残す", owner: user, status: satisfied_by_default, decision: "残す（conformance Q-* が両操作を検証しており、削除は Q-spec 準拠を壊す）"}
  - {id: SG7, subject: "パスワード長の統一値", owner: user, status: satisfied, decision: "12〜20 文字（ADR-101。2026-09-16 の「8〜20 文字」を改めた）。W-S4c で 1 実装化。backend 検証値との整合（OB-A1）は ADR-101 で確定"}
  - {id: SG8, subject: "S2 の切替方式", owner: user, status: satisfied, decision: "一括切替（2026-09-16）を、2026-09-23 の再スライスで 3 段分割（W-S2a・W-S2a1・W-S2a2 → W-S2b → W-S2c）へ改めた。入口の差し替え（W-S2b）は特性テストと e2e 3 が green になってから"}
  - {id: SG9, subject: "RF16/RF18/RF19/RF20 を S2（現 W-S2a〜W-S2c）で作業化する逸脱", owner: user, status: satisfied, decision: "採用（2026-09-16）"}
decision:
  status: pass
  artifact_readiness: ready
  engineering_status: planned
  release_status: not_applicable
  decision_maturity: {status: approved, owner: user, approval_evidence: ["2026-09-16 user: Spec 承認・SG8 一括切替・SG9 採用・SG7 8〜20 文字", "以後の改訂は末尾の改訂履歴（決定 ID つき。SG7 と SG8 は改訂済み）"], baseline_version: "2026-09-16", change_control: "本文を直し、末尾の改訂履歴に決定 ID つきで 1 行足す。反映するのは承認済みの決定と台帳 §5.0 の導出だけ。新しい判断は Selection Gate として user に確認してから"}
  next_phase: {name: "slice 単位の実装（§6 の W-*。次に投入する slice と進捗は README の状態欄）", status: allowed, human_approvals_required: []}
  resolved_unknowns:
    - {id: A1, resolution: "BACKEND_BASE_URL は origin のみ（docs/operations/2026-06-11-deployment-status.md:121 の Cloud Run URL、web-local-dev.md:30 の http://api:8080）。path prefix なし → RF4 の無害判定は成立。W-S0（旧 S0）で『BASE_URL に path があれば起動時 500』の guard を CI-T14 に含め、assumption を契約へ昇格する"}
    - {id: UV3, resolution: "HTML 仕様上、readyState=HAVE_NOTHING での currentTime 代入は default playback start position として metadata 読込後に適用される（現行コードは仕様どおり動く見込み）。ただし iOS Safari の既知の非準拠歴があるため、Session は loadedmetadata で resume を冪等に再適用する設計（CI-T3）にし、ブラウザ依存を消す。実ブラウザ観測は W-S2b の e2e（Chromium）＋ iOS Safari 手動 1 回に縮小"}
    - {id: OB-A1, resolution: "backend の新規設定は 12〜20 文字（親 docs ADR-101）。web は W-S4c で 1 実装へ揃える"}
  unknowns: []
  residual_risks: ["入口の差し替え（W-S2b）は 1 PR で切り替えるため、特性テストを先に green にしてから着手する（3 段分割で、巻き戻しの範囲は W-S2b の PR に限る）", "ApiFailure 導入で文言ラダーが一時的に二重化する（TP1 の削除条件で回収）", "R7 の E2E は backend stub のまま（実接続環境なし）"]
```

## 改訂履歴

本文を直したら、この表に 1 行足す（節 / 行 ID・旧値・現行値・決定 ID）。決定 ID の台帳は親 docs `research-reports/2026-09-23-design-docs-mino-audit.md` §5・§5.0、ADR は親 docs `adr/`。

### 2026-09-30（冒頭の追記 4 節と、その後の決定・導出を本文へ反映）

| 節 / 行 ID | 旧値 | 現行値 | 決定 ID |
|---|---|---|---|
| 冒頭・運用 | 本書は改訂せず、追記と各 slice の order を優先する | 本文が現在有効な契約。追記節は経緯。以後は本文を直し、この表に 1 行足す | —（運用の変更） |
| 冒頭・導出の正本 | 導出 W-1〜W-8 の正本は W-S2a1・W-S2a2 の order | 導出 W-1〜W-15 の正本は本書と台帳 §5.0。order は切り出し | W-1〜W-15 |
| 冒頭・SG-C56 の追記 | toast の文言は現行の 2 種類 | 3 種類（オフラインで未保存のときの文言を足す） | SG-C69 |
| ヘッダ・§3.3 PasswordPolicy・§7 R1・§8 SG7 / unknowns | 長さは 8〜20 文字。12 文字下限を 8 へ緩和。OB-A1 は未解決 | 新規設定は 12〜20 文字。OB-A1 は確定済み | ADR-101 |
| §0 `public_contract_change_allowed`・§6 不可逆点 | backend 契約は不変 | 位置の書込の `recorded_at`（target・未実装）と `user_id` の公開を除き不変 | ADR-109 決定 1〜4・SG-C74、ADR-104 決定 15・SG-C15 |
| §1.2 UC-P4・§3.1 Queue・§4 CI-T9 | Q-01〜Q-32。conformance 32 件 | Q-01〜Q-33。`setQueue` の重複 id は先勝ち | SG-C50 |
| §1.2 UC-P6・§3.1 ResumeRule / `startEpisode` | server 優先・local 次点。`resolveResumePosition(server, local)` | `candidate = server > 0 ? server : local` → `resolveResumePosition(candidate, durationSeconds)`。合成は Coordinator の 1 箇所 | SG-B5・SG-X2 |
| §2 Playback の置き場・`contexts ↛ components` | 通知は hook 側で Toast に写す（置き場の記載なし） | toast は `components/PlaybackToasts.tsx` の 2 つ（`errored` に入ったとき 1 回出す部品と、開始の 4 操作を包む hook） | SG-C56・W-13 |
| §2 Notifications・§3.5 | `PushSubscriptionState` は現状維持・変更なし | `PushRegistration`（5 操作）。`authenticated` のたびに再送、logout でサーバ行を解除（実装済み） | ADR-104 決定 18〜24・SG-C5・C6 |
| §2 依存方向 `lib/playback ↛ lib/api` | 取得は Coordinator が受け取って渡す（関数の置き場の記載なし） | gateway 関数は `lib/playback/gatewayFns.ts`。blob URL と保存領域の見積もりは `lib/platform` の adapter を注入 | W-4・W-2 |
| §3.1 Session `ended` 行 | Coordinator が `ListenCompleted` を記録し `advance` | 完聴の記録は PositionReporter。Coordinator は `advance` だけ | W-6 |
| §3.1 Session `errored` 行 | `play()`（手動再試行）→ `loading` | id だけの参照では `play()` は何もしない。再試行は `retry()` | SG-C52・W-9・W-14 |
| §3.1 遷移表の外の操作（新設）・§4 CI-T1b / CI-T1f（新設）・§5 CP1 ops | 公開操作は 8 つ。表の外の操作なし | `stop`（リセット。実装済み）・`fail`（失敗にする。target）・`subscribe` を足す。分母 13 は不変 | SG-C24・C25・C52・W-9 |
| §3.1 `nowPlaying()`・§6 W-S2b の注意 | `title` の作り方の記載なし | `title` は `podcastTitle` を通した表示用の文字列（50 字・40 字） | W-12 |
| §3.1 不変条件・§3.4 volume・§5 CP1 owns | 音量は Session が所有（`useAudioPlayer` 内） | Session は音声要素へ設定する唯一の入口。値の保持・保存・復元は `PlaybackProvider` | SG-C57 |
| §3.1 不変条件・PositionReporter | 総時間の正本の記載なし | 音声要素の値 → `durationSeconds` → 不明。完聴時は優先順の値、不明なら現在位置、0 なら送らない | SG-C54 |
| §3.1 PlaybackSource・`startEpisode`・§4 CI-T5 | `unavailable`・Playable でない → `errored(source_unavailable)` | 手動の開始はキューもセッションも変えず通知を返す。`errored` は自動で次へ進んだ後と `retry()` だけ | SG-C62・SG-C52 |
| §3.1 OfflineLibrary `save`・§5 CP3 ops | `save(episode: PlayableEpisode)` | `save(id)`。取得関数は生成時に渡し、保存の直前に署名付き URL を取り直す | SG-C55 |
| §3.1 OfflineLibrary `get` / `has`・§4 CI-T10 | `get(id) → PlayableEpisode & {audioHandle} \| null` | 保存した DTO・blob URL・handle を返す（変換は Coordinator）。`has` は最後に書く entry で判定。Cache Storage が無い環境の縮退。`clearOfflineAudio` を export | W-1・W-3・W-7・W-10 |
| §3.1 Coordinator の置き場 | `contexts/PlaybackProvider` 内の非 React 関数群 | `lib/playback/coordinator.ts`（§6 の slice 表と同じ） | —（本書内の不一致の解消） |
| §3.1 Coordinator の依存と戻り値・§5 CP4 | 依存・戻り値の記載なし | 依存 7 つ。通知 `subscribe` は 9 操作に数えない。`startEpisode` / `addToQueue` / `playNext` は結果を返す | W-5・W-8・W-11 |
| §3.1 `skipToNext` | 規則の記載なし | 共有仕様 §2.12 のとおり | SG-C63 |
| §3.1 利用者の開始の優先・§4 CI-T6 | 記載なし | 利用者の開始を、自動で次へ進む開始より優先する | SG-C73・W-15 |
| §3.1 `onEnded`・§4 CI-T8 | onCompleted → 位置 0 保存 → advance。手動 `play()` で再試行 | 完聴の記録 → local 0 → server へ総時間、を送り始め、応答を待たず advance。失敗は `fail` で `errored`、再試行は `retry()` | SG-X1・SG-C61・SG-C52 |
| §3.1 PositionReporter・§4 CI-T8・§5 CP9 owns | server 書込は単調非減少（完聴の 0 は例外）。契機は周期だけ | 単調性を廃止し、巻き戻した位置も書く。周期は `playing` のときだけ。一時停止・停止への遷移で 1 回。同じ位置は再送しない | SG-C67・SG-C53・SG-X4・W-6 |
| §3.1 再生ボタン | 記載なし | `errored` なら `retry()`、`ended` なら開始し直す | W-14 |
| §3.1 target（新設）・§6 slice 表 | 記載なし | 位置同期のクライアント側（記録時刻・端末への永続保存・15 秒差の確認）は target・未起票 | SG-C74・C76・C77・C79、ADR-109 決定 7〜14 |
| §3.3 AuthSession 表 | `authenticated` の離脱は logout と `getMe` の `unauthorized` | 遷移①②④。任意 API の `unauthorized` と、主体の直接交代を足す | ADR-104 決定 3 |
| §3.3 事後条件・§4 coverage の S02・§7 R6 | `audio-v1` は明示 logout のみ消す（失効時は残す）。主体付き key は不採用（SG4） | 主体別 `audio-v1-{user_id}`・起動時回収・旧 `audio-v1` の初回全削除。後始末を待たない。回収の契機と `user_id` 不正時の扱い | ADR-104 決定 1・27、SG-A1・A2・B3・B6・C13・C16 |
| §3.4 registry の宣言と表 | `{ key, scope, codec, default }` | `subjectScoped` を足す。分類の列と `podcast_position:{id}` の行を足す | SG-A6 |
| §4 CI-T3 | duration 以上なら 0 | 末尾 2 秒窓（RS-01〜RS-07） | SG-X2 |
| §4 CI-T15・§5 CP7 owns | `authenticated→anonymous` の事後に `shell-*`/`api-*` が空 | 共有仕様 §4.4 の SL-01〜SL-10 を準拠テストの行とする。owns は `SubjectCleanup` | ADR-104、SG-A1・A6・B3・B6・C13 |
| §5 CP8 owns / ops | `[get, set]` | `subjectScoped` の宣言と `ready`（branch_decisions の `isRestoring`） | SG-A6（`ready` は本書内の不一致の解消） |
| §6 slice 表・§7・§8 の slice ID | 旧 ID S0〜S5 | `W-*`（旧 ID の列で対応を残す）。進捗は README の状態欄が正本 | 親 plan（2026-09-23 再スライス版） |
| §6 切替方式 / rollback・§8 SG8 / residual_risks | S2 は一括切替（SG8）。特性テスト 12＋e2e 3 | 3 段分割（①新設 → ②入口の差し替え → ③削除） | 親 plan「一括切替を 3 段に割る」 |
| §6 不可逆点 | なし | W-S5 の Cache 名前空間の変更 | ADR-104 決定 27・SG-A1 |
| §8 `change_control`・`next_phase` | 本書を更新して再承認。S0 実装 | 本文を直して改訂履歴に足す。slice 単位の実装（進捗は README） | —（運用の変更） |
