import { describe, test, expect } from 'vitest'

// issue #119: vitest 5.0 は jest-dom の global `jest.Matchers` 拡張を
// `Assertion` 型に取り込まなくなった（公式移行ガイド）。tests/setup.ts が
// `@testing-library/jest-dom`（非 vitest 版）を import したままだと、
// jest-dom マッチャ呼び出しが型エラー（TS2339）になり typed lint も
// no-unsafe-call で落ちる。この回帰を型レベルで検出する。
describe('jest-dom matchers under the project vitest version', () => {
  test('toBeInTheDocument が Assertion 型に存在する', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    expect(element).toBeInTheDocument()
  })
})
