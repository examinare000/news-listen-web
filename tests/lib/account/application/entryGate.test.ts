// 入口（/）の判定表 32 行（web-rule-account-07）。
// RED 理由（実装前）: `@/lib/account/application/entryGate` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { entryGate } from '@/lib/account/application/entryGate'
import type { AuthSession } from '@/lib/account/domain/authSession'

type Onboarding = 'pending' | 'incomplete' | 'completed' | 'failed'
type Decision = 'login' | 'retry' | 'loading' | 'onboarding' | 'feed'

const SESSIONS: Record<AuthSession['kind'], AuthSession> = {
  resolving: { kind: 'resolving' },
  anonymous: { kind: 'anonymous' },
  unavailable: { kind: 'unavailable', failure: { reason: 'network' } },
  authenticated: {
    kind: 'authenticated',
    user: { username: 'u', role: 'user', display_name: 'U', userId: 'id-1' },
  },
}
const KINDS: ReadonlyArray<AuthSession['kind']> = ['resolving', 'anonymous', 'unavailable', 'authenticated']
const ONBOARDINGS: ReadonlyArray<Onboarding> = ['pending', 'incomplete', 'completed', 'failed']

function expected(kind: AuthSession['kind'], ready: boolean, onboarding: Onboarding): Decision {
  if (kind === 'resolving' || kind === 'anonymous') return 'login'
  if (kind === 'unavailable') return 'retry'
  if (!ready) return 'loading'
  if (onboarding === 'pending') return 'loading'
  if (onboarding === 'incomplete') return 'onboarding'
  return 'feed'
}

const ROWS: Array<[AuthSession['kind'], boolean, Onboarding, Decision]> = KINDS.flatMap((kind) =>
  [true, false].flatMap((ready) =>
    ONBOARDINGS.map((o): [AuthSession['kind'], boolean, Onboarding, Decision] => [kind, ready, o, expected(kind, ready, o)]),
  ),
)

describe('entryGate', () => {
  test('表は 32 行', () => {
    expect(ROWS).toHaveLength(32)
  })

  test.each(ROWS)('web-rule-account-07: session=%s ready=%s onboarding=%s -> %s', (kind, ready, onboarding, result) => {
    expect(entryGate({ preferencesReady: ready, session: SESSIONS[kind], onboarding })).toBe(result)
  })

  test('web-rule-account-07: onboarding を入れ替えて結果が変わるのは authenticated かつ ready の行だけ', () => {
    for (const kind of KINDS) {
      for (const ready of [true, false]) {
        const results = new Set(
          ONBOARDINGS.map((onboarding) => entryGate({ preferencesReady: ready, session: SESSIONS[kind], onboarding })),
        )
        if (kind === 'authenticated' && ready) {
          expect(results.size).toBeGreaterThan(1)
        } else {
          expect(results.size).toBe(1)
        }
      }
    }
  })
})
