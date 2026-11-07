// Catalog application のリードモデル: EpisodeRecord → EpisodeCardView・EpisodeDetailView（web-model-catalog・web-rule-catalog-10）。
// application の unit テスト。DTO（`@/types`）も infrastructure も import しない。record は object literal ＋ `import type` で作る。
// `sourceCredit` だけは値で import する（CC BY-SA の通知の有無は domain の規則が決めるので、期待値の根拠を domain に置く）。
//
// RED 理由（実装前）: `@/lib/catalog/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { toEpisodeCardView, toEpisodeDetailView } from '@/lib/catalog/application/readModels'
import type { EpisodeRecord } from '@/lib/catalog/application/ports'
import { sourceCredit } from '@/lib/catalog/domain/episode'
import type {
  FailedEpisode,
  GeneratingEpisode,
  PlayableEpisode,
  SourceCredit,
  SourceOrigin,
} from '@/lib/catalog/domain/episode'

const PLAYABLE: PlayableEpisode = {
  kind: 'playable',
  id: 'p1',
  title: 'タイトル',
  label: { title: 'タイトル', intro: 'イントロ' },
  audioUrl: 'https://example.com/p1.mp3',
  durationSeconds: 600,
  difficulty: 'toeic_600',
  createdAt: '2026-05-31T06:00:00Z',
  serverPositionSeconds: 42,
}
const GENERATING: GeneratingEpisode = {
  kind: 'generating',
  id: 'g1',
  title: '生成中の題',
  difficulty: 'toeic_900',
  createdAt: '2026-06-01T06:00:00Z',
}
const FAILED: FailedEpisode = { kind: 'failed', id: 'f1', title: '失敗の題', reason: 'quota_exhausted' }

const CONTENT = {
  transcript: [{ speaker: 'A', text: 'hello' }],
  glossary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
  quiz: [{ question: 'q?', options: ['a', 'b'] }],
} as const

const credit = (origin: SourceOrigin, articleId = 'art-1'): SourceCredit =>
  sourceCredit({ articleId, title: `Title ${articleId}`, url: `https://example.com/${articleId}`, siteName: 'Site' }, origin)

function record(overrides: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    episode: PLAYABLE,
    generation: 'completed',
    isDigest: false,
    intro: 'イントロ',
    label: { title: 'タイトル', intro: 'イントロ' },
    difficulty: 'toeic_600',
    durationSeconds: 600,
    createdAt: '2026-05-31T06:00:00Z',
    transcript: [],
    glossary: [],
    quiz: [],
    sources: [],
    ...overrides,
  }
}

const CARD_KEYS = [
  'createdAt',
  'difficulty',
  'durationSeconds',
  'failureReason',
  'generation',
  'id',
  'intro',
  'isDigest',
  'kind',
  'label',
  'title',
]
const DETAIL_KEYS = [...CARD_KEYS, 'glossary', 'quiz', 'showsShareAlikeNotice', 'sources', 'transcript'].sort()

describe('toEpisodeCardView・toEpisodeDetailView: 値の出どころ', () => {
  test('verifies: CI-RM1 — playable の record → 一覧のカードの field。failureReason は null', () => {
    const view = toEpisodeCardView(record({ isDigest: true }))

    expect(view).toEqual({
      id: 'p1',
      kind: 'playable',
      generation: 'completed',
      title: 'タイトル',
      label: { title: 'タイトル', intro: 'イントロ' },
      isDigest: true,
      intro: 'イントロ',
      difficulty: 'toeic_600',
      durationSeconds: 600,
      createdAt: '2026-05-31T06:00:00Z',
      failureReason: null,
    })
    expect(Object.keys(view).sort()).toEqual(CARD_KEYS)
  })

  test('verifies: CI-RM1 — generating の record → kind・title は episode から、generation は record から。failureReason は null', () => {
    const view = toEpisodeCardView(
      record({
        episode: GENERATING,
        generation: 'processing',
        label: { title: null, intro: 'イントロ' },
        difficulty: 'toeic_900',
        durationSeconds: 0,
        createdAt: '2026-06-01T06:00:00Z',
      }),
    )

    expect(view).toMatchObject({
      id: 'g1',
      kind: 'generating',
      generation: 'processing',
      title: '生成中の題',
      label: { title: null, intro: 'イントロ' },
      difficulty: 'toeic_900',
      durationSeconds: 0,
      createdAt: '2026-06-01T06:00:00Z',
      failureReason: null,
    })
    expect(Object.keys(view).sort()).toEqual(CARD_KEYS)
  })

  test('verifies: CI-RM1 — failed の record だけ failureReason を持つ（failureReason !== null ⇔ kind === failed）', () => {
    const failed = toEpisodeCardView(record({ episode: FAILED, generation: 'failed' }))
    expect(failed.kind).toBe('failed')
    expect(failed.failureReason).toBe('quota_exhausted')
    expect(failed.title).toBe('失敗の題')

    const others = [PLAYABLE, GENERATING].map((episode) => toEpisodeCardView(record({ episode })))
    expect(others.map((v) => v.failureReason)).toEqual([null, null])
    expect(Object.keys(failed).sort()).toEqual(CARD_KEYS)
  })

  test('verifies: CI-RM1 — completed なのに失敗の episode（audio_url が空）は generation が completed のまま、kind は failed', () => {
    const view = toEpisodeCardView(
      record({ episode: { ...FAILED, reason: 'generation_failed' }, generation: 'completed' }),
    )
    expect(view.kind).toBe('failed')
    expect(view.generation).toBe('completed')
    expect(view.failureReason).toBe('generation_failed')
  })

  test('verifies: CI-RM1 — カードは episode・savedPosition・isCached・audioUrl・audioHandle・詳細の内容を持たない', () => {
    const view = toEpisodeCardView(record({ ...CONTENT, sources: [credit('operator')] }))
    for (const key of ['episode', 'savedPosition', 'isCached', 'audioUrl', 'audioHandle', 'transcript', 'glossary', 'quiz', 'sources']) {
      expect(view, key).not.toHaveProperty(key)
    }
  })
})

describe('toEpisodeDetailView: 詳細の内容', () => {
  test('verifies: CI-RM2 — 内容を持つ record → transcript・glossary・quiz・sources が等しい。field の集合はカード ＋ 内容 4 ＋ 通知', () => {
    const sources = [credit('operator', 'art-1'), credit('operator', 'art-2')]
    const view = toEpisodeDetailView(record({ ...CONTENT, sources }))

    expect(view.transcript).toEqual([{ speaker: 'A', text: 'hello' }])
    expect(view.glossary).toEqual([{ term: 'term', meaningJa: '語', example: 'ex' }])
    expect(view.quiz).toEqual([{ question: 'q?', options: ['a', 'b'] }])
    expect(view.sources).toEqual(sources)
    expect(view.id).toBe('p1')
    expect(view.kind).toBe('playable')
    expect(Object.keys(view).sort()).toEqual(DETAIL_KEYS)
    for (const key of ['episode', 'savedPosition', 'isCached', 'audioUrl', 'audioHandle']) {
      expect(view, key).not.toHaveProperty(key)
    }
  })

  test('verifies: CI-RM1・CI-RM2 — failed の record が内容を持てば、そのまま詳細に出る（playable のときだけ出す実装を拒否する）', () => {
    const view = toEpisodeDetailView(
      record({ episode: FAILED, generation: 'failed', ...CONTENT, sources: [credit('operator')] }),
    )

    expect(view.kind).toBe('failed')
    expect(view.failureReason).toBe('quota_exhausted')
    expect(view.transcript).toHaveLength(1)
    expect(view.glossary).toHaveLength(1)
    expect(view.quiz).toHaveLength(1)
    expect(view.sources).toHaveLength(1)
    expect(view.showsShareAlikeNotice).toBe(true)
  })

  test('verifies: CI-RM1・CI-RM2 — generating の record の内容と、kind に依らない表示 field（intro・label・difficulty・durationSeconds・createdAt・isDigest）', () => {
    const view = toEpisodeDetailView(
      record({
        episode: GENERATING,
        generation: 'processing',
        isDigest: true,
        intro: '生成中のイントロ',
        label: { title: null, intro: '生成中のイントロ' },
        difficulty: 'eiken_2',
        durationSeconds: 123,
        createdAt: '2026-07-01T00:00:00Z',
        ...CONTENT,
      }),
    )

    expect(view).toMatchObject({
      kind: 'generating',
      isDigest: true,
      intro: '生成中のイントロ',
      label: { title: null, intro: '生成中のイントロ' },
      difficulty: 'eiken_2',
      durationSeconds: 123,
      createdAt: '2026-07-01T00:00:00Z',
    })
    expect(view.transcript).toHaveLength(1)
  })
})

describe('showsShareAlikeNotice (web-rule-catalog-10)', () => {
  test('verifies: CI-RM2 — operator 由来の出典を 1 つでも含めば真', () => {
    expect(toEpisodeDetailView(record({ sources: [credit('user', 'a'), credit('operator', 'b')] })).showsShareAlikeNotice).toBe(true)
  })

  test('verifies: CI-RM2 — user・unknown の出典だけなら偽（fail-closed）', () => {
    expect(toEpisodeDetailView(record({ sources: [credit('user', 'a'), credit('unknown', 'b')] })).showsShareAlikeNotice).toBe(false)
  })

  test('verifies: CI-RM2 — 出典なしなら偽', () => {
    expect(toEpisodeDetailView(record({ sources: [] })).showsShareAlikeNotice).toBe(false)
  })

  test('verifies: CI-RM2 — 正方向対照: 同じ構成で由来だけ operator に替えると真になる', () => {
    const base = { articleId: 'a', title: 't', url: 'https://example.com/a', siteName: 'S' }
    const viaUser = toEpisodeDetailView(record({ sources: [sourceCredit(base, 'user')] }))
    const viaOperator = toEpisodeDetailView(record({ sources: [sourceCredit(base, 'operator')] }))
    expect([viaUser.showsShareAlikeNotice, viaOperator.showsShareAlikeNotice]).toEqual([false, true])
  })
})
