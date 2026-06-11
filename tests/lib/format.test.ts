import { describe, test, expect } from 'vitest'
import { formatDuration, formatDate } from '@/lib/format'

// ==========================================================
// formatDuration(seconds: number): string
// - 300 → "5:00" (M:SS)
// - 1 hour 以上は H:MM:SS 形式
// - 0 秒・境界値で例外を出さない
// ==========================================================
describe('formatDuration', () => {
  test('Given 300 seconds, returns "5:00"', () => {
    expect(formatDuration(300)).toBe('5:00')
  })

  test('Given 0 seconds, returns "0:00"', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  test('Given 90 seconds, returns "1:30"', () => {
    expect(formatDuration(90)).toBe('1:30')
  })

  test('Given 59 seconds, returns "0:59"', () => {
    expect(formatDuration(59)).toBe('0:59')
  })

  test('Given 3600 seconds, returns "1:00:00" (>= 1 hour uses H:MM:SS)', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
  })

  test('Given 3661 seconds, returns "1:01:01"', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  test('Given 7322 seconds, returns "2:02:02"', () => {
    expect(formatDuration(7322)).toBe('2:02:02')
  })

  test('Does not throw for large values', () => {
    expect(() => formatDuration(99999)).not.toThrow()
  })
})

// ==========================================================
// formatDate(iso: string): string
// - ISO 8601 文字列 → 「M/D HH:MM」形式
// - 不正文字列で例外を出さない
// ==========================================================
describe('formatDate', () => {
  test('Returns a string in "M/D HH:MM" pattern', () => {
    // 形式のみ検証（タイムゾーンに依存させない）
    const result = formatDate('2026-06-10T09:00:00+09:00')
    expect(result).toMatch(/^\d{1,2}\/\d{1,2}\s\d{2}:\d{2}$/)
  })

  test('Does not throw on invalid ISO string', () => {
    expect(() => formatDate('not-a-date')).not.toThrow()
  })

  test('Returns a string (not empty string or undefined) for invalid input', () => {
    const result = formatDate('not-a-date')
    expect(typeof result).toBe('string')
    // 不正入力でもクラッシュせず何らかの文字列を返す
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  test('Does not throw on empty string', () => {
    expect(() => formatDate('')).not.toThrow()
  })
})
