// Account application の query（web-query-account-03・04）: listSessions・listPasskeys。
// 手書きの AccountGateway fake を渡す。`createAccountGateway`・`createGatewayDouble` は import しない。
// 成功は呼ぶたびに新しい凍結済みの配列（gateway の値と参照を共有しない）。失敗は gateway の Result をそのまま返す。
//
// RED 理由（実装前）: `@/lib/account/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAccountQueries } from '@/lib/account/application/queries'
import type { AccountGateway } from '@/lib/account/application/ports'
import type { PasskeyRow, SessionRow } from '@/lib/account/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

const SESSIONS: SessionRow[] = [
  { id: 's1', deviceLabel: 'Chrome', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-02T00:00:00Z', isCurrent: true },
  { id: 's2', deviceLabel: null, createdAt: '2026-01-03T00:00:00Z', lastUsedAt: null, isCurrent: false },
]
const PASSKEYS: PasskeyRow[] = [
  { credentialId: 'c1', name: 'MacBook', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null },
  { credentialId: 'c2', name: null, createdAt: '2026-02-02T00:00:00Z', lastUsedAt: '2026-02-03T00:00:00Z' },
]

function harness(overrides: {
  listSessions?: () => Promise<Result<ReadonlyArray<SessionRow>, ApiFailure>>
  listPasskeys?: () => Promise<Result<ReadonlyArray<PasskeyRow>, ApiFailure>>
} = {}) {
  const calls: string[] = []
  const unexpected = (name: string) => () => {
    calls.push(name)
    return Promise.reject(new Error(`${name} を想定していない`))
  }
  const gateway: AccountGateway = {
    getMe: unexpected('getMe'),
    login: unexpected('login'),
    register: unexpected('register'),
    logout: unexpected('logout'),
    getPasskeyRegisterOptions: unexpected('getPasskeyRegisterOptions'),
    getPasskeyLoginOptions: unexpected('getPasskeyLoginOptions'),
    verifyPasskeyRegistration: unexpected('verifyPasskeyRegistration'),
    verifyPasskeyLogin: unexpected('verifyPasskeyLogin'),
    updateProfile: unexpected('updateProfile'),
    changePassword: unexpected('changePassword'),
    deleteAccount: unexpected('deleteAccount'),
    deletePasskey: unexpected('deletePasskey'),
    revokeSession: unexpected('revokeSession'),
    revokeOtherSessions: unexpected('revokeOtherSessions'),
    listSessions: () => {
      calls.push('listSessions')
      return overrides.listSessions?.() ?? Promise.resolve({ ok: true, value: SESSIONS })
    },
    listPasskeys: () => {
      calls.push('listPasskeys')
      return overrides.listPasskeys?.() ?? Promise.resolve({ ok: true, value: PASSKEYS })
    },
  }
  return { queries: createAccountQueries({ gateway }), calls }
}

describe('web-query-account-03 listSessions', () => {
  test('web-query-account-03 — gateway の listSessions を 1 回だけ呼び、row の field を写して順序を保つ', async () => {
    const { queries, calls } = harness()
    const result = await queries.listSessions()
    expect(calls).toEqual(['listSessions'])
    expect(result).toEqual({ ok: true, value: SESSIONS })
  })

  test('web-query-account-03 — 失敗は gateway の Result をそのまま返す（複製しない）', async () => {
    const failed: Result<ReadonlyArray<SessionRow>, ApiFailure> = { ok: false, failure: { kind: 'server', status: 500 } }
    const { queries } = harness({ listSessions: () => Promise.resolve(failed) })
    expect(await queries.listSessions()).toBe(failed)
  })

  test('web-query-account-03 — 2 回呼ぶと別の凍結済みの値で、gateway の配列・row と参照を共有しない', async () => {
    const { queries } = harness()
    const first = await queries.listSessions()
    const second = await queries.listSessions()
    if (!first.ok || !second.ok) throw new Error('成功を期待')
    expect(first.value).not.toBe(second.value)
    expect(first.value).not.toBe(SESSIONS)
    expect(first.value[0]).not.toBe(SESSIONS[0])
    expect(first.value[0]).not.toBe(second.value[0])
    expect(Object.isFrozen(first.value)).toBe(true)
    expect(Object.isFrozen(first.value[0])).toBe(true)
  })

  test('web-query-account-03 — reject は握りつぶさず伝える', async () => {
    const { queries } = harness({ listSessions: () => Promise.reject(new Error('boom')) })
    await expect(queries.listSessions()).rejects.toThrow('boom')
  })
})

describe('web-query-account-04 listPasskeys', () => {
  test('web-query-account-04 — gateway の listPasskeys を 1 回だけ呼び、row の field を写して順序を保つ', async () => {
    const { queries, calls } = harness()
    const result = await queries.listPasskeys()
    expect(calls).toEqual(['listPasskeys'])
    expect(result).toEqual({ ok: true, value: PASSKEYS })
  })

  test('web-query-account-04 — 失敗は gateway の Result をそのまま返す（複製しない）', async () => {
    const failed: Result<ReadonlyArray<PasskeyRow>, ApiFailure> = { ok: false, failure: { kind: 'unauthorized' } }
    const { queries } = harness({ listPasskeys: () => Promise.resolve(failed) })
    expect(await queries.listPasskeys()).toBe(failed)
  })

  test('web-query-account-04 — 2 回呼ぶと別の凍結済みの値で、gateway の配列・row と参照を共有しない', async () => {
    const { queries } = harness()
    const first = await queries.listPasskeys()
    const second = await queries.listPasskeys()
    if (!first.ok || !second.ok) throw new Error('成功を期待')
    expect(first.value).not.toBe(second.value)
    expect(first.value).not.toBe(PASSKEYS)
    expect(first.value[0]).not.toBe(PASSKEYS[0])
    expect(first.value[0]).not.toBe(second.value[0])
    expect(Object.isFrozen(first.value)).toBe(true)
    expect(Object.isFrozen(first.value[0])).toBe(true)
  })

  test('web-query-account-04 — reject は握りつぶさず伝える', async () => {
    const { queries } = harness({ listPasskeys: () => Promise.reject(new Error('boom')) })
    await expect(queries.listPasskeys()).rejects.toThrow('boom')
  })
})
