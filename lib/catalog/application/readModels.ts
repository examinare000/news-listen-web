// Catalog のリードモデル（web-model-catalog）: EpisodeRecord から、一覧のカードと詳細の view を作る。
// 呼ぶたびに新しく作った値で、record とその入れ子と参照を共有せず、全深さで凍結する。
import type { EpisodeRecord } from '@/lib/catalog/application/ports'
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
import type { GenerationSnapshot } from '@/lib/catalog/domain/generationWatch'
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
