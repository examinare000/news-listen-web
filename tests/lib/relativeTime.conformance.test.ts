// 正本仕様準拠テスト（issue #138）。
// docs/design/shared-playback-spec.md §4.2 正本テストケース表（RT-01〜RT-15）の全行を、
// テスト名先頭の行 ID で機械的・目視双方に照合可能な形で実装する。
// RT-A01/A02（アダプタ層・空/不正入力）は文字列パース責務のため本コア仕様の対象外（既存 format.test.ts が担当）。
import { describe, test, expect } from 'vitest'
import { formatRelativeTime } from '@/lib/format'

// 基準 now は固定日時。target = now - offset として与える。
const NOW = new Date('2026-06-10T09:00:00Z')

function targetSecondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000)
}

describe('formatRelativeTime conformance (docs/design/shared-playback-spec.md §4.2)', () => {
  test('RT-01: target > now (future, e.g. now+60s) → "もうすぐ"', () => {
    const future = new Date(NOW.getTime() + 60 * 1000)
    expect(formatRelativeTime(future, NOW)).toBe('もうすぐ')
  })

  test('RT-02: offset 3 seconds → "たった今"', () => {
    expect(formatRelativeTime(targetSecondsAgo(3), NOW)).toBe('たった今')
  })

  test('RT-03: offset 30 seconds → "たった今"', () => {
    expect(formatRelativeTime(targetSecondsAgo(30), NOW)).toBe('たった今')
  })

  test('RT-04: offset 59 seconds → "たった今"', () => {
    expect(formatRelativeTime(targetSecondsAgo(59), NOW)).toBe('たった今')
  })

  test('RT-05: offset 60 seconds → "1分前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(60), NOW)).toBe('1分前')
  })

  test('RT-06: offset 59 minutes → "59分前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(59 * 60), NOW)).toBe('59分前')
  })

  test('RT-07: offset 60 minutes → "1時間前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(60 * 60), NOW)).toBe('1時間前')
  })

  test('RT-08: offset 23 hours → "23時間前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(23 * 3600), NOW)).toBe('23時間前')
  })

  test('RT-09: offset 24 hours → "1日前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(24 * 3600), NOW)).toBe('1日前')
  })

  test('RT-10: offset 29 days → "29日前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(29 * 24 * 3600), NOW)).toBe('29日前')
  })

  test('RT-11: offset 30 days → "1か月前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(30 * 24 * 3600), NOW)).toBe('1か月前')
  })

  test('RT-12: offset 359 days → "11か月前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(359 * 24 * 3600), NOW)).toBe('11か月前')
  })

  test('RT-13: offset 360 days → "12か月前" (month=12, year=0, year-first judgement avoids "0年前")', () => {
    expect(formatRelativeTime(targetSecondsAgo(360 * 24 * 3600), NOW)).toBe('12か月前')
  })

  test('RT-14: offset 364 days → "12か月前"', () => {
    expect(formatRelativeTime(targetSecondsAgo(364 * 24 * 3600), NOW)).toBe('12か月前')
  })

  test('RT-15: offset 365 days → "1年前" (year judgement takes precedence over month)', () => {
    expect(formatRelativeTime(targetSecondsAgo(365 * 24 * 3600), NOW)).toBe('1年前')
  })
})

// ==========================================================
// アダプタ層テスト（空/不正入力）
// spec §3.3: Web アダプタでは Date オブジェクトを受け取り、invalid Date は '' を返す
// ==========================================================
describe('formatRelativeTime adapter (web: invalid Date handling)', () => {
  test('RT-A01: empty input (invalid Date, equivalent to spec empty string case) → ""', () => {
    // Web adapter: empty string → new Date('') → Invalid Date → ''
    expect(formatRelativeTime(new Date(''), NOW)).toBe('')
  })

  test('RT-A02: malformed input (invalid Date, unparseable string) → ""', () => {
    // Web adapter: unparseable string → new Date('not-a-date') → Invalid Date → ''
    expect(formatRelativeTime(new Date('not-a-date'), NOW)).toBe('')
  })
})
