// Account の query（読み取りだけ）: web-query-account-03・04。失敗は gateway の Result をそのまま返す。
import type { AccountGateway } from '@/lib/account/application/ports'
import type { PasskeyRow, SessionRow } from '@/lib/account/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface AccountQueries {
  listSessions(): Promise<Result<ReadonlyArray<SessionRow>, ApiFailure>>
  listPasskeys(): Promise<Result<ReadonlyArray<PasskeyRow>, ApiFailure>>
}

export function createAccountQueries({ gateway }: { readonly gateway: AccountGateway }): AccountQueries {
  return {
    async listSessions() {
      const result = await gateway.listSessions()
      if (!result.ok) return result
      const rows = result.value.map((row): SessionRow =>
        Object.freeze({
          id: row.id,
          deviceLabel: row.deviceLabel,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
          isCurrent: row.isCurrent,
        }),
      )
      return { ok: true, value: Object.freeze(rows) }
    },
    async listPasskeys() {
      const result = await gateway.listPasskeys()
      if (!result.ok) return result
      const rows = result.value.map((row): PasskeyRow =>
        Object.freeze({
          credentialId: row.credentialId,
          name: row.name,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
        }),
      )
      return { ok: true, value: Object.freeze(rows) }
    },
  }
}
