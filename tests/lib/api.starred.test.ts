import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createApiClient } from '@/lib/api'

// backend が GET /feed から star 済み記事を恒久除外する移行に伴い、Star タブは
// 新設の GET /articles/starred（サーバ側の star 順一覧）へ切り替える。

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

function lastCall() {
  const [path, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
  return { path, init }
}

describe('getStarredArticles', () => {
  test('GET /api/backend/articles/starred を呼び articles を返す', async () => {
    mockFetchOk({
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
    })

    const res = await createApiClient().getStarredArticles()

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/articles/starred')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(res.articles).toHaveLength(1)
    expect(res.articles[0].id).toBe('a1')
  })
})
