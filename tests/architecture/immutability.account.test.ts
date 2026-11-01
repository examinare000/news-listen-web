// @vitest-environment node
// Account の判別共用体と PasswordCheck の不変性（web-check-06）。渡した入力を後から書き換えても戻り値は変わらず、
// 戻り値（入れ子を含む）は凍結されていることを検証する。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-06。
// verifies: web-contract-18
//
// 分類の理由: DOMAIN の authSession.ts・password.ts を値で import するので、台帳の unit 分類で固定される。
//
// RED 理由（実装前）: `@/lib/account/domain/authSession`・`@/lib/account/domain/password` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { RESOLVING_SESSION, reduce, type AuthSession } from '@/lib/account/domain/authSession'
import { validatePassword } from '@/lib/account/domain/password'

// ---------------------------------------------------------------------------
// 深い凍結の検査 helper: plain object と配列をすべての深さで辿る（関数は辿らない）。
// ---------------------------------------------------------------------------
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function unfrozenNodes(value: unknown, where = '$'): string[] {
  const found: string[] = []
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    ;(value as unknown[]).forEach((item, index) => found.push(...unfrozenNodes(item, `${where}[${index}]`)))
  } else if (isPlain(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    for (const [key, child] of Object.entries(value)) {
      found.push(...unfrozenNodes(child, `${where}.${key}`))
    }
  }
  return found
}

function expectDeeplyFrozen(label: string, value: unknown): void {
  expect(unfrozenNodes(value, label), `${label} に凍結されていない node がある`).toEqual([])
}

describe('web-check-06 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
  })
})

describe('reduce: authenticated の user は入力の複製で、入れ子まで凍結する (verifies: web-contract-18)', () => {
  test('resolved(user) の結果は、入力 user を後から書き換えても変わらない', () => {
    const user = { username: 'alice', role: 'user' as 'admin' | 'user', display_name: 'Alice' }
    const next = reduce(RESOLVING_SESSION, { type: 'resolved', user })

    user.username = 'mallory'
    user.role = 'admin'
    user.display_name = 'Mallory'

    expect(next).toEqual({
      kind: 'authenticated',
      user: { username: 'alice', role: 'user', display_name: 'Alice' },
    })
    expectDeeplyFrozen('resolved', next)
  })

  test('signedIn(user) も入力の複製で凍結される', () => {
    const user = { username: 'bob', role: 'admin' as 'admin' | 'user', display_name: 'Bob' }
    const next = reduce(RESOLVING_SESSION, { type: 'signedIn', user })

    user.role = 'user'

    expect(next).toEqual({
      kind: 'authenticated',
      user: { username: 'bob', role: 'admin', display_name: 'Bob' },
    })
    expectDeeplyFrozen('signedIn', next)
  })

  test('user の余分な property は複製に含めない（username・role・display_name の 3 つだけ）', () => {
    const user = { username: 'alice', role: 'user' as const, display_name: 'Alice', password: 'leak', extra: 1 }
    const next = reduce(RESOLVING_SESSION, { type: 'resolved', user })

    expect(next.kind).toBe('authenticated')
    if (next.kind !== 'authenticated') return
    expect(Object.keys(next.user).sort()).toEqual(['display_name', 'role', 'username'])
  })

  test('戻り値を書き換えようとしても次の呼出結果は変わらない', () => {
    const user = { username: 'alice', role: 'user' as const, display_name: 'Alice' }
    const first = reduce(RESOLVING_SESSION, { type: 'resolved', user })
    expect(() => {
      ;(first as unknown as { kind: string }).kind = 'anonymous'
    }).toThrow()
    const second = reduce(RESOLVING_SESSION, { type: 'resolved', user })
    expect(second.kind).toBe('authenticated')
  })
})

describe('reduce: unavailable の failure は入力の複製で凍結する (verifies: web-contract-18)', () => {
  test('failed(failure) の結果は、入力 failure を後から書き換えても変わらない', () => {
    const failure = { reason: 'network' as 'network' | 'server' | 'unknown' }
    const next: AuthSession = reduce(RESOLVING_SESSION, { type: 'failed', failure })

    failure.reason = 'server'

    expect(next).toEqual({ kind: 'unavailable', failure: { reason: 'network' } })
    expectDeeplyFrozen('failed', next)
  })

  test('戻り値の failure を書き換えようとしても例外になり、値は変わらない', () => {
    const next = reduce(RESOLVING_SESSION, { type: 'failed', failure: { reason: 'server' } })
    if (next.kind !== 'unavailable') throw new Error('unavailable を期待')
    expect(() => {
      ;(next.failure as unknown as { reason: string }).reason = 'network'
    }).toThrow()
    expect(next.failure.reason).toBe('server')
  })
})

describe('RESOLVING_SESSION は凍結済みの resolving (verifies: web-contract-18)', () => {
  test('kind が resolving で凍結されている', () => {
    expect(RESOLVING_SESSION).toEqual({ kind: 'resolving' })
    expectDeeplyFrozen('RESOLVING_SESSION', RESOLVING_SESSION)
  })
})

describe('validatePassword の戻り値は凍結済み (verifies: ADR-101)', () => {
  test('ok・違反どちらの戻り値も凍結され、書換えは次の呼出結果に影響しない', () => {
    const ok = validatePassword('Abcdefgh1234')
    const ng = validatePassword('short')

    expectDeeplyFrozen('ok', ok)
    expectDeeplyFrozen('ng', ng)
    expect(() => {
      ;(ng as unknown as { reason: string }).reason = 'too_long'
    }).toThrow()

    expect(validatePassword('Abcdefgh1234')).toEqual({ ok: true })
    expect(validatePassword('short')).toEqual({ ok: false, reason: 'too_short' })
  })
})
