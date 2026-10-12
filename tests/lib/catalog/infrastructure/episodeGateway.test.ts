// Catalog infrastructure の episodeGateway: port EpisodeSource を ApiGateway の上に実装する。
// 正本: 新 Spec §5.1 の port 表（EpisodeSource）、既存の getPodcast（lib/api/podcasts.ts）と同じ path・method。
//
// RED 理由（実装前）: `@/lib/catalog/infrastructure/episodeGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { decodeEpisode } from '@/lib/catalog/infrastructure/episodeMapper'
import { createEpisodeGateway } from '@/lib/catalog/infrastructure/episodeGateway'
import type { Podcast } from '@/types'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

function dto(): Podcast {
  return {
    id: 'p1',
    type: 'daily',
    article_ids: ['art-1'],
    difficulty: 'toeic_600',
    audio_url: 'https://example.com/p1.mp3',
    title: 'タイトル',
    japanese_intro_text: 'イントロ',
    segments: [{ speaker: 'A', text: 'hello' }],
    vocabulary: [],
    quiz: [],
    source_articles: [],
    source_kind: 'featured',
    duration_seconds: 600,
    created_at: '2026-05-31T06:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }
}

describe('createEpisodeGateway.fetch: 成功', () => {
  test('GET /api/backend/podcasts/:id を 1 回だけ呼び、decode した Episode を ok で返す', async () => {
    const gateway = createGatewayDouble()
    const body = dto()
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: true, value: body })

    const result = await createEpisodeGateway(gateway).fetch('p1')

    expect(gateway.calls).toEqual([{ method: 'GET', path: '/api/backend/podcasts/p1', body: undefined }])
    expect(result).toEqual({ ok: true, value: decodeEpisode(body) })
  })

  test('id は encode も検証もせず、getPodcast と同じ path に埋め込む', async () => {
    const gateway = createGatewayDouble()
    await createEpisodeGateway(gateway).fetch('a b/c')
    expect(gateway.calls.map((c) => c.path)).toEqual(['/api/backend/podcasts/a b/c'])
  })
})

describe('createEpisodeGateway.fetch: gateway の失敗', () => {
  test('not_found を同じ参照のまま ok:false で返し、reject しない', async () => {
    const gateway = createGatewayDouble()
    const failure = { kind: 'not_found', subject: 'podcast' } as const
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: false, failure })

    const result = await createEpisodeGateway(gateway).fetch('p1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
  })

  test('正方向対照: 同じ入口で成功を登録した id は ok:true を返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/podcasts/p2', { ok: true, value: { ...dto(), id: 'p2' } })
    gateway.respond('GET', '/api/backend/podcasts/p1', { ok: false, failure: { kind: 'server', status: 500 } })

    const source = createEpisodeGateway(gateway)
    expect((await source.fetch('p2')).ok).toBe(true)
    expect((await source.fetch('p1')).ok).toBe(false)
  })
})
