// Account infrastructure の accountGateway: port AccountGateway を ApiGateway の上に実装する（DTO → AuthSessionUser・SessionRow・PasskeyRow・{ revoked }、options の JSON.parse）。
// path・method・body は lib/api/auth.ts のまま。失敗の ApiFailure は同じ object を返す。
// adapter のテスト: `createGatewayDouble` を使い、domain・application の値は import しない（期待値は literal ＋ `import type`）。
//
// RED 理由（実装前）: `@/lib/account/infrastructure/accountGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAccountGateway } from '@/lib/account/infrastructure/accountGateway'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const BASE = '/api/backend/auth'
const FAILURE: ApiFailure = { kind: 'server', status: 503 }
const DTO_USER = { user_id: 'u-alice', username: 'alice', role: 'admin', display_name: 'Alice' }
const MAPPED_USER = { username: 'alice', role: 'admin', display_name: 'Alice', userId: 'u-alice' }

function setup() {
  const gw = createGatewayDouble()
  return { gw, account: createAccountGateway(gw) }
}

describe('createAccountGateway: user の写し（getMe・login・register・verifyPasskeyLogin）', () => {
  test('web-slice-account-01 — getMe は GET /auth/me を 1 回呼び、user_id を userId にした 4 key に写す', async () => {
    const { gw, account } = setup()
    gw.respond('GET', `${BASE}/me`, { ok: true, value: DTO_USER })

    const result = await account.getMe()

    expect(gw.calls).toEqual([{ method: 'GET', path: `${BASE}/me`, body: undefined }])
    expect(result).toEqual({ ok: true, value: MAPPED_USER })
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(['display_name', 'role', 'userId', 'username'])
  })

  test('web-slice-account-01 — user_id が形式不正または欠落なら userId は null（getMe）', async () => {
    const bad = setup()
    bad.gw.respond('GET', `${BASE}/me`, { ok: true, value: { ...DTO_USER, user_id: 'bad id' } })
    expect(await bad.account.getMe()).toEqual({ ok: true, value: { ...MAPPED_USER, userId: null } })

    const missing = setup()
    const { user_id: _omit, ...withoutId } = DTO_USER
    void _omit
    missing.gw.respond('GET', `${BASE}/me`, { ok: true, value: withoutId })
    expect(await missing.account.getMe()).toEqual({ ok: true, value: { ...MAPPED_USER, userId: null } })
  })

  test('web-slice-account-01 — login は POST /auth/login の body が { username, password } で、応答の user を写す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/login`, { ok: true, value: { token: 't', user: DTO_USER } })

    const result = await account.login('alice', 'pw')

    expect(gw.calls).toEqual([{ method: 'POST', path: `${BASE}/login`, body: { username: 'alice', password: 'pw' } }])
    expect(result).toEqual({ ok: true, value: MAPPED_USER })
  })

  test('web-slice-account-01 — register は POST /auth/register で、invite_code・display_name が空なら body に含めない。応答の user を写す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/register`, { ok: true, value: { token: 't', user: DTO_USER } })

    const minimal = await account.register({ username: 'alice', password: 'pw' })
    const full = await account.register({ invite_code: 'INV', username: 'alice', password: 'pw', display_name: 'Alice' })

    expect(gw.calls).toEqual([
      { method: 'POST', path: `${BASE}/register`, body: { username: 'alice', password: 'pw' } },
      {
        method: 'POST',
        path: `${BASE}/register`,
        body: { username: 'alice', password: 'pw', invite_code: 'INV', display_name: 'Alice' },
      },
    ])
    expect(minimal).toEqual({ ok: true, value: MAPPED_USER })
    expect(full).toEqual({ ok: true, value: MAPPED_USER })
  })

  test('web-slice-account-01 — verifyPasskeyLogin は POST /auth/passkey/login/verify の body が { challenge_id, credential } で、{ token, user: 写し } を返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/passkey/login/verify`, { ok: true, value: { token: 'tok', user: DTO_USER } })

    const result = await account.verifyPasskeyLogin('cid', { id: 'cred' })

    expect(gw.calls).toEqual([
      { method: 'POST', path: `${BASE}/passkey/login/verify`, body: { challenge_id: 'cid', credential: { id: 'cred' } } },
    ])
    expect(result).toEqual({ ok: true, value: { token: 'tok', user: MAPPED_USER } })
  })

  test('web-slice-account-01 — 失敗は ApiFailure を変えずに（同じ object を）返す', async () => {
    const { gw, account } = setup()
    gw.respond('GET', `${BASE}/me`, { ok: false, failure: FAILURE })
    gw.respond('POST', `${BASE}/login`, { ok: false, failure: FAILURE })
    gw.respond('POST', `${BASE}/register`, { ok: false, failure: FAILURE })
    gw.respond('POST', `${BASE}/passkey/login/verify`, { ok: false, failure: FAILURE })

    for (const result of [
      await account.getMe(),
      await account.login('a', 'b'),
      await account.register({ username: 'a', password: 'b' }),
      await account.verifyPasskeyLogin('c', {}),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe(FAILURE)
    }
  })
})

describe('createAccountGateway: passkey の options（JSON.parse はここだけ）', () => {
  const OPTIONS = { challenge: 'abc', rp: { name: 'rp' }, timeout: 60000 }

  test('web-slice-account-01 — 登録・ログインの options の JSON 文字列を object にして { challenge_id, options } を返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/passkey/register/options`, {
      ok: true,
      value: { challenge_id: 'cid-r', options: JSON.stringify(OPTIONS) },
    })
    gw.respond('POST', `${BASE}/passkey/login/options`, {
      ok: true,
      value: { challenge_id: 'cid-l', options: JSON.stringify(OPTIONS) },
    })

    const register = await account.getPasskeyRegisterOptions()
    const login = await account.getPasskeyLoginOptions()

    expect(gw.calls).toEqual([
      { method: 'POST', path: `${BASE}/passkey/register/options`, body: undefined },
      { method: 'POST', path: `${BASE}/passkey/login/options`, body: undefined },
    ])
    expect(register).toEqual({ ok: true, value: { challenge_id: 'cid-r', options: OPTIONS } })
    expect(login).toEqual({ ok: true, value: { challenge_id: 'cid-l', options: OPTIONS } })
  })

  test('web-slice-account-01 — 不正な JSON の options は例外を呼び手へ伝える（reject）', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/passkey/register/options`, { ok: true, value: { challenge_id: 'c', options: '{not json' } })
    gw.respond('POST', `${BASE}/passkey/login/options`, { ok: true, value: { challenge_id: 'c', options: '{not json' } })

    await expect(account.getPasskeyRegisterOptions()).rejects.toThrow(SyntaxError)
    await expect(account.getPasskeyLoginOptions()).rejects.toThrow(SyntaxError)
  })

  test('web-slice-account-01 — options の API が失敗したら parse せずその failure を返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/passkey/register/options`, { ok: false, failure: FAILURE })
    gw.respond('POST', `${BASE}/passkey/login/options`, { ok: false, failure: FAILURE })

    for (const result of [await account.getPasskeyRegisterOptions(), await account.getPasskeyLoginOptions()]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe(FAILURE)
    }
  })

  test('web-slice-account-01 — verifyPasskeyRegistration は POST /auth/passkey/register/verify の body が { challenge_id, credential } で、{ status } をそのまま返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/passkey/register/verify`, { ok: true, value: { status: 'ok' } })

    const result = await account.verifyPasskeyRegistration('cid', { id: 'cred' })

    expect(gw.calls).toEqual([
      { method: 'POST', path: `${BASE}/passkey/register/verify`, body: { challenge_id: 'cid', credential: { id: 'cred' } } },
    ])
    expect(result).toEqual({ ok: true, value: { status: 'ok' } })
  })
})

describe('createAccountGateway: 管理系の request と戻り値', () => {
  test('web-slice-account-01 — 6 つの操作の path・method・body が lib/api/auth.ts のまま、成功は undefined', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/logout`, { ok: true, value: { status: 'ok' } })
    gw.respond('PATCH', `${BASE}/me`, { ok: true, value: DTO_USER })
    gw.respond('POST', `${BASE}/password`, { ok: true, value: { status: 'ok' } })
    gw.respond('DELETE', `${BASE}/me`, { ok: true, value: undefined })
    gw.respond('DELETE', `${BASE}/passkey/credentials/a%2Fb%20c`, { ok: true, value: { status: 'ok' } })
    gw.respond('DELETE', `${BASE}/sessions/s%2F1`, { ok: true, value: { status: 'ok' } })

    const results = [
      await account.logout(),
      await account.updateProfile('新しい名前'),
      await account.changePassword('cur', 'next'),
      await account.deleteAccount('pw'),
      await account.deletePasskey('a/b c'),
      await account.revokeSession('s/1'),
    ]

    expect(gw.calls).toEqual([
      { method: 'POST', path: `${BASE}/logout`, body: undefined },
      { method: 'PATCH', path: `${BASE}/me`, body: { display_name: '新しい名前' } },
      { method: 'POST', path: `${BASE}/password`, body: { current_password: 'cur', new_password: 'next' } },
      { method: 'DELETE', path: `${BASE}/me`, body: { current_password: 'pw' } },
      { method: 'DELETE', path: `${BASE}/passkey/credentials/a%2Fb%20c`, body: undefined },
      { method: 'DELETE', path: `${BASE}/sessions/s%2F1`, body: undefined },
    ])
    for (const result of results) expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-slice-account-01 — 6 つの操作の失敗は同じ failure をそのまま返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/logout`, { ok: false, failure: FAILURE })
    gw.respond('PATCH', `${BASE}/me`, { ok: false, failure: FAILURE })
    gw.respond('POST', `${BASE}/password`, { ok: false, failure: FAILURE })
    gw.respond('DELETE', `${BASE}/me`, { ok: false, failure: FAILURE })
    gw.respond('DELETE', `${BASE}/passkey/credentials/c`, { ok: false, failure: FAILURE })
    gw.respond('DELETE', `${BASE}/sessions/s`, { ok: false, failure: FAILURE })

    for (const result of [
      await account.logout(),
      await account.updateProfile('n'),
      await account.changePassword('a', 'b'),
      await account.deleteAccount('p'),
      await account.deletePasskey('c'),
      await account.revokeSession('s'),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe(FAILURE)
    }
  })
})

describe('createAccountGateway: 一覧の row の写し', () => {
  test('web-slice-account-01 — listPasskeys は credentials を PasskeyRow に写す（name・last_used_at が null と欠落のとき null、順序は応答のまま）', async () => {
    const { gw, account } = setup()
    gw.respond('GET', `${BASE}/passkey/credentials`, {
      ok: true,
      value: {
        credentials: [
          {
            credential_id: 'c2',
            username: 'alice',
            name: 'MacBook',
            transports: ['internal'],
            aaguid: 'x',
            sign_count: 3,
            created_at: '2026-02-02T00:00:00Z',
            last_used_at: '2026-02-03T00:00:00Z',
          },
          {
            credential_id: 'c1',
            username: 'alice',
            name: null,
            transports: [],
            aaguid: null,
            sign_count: 0,
            created_at: '2026-02-01T00:00:00Z',
            last_used_at: null,
          },
          { credential_id: 'c0', created_at: '2026-01-01T00:00:00Z' },
        ],
      },
    })

    const result = await account.listPasskeys()

    expect(gw.calls).toEqual([{ method: 'GET', path: `${BASE}/passkey/credentials`, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: [
        { credentialId: 'c2', name: 'MacBook', createdAt: '2026-02-02T00:00:00Z', lastUsedAt: '2026-02-03T00:00:00Z' },
        { credentialId: 'c1', name: null, createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null },
        { credentialId: 'c0', name: null, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null },
      ],
    })
  })

  test('web-slice-account-01 — listSessions は sessions を SessionRow に写す（device_label・last_used_at の null と欠落は null、current → isCurrent、順序は応答のまま）', async () => {
    const { gw, account } = setup()
    gw.respond('GET', `${BASE}/sessions`, {
      ok: true,
      value: {
        sessions: [
          { id: 's2', device_label: 'Chrome', created_at: '2026-01-02T00:00:00Z', last_used_at: '2026-01-03T00:00:00Z', current: true },
          { id: 's1', device_label: null, created_at: '2026-01-01T00:00:00Z', last_used_at: null, current: false },
          { id: 's0', created_at: '2026-01-01T00:00:00Z', current: false },
        ],
      },
    })

    const result = await account.listSessions()

    expect(gw.calls).toEqual([{ method: 'GET', path: `${BASE}/sessions`, body: undefined }])
    expect(result).toEqual({
      ok: true,
      value: [
        { id: 's2', deviceLabel: 'Chrome', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: '2026-01-03T00:00:00Z', isCurrent: true },
        { id: 's1', deviceLabel: null, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, isCurrent: false },
        { id: 's0', deviceLabel: null, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, isCurrent: false },
      ],
    })
  })

  test('web-slice-account-01 — 一覧の失敗はそのまま返す', async () => {
    const { gw, account } = setup()
    gw.respond('GET', `${BASE}/passkey/credentials`, { ok: false, failure: FAILURE })
    gw.respond('GET', `${BASE}/sessions`, { ok: false, failure: FAILURE })

    for (const result of [await account.listPasskeys(), await account.listSessions()]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe(FAILURE)
    }
  })

  test('web-slice-account-01 — revokeOtherSessions は POST /auth/sessions/revoke-others で revoked_count を { revoked } に写し、失敗はそのまま返す', async () => {
    const { gw, account } = setup()
    gw.respond('POST', `${BASE}/sessions/revoke-others`, { ok: true, value: { revoked_count: 3 } })

    expect(await account.revokeOtherSessions()).toEqual({ ok: true, value: { revoked: 3 } })
    expect(gw.calls).toEqual([{ method: 'POST', path: `${BASE}/sessions/revoke-others`, body: undefined }])

    gw.respond('POST', `${BASE}/sessions/revoke-others`, { ok: false, failure: FAILURE })
    const failed = await account.revokeOtherSessions()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.failure).toBe(FAILURE)
  })
})
