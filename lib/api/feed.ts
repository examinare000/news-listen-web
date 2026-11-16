import type {
  FeedResponse,
} from '@/lib/api/dto'
import type { ApiGateway } from '@/lib/api/gateway'

export function getFeed(gateway: ApiGateway) {
  return gateway.request<FeedResponse>('/api/backend/feed', { method: 'GET' })
}
