// Catalog application の port。実装は infrastructure（catalogGateway）が持つ（HTTP・DTO はここに現れない）。
// 型だけの module。
import type {
  Episode,
  EpisodeLabel,
  GlossaryEntry,
  // DTO に同名の型があり、web-dep-04 の検出器は名前で判定するので別名で読む。
  QuizQuestion as EpisodeQuizQuestion,
  SourceCredit,
  TranscriptLine,
} from '@/lib/catalog/domain/episode'
import type { GenerationSnapshot } from '@/lib/catalog/domain/generationWatch'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** `Episode` は kind によっては表示 field を持たないので、一覧・詳細を描くのに要る値を kind に依らず併せて持つ。 */
export interface EpisodeRecord {
  readonly episode: Episode
  readonly generation: GenerationSnapshot['generation']
  readonly isDigest: boolean
  readonly intro: string
  readonly label: EpisodeLabel
  readonly difficulty: DifficultyLevel
  readonly durationSeconds: number
  readonly createdAt: string
  readonly transcript: ReadonlyArray<TranscriptLine>
  readonly glossary: ReadonlyArray<GlossaryEntry>
  readonly quiz: ReadonlyArray<EpisodeQuizQuestion>
  readonly sources: ReadonlyArray<SourceCredit>
}

export interface CatalogGateway {
  listEpisodes(): Promise<Result<ReadonlyArray<EpisodeRecord>, ApiFailure>>
  getEpisode(id: string): Promise<Result<EpisodeRecord, ApiFailure>>
}
