import { describe, test, expect } from 'vitest'
import { reduce, type AuthEvent, type AuthSession } from '@/lib/account/domain/authSession'

// 認証状態の遷移（web-contract-18 / web-dec-68）: 4 状態 × 6 事象 = 24 セル。次状態は事象だけで決まり、禁止セルはない。
// React なしで検査する純関数。
// RED 理由（実装前）: `@/lib/account/domain/authSession` が無い（module not found）。

const alice = { username: 'alice', role: 'user' as const, display_name: 'Alice' }
const bob = { username: 'bob', role: 'admin' as const, display_name: 'Bob' }
const failure = { reason: 'network' as const }

const STATES: ReadonlyArray<readonly [string, AuthSession]> = [
  ['resolving', { kind: 'resolving' }],
  ['authenticated', { kind: 'authenticated', user: alice }],
  ['anonymous', { kind: 'anonymous' }],
  ['unavailable', { kind: 'unavailable', failure: { reason: 'server' } }],
]

const EVENTS: ReadonlyArray<readonly [string, AuthEvent, AuthSession]> = [
  ['resolved', { type: 'resolved', user: bob }, { kind: 'authenticated', user: bob }],
  ['unauthorized', { type: 'unauthorized' }, { kind: 'anonymous' }],
  ['failed', { type: 'failed', failure }, { kind: 'unavailable', failure }],
  ['signedIn', { type: 'signedIn', user: bob }, { kind: 'authenticated', user: bob }],
  ['retry', { type: 'retry' }, { kind: 'resolving' }],
  ['loggedOut', { type: 'loggedOut' }, { kind: 'anonymous' }],
]

describe('reduce: 4 状態 × 6 事象の遷移表 (verifies: web-contract-18)', () => {
  const cells = STATES.flatMap(([stateName, state]) =>
    EVENTS.map(([eventName, event, expected]) => [stateName, eventName, state, event, expected] as const)
  )

  test('セルは 24 個', () => {
    expect(cells).toHaveLength(24)
  })

  test.each(cells)('%s + %s → 事象だけで決まる次状態', (_stateName, _eventName, state, event, expected) => {
    expect(reduce(state, event)).toEqual(expected)
  })

  // 一時障害（401 以外）は anonymous にならず unavailable（shared-leave-03）。
  test.each(STATES)('shared-leave-03: %s から failed を受けると unavailable（anonymous にしない）', (_name, state) => {
    const next = reduce(state, { type: 'failed', failure: { reason: 'unknown' } })
    expect(next.kind).toBe('unavailable')
    expect(next).toEqual({ kind: 'unavailable', failure: { reason: 'unknown' } })
  })

  test.each(STATES)('%s からの unauthorized は anonymous（401 だけが未認証）', (_name, state) => {
    expect(reduce(state, { type: 'unauthorized' })).toEqual({ kind: 'anonymous' })
  })
})

describe('reduce: retry は何度送っても resolving (verifies: web-contract-18)', () => {
  test.each(STATES)('%s から retry を 2 回送っても resolving', (_name, state) => {
    const once = reduce(state, { type: 'retry' })
    const twice = reduce(once, { type: 'retry' })
    expect(once).toEqual({ kind: 'resolving' })
    expect(twice).toEqual({ kind: 'resolving' })
  })
})

describe('reduce: 純関数', () => {
  test('同じ入力に同じ出力を返し、入力の state を書き換えない', () => {
    const state: AuthSession = { kind: 'authenticated', user: alice }
    const a = reduce(state, { type: 'unauthorized' })
    const b = reduce(state, { type: 'unauthorized' })
    expect(a).toEqual(b)
    expect(state).toEqual({ kind: 'authenticated', user: alice })
  })
})
