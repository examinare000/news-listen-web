// Admin 画面が読む形（リードモデル）と、record からの生成関数。呼ぶたびに新しい値を作り、全深さで凍結する。
// record は gateway が正規化済みの値なので、ここでは写すだけで値の検査をしない。
import type { UserRole } from '@/lib/account/domain/role'
import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'
import type {
  AdminUserRecord,
  FeaturedSiteRecord,
  InviteReceiptRecord,
  InviteRecord,
  MetricsRecord,
} from '@/lib/admin/application/ports'

// page は `@/types` を import できないので、招待の状態の型はここから再 export する。
export type { InviteStatus } from '@/lib/admin/application/ports'

export interface AdminUserRow {
  readonly username: string
  readonly displayName: string
  readonly role: UserRole
}

export interface InviteRow {
  readonly id: string
  readonly note: string | null
  readonly status: InviteRecord['status']
  readonly useCount: number
  readonly maxUses: number
  readonly expiresAt: string | null
  readonly createdBy: string
}

export interface InviteReceipt {
  readonly id: string
  readonly code: string
  readonly inviteUrl: string
}

export interface FeaturedSiteRow {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly thumbnailUrl: string
  readonly description: string
  readonly category: FeaturedCategory
  readonly order: number
}

export interface MetricsView {
  readonly date: string
  readonly d7: MetricsRecord['d7']
  readonly d30: MetricsRecord['d30']
  readonly completion: MetricsRecord['completion']
  readonly weeklyStar: MetricsRecord['weeklyStar']
}

export function toAdminUserRow(record: AdminUserRecord): AdminUserRow {
  return Object.freeze({ username: record.username, displayName: record.displayName, role: record.role })
}

export function toInviteRow(record: InviteRecord): InviteRow {
  return Object.freeze({
    id: record.id,
    note: record.note,
    status: record.status,
    useCount: record.useCount,
    maxUses: record.maxUses,
    expiresAt: record.expiresAt,
    createdBy: record.createdBy,
  })
}

export function toInviteReceipt(record: InviteReceiptRecord): InviteReceipt {
  return Object.freeze({ id: record.id, code: record.code, inviteUrl: record.inviteUrl })
}

export function toFeaturedSiteRow(record: FeaturedSiteRecord): FeaturedSiteRow {
  return Object.freeze({
    id: record.id,
    name: record.name,
    url: record.url,
    thumbnailUrl: record.thumbnailUrl ?? '',
    description: record.description ?? '',
    category: record.category,
    order: record.order,
  })
}

export function toMetricsView(record: MetricsRecord): MetricsView {
  return Object.freeze({
    date: record.date,
    d7: Object.freeze({ ...record.d7 }),
    d30: Object.freeze({ ...record.d30 }),
    completion: Object.freeze({ ...record.completion }),
    weeklyStar: Object.freeze({ ...record.weeklyStar }),
  })
}
