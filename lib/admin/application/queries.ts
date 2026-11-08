// Admin の query（読み取りだけ）: web-query-admin-01〜04。失敗は gateway の Result をそのまま返す。
import type { AdminGateway } from '@/lib/admin/application/ports'
import {
  toAdminUserRow,
  toFeaturedSiteRow,
  toInviteRow,
  toMetricsView,
  type AdminUserRow,
  type FeaturedSiteRow,
  type InviteRow,
  type MetricsView,
} from '@/lib/admin/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface AdminQueries {
  listUsers(): Promise<Result<ReadonlyArray<AdminUserRow>, ApiFailure>>
  listInvites(): Promise<Result<ReadonlyArray<InviteRow>, ApiFailure>>
  listFeaturedSites(): Promise<Result<ReadonlyArray<FeaturedSiteRow>, ApiFailure>>
  getMetrics(): Promise<Result<MetricsView, ApiFailure>>
}

export function createAdminQueries({ gateway }: { readonly gateway: AdminGateway }): AdminQueries {
  return {
    async listUsers() {
      const result = await gateway.listUsers()
      if (!result.ok) return result
      return { ok: true, value: Object.freeze(result.value.map(toAdminUserRow)) }
    },
    async listInvites() {
      const result = await gateway.listInvites()
      if (!result.ok) return result
      return { ok: true, value: Object.freeze(result.value.map(toInviteRow)) }
    },
    async listFeaturedSites() {
      const result = await gateway.listFeaturedSites()
      if (!result.ok) return result
      return { ok: true, value: Object.freeze(result.value.map(toFeaturedSiteRow)) }
    },
    async getMetrics() {
      const result = await gateway.getMetrics()
      if (!result.ok) return result
      return { ok: true, value: toMetricsView(result.value) }
    },
  }
}
