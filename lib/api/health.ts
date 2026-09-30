import { request } from '@/lib/api/legacyRequest'

export function checkHealth() {
  return request<{ status: string }>('/api/backend/health', { method: 'GET' })
}
