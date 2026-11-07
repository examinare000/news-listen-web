import type {
  SourcesResponse,
  FeaturedSourcesResponse,
  OnboardingStatusResponse,
  UserPreferences,
  UserPreferencesPatch,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

export function getSources(gateway: ApiGateway) {
  return gateway.request<SourcesResponse>('/api/backend/settings/sources', { method: 'GET' })
}

export function addSource(gateway: ApiGateway, name: string, url: string) {
  return gateway.request<SourcesResponse>(
    '/api/backend/settings/sources',
    { method: 'POST', body: { name, url } },
  )
}

export function deleteSource(gateway: ApiGateway, url: string) {
  const encoded = encodeURIComponent(url)
  return gateway.request<SourcesResponse>(
    `/api/backend/settings/sources?url=${encoded}`,
    { method: 'DELETE' },
  )
}

export function getFeaturedSources(gateway: ApiGateway) {
  return gateway.request<FeaturedSourcesResponse>(
    '/api/backend/settings/featured-sources',
    { method: 'GET' },
  )
}

export function getOnboardingStatus(gateway: ApiGateway) {
  return gateway.request<OnboardingStatusResponse>(
    '/api/backend/settings/onboarding',
    { method: 'GET' },
  )
}

export function completeOnboarding(gateway: ApiGateway) {
  return gateway.request<OnboardingStatusResponse>(
    '/api/backend/settings/onboarding/complete',
    { method: 'POST' },
  )
}

export function getPreferences(gateway: ApiGateway) {
  return gateway.request<UserPreferences>('/api/backend/settings/preferences', { method: 'GET' })
}

export function updatePreferences(gateway: ApiGateway, patch: UserPreferencesPatch) {
  return gateway.request<UserPreferences>('/api/backend/settings/preferences', {
    method: 'PUT',
    body: patch,
  })
}
