import { describe, test, expect, beforeEach, vi } from 'vitest'
// NOTE: Next.js の catch-all ルートファイルは [...path] をブラケット含みでインポートする
import { GET, POST, DELETE } from '@/app/api/backend/[...path]/route'

function makeRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Request {
  const url = `http://localhost/api/backend/${path}`
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ?? undefined,
  })
}

function makeContext(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) }
}

function mockBackendOk(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  )
}

function mockBackendNetworkError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ==========================================================
// 正常系: リクエスト転送
// ==========================================================
describe('GET — forwards request to backend', () => {
  test('forwards path segments to X-Backend-Base-Url', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'secret',
    })

    const res = await GET(req, makeContext(['health']))

    expect(res.status).toBe(200)
    const forwardedUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(forwardedUrl).toContain('https://api.example.com')
    expect(forwardedUrl).toContain('health')
  })

  test('passes through X-API-Key header to backend', async () => {
    mockBackendOk({ articles: [], date: '2026-06-10' })
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'my-key',
    })

    await GET(req, makeContext(['feed']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = forwardedInit.headers as Record<string, string>
    expect(headers['X-API-Key'] ?? (new Headers(forwardedInit.headers)).get('X-API-Key')).toBe('my-key')
  })

  test('preserves query string in forwarded URL', async () => {
    mockBackendOk({ sources: [] })
    const urlWithQuery = 'settings/sources?url=' + encodeURIComponent('https://example.com')
    const req = makeRequest('GET', urlWithQuery, {
      'X-Backend-Base-Url': 'https://api.example.com',
    })

    await GET(req, makeContext(['settings', 'sources']))

    const forwardedUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(forwardedUrl).toContain(encodeURIComponent('https://example.com'))
  })
})

describe('POST — forwards request body', () => {
  test('forwards POST body to backend', async () => {
    mockBackendOk({ sources: [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }] })
    const body = JSON.stringify({ name: 'HN', url: 'https://news.ycombinator.com/rss' })
    const req = makeRequest('POST', 'settings/sources', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    }, body)

    const res = await POST(req, makeContext(['settings', 'sources']))

    expect(res.status).toBe(200)
  })
})

describe('DELETE — forwards request', () => {
  test('forwards DELETE to backend', async () => {
    mockBackendOk({ sources: [] })
    const encodedUrl = encodeURIComponent('https://example.com/rss')
    const req = makeRequest('DELETE', `settings/sources?url=${encodedUrl}`, {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await DELETE(req, makeContext(['settings', 'sources']))

    expect(res.status).toBe(200)
  })
})

// ==========================================================
// 素通し: バックエンドのエラーステータスを変換しない
// ==========================================================
describe('Pass-through of backend status codes', () => {
  test('returns 401 as-is from backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Invalid or missing API key' }), { status: 401 })
      )
    )
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'wrong-key',
    })

    const res = await GET(req, makeContext(['feed']))

    expect(res.status).toBe(401)
  })

  test('returns 404 as-is from backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Podcast not found' }), { status: 404 })
      )
    )
    const req = makeRequest('GET', 'podcasts/missing-id', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['podcasts', 'missing-id']))

    expect(res.status).toBe(404)
  })

  test('returns 409 as-is from backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Source URL already exists' }), { status: 409 })
      )
    )
    const req = makeRequest('POST', 'settings/sources', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    }, JSON.stringify({ name: 'HN', url: 'https://example.com' }))

    const res = await POST(req, makeContext(['settings', 'sources']))

    expect(res.status).toBe(409)
  })
})

// ==========================================================
// 異常系: X-Backend-Base-Url 欠落 → 400
// ==========================================================
describe('Missing X-Backend-Base-Url header', () => {
  test('returns 400 when X-Backend-Base-Url header is absent', async () => {
    const req = makeRequest('GET', 'feed', {
      'X-API-Key': 'key',
      // X-Backend-Base-Url を意図的に省略
    })

    const res = await GET(req, makeContext(['feed']))

    expect(res.status).toBe(400)
  })
})

// ==========================================================
// 異常系: 不正スキーム → 400 (SSRF 緩和)
// ==========================================================
describe('Invalid scheme in X-Backend-Base-Url', () => {
  test('returns 400 for ftp:// scheme', async () => {
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': 'ftp://evil.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['feed']))

    expect(res.status).toBe(400)
  })

  test('returns 400 for file:// scheme', async () => {
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'file:///etc/passwd',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['health']))

    expect(res.status).toBe(400)
  })

  test('returns 400 for relative URL (no scheme)', async () => {
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': '/relative/path',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['feed']))

    expect(res.status).toBe(400)
  })

  test('accepts http:// scheme', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'http://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['health']))

    expect(res.status).toBe(200)
  })

  test('accepts https:// scheme', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['health']))

    expect(res.status).toBe(200)
  })
})

// ==========================================================
// 異常系: バックエンド到達不能 → 502
// ==========================================================
describe('Backend unreachable', () => {
  test('returns 502 when backend fetch rejects (network error)', async () => {
    mockBackendNetworkError()
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(req, makeContext(['feed']))

    expect(res.status).toBe(502)
  })
})
