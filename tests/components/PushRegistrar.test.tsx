import { describe, test, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { PushRegistrar } from '@/components/PushRegistrar'

/**
 * PushRegistrar テスト
 *
 * jsdom 環境では 'serviceWorker' in navigator が false（デフォルト）のため、
 * コンポーネントは機能検出ガードで自動的に no-op となり、
 * 既存テスト（tests/app/layout.test.tsx）に影響しない。
 *
 * serviceWorker が存在する環境では navigator.serviceWorker.register を呼び出す。
 */
describe('PushRegistrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('jsdom 環境（serviceWorker 非対応）では何もレンダリングしない', () => {
    // jsdom にはデフォルトで serviceWorker がないため no-op になる
    const { container } = render(<PushRegistrar />)
    expect(container.firstChild).toBeNull()
  })

  test('serviceWorker 非対応環境でエラーを投げない', () => {
    // 機能検出ガードが正しく機能することを確認
    expect(() => render(<PushRegistrar />)).not.toThrow()
  })

  test('serviceWorker 対応環境では navigator.serviceWorker.register を呼び出す', async () => {
    // serviceWorker API をモック
    const mockRegister = vi.fn().mockResolvedValue({ scope: '/' })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: mockRegister, ready: Promise.resolve({}) },
      configurable: true,
    })

    render(<PushRegistrar />)

    // useEffect は非同期なので少し待つ
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockRegister).toHaveBeenCalledWith('/sw.js')

    // クリーンアップ
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })
  })
})
