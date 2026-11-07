// Catalog infrastructure の catalogGateway: port CatalogGateway を ApiGateway の上に実装する（DTO `Podcast` → `EpisodeRecord`）。
// 取得は lib/api/podcasts.ts の getPodcasts・getPodcast と同じ path・method（GET のみ）。
// adapter のテスト: `createGatewayDouble` を使い、domain の生成関数は値で import しない（期待値は literal ＋ `import type`）。
//
// RED 理由（実装前）: `@/lib/catalog/infrastructure/catalogGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createCatalogGateway } from '@/lib/catalog/infrastructure/catalogGateway'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Podcast } from '@/types'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const LIST_PATH = '/api/backend/podcasts'

function dto(overrides: Partial<Podcast> = {}): Podcast {
  return {
    id: 'p1',
    type: 'daily',
    article_ids: ['art-1'],
    difficulty: 'toeic_600',
    audio_url: 'https://example.com/p1.mp3',
    title: 'タイトル',
    japanese_intro_text: 'イントロ',
    segments: [{ speaker: 'A', text: 'hello', role: 'fact' }],
    vocabulary: [{ term: 'term', meaning_ja: '語', example: 'ex' }],
    quiz: [{ question: 'q?', options: ['a', 'b'] }],
    source_articles: [{ article_id: 'art-1', title: 'Title A', url: 'https://example.com/a', source: 'Site A' }],
    source_kind: 'featured',
    duration_seconds: 600,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 7,
    ...overrides,
  }
}

async function listOne(podcast: Podcast) {
  const gateway = createGatewayDouble()
  gateway.respond('GET', LIST_PATH, { ok: true, value: { podcasts: [podcast] } })
  const result = await createCatalogGateway(gateway).listEpisodes()
  if (!result.ok) throw new Error('一覧の成功を期待した')
  return result.value[0]
}

describe('createCatalogGateway.listEpisodes: 成功', () => {
  test('verifies: CI-GW1 — GET /api/backend/podcasts を 1 回だけ呼び、DTO を EpisodeRecord に写して順序どおり返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', LIST_PATH, {
      ok: true,
      value: { podcasts: [dto({ id: 'p2', type: 'digest' }), dto({ id: 'p1' })] },
    })

    const result = await createCatalogGateway(gateway).listEpisodes()

    expect(gateway.calls).toEqual([{ method: 'GET', path: LIST_PATH, body: undefined }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((r) => r.episode.id)).toEqual(['p2', 'p1'])
    expect(result.value[1]).toMatchObject({
      generation: 'completed',
      isDigest: false,
      intro: 'イントロ',
      label: { title: 'タイトル', intro: 'イントロ' },
      difficulty: 'toeic_600',
      durationSeconds: 600,
      createdAt: '2026-05-31T06:00:00Z',
      transcript: [{ speaker: 'A', text: 'hello' }],
      glossary: [{ term: 'term', meaningJa: '語', example: 'ex' }],
      quiz: [{ question: 'q?', options: ['a', 'b'] }],
      sources: [
        { articleId: 'art-1', title: 'Title A', url: 'https://example.com/a', siteName: 'Site A', showsShareAlikeNotice: true },
      ],
    })
    expect(result.value[1].episode).toMatchObject({ kind: 'playable', id: 'p1' })
    expect(result.value[0].isDigest).toBe(true)
  })

  test('verifies: CI-GW1 — transcript の role は record に持ち込まない（speaker・text だけ）', async () => {
    const record = await listOne(dto())
    expect(record.transcript[0]).toEqual({ speaker: 'A', text: 'hello' })
  })

  test('verifies: CI-GW1 — 空の一覧は空のまま ok', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', LIST_PATH, { ok: true, value: { podcasts: [] } })
    expect(await createCatalogGateway(gateway).listEpisodes()).toEqual({ ok: true, value: [] })
  })
})

describe('createCatalogGateway.getEpisode: 成功', () => {
  test('verifies: CI-GW2 — GET /api/backend/podcasts/p1 を 1 回だけ呼び、EpisodeRecord を ok で返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: true, value: dto() })

    const result = await createCatalogGateway(gateway).getEpisode('p1')

    expect(gateway.calls).toEqual([{ method: 'GET', path: '/api/backend/podcasts/p1', body: undefined }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.episode).toMatchObject({ kind: 'playable', id: 'p1' })
    expect(result.value.transcript).toEqual([{ speaker: 'A', text: 'hello' }])
  })

  test('verifies: CI-GW2 — id は encode も検証もせず、getPodcast と同じ path に埋め込む', async () => {
    const gateway = createGatewayDouble()
    await createCatalogGateway(gateway).getEpisode('a b/c')
    expect(gateway.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/backend/podcasts/a b/c'])
  })
})

describe('createCatalogGateway: gateway の失敗', () => {
  test('verifies: CI-GW1・CI-GW2 — 失敗は同じ参照のまま ok:false で返し、reject しない（not_found を含む）', async () => {
    const gateway = createGatewayDouble()
    const listFailure: ApiFailure = { kind: 'server', status: 503 }
    const getFailure: ApiFailure = { kind: 'not_found', subject: 'podcast' }
    gateway.respond('GET', LIST_PATH, { ok: false, failure: listFailure })
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: false, failure: getFailure })

    const source = createCatalogGateway(gateway)
    const list = await source.listEpisodes()
    const one = await source.getEpisode('p1')

    expect(list.ok).toBe(false)
    expect(one.ok).toBe(false)
    if (list.ok || one.ok) return
    expect(list.failure).toBe(listFailure)
    expect(one.failure).toBe(getFailure)
  })

  test('verifies: CI-GW1・CI-GW2 — 正方向対照: 同じ入口で成功を登録した path は ok:true を返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/podcasts/p2', { ok: true, value: dto({ id: 'p2' }) })
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: false, failure: { kind: 'server', status: 500 } })

    const source = createCatalogGateway(gateway)
    expect((await source.getEpisode('p2')).ok).toBe(true)
    expect((await source.getEpisode('p1')).ok).toBe(false)
  })

  test('verifies: CI-GW3 — GET 以外の method を出さない（一覧・詳細の呼出は GET のみ）', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', LIST_PATH, { ok: true, value: { podcasts: [dto()] } })
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: true, value: dto() })
    const source = createCatalogGateway(gateway)

    await source.listEpisodes()
    await source.getEpisode('p1')

    expect(gateway.calls.map((c) => c.method)).toEqual(['GET', 'GET'])
  })
})

describe('createCatalogGateway: 写しの不変条件', () => {
  test('verifies: CI-GW3 — completed で audio_url が空 → episode は failed だが generation は completed のまま', async () => {
    const record = await listOne(dto({ status: 'completed', audio_url: '' }))
    expect(record.episode.kind).toBe('failed')
    expect(record.generation).toBe('completed')
  })

  test('verifies: CI-GW3 — partial_failed → generation は failed', async () => {
    const record = await listOne(dto({ status: 'partial_failed' }))
    expect(record.generation).toBe('failed')
    expect(record.episode.kind).toBe('failed')
  })

  test.each([
    ['processing', 'processing', 'generating'],
    ['failed', 'failed', 'failed'],
    ['completed', 'completed', 'playable'],
  ] as const)('verifies: CI-GW3 — 正方向対照: status %s → generation %s・episode.kind %s', async (status, generation, kind) => {
    const record = await listOne(dto({ status }))
    expect(record.generation).toBe(generation)
    expect(record.episode.kind).toBe(kind)
  })

  test('verifies: CI-GW3 — failed の DTO が持つ 4 つの内容と表示 field を捨てず、kind に依らず DTO の値で写す', async () => {
    const record = await listOne(
      dto({
        status: 'failed',
        error_message: 'quota_exhausted',
        type: 'digest',
        difficulty: 'eiken_2',
        duration_seconds: 123,
        created_at: '2026-07-01T00:00:00Z',
        japanese_intro_text: '失敗した回のイントロ',
      }),
    )

    expect(record.episode.kind).toBe('failed')
    expect(record.transcript).toEqual([{ speaker: 'A', text: 'hello' }])
    expect(record.glossary).toEqual([{ term: 'term', meaningJa: '語', example: 'ex' }])
    expect(record.quiz).toEqual([{ question: 'q?', options: ['a', 'b'] }])
    expect(record.sources).toHaveLength(1)
    expect(record.difficulty).toBe('eiken_2')
    expect(record.durationSeconds).toBe(123)
    expect(record.createdAt).toBe('2026-07-01T00:00:00Z')
    expect(record.isDigest).toBe(true)
    expect(record.intro).toBe('失敗した回のイントロ')
  })

  test('verifies: CI-GW3 — 4 つの内容が null なら空配列、欠落でも空配列。title の欠落は label.title が null', async () => {
    const nulls = await listOne(dto({ segments: null, vocabulary: null, quiz: null, source_articles: null }))
    expect([nulls.transcript, nulls.glossary, nulls.quiz, nulls.sources]).toEqual([[], [], [], []])

    const { segments: _s, vocabulary: _v, quiz: _q, source_articles: _a, title: _t, ...rest } = dto()
    void [_s, _v, _q, _a, _t]
    const missing = await listOne(rest)
    expect([missing.transcript, missing.glossary, missing.quiz, missing.sources]).toEqual([[], [], [], []])
    expect(missing.label).toEqual({ title: null, intro: 'イントロ' })
  })

  test('verifies: CI-GW3 — title があれば label.title にそのまま入る（正方向対照）', async () => {
    expect((await listOne(dto({ title: '題' }))).label).toEqual({ title: '題', intro: 'イントロ' })
  })

  test.each([
    ['featured', 'featured', true],
    ['user', 'user', false],
    ['unknown', 'unknown', false],
    ['null', null, false],
  ] as const)('verifies: CI-GW3 — source_kind が %s のとき通知は %s（featured だけ真。fail-closed）', async (_label, kind, expected) => {
    const record = await listOne(dto({ source_kind: kind }))
    expect(record.sources.map((s) => s.showsShareAlikeNotice)).toEqual([expected])
  })

  test('verifies: CI-GW3 — source_kind が欠落していても通知は偽（fail-closed）', async () => {
    const { source_kind: _k, ...rest } = dto()
    void _k
    const record = await listOne(rest)
    expect(record.sources.map((s) => s.showsShareAlikeNotice)).toEqual([false])
  })
})
