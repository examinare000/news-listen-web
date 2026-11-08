// Admin の command: web-cmd-admin-01〜09。gateway の書込 method を呼び、失敗は gateway の Result をそのまま返す。
// 入力の検査（password の方針・必須欄・招待の数値欄）は page が行う（web-dec-137）。
import { nextOrder, orderForUpdate, reorderDiff } from '@/lib/admin/domain/featuredOrder'
import type { UserRole } from '@/lib/account/domain/role'
import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'
import type { AdminGateway } from '@/lib/admin/application/ports'
import { toInviteReceipt, type FeaturedSiteRow, type InviteReceipt } from '@/lib/admin/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface FeaturedSiteInput {
  readonly name: string
  readonly url: string
  readonly thumbnailUrl: string | undefined
  readonly description: string | undefined
  readonly category: FeaturedCategory
}

export interface AdminCommands {
  createUser(input: {
    readonly username: string
    readonly password: string
    readonly displayName: string | undefined
    readonly role: UserRole
  }): Promise<Result<void, ApiFailure>>
  updateUser(username: string, patch: { readonly role: UserRole }): Promise<Result<void, ApiFailure>>
  deleteUser(username: string): Promise<Result<void, ApiFailure>>
  createInvite(input: {
    readonly note: string | undefined
    readonly maxUses: number | undefined
    readonly expiresInDays: number | undefined
  }): Promise<Result<InviteReceipt, ApiFailure>>
  revokeInvite(id: string): Promise<Result<void, ApiFailure>>
  createFeaturedSite(sites: ReadonlyArray<FeaturedSiteRow>, input: FeaturedSiteInput): Promise<Result<void, ApiFailure>>
  updateFeaturedSite(
    sites: ReadonlyArray<FeaturedSiteRow>,
    id: string,
    input: FeaturedSiteInput,
  ): Promise<Result<void, ApiFailure>>
  deleteFeaturedSite(id: string): Promise<Result<void, ApiFailure>>
  reorderFeaturedSites(
    sites: ReadonlyArray<FeaturedSiteRow>,
    id: string,
    direction: 'up' | 'down',
  ): Promise<Result<{ readonly moved: boolean }, ApiFailure>>
}

export function createAdminCommands({ gateway }: { readonly gateway: AdminGateway }): AdminCommands {
  return {
    createUser: (input) => gateway.createUser(input),
    updateUser: (username, patch) => gateway.updateUser(username, patch),
    deleteUser: (username) => gateway.deleteUser(username),
    async createInvite(input) {
      const result = await gateway.createInvite(input)
      if (!result.ok) return result
      return { ok: true, value: toInviteReceipt(result.value) }
    },
    revokeInvite: (id) => gateway.revokeInvite(id),
    createFeaturedSite: (sites, input) => gateway.createFeaturedSite({ ...input, order: nextOrder(sites) }),
    updateFeaturedSite: (sites, id, input) =>
      gateway.updateFeaturedSite(id, { ...input, order: orderForUpdate(sites, id) }),
    deleteFeaturedSite: (id) => gateway.deleteFeaturedSite(id),
    async reorderFeaturedSites(sites, id, direction) {
      const diff = reorderDiff(sites, id, direction)
      if (diff === null) return { ok: true, value: { moved: false } }
      // 並列に送らず、最初の失敗で止める（途中までの更新は呼び手が reload で整合させる）。
      for (const row of diff) {
        const result = await gateway.updateFeaturedSite(row.id, {
          name: row.name,
          url: row.url,
          thumbnailUrl: row.thumbnailUrl || undefined,
          description: row.description || undefined,
          category: row.category,
          order: row.order,
        })
        if (!result.ok) return result
      }
      return { ok: true, value: { moved: true } }
    },
  }
}
