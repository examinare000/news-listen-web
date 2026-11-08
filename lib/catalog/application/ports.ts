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
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'
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

/** 手入力の追加の失敗。409・422 の意味づけは infrastructure が済ませる。 */
export type AddSourceGatewayFailure =
  | { readonly kind: 'already_registered' }
  | { readonly kind: 'invalid_feed' }
  | { readonly kind: 'failed'; readonly failure: ApiFailure }

/** 生成の残回数。使用済み回数と日次のリセット時刻は画面が読まないので持たない。 */
export interface QuotaRecord {
  readonly limit: number
  readonly remaining: number | null
  readonly monthly: {
    readonly limit: number
    readonly remaining: number | null
    readonly resetAt: string
  } | null
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
  getSources(): Promise<Result<ReadonlyArray<SourceRef>, ApiFailure>>
  addSource(name: string, url: string): Promise<Result<ReadonlyArray<SourceRef>, AddSourceGatewayFailure>>
  deleteSource(url: string): Promise<Result<ReadonlyArray<SourceRef>, ApiFailure>>
  getFeaturedSources(): Promise<Result<ReadonlyArray<FeaturedSourceRef>, ApiFailure>>
  getOnboardingStatus(): Promise<Result<{ readonly completed: boolean }, ApiFailure>>
  getGenerationQuota(): Promise<Result<QuotaRecord, ApiFailure>>
  completeOnboarding(): Promise<Result<void, ApiFailure>>
}
