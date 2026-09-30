import type {
  FeedResponse,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

export function getFeed() {
  return request<FeedResponse>('/api/backend/feed', { method: 'GET' })
}
