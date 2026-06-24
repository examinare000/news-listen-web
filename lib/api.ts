/**
 * BFF-proxied API client.
 *
 * All requests are sent to /api/backend/... (the BFF proxy route).
 * The proxy adds X-Backend-Base-Url and X-API-Key so this client
 * never talks to the backend directly.
 */
import type {
  FeedResponse,
  PodcastsResponse,
  SourcesResponse,
  Podcast,
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
} from '@/types/index'
import { readCookie } from '@/lib/cookie'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

interface ApiClientConfig {
  baseUrl: string
  apiKey: string
}

/** Shared fetch wrapper that normalizes errors to ApiError */
async function request<T>(
  path: string,
  config: ApiClientConfig,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': config.apiKey,
    'X-Backend-Base-Url': config.baseUrl,
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
      const body = await response.json()
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Non-JSON body — keep 'Unknown error'
    }
    throw new ApiError(response.status, detail)
  }

  return response.json() as Promise<T>
}

export function createApiClient(config: ApiClientConfig) {
  return {
    getFeed() {
      return request<FeedResponse>('/api/backend/feed', config, { method: 'GET' })
    },

    starArticle(id: string) {
      return request<{ status: string; article_id: string }>(
        `/api/backend/articles/${id}/star`,
        config,
        { method: 'POST' },
      )
    },

    dismissArticle(id: string) {
      return request<{ status: string; article_id: string }>(
        `/api/backend/articles/${id}/dismiss`,
        config,
        { method: 'POST' },
      )
    },

    getPodcasts() {
      return request<PodcastsResponse>('/api/backend/podcasts', config, { method: 'GET' })
    },

    getPodcast(id: string) {
      return request<Podcast>(`/api/backend/podcasts/${id}`, config, { method: 'GET' })
    },

    updatePosition(id: string, positionSeconds: number) {
      return request<Podcast>(
        `/api/backend/podcasts/${id}/position`,
        config,
        {
          method: 'PATCH',
          body: JSON.stringify({ position_seconds: positionSeconds }),
        },
      )
    },

    getSources() {
      return request<SourcesResponse>('/api/backend/settings/sources', config, { method: 'GET' })
    },

    addSource(name: string, url: string) {
      return request<SourcesResponse>(
        '/api/backend/settings/sources',
        config,
        { method: 'POST', body: JSON.stringify({ name, url }) },
      )
    },

    deleteSource(url: string) {
      const encoded = encodeURIComponent(url)
      return request<SourcesResponse>(
        `/api/backend/settings/sources?url=${encoded}`,
        config,
        { method: 'DELETE' },
      )
    },

    getFeaturedSources() {
      return request<FeaturedSourcesResponse>(
        '/api/backend/settings/featured-sources',
        config,
        { method: 'GET' },
      )
    },

    getOnboardingStatus() {
      return request<OnboardingStatusResponse>(
        '/api/backend/settings/onboarding',
        config,
        { method: 'GET' },
      )
    },

    completeOnboarding() {
      return request<OnboardingStatusResponse>(
        '/api/backend/settings/onboarding/complete',
        config,
        { method: 'POST' },
      )
    },

    getPreferences() {
      return request<UserPreferences>('/api/backend/settings/preferences', config, { method: 'GET' })
    },

    updatePreferences(patch: UserPreferencesPatch) {
      return request<UserPreferences>('/api/backend/settings/preferences', config, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
    },

    checkHealth() {
      return request<{ status: string }>('/api/backend/health', config, { method: 'GET' })
    },

    // ── 認証（セッション） ──────────────────────────────────────
    login(username: string, password: string) {
      return request<LoginResponse>('/api/backend/auth/login', config, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
    },

    logout() {
      return request<{ status: string }>('/api/backend/auth/logout', config, { method: 'POST' })
    },

    getMe() {
      return request<AuthUser>('/api/backend/auth/me', config, { method: 'GET' })
    },

    updateProfile(displayName: string) {
      return request<AuthUser>('/api/backend/auth/me', config, {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName }),
      })
    },

    changePassword(currentPassword: string, newPassword: string) {
      return request<{ status: string }>('/api/backend/auth/password', config, {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
    },

    // ── 管理者によるユーザー管理 ────────────────────────────────
    listUsers() {
      return request<UserListResponse>('/api/backend/admin/users', config, { method: 'GET' })
    },

    createUser(input: { username: string; password: string; display_name?: string; role?: UserRole }) {
      return request<AuthUser>('/api/backend/admin/users', config, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    updateUser(
      username: string,
      patch: { role?: UserRole; new_password?: string; display_name?: string },
    ) {
      return request<AuthUser>(`/api/backend/admin/users/${encodeURIComponent(username)}`, config, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },

    deleteUser(username: string) {
      return request<{ status: string; username: string }>(
        `/api/backend/admin/users/${encodeURIComponent(username)}`,
        config,
        { method: 'DELETE' },
      )
    },

    // ── Web Push 通知 ─────────────────────────────────────────────────────
    getVapidPublicKey() {
      return request<VapidPublicKeyResponse>(
        '/api/backend/notifications/vapid-public-key',
        config,
        { method: 'GET' },
      )
    },

    subscribePush(subscription: PushSubscriptionJSON) {
      return request<Record<string, unknown>>(
        '/api/backend/notifications/subscriptions',
        config,
        { method: 'POST', body: JSON.stringify(subscription) },
      )
    },

    unsubscribePush(endpoint: string) {
      // WHY: endpoint はクエリパラメータで渡す（backend は ?endpoint= を読む。
      //       既存 deleteSource(url) と同じ DELETE 規約に揃える）。
      const encoded = encodeURIComponent(endpoint)
      return request<Record<string, unknown>>(
        `/api/backend/notifications/subscriptions?endpoint=${encoded}`,
        config,
        { method: 'DELETE' },
      )
    },
  }
}

