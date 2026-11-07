import type {
  VocabularyItem,
  VocabularyListResponse,
  VocabularyTestSessionResponse,
  VocabularyTestResultItem,
  VocabularyTestResultResponse,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

export function saveVocabulary(gateway: ApiGateway, podcastId: string, term: string) {
  return gateway.request<VocabularyItem>('/api/backend/vocabulary', {
    method: 'POST',
    body: { podcast_id: podcastId, term },
  })
}

export function getVocabulary(gateway: ApiGateway) {
  return gateway.request<VocabularyListResponse>('/api/backend/vocabulary', { method: 'GET' })
}

export function getVocabularyTestSession(gateway: ApiGateway) {
  return gateway.request<VocabularyTestSessionResponse>('/api/backend/vocabulary/test-session', {
    method: 'GET',
  })
}

export function submitVocabularyTestResult(gateway: ApiGateway, results: VocabularyTestResultItem[]) {
  return gateway.request<VocabularyTestResultResponse>('/api/backend/vocabulary/test-result', {
    method: 'POST',
    body: results,
  })
}
