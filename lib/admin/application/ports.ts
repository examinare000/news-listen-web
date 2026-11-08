// Admin の port と record（型だけ）。gateway は backend の応答をこの形（camelCase）に写して返す。
import type { UserRole } from '@/lib/account/domain/role'
import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked'

export interface AdminUserRecord {
  readonly username: string
  readonly displayName: string
  readonly role: UserRole
}

export interface InviteRecord {
  readonly id: string
  readonly note: string | null
  readonly status: InviteStatus
  readonly useCount: number
  readonly maxUses: number
  readonly expiresAt: string | null
  readonly createdBy: string
}

export interface InviteReceiptRecord {
  readonly id: string
  readonly code: string
  readonly inviteUrl: string
}

/** category は gateway が値域に正規化済み。 */
export interface FeaturedSiteRecord {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly thumbnailUrl: string | null
  readonly description: string | null
  readonly category: FeaturedCategory
  readonly order: number
}

export interface CohortRecord {
  readonly rate: number | null
  readonly retained: number | null
  readonly eligible: number | null
}

export interface MetricsRecord {
  readonly date: string
  readonly d7: CohortRecord
  readonly d30: CohortRecord
  readonly completion: {
    readonly rateStarted: number | null
    readonly rateDelivered: number | null
  }
  readonly weeklyStar: {
    readonly avgPerActiveUser: number | null
  }
}

export interface AdminUserCreate {
  readonly username: string
  readonly password: string
  readonly displayName: string | undefined
  readonly role: UserRole
}

export interface InviteCreate {
  readonly note: string | undefined
  readonly maxUses: number | undefined
  readonly expiresInDays: number | undefined
}

export interface FeaturedSiteWrite {
  readonly name: string
  readonly url: string
  readonly thumbnailUrl: string | undefined
  readonly description: string | undefined
  readonly category: FeaturedCategory
  readonly order: number
}

export interface AdminGateway {
  listUsers(): Promise<Result<ReadonlyArray<AdminUserRecord>, ApiFailure>>
  createUser(input: AdminUserCreate): Promise<Result<void, ApiFailure>>
  updateUser(username: string, patch: { readonly role: UserRole }): Promise<Result<void, ApiFailure>>
  deleteUser(username: string): Promise<Result<void, ApiFailure>>
  listInvites(): Promise<Result<ReadonlyArray<InviteRecord>, ApiFailure>>
  createInvite(input: InviteCreate): Promise<Result<InviteReceiptRecord, ApiFailure>>
  revokeInvite(id: string): Promise<Result<void, ApiFailure>>
  listFeaturedSites(): Promise<Result<ReadonlyArray<FeaturedSiteRecord>, ApiFailure>>
  createFeaturedSite(input: FeaturedSiteWrite): Promise<Result<void, ApiFailure>>
  updateFeaturedSite(id: string, input: FeaturedSiteWrite): Promise<Result<void, ApiFailure>>
  deleteFeaturedSite(id: string): Promise<Result<void, ApiFailure>>
  getMetrics(): Promise<Result<MetricsRecord, ApiFailure>>
}
