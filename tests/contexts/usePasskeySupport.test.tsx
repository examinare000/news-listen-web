// composition root `usePasskeySupport`: 初期値 true、mount 後の effect で createRealWebAuthnBrowserPort().supportsWebAuthn() を 1 回読む。
// 統合テスト: adapter `@/lib/platform/webauthn` を差し替え、ブラウザ API を呼ばない。
//
// RED 理由（実装前）: `@/contexts/usePasskeySupport` が無い（module not found）。
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const port = vi.hoisted(() => ({ supports: vi.fn<() => boolean>() }))

vi.mock('@/lib/platform/webauthn', () => ({
  createRealWebAuthnBrowserPort: () => ({
    startRegistration: vi.fn(),
    startAuthentication: vi.fn(),
    supportsWebAuthn: port.supports,
  }),
}))

import { usePasskeySupport } from '@/contexts/usePasskeySupport'

beforeEach(() => {
  port.supports.mockReset()
})

describe('usePasskeySupport', () => {
  test('web-slice-account-01 — port が true を返すなら true のまま（読むのは effect の後の 1 回だけ）', () => {
    port.supports.mockReturnValue(true)

    const { result } = renderHook(() => usePasskeySupport())

    expect(result.current).toBe(true)
    expect(port.supports).toHaveBeenCalledTimes(1)
  })

  test('web-slice-account-01 — port が false を返すなら、effect の後に false へ更新される', () => {
    port.supports.mockReturnValue(false)

    const { result } = renderHook(() => usePasskeySupport())

    expect(result.current).toBe(false)
    expect(port.supports).toHaveBeenCalledTimes(1)
  })

  test('web-slice-account-01 — 最初の描画では port を読まず true を返す（SSR と hydration の一致）', () => {
    port.supports.mockReturnValue(false)
    const seen: boolean[] = []

    renderHook(() => {
      const value = usePasskeySupport()
      seen.push(value)
      return value
    })

    expect(seen[0]).toBe(true)
  })

  test('web-slice-account-01 — 再描画しても port を読み直さない', () => {
    port.supports.mockReturnValue(false)

    const { rerender } = renderHook(() => usePasskeySupport())
    rerender()
    rerender()

    expect(port.supports).toHaveBeenCalledTimes(1)
  })
})
