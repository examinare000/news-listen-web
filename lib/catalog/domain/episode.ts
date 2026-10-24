// Catalog domain の Episode: 判別（web-rule-catalog-01）・題の規則（web-rule-catalog-02）・出典の可否（web-rule-catalog-10）・失敗の値域（web-rule-catalog-11）。
// DTO（`@/types`）も Playback も import しない（web-dep-01・web-dep-12）。DTO からの読み取りは infrastructure の episodeMapper が行う。
import type { DifficultyLevel } from '@/lib/shared/difficulty'

/** オフライン再生用に発行された音源の解放口。中身（blob URL 等）は露出しない。 */
export interface AudioHandle {
  release(): void
}

export interface TranscriptLine {
  readonly speaker: string
  readonly text: string
}

export interface GlossaryEntry {
  readonly term: string
  readonly meaningJa: string
  readonly example: string
}

export interface QuizQuestion {
  readonly question: string
  readonly options: ReadonlyArray<string>
}

/** 出典の由来。CC BY-SA の表示可否の判定にだけ使う。 */
export type SourceOrigin = 'operator' | 'user' | 'unknown'

export interface SourceCreditInput {
  readonly articleId: string
  readonly title: string
  readonly url: string
  readonly siteName: string
}

export interface SourceCredit extends SourceCreditInput {
  readonly showsShareAlikeNotice: boolean
}

export type FailureReason = 'generation_failed' | 'quota_exhausted'

export interface PlayableEpisode {
  readonly kind: 'playable'
  readonly id: string
  readonly title: string
  /** 題の原文。表示の切り詰め長は利用側が displayTitle で決める。 */
  readonly label: EpisodeLabel
  readonly audioUrl: string
  readonly durationSeconds: number
  readonly difficulty: DifficultyLevel
  readonly createdAt: string
  readonly serverPositionSeconds: number
  readonly transcript?: ReadonlyArray<TranscriptLine>
  readonly vocabulary?: ReadonlyArray<GlossaryEntry>
  readonly quiz?: ReadonlyArray<QuizQuestion>
  readonly sources?: ReadonlyArray<SourceCredit>
  /** handle を持つとき audioUrl はその handle だけが包む URL であること（呼出側の責務）。 */
  readonly audioHandle?: AudioHandle
}

export interface GeneratingEpisode {
  readonly kind: 'generating'
  readonly id: string
  readonly title: string
  readonly difficulty: DifficultyLevel
  readonly createdAt: string
}

export interface FailedEpisode {
  readonly kind: 'failed'
  readonly id: string
  readonly title: string
  readonly reason: FailureReason
}

export type Episode = PlayableEpisode | GeneratingEpisode | FailedEpisode

export interface EpisodeLabel {
  readonly title: string | null
  readonly intro: string
}

/** Queue の要素（web-deriv-17）。 */
export interface QueuedEpisode {
  readonly id: string
  readonly label: EpisodeLabel
}

export interface QueuedEpisodeInput {
  readonly id: string
  readonly title: string | null
  readonly intro: string
}

/** DTO の読み取り結果を domain の語で書いたもの。`partial_failed` は mapper が `failed` に写してから渡す。 */
export interface EpisodeReadout {
  readonly id: string
  readonly title: string | null
  readonly intro: string
  readonly status: 'completed' | 'processing' | 'failed'
  readonly audioUrl: string
  readonly failure: FailureReason | null
  readonly difficulty: DifficultyLevel
  readonly createdAt: string
  readonly durationSeconds: number
  readonly serverPositionSeconds: number
  readonly transcript: ReadonlyArray<TranscriptLine>
  readonly vocabulary: ReadonlyArray<GlossaryEntry>
  readonly quiz: ReadonlyArray<QuizQuestion>
  readonly sources: ReadonlyArray<SourceCreditInput>
  readonly sourceOrigin: SourceOrigin
}

export type PlayableEpisodeInput = Omit<PlayableEpisode, 'kind'>
export type GeneratingEpisodeInput = Omit<GeneratingEpisode, 'kind'>
export type FailedEpisodeInput = Omit<FailedEpisode, 'kind'>

// ---------------------------------------------------------------------------
// 複製と凍結（値の生成。呼出側の値を共有せず、返した値を書き換えさせない）
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** plain object と配列だけを全深さで複製する。release 口の audioHandle は同一参照のまま。 */
function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneDeep(v)) as T
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) copy[key] = key === 'audioHandle' ? v : cloneDeep(v)
    return copy as T
  }
  return value
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    for (const v of value as unknown[]) freezeDeep(v)
  } else if (isPlainObject(value)) {
    for (const [key, v] of Object.entries(value)) if (key !== 'audioHandle') freezeDeep(v)
  } else {
    return value
  }
  return Object.freeze(value)
}

const seal = <T>(value: T): T => freezeDeep(cloneDeep(value))

export function sourceCredit(input: SourceCreditInput, origin: SourceOrigin): SourceCredit {
  return seal({
    articleId: input.articleId,
    title: input.title,
    url: input.url,
    siteName: input.siteName,
    showsShareAlikeNotice: origin === 'operator',
  })
}

/** audioUrl が空の Playable は作れない（不変条件の違反は呼出側のバグ）。 */
export function playableEpisode(input: PlayableEpisodeInput): PlayableEpisode {
  if (input.audioUrl === '') {
    throw new Error('PlayableEpisode の不変条件違反: audioUrl が空')
  }
  return seal({ ...input, kind: 'playable' as const })
}

export function generatingEpisode(input: GeneratingEpisodeInput): GeneratingEpisode {
  return seal({ ...input, kind: 'generating' as const })
}

export function failedEpisode(input: FailedEpisodeInput): FailedEpisode {
  return seal({ ...input, kind: 'failed' as const })
}

export function queuedEpisode(input: QueuedEpisodeInput): QueuedEpisode {
  return seal({ id: input.id, label: { title: input.title, intro: input.intro } })
}

// ---------------------------------------------------------------------------
// 題の規則
// ---------------------------------------------------------------------------

/** title を trim して空でなければそれ（切り詰めない）。そうでなければ intro の先頭 maxLen 字。 */
export function displayTitle(label: EpisodeLabel, maxLen: number): string {
  const title = label.title?.trim() ?? ''
  return title !== '' ? title : label.intro.slice(0, Math.max(0, maxLen))
}

// ---------------------------------------------------------------------------
// 判別
// ---------------------------------------------------------------------------

/**
 * 再生できるのは completed ∧ audioUrl≠'' ∧ failure=null のときだけ。completed の矛盾（audioUrl が空、または failure あり）は
 * Playable にせず Failed に倒す（shared-session-08）。reason は failure があればその値、なければ generation_failed。
 */
export function classifyEpisode(input: EpisodeReadout): Episode {
  const title = displayTitle({ title: input.title, intro: input.intro }, Number.POSITIVE_INFINITY)
  const reason: FailureReason = input.failure ?? 'generation_failed'
  switch (input.status) {
    case 'processing':
      return generatingEpisode({ id: input.id, title, difficulty: input.difficulty, createdAt: input.createdAt })
    case 'failed':
      return failedEpisode({ id: input.id, title, reason })
    case 'completed': {
      if (input.audioUrl === '' || input.failure !== null) return failedEpisode({ id: input.id, title, reason })
      return playableEpisode({
        id: input.id,
        title,
        label: { title: input.title, intro: input.intro },
        audioUrl: input.audioUrl,
        durationSeconds: input.durationSeconds,
        difficulty: input.difficulty,
        createdAt: input.createdAt,
        serverPositionSeconds: input.serverPositionSeconds,
        transcript: input.transcript,
        vocabulary: input.vocabulary,
        quiz: input.quiz,
        sources: input.sources.map((source) => sourceCredit(source, input.sourceOrigin)),
      })
    }
  }
}
