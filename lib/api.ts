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
} from '@/types/index'

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

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
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

    checkHealth() {
      return request<{ status: string }>('/api/backend/health', config, { method: 'GET' })
    },
  }
}

