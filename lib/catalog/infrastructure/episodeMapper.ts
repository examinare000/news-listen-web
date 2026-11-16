// DTO `Podcast` → domain `Episode`。欠落の補完・名前の改名・値域の正規化をここで終え、判別（web-rule-catalog-01）は domain に渡す。
import {
  classifyEpisode,
  type Episode,
  type EpisodeReadout,
  type FailureReason,
  type SourceOrigin,
} from '@/lib/catalog/domain/episode'
import { parseRecordedAt } from '@/lib/shared/recordedAt'
import type { Podcast } from '@/types'

/** shared-session-09・web-deriv-31: `partial_failed` は再生不可で、domain の値域の外なので `failed` に写す。 */
export function readStatus(status: Podcast['status']): EpisodeReadout['status'] {
  return status === 'partial_failed' ? 'failed' : status
}

/** web-rule-catalog-11: null だけが失敗なし。識別子以外（自由文・空文字・`partial_failed`）は `generation_failed`。 */
function readFailure(errorMessage: Podcast['error_message']): FailureReason | null {
  if (errorMessage === null) return null
  return errorMessage === 'quota_exhausted' ? 'quota_exhausted' : 'generation_failed'
}

/** 表示可否の判定は domain の `sourceCredit` が持つ。ここは語を写すだけ（ADR-095: 不明は unknown）。 */
export function readSourceOrigin(sourceKind: Podcast['source_kind']): SourceOrigin {
  if (sourceKind === 'featured') return 'operator'
  return sourceKind === 'user' ? 'user' : 'unknown'
}

function readRecordedAt(value: Podcast['playback_position_recorded_at']): number | null {
  return typeof value === 'string' ? parseRecordedAt(value) : null
}

export function decodeEpisode(dto: Podcast): Episode {
  const recordedAt = readRecordedAt(dto.playback_position_recorded_at)
  return classifyEpisode({
    id: dto.id,
    title: dto.title ?? null,
    intro: dto.japanese_intro_text,
    status: readStatus(dto.status),
    audioUrl: dto.audio_url,
    failure: readFailure(dto.error_message),
    difficulty: dto.difficulty,
    createdAt: dto.created_at,
    durationSeconds: dto.duration_seconds,
    serverPositionSeconds: dto.playback_position_seconds,
    ...(recordedAt === null ? {} : { serverPositionRecordedAt: recordedAt }),
    transcript: (dto.segments ?? []).map((s) => ({ speaker: s.speaker, text: s.text })),
    vocabulary: (dto.vocabulary ?? []).map((v) => ({ term: v.term, meaningJa: v.meaning_ja, example: v.example })),
    quiz: (dto.quiz ?? []).map((q) => ({ question: q.question, options: q.options })),
    sources: (dto.source_articles ?? []).map((a) => ({
      articleId: a.article_id,
      title: a.title,
      url: a.url,
      siteName: a.source,
    })),
    sourceOrigin: readSourceOrigin(dto.source_kind),
  })
}
