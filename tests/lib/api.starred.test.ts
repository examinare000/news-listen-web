import { describe, test, expect } from 'vitest'
import { getStarredArticles } from '@/lib/api/articles'
import { createGatewayDouble } from '../helpers/gatewayDouble'

// backend が GET /feed から star 済み記事を恒久除外する移行に伴い、Star タブは
// 新設の GET /articles/starred（サーバ側の star 順一覧）へ切り替える。

describe('getStarredArticles', () => {
  test('GET /api/backend/articles/starred を呼び articles を返す', async () => {
    const gw = createGatewayDouble()
    const body = {
      articles: [
        {
          id: 'a1',
          title: 'TypeScript 5.5 Released',
          url: 'https://devblogs.microsoft.com/typescript',
          source: 'Microsoft Blog',
          score: 0.95,
          published_at: '2026-06-10T09:00:00+09:00',
        },
      ],
    }
    gw.respond('GET', '/api/backend/articles/starred', { ok: true, value: body })

    const res = await getStarredArticles(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/articles/starred', body: undefined }])
    expect(res).toEqual({ ok: true, value: body })
  })
})
