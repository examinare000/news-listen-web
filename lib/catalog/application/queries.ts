// Catalog の query（読み取りだけ）: web-query-catalog-01〜08（購読一覧・おすすめ・onboarding の状態を含む）。失敗は Result で返し、toast は page が出す。
import type { CatalogGateway } from '@/lib/catalog/application/ports'
import {
  toEpisodeCardView,
  toEpisodeDetailView,
  toFeaturedSourceView,
  toFeedFailed,
  toFeedLoaded,
  toOnboardingView,
  toQuotaView,
  toSourceView,
  toStarredOk,
  type EpisodeCardView,
  type EpisodeDetailView,
  type FeaturedSourceView,
  type FeedOutcome,
  type FeedView,
  type OnboardingView,
  type QuotaView,
  type SourceView,
  type StarredOutcome,
  type StarredStale,
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
  getFeed(): Promise<FeedView>
  listSources(): Promise<Result<ReadonlyArray<SourceView>, ApiFailure>>
  getFeaturedSources(): Promise<Result<ReadonlyArray<FeaturedSourceView>, ApiFailure>>
  getOnboardingStatus(): Promise<Result<OnboardingView, ApiFailure>>
  getGenerationQuota(): Promise<Result<QuotaView, ApiFailure>>
}

function toStale(outcome: StarredOutcome): StarredStale {
  return Object.freeze('cause' in outcome ? { stale: true as const, cause: outcome.cause } : { stale: true as const })
}

export function createCatalogQueries({ gateway }: { readonly gateway: CatalogGateway }): CatalogQueries {
  // 手動更新の連打などで取得が重なったとき、最新の取得だけを反映するための連番。
  let latestRequest = 0

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
    async listSources() {
      const result = await gateway.getSources()
      return result.ok ? { ok: true, value: Object.freeze(result.value.map(toSourceView)) } : result
    },
    async getFeaturedSources() {
      const result = await gateway.getFeaturedSources()
      return result.ok ? { ok: true, value: Object.freeze(result.value.map(toFeaturedSourceView)) } : result
    },
    async getOnboardingStatus() {
      const result = await gateway.getOnboardingStatus()
      return result.ok ? { ok: true, value: toOnboardingView(result.value) } : result
    },
    async getGenerationQuota() {
      const result = await gateway.getGenerationQuota()
      return result.ok ? { ok: true, value: toQuotaView(result.value) } : result
    },
    getFeed() {
      const requestId = ++latestRequest
      const isLatest = () => requestId === latestRequest
      // 両方を先に開始し、catch は同期的に付ける（片方の待機中の reject を unhandled にしない）。
      // starred の失敗でフィード全体を壊さない。
      const starredSettled: Promise<StarredOutcome> = gateway.getStarredArticles().then(
        (result): StarredOutcome => (result.ok ? toStarredOk(result.value) : Object.freeze({ cause: result.failure })),
        (cause: unknown): StarredOutcome => Object.freeze({ cause }),
      )
      const feedSettled: Promise<FeedOutcome> = gateway.getFeed().then(
        (result): FeedOutcome => (result.ok ? toFeedLoaded(result.value) : toFeedFailed(result.failure)),
        (): FeedOutcome => Object.freeze({ unexpected: true as const }),
      )
      // starred の反映の可否は、フィードと starred の両方が決着した時点で決める。
      const starred = Promise.all([feedSettled, starredSettled]).then(([, outcome]) => (isLatest() ? outcome : toStale(outcome)))
      return feedSettled.then((feed): FeedView =>
        isLatest()
          ? Object.freeze({ feed, starred })
          : Object.freeze({ stale: true as const, starred: starred.then((outcome) => ('stale' in outcome ? outcome : toStale(outcome))) }),
      )
    },
  }
}
