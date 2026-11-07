import type {
  FeaturedSource,
  FeaturedSourcesResponse,
  UserSummary,
  UserListResponse,
  UserRole,
  InviteCreateResponse,
  InviteListResponse,
  MetricsSnapshot,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

/**
 * リテンション計測ダッシュボード用スナップショット（ADR-075 決定 E1・require_admin・
 * backend api/schemas.py 確定契約）。指定日（省略時は当日 Asia/Tokyo）のスナップショットが
 * 未生成の場合は 404（呼び出し側で ApiError.status===404 を「集計データ未蓄積」として扱う）。
 */
export function getMetrics(gateway: ApiGateway) {
  return gateway.request<MetricsSnapshot>('/api/backend/admin/metrics', { method: 'GET' })
}

// ── 管理者によるユーザー管理 ────────────────────────────────

export function listUsers(gateway: ApiGateway) {
  return gateway.request<UserListResponse>('/api/backend/admin/users', { method: 'GET' })
}

export function createUser(gateway: ApiGateway, input: { username: string; password: string; display_name?: string; role?: UserRole }) {
  return gateway.request<UserSummary>('/api/backend/admin/users', {
    method: 'POST',
    body: input,
  })
}

export function updateUser(
  gateway: ApiGateway,
  username: string,
  patch: { role?: UserRole; new_password?: string; display_name?: string },
) {
  return gateway.request<UserSummary>(`/api/backend/admin/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: patch,
  })
}

export function deleteUser(gateway: ApiGateway, username: string) {
  return gateway.request<{ status: string; username: string }>(
    `/api/backend/admin/users/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
  )
}

// ── 管理者による招待コード管理 ────────────────────────────────

/** code / invite_url はこの応答でのみ表示される（以降は復元不可）。 */
export function createInvite(gateway: ApiGateway, input: { note?: string; max_uses?: number; expires_in_days?: number }) {
  return gateway.request<InviteCreateResponse>('/api/backend/admin/invites', {
    method: 'POST',
    body: input,
  })
}

export function listInvites(gateway: ApiGateway) {
  return gateway.request<InviteListResponse>('/api/backend/admin/invites', { method: 'GET' })
}

/** 招待コードを失効（ソフト削除）。存在しない id は 404。 */
export function revokeInvite(gateway: ApiGateway, id: string) {
  return gateway.request<{ status: string; id: string }>(`/api/backend/admin/invites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ── 管理者によるおすすめサイト管理 ────────────────────────────────

export function listFeaturedSites(gateway: ApiGateway) {
  return gateway.request<FeaturedSourcesResponse>('/api/backend/admin/featured-sites', { method: 'GET' })
}

export function createFeaturedSite(gateway: ApiGateway, input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number }) {
  return gateway.request<FeaturedSource>('/api/backend/admin/featured-sites', {
    method: 'POST',
    body: input,
  })
}

export function updateFeaturedSite(
  gateway: ApiGateway,
  id: string,
  input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number },
) {
  return gateway.request<FeaturedSource>(`/api/backend/admin/featured-sites/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  })
}

export function deleteFeaturedSite(gateway: ApiGateway, id: string) {
  return gateway.request<{ status: string; id: string }>(
    `/api/backend/admin/featured-sites/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}
