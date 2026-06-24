// Domain types shared across the frontend

export type DifficultyLevel =
  | 'toeic_600'
  | 'toeic_900'
  | 'ielts_55'
  | 'ielts_7'
  | 'eiken_2'
  | 'eiken_p1'

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

export interface Podcast {
  id: string
  type: string
  article_ids: string[]
  difficulty: DifficultyLevel
  audio_url: string
  japanese_intro_text: string
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

// ── ユーザー設定・嗜好 ────────────────────────────────────────────
export interface UserPreferences {
  default_difficulty: DifficultyLevel
  default_playback_speed: number
  digest_enabled: boolean
  digest_article_count: number
}

export type UserPreferencesPatch = Partial<UserPreferences>
