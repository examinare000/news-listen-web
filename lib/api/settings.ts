import type {
  SourcesResponse,
  FeaturedSourcesResponse,
  OnboardingStatusResponse,
  UserPreferences,
  UserPreferencesPatch,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

export function getSources() {
  return request<SourcesResponse>('/api/backend/settings/sources', { method: 'GET' })
}

export function addSource(name: string, url: string) {
  return request<SourcesResponse>(
    '/api/backend/settings/sources',
    { method: 'POST', body: JSON.stringify({ name, url }) },
  )
}

export function deleteSource(url: string) {
  const encoded = encodeURIComponent(url)
  return request<SourcesResponse>(
    `/api/backend/settings/sources?url=${encoded}`,
    { method: 'DELETE' },
  )
}

export function getFeaturedSources() {
  return request<FeaturedSourcesResponse>(
    '/api/backend/settings/featured-sources',
    { method: 'GET' },
  )
}

export function getOnboardingStatus() {
  return request<OnboardingStatusResponse>(
    '/api/backend/settings/onboarding',
    { method: 'GET' },
  )
}

export function completeOnboarding() {
  return request<OnboardingStatusResponse>(
    '/api/backend/settings/onboarding/complete',
    { method: 'POST' },
  )
}

export function getPreferences() {
  return request<UserPreferences>('/api/backend/settings/preferences', { method: 'GET' })
}

export function updatePreferences(patch: UserPreferencesPatch) {
  return request<UserPreferences>('/api/backend/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
