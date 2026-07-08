// Domain types shared across the frontend

export type DifficultyLevel =
  | 'toeic_600'
  | 'toeic_900'
  | 'ielts_55'
  | 'ielts_7'
  | 'eiken_2'
  | 'eiken_p1'

// 統一デフォルト難易度（issue #163・docs/design/shared-playback-spec.md 正本）。
// 設定画面の初期値/フォールバックと、記事単位star省略時の想定値を一箇所に集約する。
export const DEFAULT_DIFFICULTY: DifficultyLevel = 'toeic_600'

export type PodcastStatus = 'processing' | 'completed' | 'failed' | 'partial_failed'

export interface Article {
  id: string
  title: string
  url: string
  source: string
  score: number
  published_at: string
}

export interface FeedResponse {
  articles: Article[]
  date: string
}

/** トランスクリプトのセリフ1件（話者ラベルと発話テキスト）。GET /podcasts/:id の segments 要素。 */
export interface TranscriptSegment {
  speaker: string
  text: string
}

export interface Podcast {
  id: string
  type: string
  article_ids: string[]
  difficulty: DifficultyLevel
  audio_url: string
  /** ニュース内容を1センテンスに要約した日本語タイトル（backend 追加フィールド）。
   *  既存データや未デプロイ環境では空文字または欠落するため optional。 */
  title?: string
  japanese_intro_text: string
  /** 英語本編のトランスクリプト（issue #162）。旧エピソードや劣化生成では null/欠落するため optional。 */
  segments?: TranscriptSegment[] | null
  duration_seconds: number
  created_at: string
  status: PodcastStatus
  error_message: string | null
  playback_position_seconds: number
}

export interface PodcastsResponse {
  podcasts: Podcast[]
}

export interface Source {
  name: string
  url: string
}

export interface SourcesResponse {
  sources: Source[]
}

// システム提供のおすすめサイト（GET /settings/featured-sources）
export interface FeaturedSource {
  id: string
  name: string
  url: string
  thumbnail_url?: string | null
  description?: string | null
  order: number
}

export interface FeaturedSourcesResponse {
  sites: FeaturedSource[]
}

export interface OnboardingStatusResponse {
  onboarding_completed: boolean
}

// ── 認証・ユーザー管理 ────────────────────────────────────────────
export type UserRole = 'admin' | 'user'

/** ログインユーザーの公開情報（GET /auth/me 等）。password_hash は含まれない。 */
export interface AuthUser {
  username: string
  role: UserRole
  display_name: string
}

/** POST /auth/login のレスポンス。Web は Cookie 認証のため token は未使用。 */
export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface UserListResponse {
  users: AuthUser[]
}

/** POST /auth/register のリクエストボディ。invite_code は登録制限が無効な環境では省略可。 */
export interface RegisterInput {
  invite_code?: string
  username: string
  password: string
  display_name?: string
}

// ── 招待コード（管理者による新規登録招待） ──────────────────────────────
export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked'

/** GET /admin/invites の一覧要素。code 自体は初回作成時のみ返るため一覧には含まれない。 */
export interface Invite {
  id: string
  note: string | null
  created_by: string
  max_uses: number
  use_count: number
  used_by: string[]
  expires_at: string | null // ISO 8601
  revoked_at: string | null // ISO 8601
  created_at: string // ISO 8601
  status: InviteStatus
}

/** POST /admin/invites のレスポンス。code / invite_url はこの応答でのみ表示される（以降は復元不可）。 */
export interface InviteCreateResponse {
  id: string
  code: string
  invite_url: string
  note: string | null
  max_uses: number
  expires_at: string | null // ISO 8601
  created_at: string // ISO 8601
}

export interface InviteListResponse {
  invites: Invite[]
}

// ── ユーザー設定・嗜好 ────────────────────────────────────────────
export interface UserPreferences {
  default_difficulty: DifficultyLevel
  default_playback_speed: number
  digest_enabled: boolean
  digest_article_count: number
}

export type UserPreferencesPatch = Partial<UserPreferences>

// ── 生成残回数（issue #164 / ADR-061） ────────────────────────────────
/** GET /users/me/generation-quota のレスポンス。limit=0 は無制限（remaining は null）。 */
export interface GenerationQuota {
  limit: number
  used: number
  remaining: number | null
  reset_at: string // ISO 8601
}

// ── 聴取ストリーク（issue #165 / ADR-062） ─────────────────────────────
/** GET /users/me/listening-streak のレスポンス。
 *  current_streak_days は 0 の場合もある（ストリークが途切れただけで、聴取歴自体は存在する）。
 *  last_listened_day が null なのは、聴取歴が一度もない場合のみ。 */
export interface ListeningStreak {
  current_streak_days: number
  today_listened: boolean
  last_listened_day: string | null // ISO 8601 date (YYYY-MM-DD)
}

// ── Passkey / WebAuthn ───────────────────────────────────────────────
/** POST /auth/passkey/register/options および /auth/passkey/login/options のレスポンス。
 *  options フィールドは JSON 文字列（backend の options_to_json() 出力）。クライアント側で JSON.parse が必要。 */
export interface PasskeyOptionsResponse {
  challenge_id: string
  options: string
}

/** GET /auth/passkey/credentials のクレデンシャル要素（public_key は除外）。*/
export interface PasskeyCredential {
  credential_id: string
  username: string
  name: string | null
  transports: string[]
  aaguid: string | null
  sign_count: number
  created_at: string       // ISO 8601
  last_used_at: string | null  // ISO 8601
}

export interface PasskeyCredentialsListResponse {
  credentials: PasskeyCredential[]
}

// ── ログイン中のデバイス/セッション（issue #84） ─────────────────────────
export interface Session {
  /** セッション識別子（トークンの SHA-256 ハッシュ・失効 API で指定）。 */
  id: string
  /** User-Agent 由来のデバイス表示名。 */
  device_label: string | null
  created_at: string // ISO 8601
  last_used_at: string | null // ISO 8601
  /** このセッションが現在のデバイスか（サーバ算出）。 */
  current: boolean
}

export interface SessionsListResponse {
  sessions: Session[]
}

export interface RevokeSessionsResponse {
  revoked_count: number
}

// ── Web Push 通知 ────────────────────────────────────────────────────
/** W3C PushSubscription の JSON 表現（backend API に送るボディ）*/
export interface PushSubscriptionJSON {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/** GET /notifications/vapid-public-key のレスポンス */
export interface VapidPublicKeyResponse {
  public_key: string
}

/** Web Push 購読状態機械 */
export type PushSubscriptionState =
  | 'unsupported' // serviceWorker/PushManager 非対応
  | 'denied'      // Notification.permission === 'denied'
  | 'unsubscribed' // 購読なし
  | 'subscribing'  // 購読処理中
  | 'subscribed'   // 購読済み
  | 'error'        // エラー発生
