// port CatalogGateway の実装。取得は lib/api/podcasts.ts の getPodcasts・getPodcast を呼び（GET のみ）、DTO を EpisodeRecord に写す。
import type { CatalogGateway, EpisodeRecord } from '@/lib/catalog/application/ports'
import { sourceCredit } from '@/lib/catalog/domain/episode'
import { decodeEpisode, readSourceOrigin, readStatus } from '@/lib/catalog/infrastructure/episodeMapper'
import type { ApiGateway } from '@/lib/api/gateway'
import { getPodcast, getPodcasts } from '@/lib/api/podcasts'
import type { Podcast } from '@/types'

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
  }
}
