// @vitest-environment node
// Preferences application のリードモデル: ServerPreferencesRecord → ServerPreferencesView（web-model-prefs）。
// application の unit テスト。DTO（`@/types`）も infrastructure も import しない。record は object literal ＋ `import type` で作る。
//
// RED 理由（実装前）: `@/lib/preferences/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { toServerPreferencesView } from '@/lib/preferences/application/readModels'
import type { ServerPreferencesRecord } from '@/lib/preferences/application/ports'

function record(overrides: Partial<ServerPreferencesRecord> = {}): ServerPreferencesRecord {
  return {
    defaultDifficulty: 'ielts_7',
    weeklyGoal: 5,
    digest: { enabled: true, articleCount: 10 },
    ...overrides,
  }
}

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen)
}

describe('toServerPreferencesView (web-model-prefs)', () => {
  test('web-model-prefs: 未知の難易度は toeic_600 に倒し、週の目標の欠落（null）は 3 にする。digest は写す', () => {
    const view = toServerPreferencesView(
      record({ defaultDifficulty: 'toeic_250', weeklyGoal: null, digest: { enabled: false, articleCount: 4 } }),
    )

    expect(view).toEqual({ defaultDifficulty: 'toeic_600', weeklyGoal: 3, digest: { enabled: false, articleCount: 4 } })
  })

  test.each(['toeic_600', 'toeic_900', 'ielts_55', 'ielts_7', 'eiken_2', 'eiken_p1'])(
    'web-model-prefs: 既知の難易度 %s はそのまま写す',
    (level) => {
      expect(toServerPreferencesView(record({ defaultDifficulty: level })).defaultDifficulty).toBe(level)
    },
  )

  test.each([3, 5, 7, 10] as const)('web-model-prefs: 週の目標 %s はそのまま写す', (goal) => {
    expect(toServerPreferencesView(record({ weeklyGoal: goal })).weeklyGoal).toBe(goal)
  })

  test('web-model-prefs: 値域外の週の目標は検査せずそのまま素通しする（欠落だけを既定値にする）', () => {
    const odd = 4 as unknown as ServerPreferencesRecord['weeklyGoal']

    expect(toServerPreferencesView(record({ weeklyGoal: odd })).weeklyGoal).toBe(4)
  })

  test('web-model-prefs: 呼ぶたびに別の凍結した値を返し、record の入れ子と参照を共有しない', () => {
    const raw = record()

    const first = toServerPreferencesView(raw)
    const second = toServerPreferencesView(raw)

    expect(isDeepFrozen(first)).toBe(true)
    expect(isDeepFrozen(second)).toBe(true)
    expect(first).not.toBe(raw)
    expect(first).not.toBe(second)
    expect(first.digest).not.toBe(raw.digest)
    expect(first.digest).not.toBe(second.digest)
  })

  test('web-model-prefs: record を後から書き換えても、すでに返した値は変わらない。record 自体も書き換えない', () => {
    const raw = { defaultDifficulty: 'eiken_2', weeklyGoal: 7 as const, digest: { enabled: true, articleCount: 10 } }
    const before = structuredClone(raw)

    const view = toServerPreferencesView(raw)
    expect(raw).toEqual(before)

    raw.defaultDifficulty = 'toeic_900'
    raw.digest.articleCount = 1
    expect(view).toEqual({ defaultDifficulty: 'eiken_2', weeklyGoal: 7, digest: { enabled: true, articleCount: 10 } })
  })
})
