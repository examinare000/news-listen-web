// @vitest-environment node
// Preferences application の query: getServerPreferences（web-query-prefs-02）と、値の不変性（web-check-06）。
// 手書きの PreferencesGateway fake を渡す。`createGatewayDouble`・infrastructure は import しない（期待値は literal）。
//
// RED 理由（実装前）: `@/lib/preferences/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createPreferencesQueries } from '@/lib/preferences/application/queries'
import type { PreferencesGateway, ServerPreferencesRecord } from '@/lib/preferences/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

interface FakeGateway extends PreferencesGateway {
  readonly calls: string[]
}

function fake(get: () => Promise<Result<ServerPreferencesRecord, ApiFailure>>): FakeGateway {
  const calls: string[] = []
  return {
    calls,
    get: () => {
      calls.push('get')
      return get()
    },
    patch: () => {
      calls.push('patch')
      return Promise.reject(new Error('patch は query から呼ばれない'))
    },
  }
}

const record = (overrides: Partial<ServerPreferencesRecord> = {}): ServerPreferencesRecord => ({
  defaultDifficulty: 'ielts_7',
  weeklyGoal: 5,
  defaultPlaybackSpeed: 1.0,
  digest: { enabled: true, articleCount: 10 },
  ...overrides,
})

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen)
}

describe('getServerPreferences (web-query-prefs-02)', () => {
  test('web-query-prefs-02: 未知の難易度でも ok のまま toeic_600 に倒す（読み取りを失敗にしない）', async () => {
    const gateway = fake(() => Promise.resolve({ ok: true, value: record({ defaultDifficulty: 'toeic_250' }) }))

    const result = await createPreferencesQueries({ gateway }).getServerPreferences()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.defaultDifficulty).toBe('toeic_600')
  })

  test('web-query-prefs-02: 既知の難易度はそのまま、gateway は 1 回だけ呼ぶ', async () => {
    const gateway = fake(() => Promise.resolve({ ok: true, value: record({ defaultDifficulty: 'eiken_p1' }) }))

    const result = await createPreferencesQueries({ gateway }).getServerPreferences()

    expect(gateway.calls).toEqual(['get'])
    expect(result).toEqual({
      ok: true,
      value: { defaultDifficulty: 'eiken_p1', weeklyGoal: 5, defaultPlaybackSpeed: 1.0, digest: { enabled: true, articleCount: 10 } },
    })
  })

  test('web-contract-20: gateway の既定速度が 8 段の外（1.2）でも ok のまま 1.0 に倒す。8 段の値（1.75）はそのまま', async () => {
    const outside = fake(() => Promise.resolve({ ok: true, value: record({ defaultPlaybackSpeed: 1.2 }) }))
    const inside = fake(() => Promise.resolve({ ok: true, value: record({ defaultPlaybackSpeed: 1.75 }) }))

    const normalized = await createPreferencesQueries({ gateway: outside }).getServerPreferences()
    const passed = await createPreferencesQueries({ gateway: inside }).getServerPreferences()

    expect(normalized.ok && normalized.value.defaultPlaybackSpeed).toBe(1.0)
    expect(passed.ok && passed.value.defaultPlaybackSpeed).toBe(1.75)
  })

  test.each([
    [null, 3],
    [5, 5],
    [10, 10],
  ] as const)('web-query-prefs-02: 週の目標 %s は %s になる（欠落だけ 3）', async (weeklyGoal, expected) => {
    const gateway = fake(() => Promise.resolve({ ok: true, value: record({ weeklyGoal }) }))

    const result = await createPreferencesQueries({ gateway }).getServerPreferences()

    expect(result.ok && result.value.weeklyGoal).toBe(expected)
  })

  test('web-query-prefs-02: gateway の failure は同じ参照のまま返し、patch は呼ばない', async () => {
    const failure: ApiFailure = { kind: 'server', status: 500 }
    const gateway = fake(() => Promise.resolve({ ok: false, failure }))

    const result = await createPreferencesQueries({ gateway }).getServerPreferences()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe(failure)
    expect(gateway.calls).toEqual(['get'])
  })

  test('web-query-prefs-02: gateway の reject は握りつぶさず、そのまま reject する', async () => {
    const gateway = fake(() => Promise.reject(new Error('boom')))

    await expect(createPreferencesQueries({ gateway }).getServerPreferences()).rejects.toThrow('boom')
    expect(gateway.calls).toEqual(['get'])
  })
})

describe('getServerPreferences の値 (web-check-06)', () => {
  test('web-check-06: 値は全深さで凍結され、呼ぶたびに別の object で、gateway の値と参照を共有しない', async () => {
    const raw = record()
    const queries = createPreferencesQueries({ gateway: fake(() => Promise.resolve({ ok: true, value: raw })) })

    const first = await queries.getServerPreferences()
    const second = await queries.getServerPreferences()

    if (!first.ok || !second.ok) throw new Error('成功を期待した')
    expect(isDeepFrozen(first.value)).toBe(true)
    expect(isDeepFrozen(second.value)).toBe(true)
    expect(first.value).not.toBe(raw)
    expect(first.value.digest).not.toBe(raw.digest)
    expect(first.value).not.toBe(second.value)
    expect(first.value.digest).not.toBe(second.value.digest)
  })

  test('web-check-06: gateway の値を後から書き換えても、すでに返した値は変わらない', async () => {
    const raw = { defaultDifficulty: 'ielts_7', weeklyGoal: 5 as const, defaultPlaybackSpeed: 1.0, digest: { enabled: true, articleCount: 10 } }
    const queries = createPreferencesQueries({ gateway: fake(() => Promise.resolve({ ok: true, value: raw })) })
    const result = await queries.getServerPreferences()
    if (!result.ok) throw new Error('成功を期待した')
    const before = structuredClone(result.value)

    raw.defaultDifficulty = 'toeic_900'
    raw.digest.articleCount = 1

    expect(result.value).toEqual(before)
    expect(result.value.defaultDifficulty).toBe('ielts_7')
  })
})
