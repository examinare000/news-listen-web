// Catalog application の port。実装は infrastructure（catalogGateway）が持つ（HTTP・DTO はここに現れない）。
// 型だけの module。
import type { ArticleRef } from '@/lib/catalog/domain/article'
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
  /** `starredIds` は応答の各記事のうち Star 済みと示されたものの id。 */
  getFeed(): Promise<
    Result<
      { readonly articles: ReadonlyArray<ArticleRef>; readonly starredIds: ReadonlyArray<string>; readonly date: string | null },
      ApiFailure
    >
  >
  getStarredArticles(): Promise<Result<ReadonlyArray<ArticleRef>, ApiFailure>>
  /** `difficulty` が無ければ指定なしで送る（backend の既定の難易度）。`remaining` は数値のときだけ。 */
  starArticle(id: string, difficulty?: DifficultyLevel): Promise<Result<{ readonly remaining: number | null }, ApiFailure>>
  dismissArticle(id: string): Promise<Result<void, ApiFailure>>
  unstarArticle(id: string): Promise<Result<void, ApiFailure>>
}
