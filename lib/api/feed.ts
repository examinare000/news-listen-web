import type {
  FeedResponse,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

export function getFeed(gateway: ApiGateway) {
  return gateway.request<FeedResponse>('/api/backend/feed', { method: 'GET' })
}
