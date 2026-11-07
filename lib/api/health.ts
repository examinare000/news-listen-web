import type { ApiGateway } from '@/lib/api/gateway'

export function checkHealth(gateway: ApiGateway) {
  return gateway.request<{ status: string }>('/api/backend/health', { method: 'GET' })
}
