import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  changePassword,
  deleteAccount,
  getMe,
  login,
  logout,
  register,
  updateProfile,
} from '@/lib/api/auth'
import { createUser, deleteUser, listUsers, updateUser } from '@/lib/api/admin'
import { createGateway } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'

function mockFetchResponse(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('login', () => {
  // credentials は gateway の責務だが、名前が主張するので実 gateway で保つ。
  test('POSTs credentials to /api/backend/auth/login with credentials included', async () => {
    const loginResponse = { token: 't', user: { username: 'alice', role: 'user', display_name: 'Alice' } }
    const fetchMock = mockFetchResponse(200, loginResponse)

    const res = await login(createGateway(), 'alice', 'pw')

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/backend/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ username: 'alice', password: 'pw' })
    // セッション Cookie 送受信のため credentials: 'include'
    expect(init.credentials).toBe('include')
    expect(res).toEqual({ ok: true, value: loginResponse })
  })

  test('returns a unauthorized failure on 401', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/login', { ok: false, failure: { kind: 'unauthorized' } })

    const res = await login(gw, 'x', 'y')

    expect(res).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
  })
})

describe('getMe', () => {
  test('GETs /api/backend/auth/me', async () => {
    const gw = createGatewayDouble()
    const me = { username: 'alice', role: 'admin', display_name: 'Alice' }
    gw.respond('GET', '/api/backend/auth/me', { ok: true, value: me })

    const res = await getMe(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/auth/me', body: undefined }])
    expect(res).toEqual({ ok: true, value: me })
  })
})

describe('logout', () => {
  test('POSTs /api/backend/auth/logout', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/logout', { ok: true, value: { status: 'ok' } })

    const res = await logout(gw)

    expect(gw.calls).toEqual([{ method: 'POST', path: '/api/backend/auth/logout', body: undefined }])
    expect(res).toEqual({ ok: true, value: { status: 'ok' } })
  })
})

describe('updateProfile / changePassword', () => {
  test('updateProfile PATCHes display_name', async () => {
    const gw = createGatewayDouble()
    const updated = { username: 'alice', role: 'user', display_name: 'New' }
    gw.respond('PATCH', '/api/backend/auth/me', { ok: true, value: updated })

    const res = await updateProfile(gw, 'New')

    expect(gw.calls).toEqual([{ method: 'PATCH', path: '/api/backend/auth/me', body: { display_name: 'New' } }])
    expect(res).toEqual({ ok: true, value: updated })
  })

  test('changePassword POSTs current/new passwords', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/password', { ok: true, value: { status: 'ok' } })

    const res = await changePassword(gw, 'old', 'new-password')

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/auth/password',
        body: { current_password: 'old', new_password: 'new-password' },
      },
    ])
    expect(res).toEqual({ ok: true, value: { status: 'ok' } })
  })
})

describe('deleteAccount', () => {
  test('DELETEs /api/backend/auth/me with current_password body', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/auth/me', { ok: true, value: undefined })

    const res = await deleteAccount(gw, 'current-pw')

    expect(gw.calls).toEqual([
      { method: 'DELETE', path: '/api/backend/auth/me', body: { current_password: 'current-pw' } },
    ])
    expect(res).toEqual({ ok: true, value: undefined })
  })

  // noContent は double に記録されないので、204 を成功にする経路は実 gateway で保つ。
  test('resolves without parsing a body on 204 No Content', async () => {
    mockFetchResponse(204)

    const res = await deleteAccount(createGateway(), 'current-pw')

    expect(res).toEqual({ ok: true, value: undefined })
  })

  test('returns a forbidden failure on 403 when the password is incorrect', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/auth/me', { ok: false, failure: { kind: 'forbidden' } })

    const res = await deleteAccount(gw, 'wrong')

    expect(res).toEqual({ ok: false, failure: { kind: 'forbidden' } })
  })

  test('returns a conflict failure on 409 when deleting the last admin', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/auth/me', { ok: false, failure: { kind: 'conflict' } })

    const res = await deleteAccount(gw, 'current-pw')

    expect(res).toEqual({ ok: false, failure: { kind: 'conflict' } })
  })
})

describe('register', () => {
  test('POSTs invite/username/password/display_name to /api/backend/auth/register with credentials included', async () => {
    const registered = { token: 't', user: { username: 'newbie', role: 'user', display_name: 'Newbie' } }
    const fetchMock = mockFetchResponse(201, registered)
    const input = {
      invite_code: 'INV123',
      username: 'newbie',
      password: 'Sup3r-Secret!!',
      display_name: 'Newbie',
    }

    const res = await register(createGateway(), input)

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/backend/auth/register')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(input)
    // セッション Cookie 送受信のため credentials: 'include'
    expect(init.credentials).toBe('include')
    expect(res).toEqual({ ok: true, value: registered })
  })

  test('omits invite_code/display_name from body when not provided', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/register', {
      ok: true,
      value: { token: 't', user: { username: 'newbie', role: 'user', display_name: 'newbie' } },
    })

    await register(gw, { username: 'newbie', password: 'Sup3r-Secret!!' })

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/auth/register',
        body: { username: 'newbie', password: 'Sup3r-Secret!!' },
      },
    ])
  })

  test('returns a conflict failure on 409 (username not available)', async () => {
    const gw = createGatewayDouble()
    gw.respond('POST', '/api/backend/auth/register', { ok: false, failure: { kind: 'conflict' } })

    const res = await register(gw, { username: 'taken', password: 'Sup3r-Secret!!' })

    expect(res).toEqual({ ok: false, failure: { kind: 'conflict' } })
  })

  test('returns a validation failure on 400 (invalid or expired invite)', async () => {
    const gw = createGatewayDouble()
    const failure = { kind: 'validation', reason: 'rule', detail: 'Invalid or expired invite' } as const
    gw.respond('POST', '/api/backend/auth/register', { ok: false, failure })

    const res = await register(gw, { invite_code: 'BAD', username: 'newbie', password: 'Sup3r-Secret!!' })

    expect(res).toEqual({ ok: false, failure })
  })
})

describe('admin user management', () => {
  test('listUsers GETs /api/backend/admin/users', async () => {
    const gw = createGatewayDouble()
    gw.respond('GET', '/api/backend/admin/users', { ok: true, value: { users: [] } })

    const res = await listUsers(gw)

    expect(gw.calls).toEqual([{ method: 'GET', path: '/api/backend/admin/users', body: undefined }])
    expect(res).toEqual({ ok: true, value: { users: [] } })
  })

  test('createUser POSTs to /api/backend/admin/users', async () => {
    const gw = createGatewayDouble()
    const input = { username: 'carol', password: 'carol-pass', role: 'user' as const }
    const created = { username: 'carol', role: 'user', display_name: 'carol' }
    gw.respond('POST', '/api/backend/admin/users', { ok: true, value: created })

    const res = await createUser(gw, input)

    expect(gw.calls).toEqual([{ method: 'POST', path: '/api/backend/admin/users', body: input }])
    expect(res).toEqual({ ok: true, value: created })
  })

  test('updateUser PATCHes the username-scoped path', async () => {
    const gw = createGatewayDouble()
    const updated = { username: 'bob', role: 'admin', display_name: 'Bob' }
    gw.respond('PATCH', '/api/backend/admin/users/bob', { ok: true, value: updated })

    const res = await updateUser(gw, 'bob', { role: 'admin' })

    expect(gw.calls).toEqual([{ method: 'PATCH', path: '/api/backend/admin/users/bob', body: { role: 'admin' } }])
    expect(res).toEqual({ ok: true, value: updated })
  })

  test('deleteUser DELETEs the username-scoped path', async () => {
    const gw = createGatewayDouble()
    gw.respond('DELETE', '/api/backend/admin/users/bob', { ok: true, value: { status: 'deleted', username: 'bob' } })

    const res = await deleteUser(gw, 'bob')

    expect(gw.calls).toEqual([{ method: 'DELETE', path: '/api/backend/admin/users/bob', body: undefined }])
    expect(res).toEqual({ ok: true, value: { status: 'deleted', username: 'bob' } })
  })
})
