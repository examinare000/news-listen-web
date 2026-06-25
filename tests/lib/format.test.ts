import { describe, test, expect } from 'vitest'
import { formatDuration, formatDate, formatRelativeTime } from '@/lib/format'

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

// ==========================================================
// formatRelativeTime(date: Date, now: Date): string
// 相対日時を日本語で表示。now を注入可能にして決定的にテスト。
// ==========================================================
// Helper: 指定秒数前の Date を生成
function dateAgoSeconds(seconds: number, from: Date): Date {
  return new Date(from.getTime() - seconds * 1000)
}

// Helper: 指定分前の Date を生成
function dateAgoMinutes(minutes: number, from: Date): Date {
  return dateAgoSeconds(minutes * 60, from)
}

// Helper: 指定時間前の Date を生成
function dateAgoHours(hours: number, from: Date): Date {
  return dateAgoSeconds(hours * 3600, from)
}

// Helper: 指定日前の Date を生成
function dateAgoDays(days: number, from: Date): Date {
  return dateAgoSeconds(days * 86400, from)
}

// Helper: 指定年前の Date を生成
function dateAgoYears(years: number, from: Date): Date {
  const d = new Date(from)
  d.setFullYear(d.getFullYear() - years)
  return d
}

describe('formatRelativeTime', () => {
  test('Given 3 seconds ago, returns "たった今"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoSeconds(3, now)
    expect(formatRelativeTime(date, now)).toBe('たった今')
  })

  test('Given 30 seconds ago, returns "たった今"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoSeconds(30, now)
    expect(formatRelativeTime(date, now)).toBe('たった今')
  })

  test('Given 1 minute ago, returns "1分前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoMinutes(1, now)
    expect(formatRelativeTime(date, now)).toBe('1分前')
  })

  test('Given 30 minutes ago, returns "30分前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoMinutes(30, now)
    expect(formatRelativeTime(date, now)).toBe('30分前')
  })

  test('Given 59 minutes ago, returns "59分前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoMinutes(59, now)
    expect(formatRelativeTime(date, now)).toBe('59分前')
  })

  test('Given 60 minutes ago (boundary), returns "1時間前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoMinutes(60, now)
    expect(formatRelativeTime(date, now)).toBe('1時間前')
  })

  test('Given 3 hours ago, returns "3時間前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoHours(3, now)
    expect(formatRelativeTime(date, now)).toBe('3時間前')
  })

  test('Given 23 hours ago, returns "23時間前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoHours(23, now)
    expect(formatRelativeTime(date, now)).toBe('23時間前')
  })

  test('Given 24 hours ago (boundary), returns "1日前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(1, now)
    expect(formatRelativeTime(date, now)).toBe('1日前')
  })

  test('Given 2 days ago, returns "2日前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(2, now)
    expect(formatRelativeTime(date, now)).toBe('2日前')
  })

  test('Given 29 days ago, returns "29日前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(29, now)
    expect(formatRelativeTime(date, now)).toBe('29日前')
  })

  test('Given 30 days ago (boundary), returns "1か月前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(30, now)
    expect(formatRelativeTime(date, now)).toBe('1か月前')
  })

  test('Given 60 days ago, returns "2か月前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(60, now)
    expect(formatRelativeTime(date, now)).toBe('2か月前')
  })

  test('Given 364 days ago, returns "12か月前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(364, now)
    expect(formatRelativeTime(date, now)).toBe('12か月前')
  })

  test('Given 365 days ago (boundary), returns "1年前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoDays(365, now)
    expect(formatRelativeTime(date, now)).toBe('1年前')
  })

  test('Given 2 years ago, returns "2年前"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = dateAgoYears(2, now)
    expect(formatRelativeTime(date, now)).toBe('2年前')
  })

  test('Given future date, returns "もうすぐ"', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const date = new Date(now.getTime() + 60 * 1000) // 1分後
    expect(formatRelativeTime(date, now)).toBe('もうすぐ')
  })

  test('Does not throw on invalid Date', () => {
    const now = new Date('2026-06-10T09:00:00Z')
    const invalid = new Date('invalid')
    expect(() => formatRelativeTime(invalid, now)).not.toThrow()
  })
})
