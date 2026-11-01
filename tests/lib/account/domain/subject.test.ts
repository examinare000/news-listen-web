import { describe, test, expect } from 'vitest'
import { subjectOf } from '@/lib/account/domain/subject'

// 主体 = backend の user_id（ADR-104 決定 6）。形式は subject.ts にだけ置く。
// RED 理由（実装前）: `@/lib/account/domain/subject` が無い（module not found）。

describe('subjectOf: 形式を満たす user_id だけが主体になる (verifies: shared-leave-10)', () => {
  test.each(['u-alice_1', 'A-z_0-9'])('shared-leave-10: %s はそのまま userId になる', (id) => {
    expect(subjectOf(id).userId).toBe(id)
  })

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 123],
    ['empty string', ''],
    ['space を含む', 'a b'],
    ['slash を含む', 'a/b'],
    ['非 ASCII', 'é'],
    ['末尾の改行', 'a\n'],
  ])('shared-leave-10: %s は userId: null（主体別の資産を使えない）', (_name, value) => {
    expect(subjectOf(value).userId).toBeNull()
  })
})

describe('subjectOf: 凍結 (verifies: web-check-05)', () => {
  test('返した値の property を書き換えても次の読みが変わらない', () => {
    const subject = subjectOf('u-a') as { userId: string | null }
    expect(() => {
      subject.userId = 'u-evil'
    }).toThrow(TypeError)
    expect(subject.userId).toBe('u-a')
    expect(Object.isFrozen(subject)).toBe(true)
  })

  test('userId: null の値も凍結されている', () => {
    expect(Object.isFrozen(subjectOf(null))).toBe(true)
  })
})
