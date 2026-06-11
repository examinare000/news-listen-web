import { describe, test, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from '@/hooks/useLocalStorage'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

// ==========================================================
// useLocalStorage(key, initialValue)
// - ストレージ未設定 → initialValue を返す
// - set 後に再読込すると保存値が返る
// - JSON 不正値が保存されている → initialValue へフォールバック
// - SSR（window 不在）で例外を出さない
// ==========================================================
describe('useLocalStorage', () => {
  describe('Given no stored value', () => {
    test('returns the initial value', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
      expect(result.current[0]).toBe('default')
    })

    test('returns the initial value for object type', () => {
      const initial = { count: 0 }
      const { result } = renderHook(() => useLocalStorage('test-obj', initial))
      expect(result.current[0]).toEqual(initial)
    })
  })

  describe('Given setValue is called', () => {
    test('updates the returned value', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'))

      act(() => {
        result.current[1]('updated')
      })

      expect(result.current[0]).toBe('updated')
    })

    test('persists the value to localStorage', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'))

      act(() => {
        result.current[1]('persisted')
      })

      expect(localStorage.getItem('test-key')).toBe(JSON.stringify('persisted'))
    })
  })

  describe('Given a previously stored value', () => {
    test('returns the stored value on mount', () => {
      localStorage.setItem('test-key', JSON.stringify('stored-value'))
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
      expect(result.current[0]).toBe('stored-value')
    })
  })

  describe('Given invalid JSON is stored', () => {
    test('returns initial value without throwing', () => {
      localStorage.setItem('test-key', 'not-valid-json{{{')
      expect(() => {
        renderHook(() => useLocalStorage('test-key', 'default'))
      }).not.toThrow()
    })

    test('falls back to initialValue when stored JSON is malformed', () => {
      localStorage.setItem('test-key', 'not-valid-json{{{')
      const { result } = renderHook(() => useLocalStorage('test-key', 'fallback'))
      expect(result.current[0]).toBe('fallback')
    })
  })

  describe('Given localStorage is inaccessible (SSR / privacy mode)', () => {
    // SSR や一部プライバシーモードでは localStorage アクセスが例外を投げる。
    // window 自体を delete すると renderHook（jsdom）が動かなくなるため、
    // getItem を throw させて「localStorage 利用不可」状態をフォールバック観点で検証する。
    test('does not throw and falls back to initialValue when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage inaccessible')
      })

      let result: { current: [string, unknown] } | undefined
      expect(() => {
        ;({ result } = renderHook(() => useLocalStorage('test-key', 'default')))
      }).not.toThrow()
      expect(result!.current[0]).toBe('default')
    })
  })

  describe('setValue with updater function', () => {
    test('applies updater function to current value', () => {
      const { result } = renderHook(() => useLocalStorage('count', 0))

      act(() => {
        result.current[1]((prev: number) => prev + 1)
      })

      expect(result.current[0]).toBe(1)
    })
  })
})
