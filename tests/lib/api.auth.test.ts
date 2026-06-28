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
    }),
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

describe('login', () => {
  test('POSTs credentials to /api/backend/auth/login with credentials included', async () => {
    mockFetchOk({ token: 't', user: { username: 'alice', role: 'user', display_name: 'Alice' } })
    const res = await makeClient().login('alice', 'pw')

    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ username: 'alice', password: 'pw' })
    // セッション Cookie 送受信のため credentials: 'include'
    expect(init.credentials).toBe('include')
    expect(res.user.username).toBe('alice')
  })

  test('throws ApiError on 401', async () => {
    mockFetchError(401, 'Invalid username or password')
    await expect(makeClient().login('x', 'y')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getMe', () => {
  test('GETs /api/backend/auth/me', async () => {
    mockFetchOk({ username: 'alice', role: 'admin', display_name: 'Alice' })
    const me = await makeClient().getMe()
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/me')
    expect(init.method).toBe('GET')
    expect(me.role).toBe('admin')
  })
})

describe('logout', () => {
  test('POSTs /api/backend/auth/logout', async () => {
    mockFetchOk({ status: 'ok' })
    await makeClient().logout()
    expect(lastCall().path).toBe('/api/backend/auth/logout')
    expect(lastCall().init.method).toBe('POST')
  })
})

describe('updateProfile / changePassword', () => {
  test('updateProfile PATCHes display_name', async () => {
    mockFetchOk({ username: 'alice', role: 'user', display_name: 'New' })
    await makeClient().updateProfile('New')
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/me')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ display_name: 'New' })
  })

  test('changePassword POSTs current/new passwords', async () => {
    mockFetchOk({ status: 'ok' })
    await makeClient().changePassword('old', 'new-password')
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/auth/password')
    expect(JSON.parse(init.body as string)).toEqual({
      current_password: 'old',
      new_password: 'new-password',
    })
  })
})

describe('admin user management', () => {
  test('listUsers GETs /api/backend/admin/users', async () => {
    mockFetchOk({ users: [] })
    await makeClient().listUsers()
    expect(lastCall().path).toBe('/api/backend/admin/users')
  })

  test('createUser POSTs to /api/backend/admin/users', async () => {
    mockFetchOk({ username: 'carol', role: 'user', display_name: 'carol' })
    await makeClient().createUser({ username: 'carol', password: 'carol-pass', role: 'user' })
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/users')
    expect(init.method).toBe('POST')
  })

  test('updateUser PATCHes the username-scoped path', async () => {
    mockFetchOk({ username: 'bob', role: 'admin', display_name: 'Bob' })
    await makeClient().updateUser('bob', { role: 'admin' })
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/users/bob')
    expect(init.method).toBe('PATCH')
  })

  test('deleteUser DELETEs the username-scoped path', async () => {
    mockFetchOk({ status: 'deleted', username: 'bob' })
    await makeClient().deleteUser('bob')
    const { path, init } = lastCall()
    expect(path).toBe('/api/backend/admin/users/bob')
    expect(init.method).toBe('DELETE')
  })
})
