/**
 * BFF-proxied API client.
 *
 * All requests are sent to /api/backend/... (the BFF proxy route).
 * The proxy adds X-Backend-Base-Url and X-API-Key so this client
 * never talks to the backend directly.
 */
import type {
  DifficultyLevel,
  FeedResponse,
  StarredArticlesResponse,
  PodcastsResponse,
  SourcesResponse,
  Podcast,
  FeaturedSource,
  FeaturedSourcesResponse,
  OnboardingStatusResponse,
  AuthUser,
  LoginResponse,
  RegisterInput,
  UserListResponse,
  UserRole,
  InviteCreateResponse,
  InviteListResponse,
  UserPreferences,
  UserPreferencesPatch,
  VapidPublicKeyResponse,
  PushSubscriptionJSON,
  MetricsSnapshot,
  PasskeyOptionsResponse,
  PasskeyCredentialsListResponse,
  SessionsListResponse,
  RevokeSessionsResponse,
  GenerationQuota,
  ListeningStreak,
  DifficultySuggestion,
  QuizAnswerResponse,
  LearningDashboard,
  VocabularyItem,
  VocabularyListResponse,
  VocabularyTestSessionResponse,
  VocabularyTestResultItem,
  VocabularyTestResultResponse,
} from '@/types/index'
import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, GatewayJsonRequest } from '@/lib/api/gateway'

// owner: user・導入: W-S1（2026-09-24）。
// 削除条件: app/・components/・hooks/ が既存の API クライアント関数の呼出（ApiError の import）を
// しなくなった時（grep 0。W-S4d1 で満たし、本体削除は W-S4d3）。
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    // Retry-After ヘッダ（秒）。429 等でサーバが提示した場合のみ設定（issue #82）。
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

// TP1（互換 adapter）が読む gateway 失敗オブジェクトの raw。symbol キーは import せず、
// gateway.ts と同じ Symbol.for(...) 文字列で own プロパティを直接読む（factory 形式の
// mock でも壊れない）。読み手はこのファイルだけ。
const GATEWAY_RAW_KEY = Symbol.for('news-listen.web.gateway.raw')

type LegacyRaw =
  | { type: 'network' }
  | { type: 'timeout' }
  | { type: 'error'; status: number; detail: string; retryAfterSeconds: number | undefined }
  | { type: 'no_content'; status: number }
  | { type: 'malformed'; status: number; error: unknown }

function isLegacyRaw(value: unknown): value is LegacyRaw {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  return (
    value.type === 'network' ||
    value.type === 'timeout' ||
    value.type === 'error' ||
    value.type === 'no_content' ||
    value.type === 'malformed'
  )
}

function rawOf(failure: ApiFailure): LegacyRaw | undefined {
  const value = Object.getOwnPropertyDescriptor(failure, GATEWAY_RAW_KEY)?.value
  return isLegacyRaw(value) ? value : undefined
}

type LegacyInit = { method?: GatewayJsonRequest['method']; body?: string }

/** Shared fetch wrapper that normalizes errors to ApiError（内部は gateway 経由で fetch する） */
async function request<T>(
  path: string,
  init: LegacyInit = {},
): Promise<T> {
  const method = init.method ?? 'GET'
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  const r = await createGateway().request<T>(path, { method, body })
  if (r.ok) return r.value

  const raw = rawOf(r.failure)
  if (raw) {
    if (raw.type === 'network' || raw.type === 'timeout') {
      throw new ApiError(0, 'Network error')
    }
    if (raw.type === 'error') {
      throw new ApiError(raw.status, raw.detail, raw.retryAfterSeconds)
    }
    if (raw.type === 'no_content') {
      // 204 No Content: 旧契約では成功扱いだったため undefined を返す（型の穴。TP1 削除で消える）
      return undefined as T
    }
    // malformed: 本文が JSON として読めなかった元の parse エラーをそのまま再 throw
    throw raw.error
  }

  // raw を持たない失敗（factory 形式 mock 経由。gateway の ApiFailure.kind から旧 ApiError への逆変換）
  const failure = r.failure
  switch (failure.kind) {
    case 'network':
    case 'timeout':
      throw new ApiError(0, 'Network error')
    case 'unauthorized':
      throw new ApiError(401, 'Unknown error')
    case 'forbidden':
      throw new ApiError(403, 'Unknown error')
    case 'not_found':
      throw new ApiError(404, 'Unknown error')
    case 'conflict':
      throw new ApiError(409, 'Unknown error')
    case 'validation':
      throw new ApiError(422, failure.detail)
    case 'rate_limited':
      throw new ApiError(429, 'Unknown error', failure.retryAfterSeconds)
    case 'server':
      throw new ApiError(failure.status, 'Unknown error')
    case 'unknown':
      if (failure.status === 204) {
        // 204 No Content: 旧契約では成功扱いだったため undefined を返す（型の穴。TP1 削除で消える）
        return undefined as T
      }
      throw new ApiError(failure.status, 'Unknown error')
  }
}

export function createApiClient() {
  return {
    getFeed() {
      return request<FeedResponse>('/api/backend/feed', { method: 'GET' })
    },

    /**
     * Star 済み記事のサーバ側一覧（新しい star 順）。backend が GET /feed から star 済み記事を
     * 恒久除外する移行に伴い、Star タブの真実の源をこちらへ切り替える。
     */
    getStarredArticles() {
      return request<StarredArticlesResponse>('/api/backend/articles/starred', { method: 'GET' })
    },

    // difficulty 省略時は backend 側で prefs のデフォルト難易度が使われる（後方互換・issue #163）。
    // remaining は生成残回数（issue #164 / ADR-061）。旧 backend は未送信のため optional。
    starArticle(id: string, difficulty?: DifficultyLevel) {
      return request<{ status: string; article_id: string; remaining?: number | null }>(
        `/api/backend/articles/${id}/star`,
        {
          method: 'POST',
          ...(difficulty ? { body: JSON.stringify({ difficulty }) } : {}),
        },
      )
    },

    dismissArticle(id: string) {
      return request<{ status: string; article_id: string }>(
        `/api/backend/articles/${id}/dismiss`,
        { method: 'POST' },
      )
    },

    // Star解除。backend側は冪等・生成済みPodcastも削除する。200 + ActionResponse
    // （{status: "unstarred", article_id}）を返す（204は返さない）。
    unstarArticle(id: string) {
      return request<{ status: string; article_id: string }>(
        `/api/backend/articles/${id}/star`,
        { method: 'DELETE' },
      )
    },

    getPodcasts() {
      return request<PodcastsResponse>('/api/backend/podcasts', { method: 'GET' })
    },

    getPodcast(id: string) {
      return request<Podcast>(`/api/backend/podcasts/${id}`, { method: 'GET' })
    },

    updatePosition(id: string, positionSeconds: number) {
      return request<Podcast>(
        `/api/backend/podcasts/${id}/position`,
        {
          method: 'PATCH',
          body: JSON.stringify({ position_seconds: positionSeconds }),
        },
      )
    },

    /**
     * 完聴イベント発火（ADR-075 決定3）。ended（自然終端）到達時に呼ぶ。ボディ不要・
     * サーバ側で first-write-wins のため、呼び出し側は fire-and-forget（失敗握りつぶし）でよい。
     * updatePosition の鏡像だが、責務が別（同期 vs イベント）のため専用エンドポイントに分離する。
     */
    markCompleted(id: string) {
      return request<Podcast>(
        `/api/backend/podcasts/${id}/completed`,
        { method: 'POST' },
      )
    },

    /**
     * 理解度チェッククイズの回答送信・サーバ採点（ADR-070 決定7）。
     * answers は各設問で選んだ option の添字（設問順）。正解キーはクライアントに一切渡らず、
     * このレスポンスの results[].correct_index で採点後にのみ開示される。
     */
    submitQuizAnswers(podcastId: string, answers: number[]) {
      return request<QuizAnswerResponse>(
        `/api/backend/podcasts/${podcastId}/quiz-answers`,
        {
          method: 'POST',
          body: JSON.stringify({ answers }),
        },
      )
    },

    getSources() {
      return request<SourcesResponse>('/api/backend/settings/sources', { method: 'GET' })
    },

    addSource(name: string, url: string) {
      return request<SourcesResponse>(
        '/api/backend/settings/sources',
        { method: 'POST', body: JSON.stringify({ name, url }) },
      )
    },

    deleteSource(url: string) {
      const encoded = encodeURIComponent(url)
      return request<SourcesResponse>(
        `/api/backend/settings/sources?url=${encoded}`,
        { method: 'DELETE' },
      )
    },

    getFeaturedSources() {
      return request<FeaturedSourcesResponse>(
        '/api/backend/settings/featured-sources',
        { method: 'GET' },
      )
    },

    getOnboardingStatus() {
      return request<OnboardingStatusResponse>(
        '/api/backend/settings/onboarding',
        { method: 'GET' },
      )
    },

    completeOnboarding() {
      return request<OnboardingStatusResponse>(
        '/api/backend/settings/onboarding/complete',
        { method: 'POST' },
      )
    },

    getPreferences() {
      return request<UserPreferences>('/api/backend/settings/preferences', { method: 'GET' })
    },

    /** 生成残回数。limit=0 は無制限（remaining は null）。issue #164 / ADR-061。 */
    getGenerationQuota() {
      return request<GenerationQuota>('/api/backend/users/me/generation-quota', { method: 'GET' })
    },

    /** 聴取ストリーク。current_streak_days=0 でも last_listened_day が非null の場合がある（途切れ）。issue #165 / ADR-062。 */
    getListeningStreak() {
      return request<ListeningStreak>('/api/backend/users/me/listening-streak', { method: 'GET' })
    },

    /** 難易度自動適応の推奨。常に 200・has_suggestion=false で推奨なしを表現する。ADR-071 F3。 */
    getDifficultySuggestion() {
      return request<DifficultySuggestion>('/api/backend/users/me/difficulty-suggestion', { method: 'GET' })
    },

    /** 学習ダッシュボード（ストリーク・週次目標・実績・エピソード数・語彙・クイズ成績・月別活動・難易度）。
     *  既存シグナルの read-only 集約。常に200・新規ユーザーは全ゼロ/null/空配列（ADR-072 / F4）。 */
    getLearningDashboard() {
      return request<LearningDashboard>('/api/backend/users/me/learning-dashboard', { method: 'GET' })
    },

    saveVocabulary(podcastId: string, term: string) {
      return request<VocabularyItem>('/api/backend/vocabulary', {
        method: 'POST',
        body: JSON.stringify({ podcast_id: podcastId, term }),
      })
    },

    getVocabulary() {
      return request<VocabularyListResponse>('/api/backend/vocabulary', { method: 'GET' })
    },

    getVocabularyTestSession() {
      return request<VocabularyTestSessionResponse>('/api/backend/vocabulary/test-session', {
        method: 'GET',
      })
    },

    submitVocabularyTestResult(results: VocabularyTestResultItem[]) {
      return request<VocabularyTestResultResponse>('/api/backend/vocabulary/test-result', {
        method: 'POST',
        body: JSON.stringify(results),
      })
    },

    updatePreferences(patch: UserPreferencesPatch) {
      return request<UserPreferences>('/api/backend/settings/preferences', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
    },

    checkHealth() {
      return request<{ status: string }>('/api/backend/health', { method: 'GET' })
    },

    // ── 認証（セッション） ──────────────────────────────────────
    login(username: string, password: string) {
      return request<LoginResponse>('/api/backend/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
    },

    logout() {
      return request<{ status: string }>('/api/backend/auth/logout', { method: 'POST' })
    },

    /**
     * 招待コードによる新規登録。成功時（201）は login と同じ LoginResponse を返し、
     * httpOnly セッション Cookie を発行する。invite_code/display_name は未指定なら
     * ボディへ含めない（バックエンドの Optional フィールドとの整合）。
     */
    register(input: RegisterInput) {
      const body: Record<string, string> = { username: input.username, password: input.password }
      if (input.invite_code) body.invite_code = input.invite_code
      if (input.display_name) body.display_name = input.display_name
      return request<LoginResponse>('/api/backend/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },

    getMe() {
      return request<AuthUser>('/api/backend/auth/me', { method: 'GET' })
    },

    updateProfile(displayName: string) {
      return request<AuthUser>('/api/backend/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName }),
      })
    },

    changePassword(currentPassword: string, newPassword: string) {
      return request<{ status: string }>('/api/backend/auth/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
    },

    /**
     * アカウント削除（退会）。要ログイン・CSRF 必須（request() が自動付与）。
     * 成功時（204）はサーバー側でセッション Cookie が失効するため戻り値は無い。
     * 403 = パスワード不一致 / 401 = 未認証 / 409 = 最後の管理者のため削除不可（呼び出し側で判定）。
     */
    deleteAccount(currentPassword: string) {
      return request<void>('/api/backend/auth/me', {
        method: 'DELETE',
        body: JSON.stringify({ current_password: currentPassword }),
      })
    },

    /**
     * リテンション計測ダッシュボード用スナップショット（ADR-075 決定 E1・require_admin・
     * backend api/schemas.py 確定契約）。指定日（省略時は当日 Asia/Tokyo）のスナップショットが
     * 未生成の場合は 404（呼び出し側で ApiError.status===404 を「集計データ未蓄積」として扱う）。
     */
    getMetrics() {
      return request<MetricsSnapshot>('/api/backend/admin/metrics', { method: 'GET' })
    },

    // ── 管理者によるユーザー管理 ────────────────────────────────
    listUsers() {
      return request<UserListResponse>('/api/backend/admin/users', { method: 'GET' })
    },

    createUser(input: { username: string; password: string; display_name?: string; role?: UserRole }) {
      return request<AuthUser>('/api/backend/admin/users', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    updateUser(
      username: string,
      patch: { role?: UserRole; new_password?: string; display_name?: string },
    ) {
      return request<AuthUser>(`/api/backend/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },

    deleteUser(username: string) {
      return request<{ status: string; username: string }>(
        `/api/backend/admin/users/${encodeURIComponent(username)}`,
        { method: 'DELETE' },
      )
    },

    // ── 管理者による招待コード管理 ────────────────────────────────
    /** code / invite_url はこの応答でのみ表示される（以降は復元不可）。 */
    createInvite(input: { note?: string; max_uses?: number; expires_in_days?: number }) {
      return request<InviteCreateResponse>('/api/backend/admin/invites', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    listInvites() {
      return request<InviteListResponse>('/api/backend/admin/invites', { method: 'GET' })
    },

    /** 招待コードを失効（ソフト削除）。存在しない id は 404。 */
    revokeInvite(id: string) {
      return request<void>(`/api/backend/admin/invites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },

    // ── 管理者によるおすすめサイト管理 ────────────────────────────────
    listFeaturedSites() {
      return request<FeaturedSourcesResponse>('/api/backend/admin/featured-sites', { method: 'GET' })
    },

    createFeaturedSite(input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number }) {
      return request<FeaturedSource>('/api/backend/admin/featured-sites', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    updateFeaturedSite(
      id: string,
      input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number },
    ) {
      return request<FeaturedSource>(`/api/backend/admin/featured-sites/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })
    },

    deleteFeaturedSite(id: string) {
      return request<{ status: string; id: string }>(
        `/api/backend/admin/featured-sites/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
    },

    // ── Web Push 通知 ─────────────────────────────────────────────────────
    getVapidPublicKey() {
      return request<VapidPublicKeyResponse>(
        '/api/backend/notifications/vapid-public-key',
        { method: 'GET' },
      )
    },

    subscribePush(subscription: PushSubscriptionJSON) {
      return request<Record<string, unknown>>(
        '/api/backend/notifications/subscriptions',
        { method: 'POST', body: JSON.stringify(subscription) },
      )
    },

    unsubscribePush(endpoint: string) {
      // WHY: endpoint はクエリパラメータで渡す（backend は ?endpoint= を読む。
      //       既存 deleteSource(url) と同じ DELETE 規約に揃える）。
      const encoded = encodeURIComponent(endpoint)
      return request<Record<string, unknown>>(
        `/api/backend/notifications/subscriptions?endpoint=${encoded}`,
        { method: 'DELETE' },
      )
    },

    // ── Passkey / WebAuthn ────────────────────────────────────────────
    // register/options・login/options は認証不要だが credentials:'include' で Cookie を送る。
    // register/options・register/verify・delete は CSRF 必須（X-CSRF-Token は request() が自動付与）。
    // login/options・login/verify は CSRF 免除（backend の csrf.py 設定参照）。

    /** 登録オプション取得。要ログイン・CSRF 必須。options は JSON 文字列で返る → 呼び出し側で JSON.parse。 */
    getPasskeyRegisterOptions() {
      return request<PasskeyOptionsResponse>(
        '/api/backend/auth/passkey/register/options',
        { method: 'POST' },
      )
    },

    /** 登録検証。要ログイン・CSRF 必須。credential は startRegistration の戻り値をそのまま渡す。 */
    verifyPasskeyRegistration(challenge_id: string, credential: unknown) {
      return request<{ status: string }>(
        '/api/backend/auth/passkey/register/verify',
        { method: 'POST', body: JSON.stringify({ challenge_id, credential }) },
      )
    },

    /** ログインオプション取得。認証不要・CSRF 免除。discoverable フロー（username 不送信）。*/
    getPasskeyLoginOptions() {
      return request<PasskeyOptionsResponse>(
        '/api/backend/auth/passkey/login/options',
        { method: 'POST' },
      )
    },

    /** ログイン検証。認証不要・CSRF 免除。成功時は httpOnly Cookie セッションを発行し LoginResponse を返す。 */
    verifyPasskeyLogin(challenge_id: string, credential: unknown) {
      return request<LoginResponse>(
        '/api/backend/auth/passkey/login/verify',
        { method: 'POST', body: JSON.stringify({ challenge_id, credential }) },
      )
    },

    /** 登録済みクレデンシャル一覧。要ログイン。public_key は含まれない。 */
    getPasskeyCredentials() {
      return request<PasskeyCredentialsListResponse>(
        '/api/backend/auth/passkey/credentials',
        { method: 'GET' },
      )
    },

    /** クレデンシャル削除。要ログイン・CSRF 必須。credential_id は encodeURIComponent で安全にエスケープ。 */
    deletePasskeyCredential(credential_id: string) {
      return request<{ status: string }>(
        `/api/backend/auth/passkey/credentials/${encodeURIComponent(credential_id)}`,
        { method: 'DELETE' },
      )
    },

    /** 自分の有効セッション（ログイン中デバイス）一覧。要ログイン。issue #84。 */
    getSessions() {
      return request<SessionsListResponse>('/api/backend/auth/sessions', { method: 'GET' })
    },

    /** セッションを個別失効。要ログイン・CSRF 必須。他人/不在は 404。 */
    revokeSession(session_id: string) {
      return request<{ status: string }>(
        `/api/backend/auth/sessions/${encodeURIComponent(session_id)}`,
        { method: 'DELETE' },
      )
    },

    /** 現在以外のセッションを一括失効（他のデバイスからログアウト）。要ログイン・CSRF 必須。 */
    revokeOtherSessions() {
      return request<RevokeSessionsResponse>('/api/backend/auth/sessions/revoke-others', {
        method: 'POST',
      })
    },
  }
}

