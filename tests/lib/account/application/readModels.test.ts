// Account application の read model（web-query-account-01）: authView(session) は session から毎回作る派生値。
// kind は session.kind と同じ。user は authenticated のときだけ非 null の 4 field の複製。unavailable の failure は持たない。
//
// RED 理由（実装前）: `@/lib/account/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { authView } from '@/lib/account/application/readModels'
import type { AuthSession } from '@/lib/account/domain/authSession'

const USER = { username: 'alice', role: 'admin', display_name: 'Alice', userId: 'u-alice' } as const

const authenticated: AuthSession = { kind: 'authenticated', user: USER }

describe('authView: 4 状態の写し (verifies: web-query-account-01)', () => {
  test('web-query-account-01 — authenticated は kind と user の 4 field を写す', () => {
    expect(authView(authenticated)).toEqual({
      kind: 'authenticated',
      user: { username: 'alice', role: 'admin', display_name: 'Alice', userId: 'u-alice' },
    })
  })

  test('web-query-account-01 — resolving・anonymous・unavailable は kind を写し、user は null', () => {
    expect(authView({ kind: 'resolving' })).toEqual({ kind: 'resolving', user: null })
    expect(authView({ kind: 'anonymous' })).toEqual({ kind: 'anonymous', user: null })
    expect(authView({ kind: 'unavailable', failure: { reason: 'network' } })).toEqual({
      kind: 'unavailable',
      user: null,
    })
  })

  test('web-query-account-01 — unavailable の値は failure の key を持たない', () => {
    const view = authView({ kind: 'unavailable', failure: { reason: 'server' } })
    expect('failure' in view).toBe(false)
    expect(Object.keys(view).sort()).toEqual(['kind', 'user'])
  })

  test('web-query-account-01 — user の余分な property は写さない（4 key だけ）', () => {
    const withExtra = {
      kind: 'authenticated',
      user: { ...USER, password: 'leak' },
    } as unknown as AuthSession
    const view = authView(withExtra)
    expect(Object.keys(view.user ?? {}).sort()).toEqual(['display_name', 'role', 'userId', 'username'])
  })

  test('web-query-account-01 — userId が null の user も写す', () => {
    const view = authView({ kind: 'authenticated', user: { ...USER, userId: null } })
    expect(view.user?.userId).toBeNull()
  })
})

describe('authView: 呼ぶたびに別の凍結済みの値 (verifies: web-query-account-01)', () => {
  test('web-query-account-01 — 2 回呼ぶと別の object で、user も session.user と参照を共有しない', () => {
    const first = authView(authenticated)
    const second = authView(authenticated)
    expect(first).not.toBe(second)
    expect(first.user).not.toBe(second.user)
    expect(first.user).not.toBe(USER)
  })

  test('web-query-account-01 — 値と user は凍結済み', () => {
    const view = authView(authenticated)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.user)).toBe(true)
    expect(Object.isFrozen(authView({ kind: 'anonymous' }))).toBe(true)
  })

  test('web-query-account-01 — 入力 user を後から書き換えても値は変わらない', () => {
    const user = { username: 'bob', role: 'user' as 'admin' | 'user', display_name: 'Bob', userId: 'u-bob' as string | null }
    const view = authView({ kind: 'authenticated', user })
    user.username = 'mallory'
    user.role = 'admin'
    expect(view.user).toEqual({ username: 'bob', role: 'user', display_name: 'Bob', userId: 'u-bob' })
  })
})
