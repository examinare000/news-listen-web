import type {
  VocabularyItem,
  VocabularyListResponse,
  VocabularyTestSessionResponse,
  VocabularyTestResultItem,
  VocabularyTestResultResponse,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

export function saveVocabulary(podcastId: string, term: string) {
  return request<VocabularyItem>('/api/backend/vocabulary', {
    method: 'POST',
    body: JSON.stringify({ podcast_id: podcastId, term }),
  })
}

export function getVocabulary() {
  return request<VocabularyListResponse>('/api/backend/vocabulary', { method: 'GET' })
}

export function getVocabularyTestSession() {
  return request<VocabularyTestSessionResponse>('/api/backend/vocabulary/test-session', {
    method: 'GET',
  })
}

export function submitVocabularyTestResult(results: VocabularyTestResultItem[]) {
  return request<VocabularyTestResultResponse>('/api/backend/vocabulary/test-result', {
    method: 'POST',
    body: JSON.stringify(results),
  })
}
