// Catalog domain の Episode: 判別・生成関数・題の規則・出典の可否。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §5.0〜§5.2（web-rule-catalog-01・web-rule-catalog-02・web-rule-catalog-10）、
// 共有仕様 §4.4（shared-session-08）。
//
// RED 理由（実装前）: `@/lib/catalog/domain/episode` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import {
  classifyEpisode,
  displayTitle,
  failedEpisode,
  generatingEpisode,
  playableEpisode,
  queuedEpisode,
  sourceCredit,
} from '@/lib/catalog/domain/episode'
import type {
  EpisodeLabel,
  EpisodeReadout,
  FailureReason,
  SourceCreditInput,
  SourceOrigin,
} from '@/lib/catalog/domain/episode'

const SOURCE_A: SourceCreditInput = { articleId: 'art-1', title: 'Title A', url: 'https://example.com/a', siteName: 'Site A' }
const SOURCE_B: SourceCreditInput = { articleId: 'art-2', title: 'Title B', url: 'https://example.com/b', siteName: 'Site B' }

function readout(over: Partial<EpisodeReadout> = {}): EpisodeReadout {
  return {
    id: 'p1',
    title: 'T',
    intro: 'イントロの全文です',
    status: 'completed',
    audioUrl: 'https://example.com/p1.mp3',
    failure: null,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    durationSeconds: 600,
    serverPositionSeconds: 42,
    transcript: [{ speaker: 'A', text: 'hello' }],
    vocabulary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    sources: [SOURCE_A, SOURCE_B],
    sourceOrigin: 'operator',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// classifyEpisode: 判別 12 行（web-rule-catalog-01）
// ---------------------------------------------------------------------------
type Expected = { kind: 'playable' } | { kind: 'generating' } | { kind: 'failed'; reason: FailureReason }

interface ClassifyRow {
  readonly status: EpisodeReadout['status']
  readonly audioUrl: string
  readonly failure: FailureReason | null
  readonly expected: Expected
  readonly note: string
}

const AUDIO = 'https://example.com/p1.mp3'

const CLASSIFY_ROWS: readonly ClassifyRow[] = [
  { status: 'completed', audioUrl: AUDIO, failure: null, expected: { kind: 'playable' }, note: '' },
  { status: 'completed', audioUrl: AUDIO, failure: 'quota_exhausted', expected: { kind: 'failed', reason: 'quota_exhausted' }, note: ' shared-session-08' },
  { status: 'completed', audioUrl: '', failure: null, expected: { kind: 'failed', reason: 'generation_failed' }, note: '' },
  { status: 'completed', audioUrl: '', failure: 'quota_exhausted', expected: { kind: 'failed', reason: 'quota_exhausted' }, note: ' shared-session-08' },
  { status: 'processing', audioUrl: AUDIO, failure: null, expected: { kind: 'generating' }, note: '' },
  { status: 'processing', audioUrl: AUDIO, failure: 'quota_exhausted', expected: { kind: 'generating' }, note: '' },
  { status: 'processing', audioUrl: '', failure: null, expected: { kind: 'generating' }, note: '' },
  { status: 'processing', audioUrl: '', failure: 'quota_exhausted', expected: { kind: 'generating' }, note: '' },
  { status: 'failed', audioUrl: AUDIO, failure: null, expected: { kind: 'failed', reason: 'generation_failed' }, note: '' },
  { status: 'failed', audioUrl: '', failure: null, expected: { kind: 'failed', reason: 'generation_failed' }, note: '' },
  { status: 'failed', audioUrl: AUDIO, failure: 'quota_exhausted', expected: { kind: 'failed', reason: 'quota_exhausted' }, note: '' },
  { status: 'failed', audioUrl: '', failure: 'quota_exhausted', expected: { kind: 'failed', reason: 'quota_exhausted' }, note: '' },
]

describe('web-rule-catalog-01 classifyEpisode: status × audioUrl × failure の判別', () => {
  test.each(CLASSIFY_ROWS)(
    'web-rule-catalog-01$note: status=$status audioUrl=$audioUrl failure=$failure → $expected',
    ({ status, audioUrl, failure, expected }) => {
      const episode = classifyEpisode(readout({ status, audioUrl, failure }))
      expect(episode.kind).toBe(expected.kind)
      if (expected.kind === 'failed') {
        expect(episode.kind === 'failed' ? episode.reason : undefined).toBe(expected.reason)
      }
    },
  )

  test('web-rule-catalog-01: Playable になるのは completed ∧ audioUrl≠"" ∧ failure=null の 1 行だけ', () => {
    const playableRows = CLASSIFY_ROWS.filter((row) => classifyEpisode(readout(row)).kind === 'playable')
    expect(playableRows).toHaveLength(1)
    expect(playableRows[0]).toMatchObject({ status: 'completed', audioUrl: AUDIO, failure: null })
  })
})

// ---------------------------------------------------------------------------
// title の補完（variant 共通）
// ---------------------------------------------------------------------------
describe('web-rule-catalog-02 classifyEpisode: どの variant でも title は displayTitle(label, +∞) と等しい', () => {
  const LONG_INTRO = 'あ'.repeat(60)
  const statuses: ReadonlyArray<EpisodeReadout['status']> = ['completed', 'processing', 'failed']

  test.each(statuses)('status=%s: 前後に空白のある title は trim した値、null・空・空白だけは intro の全文（切り詰めない）', (status) => {
    expect(classifyEpisode(readout({ status, title: ' T ', intro: LONG_INTRO })).title).toBe('T')
    for (const title of [null, '', '   ']) {
      expect(classifyEpisode(readout({ status, title, intro: LONG_INTRO })).title).toBe(LONG_INTRO)
    }
  })
})

// ---------------------------------------------------------------------------
// field の集合
// ---------------------------------------------------------------------------
describe('web-rule-catalog-01 classifyEpisode: variant ごとの field の集合に過不足が無い', () => {
  const full = readout()

  test('Playable は内容をすべて持ち、値は入力から写される（audioHandle の key は無い）', () => {
    const episode = classifyEpisode(full)
    expect(Object.keys(episode).sort()).toEqual(
      [
        'kind',
        'id',
        'title',
        'label',
        'audioUrl',
        'durationSeconds',
        'difficulty',
        'createdAt',
        'serverPositionSeconds',
        'transcript',
        'vocabulary',
        'quiz',
        'sources',
      ].sort(),
    )
    expect(episode).toMatchObject({
      kind: 'playable',
      id: full.id,
      label: { title: full.title, intro: full.intro },
      audioUrl: full.audioUrl,
      durationSeconds: full.durationSeconds,
      difficulty: full.difficulty,
      createdAt: full.createdAt,
      serverPositionSeconds: full.serverPositionSeconds,
      transcript: full.transcript,
      vocabulary: full.vocabulary,
      quiz: full.quiz,
    })
  })

  test('Generating は kind・id・title・difficulty・createdAt だけを持つ', () => {
    const episode = classifyEpisode(readout({ status: 'processing' }))
    expect(Object.keys(episode).sort()).toEqual(['createdAt', 'difficulty', 'id', 'kind', 'title'])
    expect(episode).toEqual({ kind: 'generating', id: 'p1', title: 'T', difficulty: 'toeic_600', createdAt: '2026-05-31T06:00:00Z' })
  })

  test('Failed は kind・id・title・reason だけを持つ', () => {
    const episode = classifyEpisode(readout({ status: 'failed', failure: 'quota_exhausted' }))
    expect(Object.keys(episode).sort()).toEqual(['id', 'kind', 'reason', 'title'])
    expect(episode).toEqual({ kind: 'failed', id: 'p1', title: 'T', reason: 'quota_exhausted' })
  })
})

describe('web-rule-catalog-10 classifyEpisode: Playable の sources は sourceCredit を通る', () => {
  const origins: readonly SourceOrigin[] = ['operator', 'user', 'unknown']

  test.each(origins)('sourceOrigin=%s: sources[i] は sourceCredit(input.sources[i], origin) と等しい', (origin) => {
    const input = readout({ sourceOrigin: origin })
    const episode = classifyEpisode(input)
    expect(episode.kind).toBe('playable')
    if (episode.kind !== 'playable') return
    expect(episode.sources).toHaveLength(2)
    expect(episode.sources).toEqual(input.sources.map((s) => sourceCredit(s, origin)))
    expect(episode.sources?.every((s) => s.showsShareAlikeNotice === (origin === 'operator'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sourceCredit
// ---------------------------------------------------------------------------
describe('web-rule-catalog-10 sourceCredit: CC BY-SA の表示可否は運営者由来のときだけ true', () => {
  test.each([
    ['operator', true],
    ['user', false],
    ['unknown', false],
  ] as const)('origin=%s → showsShareAlikeNotice=%s（4 field は写される）', (origin, shows) => {
    expect(sourceCredit(SOURCE_A, origin)).toEqual({ ...SOURCE_A, showsShareAlikeNotice: shows })
  })
})

// ---------------------------------------------------------------------------
// displayTitle: podcastTitle.test.ts の 11 件と同じ入力
// ---------------------------------------------------------------------------
describe('web-rule-catalog-02 displayTitle: tests/lib/podcastTitle.test.ts と同じ入力は同じ値', () => {
  const LONG_INTRO =
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん1234567890'
  const label = (title: string | null, intro: string): EpisodeLabel => ({ title, intro })

  test('title が空でなければ maxLen に関わらず title', () => {
    expect(displayTitle(label('AIが選ぶ今日のニュース', LONG_INTRO), 10)).toBe('AIが選ぶ今日のニュース')
  })

  test('title が maxLen より長くても切り詰めない', () => {
    expect(displayTitle(label('とても長いタイトルです', LONG_INTRO), 3)).toBe('とても長いタイトルです')
  })

  test('title が null なら intro を maxLen で切る', () => {
    expect(displayTitle(label(null, LONG_INTRO), 5)).toBe('あいうえお')
  })

  test('title が空文字なら intro を maxLen で切る', () => {
    expect(displayTitle(label('', LONG_INTRO), 5)).toBe('あいうえお')
  })

  test('title が空白だけなら intro を maxLen で切る', () => {
    expect(displayTitle(label('   ', LONG_INTRO), 5)).toBe('あいうえお')
  })

  test('intro が maxLen より短ければ全文', () => {
    expect(displayTitle(label(null, 'abc'), 10)).toBe('abc')
  })

  test('intro がちょうど maxLen 文字なら全文', () => {
    const text = 'あ'.repeat(50)
    expect(displayTitle(label(null, text), 50)).toBe(text)
  })

  test('intro が maxLen より長ければ maxLen で切る', () => {
    expect(displayTitle(label(null, 'あ'.repeat(60)), 50)).toBe('あ'.repeat(50))
  })

  test('maxLen=0 で title が無ければ空文字', () => {
    expect(displayTitle(label(null, LONG_INTRO), 0)).toBe('')
  })

  test('maxLen=40 は先頭 40 文字', () => {
    expect(displayTitle(label(null, LONG_INTRO), 40)).toBe(LONG_INTRO.slice(0, 40))
  })

  test('負の maxLen は空文字（0 に丸める）', () => {
    expect(displayTitle(label(null, LONG_INTRO), -1)).toBe('')
    expect(displayTitle(label(null, LONG_INTRO), -100)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 生成関数
// ---------------------------------------------------------------------------
describe('playableEpisode: 空の audioUrl は Playable の不変条件の違反として throw する', () => {
  const input = {
    id: 'p1',
    title: 'T',
    label: { title: 'T', intro: 'イントロ' },
    audioUrl: AUDIO,
    durationSeconds: 600,
    difficulty: 'toeic_600',
    createdAt: '2026-05-31T06:00:00Z',
    serverPositionSeconds: 0,
  } as const

  test('audioUrl="" は Error を throw する', () => {
    expect(() => playableEpisode({ ...input, audioUrl: '' })).toThrow(Error)
  })

  test('正方向対照: audioUrl が非空なら kind=playable を返す', () => {
    expect(playableEpisode(input)).toMatchObject({ kind: 'playable', id: 'p1', audioUrl: AUDIO })
  })
})

describe('generatingEpisode・failedEpisode: 入力に kind を足した値を返す', () => {
  test('入力に kind が紛れていても、返す値の kind は variant のもの', () => {
    // 新鮮でない object は余剰 property の検査を受けないので、実行時にだけ kind が混ざる入力を作れる
    const generatingInput = { id: 'g1', title: 'T', difficulty: 'toeic_900', createdAt: '2026-05-31T06:00:00Z', kind: 'failed' } as const
    const failedInput = { id: 'f1', title: 'T', reason: 'generation_failed', kind: 'playable' } as const
    expect(generatingEpisode(generatingInput).kind).toBe('generating')
    const failed = failedEpisode(failedInput)
    expect(failed.kind).toBe('failed')
    expect(failed).toEqual({ kind: 'failed', id: 'f1', title: 'T', reason: 'generation_failed' })
  })
})

describe('queuedEpisode: { id, label: { title, intro } } を返し、title を trim・補完しない', () => {
  test('title=null はそのまま null', () => {
    expect(queuedEpisode({ id: 'q1', title: null, intro: 'イントロ' })).toEqual({
      id: 'q1',
      label: { title: null, intro: 'イントロ' },
    })
  })

  test('title="  t " は trim されずそのまま', () => {
    expect(queuedEpisode({ id: 'q2', title: '  t ', intro: 'イントロ' })).toEqual({
      id: 'q2',
      label: { title: '  t ', intro: 'イントロ' },
    })
  })
})
