// port CatalogGateway の実装。lib/api の podcasts・feed・articles・settings を呼び、DTO を EpisodeRecord・ArticleRef・SourceRef・FeaturedSourceRef に写す。
import type { AddSourceGatewayFailure, CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
import type { ArticleRef } from '@/lib/catalog/domain/article'
import { normalizeFeaturedCategory } from '@/lib/catalog/domain/featuredCategory'
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'
import { sourceCredit } from '@/lib/catalog/domain/episode'
import { decodeEpisode, readSourceOrigin, readStatus } from '@/lib/catalog/infrastructure/episodeMapper'
import type { ApiGateway } from '@/lib/api/gateway'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import { getPodcast, getPodcasts } from '@/lib/api/podcasts'
import { dismissArticle, getStarredArticles, starArticle, unstarArticle } from '@/lib/api/articles'
import { getFeed } from '@/lib/api/feed'
import {
  addSource,
  completeOnboarding,
  deleteSource,
  getFeaturedSources,
  getOnboardingStatus,
  getSources,
} from '@/lib/api/settings'
import type { Article, FeaturedSource, Podcast, Source } from '@/types'

// 内容 4 つと表示 field は kind に依らず DTO から写す。null・欠落は空配列。
function toRecord(dto: Podcast): EpisodeRecord {
  const origin = readSourceOrigin(dto.source_kind)
  return {
    episode: decodeEpisode(dto),
    generation: readStatus(dto.status),
    isDigest: dto.type === 'digest',
    intro: dto.japanese_intro_text,
    label: { title: dto.title ?? null, intro: dto.japanese_intro_text },
    difficulty: dto.difficulty,
    durationSeconds: dto.duration_seconds,
    createdAt: dto.created_at,
    transcript: (dto.segments ?? []).map((s) => ({ speaker: s.speaker, text: s.text })),
    glossary: (dto.vocabulary ?? []).map((v) => ({ term: v.term, meaningJa: v.meaning_ja, example: v.example })),
    quiz: (dto.quiz ?? []).map((q) => ({ question: q.question, options: q.options })),
    sources: (dto.source_articles ?? []).map((a) =>
      sourceCredit({ articleId: a.article_id, title: a.title, url: a.url, siteName: a.source }, origin),
    ),
  }
}

function toArticleRef(dto: Article): ArticleRef {
  return { id: dto.id, title: dto.title, source: dto.source, url: dto.url, score: dto.score, publishedAt: dto.published_at }
}

function toSourceRef(dto: Source): SourceRef {
  return { name: dto.name, url: dto.url }
}

function toFeaturedSourceRef(dto: FeaturedSource): FeaturedSourceRef {
  return {
    id: dto.id,
    name: dto.name,
    url: dto.url,
    category: normalizeFeaturedCategory(dto.category),
    thumbnailUrl: dto.thumbnail_url ?? null,
    description: dto.description ?? null,
  }
}

// 409 は登録済み、422（reason が 'rule' でない validation）は feed の形式不正。400 を含む他は failure のまま運ぶ。
function toAddSourceFailure(failure: ApiFailure): AddSourceGatewayFailure {
  if (failure.kind === 'conflict') return { kind: 'already_registered' }
  if (failure.kind === 'validation' && failure.reason !== 'rule') return { kind: 'invalid_feed' }
  return { kind: 'failed', failure }
}

export function createCatalogGateway(gateway: ApiGateway): CatalogGateway {
  return {
    async listEpisodes() {
      const result = await getPodcasts(gateway)
      return result.ok ? { ok: true, value: result.value.podcasts.map(toRecord) } : result
    },
    async getEpisode(id) {
      const result = await getPodcast(gateway, id)
      return result.ok ? { ok: true, value: toRecord(result.value) } : result
    },
    async getFeed() {
      const result = await getFeed(gateway)
      if (!result.ok) return result
      const { articles, date } = result.value
      return {
        ok: true,
        value: {
          articles: articles.map(toArticleRef),
          // undefined は未対応 backend の可能性があり、偽と区別できないので真のものだけを運ぶ。
          starredIds: articles.filter((a) => a.is_starred).map((a) => a.id),
          date: date ?? null,
        },
      }
    },
    async getStarredArticles() {
      const result = await getStarredArticles(gateway)
      if (!result.ok) return result
      // 移行期・プロキシ経由で 200 かつ想定外の body（例: catch-all が返す {}）でも画面を壊さない。
      const { articles } = result.value
      return { ok: true, value: Array.isArray(articles) ? articles.map(toArticleRef) : [] }
    },
    async starArticle(id, difficulty) {
      const result = await (difficulty ? starArticle(gateway, id, difficulty) : starArticle(gateway, id))
      if (!result.ok) return result
      const { remaining } = result.value
      return { ok: true, value: { remaining: typeof remaining === 'number' ? remaining : null } }
    },
    async dismissArticle(id) {
      const result = await dismissArticle(gateway, id)
      return result.ok ? { ok: true, value: undefined } : result
    },
    async unstarArticle(id) {
      const result = await unstarArticle(gateway, id)
      return result.ok ? { ok: true, value: undefined } : result
    },
    async getSources() {
      const result = await getSources(gateway)
      return result.ok ? { ok: true, value: result.value.sources.map(toSourceRef) } : result
    },
    async addSource(name, url) {
      const result = await addSource(gateway, name, url)
      return result.ok
        ? { ok: true, value: result.value.sources.map(toSourceRef) }
        : { ok: false, failure: toAddSourceFailure(result.failure) }
    },
    async deleteSource(url) {
      const result = await deleteSource(gateway, url)
      return result.ok ? { ok: true, value: result.value.sources.map(toSourceRef) } : result
    },
    async getFeaturedSources() {
      const result = await getFeaturedSources(gateway)
      return result.ok ? { ok: true, value: result.value.sites.map(toFeaturedSourceRef) } : result
    },
    async getOnboardingStatus() {
      const result = await getOnboardingStatus(gateway)
      return result.ok ? { ok: true, value: { completed: result.value.onboarding_completed } } : result
    },
    async completeOnboarding() {
      const result = await completeOnboarding(gateway)
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}
