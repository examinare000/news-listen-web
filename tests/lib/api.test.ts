import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createApiClient, ApiError } from '@/lib/api'

function makeClient() {
  return createApiClient()
}

function mockFetchOk(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  )
}

function mockFetchError(status: number, detail: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ detail }),
      text: () => Promise.resolve(JSON.stringify({ detail })),
    })
  )
}

function mockFetchNetworkError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ==========================================================
// createApiClient — モジュールロード時に localStorage を読まない
// ==========================================================
describe('createApiClient', () => {
  test('does not access localStorage during module import or client creation', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem')
    makeClient()
    expect(spy).not.toHaveBeenCalled()
  })
})

// ==========================================================
// getFeed — GET /api/backend/feed
// ==========================================================
describe('getFeed', () => {
  test('sends GET request to /api/backend/feed with correct headers', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    const client = makeClient()
    await client.getFeed()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/feed',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  test('does NOT send X-API-Key or X-Backend-Base-Url headers (injected by BFF)', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    const client = makeClient()
    await client.getFeed()

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-API-Key']).toBeUndefined()
    expect(headers['X-Backend-Base-Url']).toBeUndefined()
  })

  test('returns response containing articles and date fields (interface contract)', async () => {
    const feedData = {
      articles: [
        {
          id: 'a1',
          title: 'Test',
          url: 'https://example.com',
          source: 'HN',
          score: 0.95,
          published_at: '2026-06-10T00:00:00+00:00',
        },
      ],
      date: '2026-06-10',
    }
    mockFetchOk(feedData)
    const client = makeClient()
    const result = await client.getFeed()

    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('date')
    expect(Array.isArray(result.articles)).toBe(true)
  })
})

// ==========================================================
// starArticle / dismissArticle — POST /api/backend/articles/{id}/star|dismiss
// ==========================================================
describe('starArticle', () => {
  test('sends POST to /api/backend/articles/{id}/star', async () => {
    mockFetchOk({ status: 'starred', article_id: 'a1' })
    const client = makeClient()
    await client.starArticle('a1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/articles/a1/star',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('dismissArticle', () => {
  test('sends POST to /api/backend/articles/{id}/dismiss', async () => {
    mockFetchOk({ status: 'dismissed', article_id: 'a1' })
    const client = makeClient()
    await client.dismissArticle('a1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/articles/a1/dismiss',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

// ==========================================================
// getPodcasts / getPodcast
// ==========================================================
describe('getPodcasts', () => {
  test('sends GET to /api/backend/podcasts', async () => {
    mockFetchOk({ podcasts: [] })
    const client = makeClient()
    await client.getPodcasts()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/podcasts',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

describe('getPodcast', () => {
  test('sends GET to /api/backend/podcasts/{id}', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'テスト',
      duration_seconds: 300,
      created_at: '2026-06-10T00:00:00+00:00',
    }
    mockFetchOk(podcast)
    const client = makeClient()
    await client.getPodcast('p1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/podcasts/p1',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

// ==========================================================
// getSources / addSource / deleteSource
// ==========================================================
describe('getSources', () => {
  test('sends GET to /api/backend/settings/sources', async () => {
    mockFetchOk({ sources: [] })
    const client = makeClient()
    await client.getSources()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/settings/sources',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

describe('addSource', () => {
  test('sends POST to /api/backend/settings/sources with name and url in body', async () => {
    mockFetchOk({ sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] })
    const client = makeClient()
    await client.addSource('HN', 'https://news.ycombinator.com/rss')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/settings/sources',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'HN', url: 'https://news.ycombinator.com/rss' }),
      })
    )
  })
})

describe('deleteSource', () => {
  test('sends DELETE to /api/backend/settings/sources?url={encoded}', async () => {
    mockFetchOk({ sources: [] })
    const client = makeClient()
    const sourceUrl = 'https://news.ycombinator.com/rss'
    await client.deleteSource(sourceUrl)

    const expectedQuery = `url=${encodeURIComponent(sourceUrl)}`
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(expectedQuery),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  test('encodes URL containing & character', async () => {
    mockFetchOk({ sources: [] })
    const client = makeClient()
    const urlWithAmpersand = 'https://example.com/rss?a=1&b=2'
    await client.deleteSource(urlWithAmpersand)

    const call = vi.mocked(fetch).mock.calls[0]
    const requestUrl = call[0] as string
    expect(requestUrl).toContain(encodeURIComponent(urlWithAmpersand))
    // & が素通りしていないことを確認
    expect(requestUrl).not.toContain('&b=2')
  })

  test('encodes URL containing Japanese characters', async () => {
    mockFetchOk({ sources: [] })
    const client = makeClient()
    const urlWithJapanese = 'https://example.com/日本語/rss'
    await client.deleteSource(urlWithJapanese)

    const call = vi.mocked(fetch).mock.calls[0]
    const requestUrl = call[0] as string
    expect(requestUrl).not.toContain('日本語')
  })
})

// ==========================================================
// checkHealth — GET /api/backend/health
// ==========================================================
describe('checkHealth', () => {
  test('sends GET to /api/backend/health', async () => {
    mockFetchOk({ status: 'ok' })
    const client = makeClient()
    await client.checkHealth()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/health',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

// ==========================================================
// ApiError — 異常系の正規化
// ==========================================================
describe('ApiError normalization', () => {
  describe('Given non-2xx response with {"detail": "..."} body', () => {
    test('throws ApiError with status and detail extracted', async () => {
      mockFetchError(401, 'Invalid or missing API key')
      const client = makeClient()

      await expect(client.getFeed()).rejects.toMatchObject({
        status: 401,
        detail: 'Invalid or missing API key',
      })
    })

    test('thrown error is instance of ApiError', async () => {
      mockFetchError(404, 'Article not found')
      const client = makeClient()

      try {
        await client.starArticle('missing')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
      }
    })
  })

  describe('Given non-2xx response without parseable detail', () => {
    test('throws ApiError with "Unknown error" as detail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
          text: () => Promise.resolve('Internal Server Error'),
        })
      )
      const client = makeClient()

      await expect(client.getFeed()).rejects.toMatchObject({
        status: 500,
        detail: 'Unknown error',
      })
    })
  })

  describe('Given network error (fetch rejects)', () => {
    test('normalizes to ApiError with status 0', async () => {
      mockFetchNetworkError()
      const client = makeClient()

      await expect(client.getFeed()).rejects.toMatchObject({ status: 0 })
    })

    test('thrown error is instance of ApiError', async () => {
      mockFetchNetworkError()
      const client = makeClient()

      try {
        await client.getFeed()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
      }
    })
  })

  describe('Given 409 response (duplicate source)', () => {
    test('throws ApiError with status 409', async () => {
      mockFetchError(409, 'Source URL already exists')
      const client = makeClient()

      await expect(client.addSource('HN', 'https://example.com')).rejects.toMatchObject({
        status: 409,
        detail: 'Source URL already exists',
      })
    })
  })

  describe('Given 422 response (validation error)', () => {
    test('throws ApiError with status 422', async () => {
      mockFetchError(422, 'value is not a valid URL')
      const client = makeClient()

      await expect(client.addSource('Bad', 'not-a-url')).rejects.toMatchObject({
        status: 422,
      })
    })
  })
})

// ==========================================================
// セキュリティ要件: API キーをログ出力しない
// (API キーが console.log の引数に渡されないことを型レベルで保証する構造的テスト)
// ==========================================================
// getPreferences — GET /api/backend/settings/preferences
// ==========================================================
describe('getPreferences', () => {
  test('sends GET request to /api/backend/settings/preferences with correct headers', async () => {
    const preferences = {
      default_difficulty: 'toeic_900' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    mockFetchOk(preferences)
    const client = makeClient()
    await client.getPreferences()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/settings/preferences',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  test('returns UserPreferences with all required fields', async () => {
    const preferences = {
      default_difficulty: 'ielts_7' as const,
      default_playback_speed: 1.25,
      digest_enabled: false,
      digest_article_count: 5,
    }
    mockFetchOk(preferences)
    const client = makeClient()
    const result = await client.getPreferences()

    expect(result.default_difficulty).toBe('ielts_7')
    expect(result.default_playback_speed).toBe(1.25)
    expect(result.digest_enabled).toBe(false)
    expect(result.digest_article_count).toBe(5)
  })

  test('throws ApiError on network failure', async () => {
    mockFetchNetworkError()
    const client = makeClient()

    await expect(client.getPreferences()).rejects.toThrow(ApiError)
  })
})

// ==========================================================
// updatePreferences — PUT /api/backend/settings/preferences
// ==========================================================
describe('updatePreferences', () => {
  test('sends PUT request to /api/backend/settings/preferences with partial update body', async () => {
    const updated = {
      default_difficulty: 'eiken_2' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    mockFetchOk(updated)
    const client = makeClient()
    await client.updatePreferences({ default_difficulty: 'eiken_2' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/settings/preferences',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ default_difficulty: 'eiken_2' }),
      })
    )
  })

  test('returns updated UserPreferences', async () => {
    const updated = {
      default_difficulty: 'toeic_600' as const,
      default_playback_speed: 0.75,
      digest_enabled: true,
      digest_article_count: 20,
    }
    mockFetchOk(updated)
    const client = makeClient()
    const result = await client.updatePreferences({ default_difficulty: 'toeic_600' })

    expect(result.default_difficulty).toBe('toeic_600')
  })

  test('throws ApiError on 400 Bad Request', async () => {
    mockFetchError(400, 'Invalid difficulty level')
    const client = makeClient()

    // Pass empty patch that will fail validation
    await expect(client.updatePreferences({})).rejects.toThrow(ApiError)
  })
})

// ==========================================================
// updatePosition — PATCH /api/backend/podcasts/:id/position
// ==========================================================
describe('updatePosition', () => {
  test('sends PATCH request to correct endpoint with position in body', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 120,
    }
    mockFetchOk(podcast)
    const client = makeClient()
    await client.updatePosition('p1', 150)

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/podcasts/p1/position',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ position_seconds: 150 }),
      })
    )
  })

  test('returns updated Podcast with new position', async () => {
    const updatedPodcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 150,
    }
    mockFetchOk(updatedPodcast)
    const client = makeClient()
    const result = await client.updatePosition('p1', 150)

    expect(result.playback_position_seconds).toBe(150)
    expect(result.status).toBe('completed')
  })

  test('throws ApiError on 404 Not Found', async () => {
    mockFetchError(404, 'Podcast not found')
    const client = makeClient()

    await expect(client.updatePosition('nonexistent', 100)).rejects.toThrow(ApiError)
  })

  test('throws ApiError on 422 Unprocessable Entity', async () => {
    mockFetchError(422, 'Invalid position value')
    const client = makeClient()

    await expect(client.updatePosition('p1', -100)).rejects.toThrow(ApiError)
  })

  test('throws ApiError on network failure', async () => {
    mockFetchNetworkError()
    const client = makeClient()

    await expect(client.updatePosition('p1', 100)).rejects.toThrow(ApiError)
  })
})

// ==========================================================
// 管理者専用: おすすめサイト管理 CRUD
describe('listFeaturedSites', () => {
  test('sends GET to /api/backend/admin/featured-sites', async () => {
    mockFetchOk({ sites: [] })
    const client = makeClient()
    await client.listFeaturedSites()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/admin/featured-sites',
      expect.objectContaining({ method: 'GET' })
    )
  })

  test('returns FeaturedSourcesResponse with sites array', async () => {
    const response = {
      sites: [
        { id: 'hn', name: 'Hacker News', url: 'https://news.ycombinator.com', thumbnail_url: null, description: null },
      ],
    }
    mockFetchOk(response)
    const client = makeClient()
    const result = await client.listFeaturedSites()

    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].name).toBe('Hacker News')
  })

  test('throws ApiError on 403 Forbidden (non-admin)', async () => {
    mockFetchError(403, 'Only admin users can access this endpoint')
    const client = makeClient()

    await expect(client.listFeaturedSites()).rejects.toThrow(ApiError)
  })
})

describe('createFeaturedSite', () => {
  test('sends POST to /api/backend/admin/featured-sites with input body', async () => {
    mockFetchOk({ id: 'new-site', name: 'New Site', url: 'https://example.com' }, 201)
    const client = makeClient()
    const input = { name: 'New Site', url: 'https://example.com', description: 'A new site' }
    await client.createFeaturedSite(input)

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/admin/featured-sites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      })
    )
  })

  test('does not send order field in body', async () => {
    mockFetchOk({ id: 'new', name: 'Site', url: 'https://example.com' }, 201)
    const client = makeClient()
    await client.createFeaturedSite({ name: 'Site', url: 'https://example.com' })

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    const bodyStr = ((call[1] as unknown) as RequestInit).body as string
    const body = JSON.parse(bodyStr) as Record<string, unknown>
    expect(body.order).toBeUndefined()
  })

  test('returns created FeaturedSource', async () => {
    const created = {
      id: 'new',
      name: 'Test Site',
      url: 'https://test.com',
      thumbnail_url: 'https://test.com/thumb.png',
      description: 'Test',
    }
    mockFetchOk(created, 201)
    const client = makeClient()
    const result = await client.createFeaturedSite({ name: 'Test Site', url: 'https://test.com' })

    expect(result.id).toBe('new')
    expect(result.name).toBe('Test Site')
  })

  test('throws ApiError on 409 Conflict (duplicate id)', async () => {
    mockFetchError(409, 'Site with this ID already exists')
    const client = makeClient()

    await expect(client.createFeaturedSite({ name: 'Dup', url: 'https://dup.com' })).rejects.toThrow(
      ApiError
    )
  })
})

describe('updateFeaturedSite', () => {
  test('sends PUT to /api/backend/admin/featured-sites/{id} with update body', async () => {
    mockFetchOk({ id: 'hn', name: 'Updated HN', url: 'https://hn.com' })
    const client = makeClient()
    const input = { name: 'Updated HN', url: 'https://hn.com' }
    await client.updateFeaturedSite('hn', input)

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/admin/featured-sites/hn',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(input),
      })
    )
  })

  test('encodes id in path', async () => {
    mockFetchOk({ id: 'site-with/slash', name: 'Site', url: 'https://example.com' })
    const client = makeClient()
    await client.updateFeaturedSite('site-with/slash', { name: 'Site', url: 'https://example.com' })

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain(encodeURIComponent('site-with/slash'))
    expect(url).not.toContain('site-with/slash')
  })

  test('returns updated FeaturedSource', async () => {
    const updated = {
      id: 'hn',
      name: 'Hacker News',
      url: 'https://updated.hn.com',
      thumbnail_url: 'https://hn.com/thumb.png',
      description: 'Updated description',
    }
    mockFetchOk(updated)
    const client = makeClient()
    const result = await client.updateFeaturedSite('hn', {
      name: 'Hacker News',
      url: 'https://updated.hn.com',
    })

    expect(result.id).toBe('hn')
    expect(result.url).toBe('https://updated.hn.com')
  })

  test('throws ApiError on 404 Not Found', async () => {
    mockFetchError(404, 'Site not found')
    const client = makeClient()

    await expect(client.updateFeaturedSite('nonexistent', { name: 'N', url: 'https://n.com' })).rejects.toThrow(
      ApiError
    )
  })
})

describe('deleteFeaturedSite', () => {
  test('sends DELETE to /api/backend/admin/featured-sites/{id}', async () => {
    mockFetchOk({ status: 'deleted', id: 'hn' })
    const client = makeClient()
    await client.deleteFeaturedSite('hn')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/admin/featured-sites/hn',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  test('encodes id in path', async () => {
    mockFetchOk({ status: 'deleted', id: 'site-with/slash' })
    const client = makeClient()
    await client.deleteFeaturedSite('site-with/slash')

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    const url = call[0] as string
    expect(url).toContain(encodeURIComponent('site-with/slash'))
    expect(url).not.toContain('site-with/slash')
  })

  test('returns status and id', async () => {
    const response = { status: 'deleted', id: 'hn' }
    mockFetchOk(response)
    const client = makeClient()
    const result = await client.deleteFeaturedSite('hn')

    expect(result.status).toBe('deleted')
    expect(result.id).toBe('hn')
  })

  test('throws ApiError on 404 Not Found', async () => {
    mockFetchError(404, 'Site not found')
    const client = makeClient()

    await expect(client.deleteFeaturedSite('nonexistent')).rejects.toThrow(ApiError)
  })

  test('injects CSRF token for DELETE request', async () => {
    mockFetchOk({ status: 'deleted', id: 'hn' })
    document.cookie = 'csrf_token=delete-token'
    const client = makeClient()
    await client.deleteFeaturedSite('hn')

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = ((call[1] as unknown) as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('delete-token')
  })
})

// ==========================================================
describe('Security: API key is not logged', () => {
  test('console.log is not called during normal operations', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    const consoleSpy = vi.spyOn(console, 'log')
    const client = makeClient()
    await client.getFeed()

    // API key is now stored in server-only env vars, not in client-side calls
    // This test verifies no sensitive data is inadvertently logged
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

// ==========================================================
// CSRF token injection on state-changing methods
// ==========================================================
describe('CSRF token injection', () => {
  // Helper to clear jsdom cookies between tests
  function clearCookies() {
    document.cookie.split(';').forEach(c => {
      const name = c.trim().split('=')[0]
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    })
  }

  beforeEach(() => {
    clearCookies()
  })

  test('adds X-CSRF-Token header to POST when csrf_token cookie is present', async () => {
    mockFetchOk({ status: 'starred', article_id: 'a1' })
    document.cookie = 'csrf_token=secret-token'
    const client = makeClient()
    await client.starArticle('a1')

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('secret-token')
  })

  test('adds X-CSRF-Token header to PATCH when csrf_token cookie is present', async () => {
    const podcast = {
      id: 'p1',
      type: 'single',
      article_ids: ['a1'],
      difficulty: 'toeic_900',
      audio_url: 'https://storage.example.com/audio.mp3',
      japanese_intro_text: 'test',
      duration_seconds: 300,
      created_at: '2026-06-10T09:00:00+09:00',
      status: 'completed' as const,
      error_message: null,
      playback_position_seconds: 120,
    }
    mockFetchOk(podcast)
    document.cookie = 'csrf_token=patch-token'
    const client = makeClient()
    await client.updatePosition('p1', 150)

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('patch-token')
  })

  test('adds X-CSRF-Token header to PUT when csrf_token cookie is present', async () => {
    const prefs = {
      default_difficulty: 'toeic_900' as const,
      default_playback_speed: 1.0,
      digest_enabled: true,
      digest_article_count: 10,
    }
    mockFetchOk(prefs)
    document.cookie = 'csrf_token=put-token'
    const client = makeClient()
    await client.updatePreferences({ default_difficulty: 'toeic_900' })

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('put-token')
  })

  test('adds X-CSRF-Token header to DELETE when csrf_token cookie is present', async () => {
    mockFetchOk({ sources: [] })
    document.cookie = 'csrf_token=delete-token'
    const client = makeClient()
    await client.deleteSource('https://example.com/rss')

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('delete-token')
  })

  test('does NOT add X-CSRF-Token to GET even with csrf_token cookie', async () => {
    mockFetchOk({ articles: [], date: '2026-06-10' })
    document.cookie = 'csrf_token=secret-token'
    const client = makeClient()
    await client.getFeed()

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBeUndefined()
  })

  test('does NOT add X-CSRF-Token to POST when csrf_token cookie is absent', async () => {
    mockFetchOk({ status: 'starred', article_id: 'a1' })
    // no cookie set
    const client = makeClient()
    await client.starArticle('a1')

    const call = vi.mocked(fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBeUndefined()
  })
})

// ==========================================================
// getVapidPublicKey — GET /api/backend/notifications/vapid-public-key
// ==========================================================
describe('getVapidPublicKey', () => {
  test('GET /api/backend/notifications/vapid-public-key にリクエストを送る', async () => {
    mockFetchOk({ public_key: 'test-vapid-key-base64url' })
    const client = makeClient()
    await client.getVapidPublicKey()

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/notifications/vapid-public-key',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  test('public_key フィールドを含むレスポンスを返す', async () => {
    const key = 'BNVa2nUfxEMGkLfDNj3xRnqGqX3z12345'
    mockFetchOk({ public_key: key })
    const client = makeClient()
    const result = await client.getVapidPublicKey()

    expect(result.public_key).toBe(key)
  })
})

// ==========================================================
// subscribePush — POST /api/backend/notifications/subscriptions
// ==========================================================
describe('subscribePush', () => {
  test('POST /api/backend/notifications/subscriptions にリクエストを送る', async () => {
    mockFetchOk({}, 201)
    const client = makeClient()
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }
    await client.subscribePush(subscription)

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/notifications/subscriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    )
  })

  test('サブスクリプション JSON をリクエストボディに含める', async () => {
    mockFetchOk({}, 201)
    const client = makeClient()
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }
    await client.subscribePush(subscription)

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const body = JSON.parse((callArgs as RequestInit).body as string)
    expect(body).toEqual(subscription)
  })
})

// ==========================================================
// unsubscribePush — DELETE /api/backend/notifications/subscriptions
// ==========================================================
describe('unsubscribePush', () => {
  test('DELETE /api/backend/notifications/subscriptions にリクエストを送る', async () => {
    mockFetchOk({})
    const client = makeClient()
    await client.unsubscribePush('https://fcm.googleapis.com/fcm/send/test')

    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/notifications/subscriptions?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2Ftest',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    )
  })

  test('endpoint を URL エンコードしてクエリパラメータに含める', async () => {
    mockFetchOk({})
    const client = makeClient()
    const endpoint = 'https://fcm.googleapis.com/fcm/send/xyz'
    await client.unsubscribePush(endpoint)

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(
      `/api/backend/notifications/subscriptions?endpoint=${encodeURIComponent(endpoint)}`,
    )
    // DELETE はボディを持たない（クエリパラメータ規約）
    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(callArgs.body).toBeUndefined()
  })
})
