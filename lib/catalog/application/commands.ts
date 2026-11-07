// Catalog の command（web-cmd-catalog-01〜04・web-rule-catalog-05）: Feed の Star・一括 Star・Dismiss・Unstar。
// 失敗は Result で返す。gateway の reject は握りつぶさず伝える（page が「予期しないエラー」にする）。
// 例外は bulkStar の rejected だけで、failed に数える。
import type { CatalogGateway } from '@/lib/catalog/application/ports'
import { classifyGenerationLimit, type GenerationLimit } from '@/lib/catalog/domain/generationLimit'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

export type StarFailure =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'generation_limit'; readonly limit: GenerationLimit }
  | { readonly kind: 'failed'; readonly failure: ApiFailure }

export interface BulkStarReceipt {
  readonly starred: ReadonlyArray<string>
  readonly failed: ReadonlyArray<string>
  readonly limit: GenerationLimit | null
}

export type UnstarIgnored = { readonly kind: 'ignored' }

/**
 * 進行中の同じ id への unstar は、gateway を呼ばずにこの共有の Promise を返す。
 * page は戻り値がこれと同じ参照かを、state を更新する前に同期的に比べて「何もしない」を選ぶ
 * （async 関数だと毎回別の Promise になり、比べられない）。
 */
export const UNSTAR_IGNORED: Promise<UnstarIgnored> = Promise.resolve(Object.freeze({ kind: 'ignored' as const }))

export interface CatalogCommands {
  starArticle(id: string, difficulty?: DifficultyLevel): Promise<Result<{ readonly remaining: number | null }, StarFailure>>
  bulkStar(ids: ReadonlyArray<string>): Promise<BulkStarReceipt>
  dismissArticle(id: string): Promise<Result<void, ApiFailure>>
  unstarArticle(id: string): Promise<Result<void, ApiFailure> | UnstarIgnored>
}

function toLimit(failure: Extract<ApiFailure, { kind: 'rate_limited' }>): GenerationLimit {
  return classifyGenerationLimit(failure.detail, failure.retryAfterSeconds)
}

function toStarFailure(failure: ApiFailure): StarFailure {
  switch (failure.kind) {
    case 'not_found':
      return Object.freeze({ kind: 'not_found' })
    case 'unauthorized':
      return Object.freeze({ kind: 'unauthorized' })
    case 'rate_limited':
      return Object.freeze({ kind: 'generation_limit', limit: toLimit(failure) })
    default:
      return Object.freeze({ kind: 'failed', failure })
  }
}

export function createCatalogCommands({ gateway }: { readonly gateway: CatalogGateway }): CatalogCommands {
  // 進行中の unstar の id。判定と登録は最初の await より前に同期的に行う。
  const unstarInFlight = new Set<string>()

  async function runUnstar(id: string): Promise<Result<void, ApiFailure>> {
    try {
      return await gateway.unstarArticle(id)
    } finally {
      unstarInFlight.delete(id)
    }
  }

  return {
    async starArticle(id, difficulty) {
      // difficulty が無いときは引数を渡さない（backend の既定の難易度を使う）。
      const result = difficulty ? await gateway.starArticle(id, difficulty) : await gateway.starArticle(id)
      if (!result.ok) return Object.freeze({ ok: false, failure: toStarFailure(result.failure) })
      const { remaining } = result.value
      return Object.freeze({ ok: true, value: Object.freeze({ remaining: typeof remaining === 'number' ? remaining : null }) })
    },
    async bulkStar(ids) {
      if (ids.length === 0) return Object.freeze({ starred: Object.freeze([]), failed: Object.freeze([]), limit: null })
      const settled = await Promise.allSettled(ids.map((id) => gateway.starArticle(id)))
      const starred: string[] = []
      const failed: string[] = []
      let limit: GenerationLimit | null = null
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled' && outcome.value.ok) {
          starred.push(ids[index])
          return
        }
        failed.push(ids[index])
        if (limit === null && outcome.status === 'fulfilled' && !outcome.value.ok && outcome.value.failure.kind === 'rate_limited') {
          limit = toLimit(outcome.value.failure)
        }
      })
      return Object.freeze({ starred: Object.freeze(starred), failed: Object.freeze(failed), limit })
    },
    dismissArticle(id) {
      return gateway.dismissArticle(id)
    },
    unstarArticle(id) {
      if (unstarInFlight.has(id)) return UNSTAR_IGNORED
      unstarInFlight.add(id)
      return runUnstar(id)
    },
  }
}
