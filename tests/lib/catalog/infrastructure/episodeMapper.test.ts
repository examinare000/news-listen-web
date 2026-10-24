// Catalog infrastructure の episodeMapper: DTO `Podcast` を domain の `Episode` へ読み取る。
// 正本: 既存 Spec §3.2・§4（web-contract-14）・§5（CP5）、共有仕様 §4.4（shared-session-08・shared-session-09）、新 Spec §5.2（web-rule-catalog-10・web-rule-catalog-11）。
//
// RED 理由（実装前）: `@/lib/catalog/infrastructure/episodeMapper` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { decodeEpisode } from '@/lib/catalog/infrastructure/episodeMapper'
import type { Podcast } from '@/types'

function dto(over: Partial<Podcast> = {}): Podcast {
  return {
    id: 'p1',
    type: 'daily',
    article_ids: ['art-1'],
    difficulty: 'toeic_600',
    audio_url: 'https://example.com/p1.mp3',
    title: 'タイトル',
    japanese_intro_text: 'イントロの全文です',
    segments: [{ speaker: 'A', text: 'hello', role: 'fact' }],
    vocabulary: [{ term: 'term', meaning_ja: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    source_articles: [{ article_id: 'art-1', title: 'Title A', url: 'https://example.com/a', source: 'Site A' }],
    source_kind: 'featured',
    duration_seconds: 600,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 42,
    ...over,
  }
}

const AUDIO = 'https://example.com/p1.mp3'
// 非 null の error_message は識別子 'quota_exhausted' を使う
const ERR = 'quota_exhausted'

// ---------------------------------------------------------------------------
// web-contract-14 の 16 行
// ---------------------------------------------------------------------------
type Expected = { kind: 'playable' } | { kind: 'generating' } | { kind: 'failed'; reason: 'generation_failed' | 'quota_exhausted' }
const PLAYABLE: Expected = { kind: 'playable' }
const GENERATING: Expected = { kind: 'generating' }
const GEN_FAILED: Expected = { kind: 'failed', reason: 'generation_failed' }
const QUOTA_FAILED: Expected = { kind: 'failed', reason: 'quota_exhausted' }

interface WebContract14Row {
  readonly status: Podcast['status']
  readonly audio_url: string
  readonly error_message: string | null
  readonly expected: Expected
  readonly note: string
}

const WEB_CONTRACT_14_ROWS: readonly WebContract14Row[] = [
  { status: 'completed', audio_url: AUDIO, error_message: null, expected: PLAYABLE, note: '' },
  { status: 'completed', audio_url: AUDIO, error_message: ERR, expected: QUOTA_FAILED, note: ' shared-session-08' },
  { status: 'completed', audio_url: '', error_message: null, expected: GEN_FAILED, note: '' },
  { status: 'completed', audio_url: '', error_message: ERR, expected: QUOTA_FAILED, note: ' shared-session-08' },
  { status: 'processing', audio_url: AUDIO, error_message: null, expected: GENERATING, note: '' },
  { status: 'processing', audio_url: AUDIO, error_message: ERR, expected: GENERATING, note: '' },
  { status: 'processing', audio_url: '', error_message: null, expected: GENERATING, note: '' },
  { status: 'processing', audio_url: '', error_message: ERR, expected: GENERATING, note: '' },
  { status: 'failed', audio_url: AUDIO, error_message: null, expected: GEN_FAILED, note: '' },
  { status: 'failed', audio_url: '', error_message: null, expected: GEN_FAILED, note: '' },
  { status: 'failed', audio_url: AUDIO, error_message: ERR, expected: QUOTA_FAILED, note: '' },
  { status: 'failed', audio_url: '', error_message: ERR, expected: QUOTA_FAILED, note: '' },
  { status: 'partial_failed', audio_url: AUDIO, error_message: null, expected: GEN_FAILED, note: ' shared-session-09' },
  { status: 'partial_failed', audio_url: AUDIO, error_message: ERR, expected: QUOTA_FAILED, note: ' shared-session-09' },
  { status: 'partial_failed', audio_url: '', error_message: null, expected: GEN_FAILED, note: '' },
  { status: 'partial_failed', audio_url: '', error_message: ERR, expected: QUOTA_FAILED, note: '' },
]

describe('web-contract-14 decodeEpisode: status 4 値 × audio_url × error_message の 16 行', () => {
  test('16 行ある（status 4 × audio_url 2 × error_message 2 を欠かさない）', () => {
    expect(WEB_CONTRACT_14_ROWS).toHaveLength(16)
    expect(new Set(WEB_CONTRACT_14_ROWS.map((r) => `${r.status}|${r.audio_url === ''}|${r.error_message === null}`)).size).toBe(16)
  })

  test.each(WEB_CONTRACT_14_ROWS)(
    'verifies: web-contract-14$note: status=$status audio_url=$audio_url error_message=$error_message → $expected',
    ({ status, audio_url, error_message, expected }) => {
      const episode = decodeEpisode(dto({ status, audio_url, error_message }))
      expect(episode.kind).toBe(expected.kind)
      if (expected.kind === 'failed') {
        expect(episode.kind === 'failed' ? episode.reason : undefined).toBe(expected.reason)
      }
    },
  )
})

// ---------------------------------------------------------------------------
// web-rule-catalog-11: failed の reason
// ---------------------------------------------------------------------------
describe('web-rule-catalog-11 decodeEpisode: status=failed の reason は 2 値の識別子だけ', () => {
  test.each([
    ['generation_failed', 'generation_failed'],
    ['quota_exhausted', 'quota_exhausted'],
    ['partial_failed', 'generation_failed'],
    ['Gemini API で 429 が返りました', 'generation_failed'],
    ['', 'generation_failed'],
    [null, 'generation_failed'],
  ] as const)('error_message=%j → reason=%s', (error_message, reason) => {
    const episode = decodeEpisode(dto({ status: 'failed', error_message }))
    expect(episode).toMatchObject({ kind: 'failed', reason })
  })
})

// ---------------------------------------------------------------------------
// web-rule-catalog-10: source_kind → 表示可否
// ---------------------------------------------------------------------------
describe('web-rule-catalog-10 decodeEpisode: CC BY-SA の表示可否は source_kind=featured のときだけ true', () => {
  const kinds: ReadonlyArray<[string, Podcast['source_kind'], boolean]> = [
    ['featured', 'featured', true],
    ['user', 'user', false],
    ['unknown', 'unknown', false],
    ['null', null, false],
    ['欠落', undefined, false],
  ]

  test.each(kinds)('source_kind=%s → showsShareAlikeNotice=%s', (_label, source_kind, shows) => {
    const base = dto()
    const input: Podcast = { ...base, source_kind }
    if (source_kind === undefined) delete input.source_kind
    const episode = decodeEpisode(input)
    expect(episode.kind).toBe('playable')
    if (episode.kind !== 'playable') return
    expect(episode.sources).toHaveLength(1)
    expect(episode.sources?.map((s) => s.showsShareAlikeNotice)).toEqual([shows])
  })
})

// ---------------------------------------------------------------------------
// web-contract-14（補完と改名）
// ---------------------------------------------------------------------------
describe('decodeEpisode: 欠落の補完と名前の写像', () => {
  test('全 field を持つ DTO は domain の語に写される（role は捨てる。snake_case は camelCase）', () => {
    const episode = decodeEpisode(dto())
    expect(episode).toEqual({
      kind: 'playable',
      id: 'p1',
      title: 'タイトル',
      label: { title: 'タイトル', intro: 'イントロの全文です' },
      audioUrl: AUDIO,
      durationSeconds: 600,
      difficulty: 'toeic_600',
      createdAt: '2026-05-31T06:00:00Z',
      serverPositionSeconds: 42,
      transcript: [{ speaker: 'A', text: 'hello' }],
      vocabulary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
      quiz: [{ question: 'q?', options: ['a', 'b'] }],
      sources: [
        { articleId: 'art-1', title: 'Title A', url: 'https://example.com/a', siteName: 'Site A', showsShareAlikeNotice: true },
      ],
    })
    if (episode.kind !== 'playable') return
    // role は持たない（toEqual は undefined の key を無視するので key の集合でも確かめる）
    expect(Object.keys(episode.transcript?.[0] ?? {}).sort()).toEqual(['speaker', 'text'])
    expect(Object.keys(episode.vocabulary?.[0] ?? {}).sort()).toEqual(['example', 'meaningJa', 'term'])
  })

  test('title が欠落なら intro の全文（切り詰めない）、segments・vocabulary・quiz・source_articles が null なら空の配列', () => {
    const intro = 'あ'.repeat(60)
    const input = dto({ japanese_intro_text: intro, segments: null, vocabulary: null, quiz: null, source_articles: null })
    delete input.title
    const episode = decodeEpisode(input)
    expect(episode).toMatchObject({ kind: 'playable', title: intro, transcript: [], vocabulary: [], quiz: [], sources: [] })
  })

  test('segments・vocabulary・quiz・source_articles・source_kind が欠落した DTO も空の配列に補完される', () => {
    const input = dto()
    delete input.segments
    delete input.vocabulary
    delete input.quiz
    delete input.source_articles
    delete input.source_kind
    const episode = decodeEpisode(input)
    expect(episode).toMatchObject({ kind: 'playable', transcript: [], vocabulary: [], quiz: [], sources: [] })
  })

  test('title が空文字・空白だけなら intro の全文。前後に空白のある title は trim した値', () => {
    expect(decodeEpisode(dto({ title: '', japanese_intro_text: 'イントロ' })).title).toBe('イントロ')
    expect(decodeEpisode(dto({ title: '   ', japanese_intro_text: 'イントロ' })).title).toBe('イントロ')
    expect(decodeEpisode(dto({ title: ' T ', japanese_intro_text: 'イントロ' })).title).toBe('T')
  })

  test('processing・failed の episode も同じ規則で title を補完する', () => {
    const intro = 'い'.repeat(60)
    const processing = decodeEpisode(dto({ status: 'processing', title: '', japanese_intro_text: intro }))
    const failed = decodeEpisode(dto({ status: 'failed', title: '', japanese_intro_text: intro }))
    expect(processing).toMatchObject({ kind: 'generating', title: intro, id: 'p1', difficulty: 'toeic_600', createdAt: '2026-05-31T06:00:00Z' })
    expect(failed).toMatchObject({ kind: 'failed', title: intro, id: 'p1' })
  })
})
