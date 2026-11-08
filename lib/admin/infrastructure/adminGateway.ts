// port AdminGateway の実装。lib/api/admin.ts の 12 関数を呼び、DTO を record（camelCase）に写し、書込の入力を body（snake_case）に写す。
// path・method・body は lib/api/admin.ts のまま。値の検査はしない。category の正規化だけは、境界で 1 度ここで行う
// （catalogGateway と同じ置き場。application は他 context の値を import できない）。
import type {
  AdminGateway,
  AdminUserRecord,
  CohortRecord,
  FeaturedSiteRecord,
  InviteReceiptRecord,
  InviteRecord,
  MetricsRecord,
} from '@/lib/admin/application/ports'
import {
  createFeaturedSite,
  createInvite,
  createUser,
  deleteFeaturedSite,
  deleteUser,
  getMetrics,
  listFeaturedSites,
  listInvites,
  listUsers,
  revokeInvite,
  updateFeaturedSite,
  updateUser,
} from '@/lib/api/admin'
import type { ApiGateway } from '@/lib/api/gateway'
import { normalizeFeaturedCategory } from '@/lib/catalog/domain/featuredCategory'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import type {
  FeaturedSource,
  Invite,
  InviteCreateResponse,
  MetricsSnapshot,
  UserSummary,
} from '@/types/index'

function toUserRecord(dto: UserSummary): AdminUserRecord {
  return { username: dto.username, displayName: dto.display_name, role: dto.role }
}

function toInviteRecord(dto: Invite): InviteRecord {
  return {
    id: dto.id,
    note: dto.note,
    status: dto.status,
    useCount: dto.use_count,
    maxUses: dto.max_uses,
    expiresAt: dto.expires_at,
    createdBy: dto.created_by,
  }
}

function toReceiptRecord(dto: InviteCreateResponse): InviteReceiptRecord {
  return { id: dto.id, code: dto.code, inviteUrl: dto.invite_url }
}

function toFeaturedRecord(dto: FeaturedSource): FeaturedSiteRecord {
  return {
    id: dto.id,
    name: dto.name,
    url: dto.url,
    thumbnailUrl: dto.thumbnail_url ?? null,
    description: dto.description ?? null,
    category: normalizeFeaturedCategory(dto.category),
    order: dto.order,
  }
}

function toCohortRecord(dto: Partial<MetricsSnapshot['d7']> | undefined): CohortRecord {
  return { rate: dto?.rate ?? null, retained: dto?.retained ?? null, eligible: dto?.eligible ?? null }
}

function toMetricsRecord(dto: MetricsSnapshot): MetricsRecord {
  return {
    date: dto.date,
    d7: toCohortRecord(dto.d7),
    d30: toCohortRecord(dto.d30),
    completion: {
      rateStarted: dto.completion?.rate_started ?? null,
      rateDelivered: dto.completion?.rate_delivered ?? null,
    },
    weeklyStar: { avgPerActiveUser: dto.weekly_star?.avg_per_active_user ?? null },
  }
}

function mapOk<T, U>(result: Result<T, ApiFailure>, map: (value: T) => U): Result<U, ApiFailure> {
  return result.ok ? { ok: true, value: map(result.value) } : result
}

function toVoid(result: Result<unknown, ApiFailure>): Result<void, ApiFailure> {
  return mapOk(result, () => undefined)
}

function featuredBody(input: {
  readonly name: string
  readonly url: string
  readonly thumbnailUrl: string | undefined
  readonly description: string | undefined
  readonly category: string
  readonly order: number
}) {
  return {
    name: input.name,
    url: input.url,
    thumbnail_url: input.thumbnailUrl,
    description: input.description,
    category: input.category,
    order: input.order,
  }
}

export function createAdminGateway(gateway: ApiGateway): AdminGateway {
  return {
    async listUsers() {
      return mapOk(await listUsers(gateway), (dto) => dto.users.map(toUserRecord))
    },
    async createUser(input) {
      return toVoid(
        await createUser(gateway, {
          username: input.username,
          password: input.password,
          display_name: input.displayName,
          role: input.role,
        }),
      )
    },
    async updateUser(username, patch) {
      return toVoid(await updateUser(gateway, username, { role: patch.role }))
    },
    async deleteUser(username) {
      return toVoid(await deleteUser(gateway, username))
    },
    async listInvites() {
      return mapOk(await listInvites(gateway), (dto) => dto.invites.map(toInviteRecord))
    },
    async createInvite(input) {
      return mapOk(
        await createInvite(gateway, {
          note: input.note,
          max_uses: input.maxUses,
          expires_in_days: input.expiresInDays,
        }),
        toReceiptRecord,
      )
    },
    async revokeInvite(id) {
      return toVoid(await revokeInvite(gateway, id))
    },
    async listFeaturedSites() {
      return mapOk(await listFeaturedSites(gateway), (dto) => dto.sites.map(toFeaturedRecord))
    },
    async createFeaturedSite(input) {
      return toVoid(await createFeaturedSite(gateway, featuredBody(input)))
    },
    async updateFeaturedSite(id, input) {
      return toVoid(await updateFeaturedSite(gateway, id, featuredBody(input)))
    },
    async deleteFeaturedSite(id) {
      return toVoid(await deleteFeaturedSite(gateway, id))
    },
    async getMetrics() {
      return mapOk(await getMetrics(gateway), toMetricsRecord)
    },
  }
}
