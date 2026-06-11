'use client'

import { useState } from 'react'

type SetValue<T> = (value: T | ((prev: T) => T)) => void

/**
 * SSR-safe localStorage hook. Falls back to initialValue when:
 * - localStorage is unavailable (SSR / window undefined)
 * - Stored JSON is malformed
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, SetValue<T>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue
    }
    try {
      const item = window.localStorage.getItem(key)
      return item !== null ? (JSON.parse(item) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue: SetValue<T> = (value) => {
    try {
      const next = value instanceof Function ? value(storedValue) : value
      setStoredValue(next)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(next))
      }
    } catch {
      // Silently ignore write failures (e.g. storage quota exceeded)
    }
  }

  return [storedValue, setValue]
}
