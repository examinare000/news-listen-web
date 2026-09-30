import type {
  FeaturedSource,
  FeaturedSourcesResponse,
  AuthUser,
  UserListResponse,
  UserRole,
  InviteCreateResponse,
  InviteListResponse,
  MetricsSnapshot,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

/**
 * リテンション計測ダッシュボード用スナップショット（ADR-075 決定 E1・require_admin・
 * backend api/schemas.py 確定契約）。指定日（省略時は当日 Asia/Tokyo）のスナップショットが
 * 未生成の場合は 404（呼び出し側で ApiError.status===404 を「集計データ未蓄積」として扱う）。
 */
export function getMetrics() {
  return request<MetricsSnapshot>('/api/backend/admin/metrics', { method: 'GET' })
}

// ── 管理者によるユーザー管理 ────────────────────────────────

export function listUsers() {
  return request<UserListResponse>('/api/backend/admin/users', { method: 'GET' })
}

export function createUser(input: { username: string; password: string; display_name?: string; role?: UserRole }) {
  return request<AuthUser>('/api/backend/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateUser(
  username: string,
  patch: { role?: UserRole; new_password?: string; display_name?: string },
) {
  return request<AuthUser>(`/api/backend/admin/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteUser(username: string) {
  return request<{ status: string; username: string }>(
    `/api/backend/admin/users/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
  )
}

// ── 管理者による招待コード管理 ────────────────────────────────

/** code / invite_url はこの応答でのみ表示される（以降は復元不可）。 */
export function createInvite(input: { note?: string; max_uses?: number; expires_in_days?: number }) {
  return request<InviteCreateResponse>('/api/backend/admin/invites', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listInvites() {
  return request<InviteListResponse>('/api/backend/admin/invites', { method: 'GET' })
}

/** 招待コードを失効（ソフト削除）。存在しない id は 404。 */
export function revokeInvite(id: string) {
  return request<void>(`/api/backend/admin/invites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ── 管理者によるおすすめサイト管理 ────────────────────────────────

export function listFeaturedSites() {
  return request<FeaturedSourcesResponse>('/api/backend/admin/featured-sites', { method: 'GET' })
}

export function createFeaturedSite(input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number }) {
  return request<FeaturedSource>('/api/backend/admin/featured-sites', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateFeaturedSite(
  id: string,
  input: { name: string; url: string; thumbnail_url?: string; description?: string; category?: string; order: number },
) {
  return request<FeaturedSource>(`/api/backend/admin/featured-sites/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteFeaturedSite(id: string) {
  return request<{ status: string; id: string }>(
    `/api/backend/admin/featured-sites/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}
