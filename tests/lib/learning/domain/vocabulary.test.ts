// Learning domain の vocabulary: 語が登録済みかの判定（product-learn-05・product-learn-18）。
//
// RED 理由（実装前）: `@/lib/learning/domain/vocabulary` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { isRegistered } from '@/lib/learning/domain/vocabulary'

describe('isRegistered (product-learn-05・product-learn-18)', () => {
  test('verifies: CI-LN05 — 集合に含まれる語は true、含まれない語は false', () => {
    const registered: ReadonlySet<string> = new Set(['apple'])

    expect(isRegistered('apple', registered)).toBe(true)
    expect(isRegistered('banana', registered)).toBe(false)
  })

  test('verifies: CI-LN05 — 完全一致で判定し、大文字小文字を変換しない', () => {
    const registered: ReadonlySet<string> = new Set(['apple'])

    expect(isRegistered('Apple', registered)).toBe(false)
  })

  test('verifies: CI-LN05 — 空白を変換しない', () => {
    const registered: ReadonlySet<string> = new Set(['apple'])

    expect(isRegistered(' apple', registered)).toBe(false)
  })

  test('verifies: CI-LN05 — 空集合ではすべて未登録', () => {
    expect(isRegistered('apple', new Set())).toBe(false)
  })
})
