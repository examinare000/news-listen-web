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
  PodcastsResponse,
  SourcesResponse,
  Podcast,
  FeaturedSource,
  FeaturedSourcesResponse,
  OnboardingStatusResponse,
  AuthUser,
  LoginResponse,
  UserListResponse,
  UserRole,
  UserPreferences,
  UserPreferencesPatch,
  VapidPublicKeyResponse,
  PushSubscriptionJSON,
  PasskeyOptionsResponse,
  PasskeyCredentialsListResponse,
  SessionsListResponse,
  RevokeSessionsResponse,
  GenerationQuota,
  ListeningStreak,
} from '@/types/index'
import { readCookie } from '@/lib/cookie'

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

/** Shared fetch wrapper that normalizes errors to ApiError */
async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }

  // CSRF token injection: add X-CSRF-Token header for state-changing methods
  // if csrf_token cookie is present and not already explicitly set in init.headers
  const method = (init.method ?? 'GET').toUpperCase()
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
  if (!safeMethods.has(method) && typeof document !== 'undefined') {
    const token = readCookie('csrf_token', document.cookie)
    if (token && !headers['X-CSRF-Token']) {
      headers['X-CSRF-Token'] = token
    }
  }

  let response: Response
  try {
    // credentials: 'include' で同一オリジンの BFF 経由のセッション Cookie を送受信する。
    response = await fetch(path, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiError(0, 'Network error')
  }

  if (!response.ok) {
    let detail = 'Unknown error'
    try {
      const body = await response.json() as {
        detail?: string | Array<{ msg?: unknown }>
      }
      if (typeof body.detail === 'string') {
        detail = body.detail
      } else if (Array.isArray(body.detail)) {
        const firstMessage = body.detail[0]?.msg
        if (typeof firstMessage === 'string') {
          const valueErrorPrefix = 'Value error, '
          detail = firstMessage.startsWith(valueErrorPrefix)
            ? firstMessage.slice(valueErrorPrefix.length)
            : firstMessage
        }
      }
    } catch {
      // Non-JSON body — keep 'Unknown error'
    }
    // Retry-After（秒）があれば ApiError に載せる（429 上限の「次回可能時刻」表示用・issue #82）。
    // 一部のテスト用 fetch モックは headers を持たないため optional chaining で安全に読む。
    const retryRaw = response.headers?.get?.('Retry-After') ?? null
    const retryAfterSeconds = retryRaw !== null && /^\d+$/.test(retryRaw) ? Number(retryRaw) : undefined
    throw new ApiError(response.status, detail, retryAfterSeconds)
  }

  // 204 No Content: body が存在しないため response.json() を呼ぶと実際の fetch では
  // SyntaxError になる（例: DELETE /auth/me の退会成功応答）。
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function createApiClient() {
  return {
    getFeed() {
      return request<FeedResponse>('/api/backend/feed', { method: 'GET' })
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

    // ── 管理者によるおすすめサイト管理 ────────────────────────────────
    listFeaturedSites() {
      return request<FeaturedSourcesResponse>('/api/backend/admin/featured-sites', { method: 'GET' })
    },

    createFeaturedSite(input: { name: string; url: string; thumbnail_url?: string; description?: string; order: number }) {
      return request<FeaturedSource>('/api/backend/admin/featured-sites', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    updateFeaturedSite(
      id: string,
      input: { name: string; url: string; thumbnail_url?: string; description?: string; order: number },
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

