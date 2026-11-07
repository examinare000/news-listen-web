// Catalog の query（読み取りだけ）: web-query-catalog-02〜04。失敗は Result で返し、toast は page が出す。
import type { CatalogGateway } from '@/lib/catalog/application/ports'
import {
  toEpisodeCardView,
  toEpisodeDetailView,
  type EpisodeCardView,
  type EpisodeDetailView,
} from '@/lib/catalog/application/readModels'
import { detectCompleted, type GenerationSnapshot } from '@/lib/catalog/domain/generationWatch'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface GenerationWatchResult {
  readonly completedIds: ReadonlyArray<string>
}

export interface CatalogQueries {
  listEpisodes(): Promise<Result<ReadonlyArray<EpisodeCardView>, ApiFailure>>
  getEpisodeDetail(id: string): Promise<Result<EpisodeDetailView, ApiFailure>>
  watchGeneration(
    previous: ReadonlyArray<GenerationSnapshot>,
    next: ReadonlyArray<GenerationSnapshot>,
  ): GenerationWatchResult
}

export function createCatalogQueries({ gateway }: { readonly gateway: CatalogGateway }): CatalogQueries {
  return {
    async listEpisodes() {
      const result = await gateway.listEpisodes()
      if (!result.ok) return result
      return { ok: true, value: Object.freeze(result.value.map(toEpisodeCardView)) }
    },
    async getEpisodeDetail(id) {
      const result = await gateway.getEpisode(id)
      return result.ok ? { ok: true, value: toEpisodeDetailView(result.value) } : result
    },
    watchGeneration(previous, next) {
      return Object.freeze({ completedIds: detectCompleted(previous, next) })
    },
  }
}
