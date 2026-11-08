// Catalog のリードモデル（web-model-catalog）: EpisodeRecord から、一覧のカードと詳細の view を作る。
// 呼ぶたびに新しく作った値で、record とその入れ子と参照を共有せず、全深さで凍結する。
import type { EpisodeRecord, QuotaRecord } from '@/lib/catalog/application/ports'
import type { ArticleRef } from '@/lib/catalog/domain/article'
import type {
  Episode,
  EpisodeLabel,
  FailureReason,
  GlossaryEntry,
  // DTO に同名の型があり、web-dep-04 の検出器は名前で判定するので別名で読む。
  QuizQuestion as EpisodeQuizQuestion,
  SourceCredit,
  TranscriptLine,
} from '@/lib/catalog/domain/episode'
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'
import type { GenerationSnapshot } from '@/lib/catalog/domain/generationWatch'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'

export interface EpisodeCardView {
  readonly id: string
  readonly kind: Episode['kind']
  readonly generation: GenerationSnapshot['generation']
  readonly title: string
  readonly label: EpisodeLabel
  readonly isDigest: boolean
  readonly intro: string
  readonly difficulty: DifficultyLevel
  readonly durationSeconds: number
  readonly createdAt: string
  readonly failureReason: FailureReason | null
}

export interface EpisodeDetailView extends EpisodeCardView {
  readonly transcript: ReadonlyArray<TranscriptLine>
  readonly glossary: ReadonlyArray<GlossaryEntry>
  readonly quiz: ReadonlyArray<EpisodeQuizQuestion>
  readonly sources: ReadonlyArray<SourceCredit>
  readonly showsShareAlikeNotice: boolean
}

/** Feed の記事カード。Star・busy は UI の状態なので持たない。 */
export interface ArticleCardView {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly url: string
  readonly score: number
  readonly publishedAt: string
}

export interface FeedLoaded {
  readonly articles: ReadonlyArray<ArticleCardView>
  readonly starredIds: ReadonlyArray<string>
  readonly date: string | null
}

export interface FeedFailed {
  readonly failure: ApiFailure
}

/** フィードの結果。gateway の reject は unexpected（予期しない失敗）。 */
export interface FeedUnexpected {
  readonly unexpected: true
}

export type FeedOutcome = FeedLoaded | FeedFailed | FeedUnexpected

export type StarredOutcome = { readonly articles: ReadonlyArray<ArticleCardView> } | { readonly cause: unknown }

export type StarredStale = { readonly stale: true } | { readonly stale: true; readonly cause: unknown }

/** 1 段目はフィードの決着で返し、starred は後から解決する。最新の取得でなければ stale。 */
export type FeedView =
  | { readonly stale: true; readonly starred: Promise<StarredStale> }
  | { readonly feed: FeedOutcome; readonly starred: Promise<StarredOutcome | StarredStale> }

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneDeep(v)) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, cloneDeep(v)])) as T
  }
  return value
}

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) freezeDeep(v)
    Object.freeze(value)
  }
  return value
}

const seal = <T>(value: T): T => freezeDeep(cloneDeep(value))

function cardFields(record: EpisodeRecord): EpisodeCardView {
  const { episode } = record
  return {
    id: episode.id,
    kind: episode.kind,
    generation: record.generation,
    title: episode.title,
    label: record.label,
    isDigest: record.isDigest,
    intro: record.intro,
    difficulty: record.difficulty,
    durationSeconds: record.durationSeconds,
    createdAt: record.createdAt,
    failureReason: episode.kind === 'failed' ? episode.reason : null,
  }
}

export function toEpisodeCardView(record: EpisodeRecord): EpisodeCardView {
  return seal(cardFields(record))
}

export function toEpisodeDetailView(record: EpisodeRecord): EpisodeDetailView {
  return seal({
    ...cardFields(record),
    transcript: record.transcript,
    glossary: record.glossary,
    quiz: record.quiz,
    sources: record.sources,
    showsShareAlikeNotice: record.sources.some((s) => s.showsShareAlikeNotice),
  })
}

export function toArticleCardView(ref: ArticleRef): ArticleCardView {
  return seal({
    id: ref.id,
    title: ref.title,
    source: ref.source,
    url: ref.url,
    score: ref.score,
    publishedAt: ref.publishedAt,
  })
}

export function toFeedLoaded(value: {
  readonly articles: ReadonlyArray<ArticleRef>
  readonly starredIds: ReadonlyArray<string>
  readonly date: string | null
}): FeedLoaded {
  return seal({ articles: value.articles.map(toArticleCardView), starredIds: [...value.starredIds], date: value.date })
}

/** failure は値ではなく原因の識別なので、複製せず同じ参照を返す。 */
export function toFeedFailed(failure: ApiFailure): FeedFailed {
  return Object.freeze({ failure })
}

export function toStarredOk(articles: ReadonlyArray<ArticleRef>): { readonly articles: ReadonlyArray<ArticleCardView> } {
  return seal({ articles: articles.map(toArticleCardView) })
}

/** 購読の view。`SourceRef` と同形。 */
export interface SourceView {
  readonly name: string
  readonly url: string
}

export interface FeaturedSourceView {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly category: FeaturedSourceRef['category']
  readonly thumbnailUrl: string | null
  readonly description: string | null
}

export interface OnboardingView {
  readonly completed: boolean
}

export function toSourceView(ref: SourceRef): SourceView {
  return seal({ name: ref.name, url: ref.url })
}

export function toFeaturedSourceView(ref: FeaturedSourceRef): FeaturedSourceView {
  return seal({
    id: ref.id,
    name: ref.name,
    url: ref.url,
    category: ref.category,
    thumbnailUrl: ref.thumbnailUrl,
    description: ref.description,
  })
}

export function toOnboardingView(status: { readonly completed: boolean }): OnboardingView {
  return seal({ completed: status.completed })
}

export interface QuotaView {
  readonly limit: number
  readonly remaining: number | null
  readonly monthly: {
    readonly limit: number
    readonly remaining: number | null
    readonly resetAt: string
  } | null
}

export function toQuotaView(record: QuotaRecord): QuotaView {
  return seal({ limit: record.limit, remaining: record.remaining, monthly: record.monthly })
}
