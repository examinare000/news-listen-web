import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
// NOTE: Next.js の catch-all ルートファイルは [...path] をブラケット含みでインポートする
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/backend/[...path]/route'

// パターン B: 型キャストのみ（ランタイム挙動を変えずに型エラーを解消）
const asNextRequest = (req: Request) => req as unknown as NextRequest

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

    const res = await GET(asNextRequest(req), makeContext(['health']))

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

    await GET(asNextRequest(req), makeContext(['feed']))

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

    await GET(asNextRequest(req), makeContext(['settings', 'sources']))

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

    const res = await POST(asNextRequest(req), makeContext(['settings', 'sources']))

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

    const res = await DELETE(asNextRequest(req), makeContext(['settings', 'sources']))

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

    const res = await GET(asNextRequest(req), makeContext(['feed']))

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

    const res = await GET(asNextRequest(req), makeContext(['podcasts', 'missing-id']))

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

    const res = await POST(asNextRequest(req), makeContext(['settings', 'sources']))

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

    const res = await GET(asNextRequest(req), makeContext(['feed']))

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

    const res = await GET(asNextRequest(req), makeContext(['feed']))

    expect(res.status).toBe(400)
  })

  test('returns 400 for file:// scheme', async () => {
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'file:///etc/passwd',
      'X-API-Key': 'key',
    })

    const res = await GET(asNextRequest(req), makeContext(['health']))

    expect(res.status).toBe(400)
  })

  test('returns 400 for relative URL (no scheme)', async () => {
    const req = makeRequest('GET', 'feed', {
      'X-Backend-Base-Url': '/relative/path',
      'X-API-Key': 'key',
    })

    const res = await GET(asNextRequest(req), makeContext(['feed']))

    expect(res.status).toBe(400)
  })

  test('accepts http:// scheme', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'http://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(asNextRequest(req), makeContext(['health']))

    expect(res.status).toBe(200)
  })

  test('accepts https:// scheme', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('GET', 'health', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    })

    const res = await GET(asNextRequest(req), makeContext(['health']))

    expect(res.status).toBe(200)
  })
})

// ==========================================================
// PATCH — 転送
// ==========================================================
describe('PATCH — forwards request', () => {
  test('forwards PATCH body to backend', async () => {
    mockBackendOk({ username: 'alice', role: 'user', display_name: 'New' })
    const req = makeRequest(
      'PATCH',
      'auth/me',
      { 'X-Backend-Base-Url': 'https://api.example.com', 'X-API-Key': 'key' },
      JSON.stringify({ display_name: 'New' }),
    )
    const res = await PATCH(asNextRequest(req), makeContext(['auth', 'me']))
    expect(res.status).toBe(200)
    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(forwardedInit.method).toBe('PATCH')
  })
})

// ==========================================================
// PUT — 転送（updatePreferences が PUT を使うため必須）
// ==========================================================
describe('PUT — forwards request', () => {
  test('forwards PUT body to backend (settings/preferences)', async () => {
    mockBackendOk({ default_difficulty: 'toeic_900' })
    const req = makeRequest(
      'PUT',
      'settings/preferences',
      { 'X-Backend-Base-Url': 'https://api.example.com', 'X-API-Key': 'key' },
      JSON.stringify({ default_difficulty: 'toeic_900' }),
    )
    const res = await PUT(asNextRequest(req), makeContext(['settings', 'preferences']))
    expect(res.status).toBe(200)
    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(forwardedInit.method).toBe('PUT')
  })
})

// ==========================================================
// セッション Cookie の中継
// ==========================================================
describe('Session cookie relay', () => {
  test('forwards incoming Cookie header to backend', async () => {
    mockBackendOk({ username: 'alice', role: 'user', display_name: 'Alice' })
    const req = makeRequest('GET', 'auth/me', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
      Cookie: 'nl_session=raw-token',
    })

    await GET(asNextRequest(req), makeContext(['auth', 'me']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = new Headers(forwardedInit.headers)
    expect(headers.get('Cookie')).toBe('nl_session=raw-token')
  })

  test('relays backend Set-Cookie to the browser response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ token: 't', user: { username: 'alice', role: 'user', display_name: 'Alice' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'set-cookie': 'nl_session=raw-token; Path=/; HttpOnly; SameSite=Lax',
          },
        }),
      ),
    )
    const req = makeRequest(
      'POST',
      'auth/login',
      { 'X-Backend-Base-Url': 'https://api.example.com', 'X-API-Key': 'key' },
      JSON.stringify({ username: 'alice', password: 'pw' }),
    )

    const res = await POST(asNextRequest(req), makeContext(['auth', 'login']))

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('nl_session=raw-token')
    expect(setCookie).toContain('HttpOnly')
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

    const res = await GET(asNextRequest(req), makeContext(['feed']))

    expect(res.status).toBe(502)
  })
})

// ==========================================================
// CSRF token forwarding
// ==========================================================
describe('CSRF token forwarding', () => {
  test('forwards X-CSRF-Token header to backend when present', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('POST', 'settings/sources', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
      'X-CSRF-Token': 'csrf-token-123',
    }, JSON.stringify({ name: 'HN' }))

    await POST(asNextRequest(req), makeContext(['settings', 'sources']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = forwardedInit.headers as Record<string, string>
    expect(headers['X-CSRF-Token'] ?? (new Headers(forwardedInit.headers)).get('X-CSRF-Token')).toBe('csrf-token-123')
  })

  test('does not add X-CSRF-Token header when absent from request', async () => {
    mockBackendOk({ status: 'ok' })
    const req = makeRequest('POST', 'settings/sources', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
    }, JSON.stringify({ name: 'HN' }))

    await POST(asNextRequest(req), makeContext(['settings', 'sources']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = new Headers(forwardedInit.headers)
    expect(headers.has('X-CSRF-Token')).toBe(false)
  })

  test('forwards X-CSRF-Token on state-changing methods (PATCH)', async () => {
    mockBackendOk({ username: 'alice' })
    const req = makeRequest('PATCH', 'auth/me', {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
      'X-CSRF-Token': 'csrf-abc',
    }, JSON.stringify({ display_name: 'New' }))

    await PATCH(asNextRequest(req), makeContext(['auth', 'me']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = forwardedInit.headers as Record<string, string>
    expect(headers['X-CSRF-Token'] ?? (new Headers(forwardedInit.headers)).get('X-CSRF-Token')).toBe('csrf-abc')
  })

  test('forwards X-CSRF-Token on DELETE', async () => {
    mockBackendOk({ sources: [] })
    const encodedUrl = encodeURIComponent('https://example.com/rss')
    const req = makeRequest('DELETE', `settings/sources?url=${encodedUrl}`, {
      'X-Backend-Base-Url': 'https://api.example.com',
      'X-API-Key': 'key',
      'X-CSRF-Token': 'csrf-xyz',
    })

    await DELETE(asNextRequest(req), makeContext(['settings', 'sources']))

    const forwardedInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const headers = forwardedInit.headers as Record<string, string>
    expect(headers['X-CSRF-Token'] ?? (new Headers(forwardedInit.headers)).get('X-CSRF-Token')).toBe('csrf-xyz')
  })
})
