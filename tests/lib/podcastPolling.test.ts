import { describe, test, expect } from 'vitest'
import { shouldStopPolling } from '@/lib/podcastPolling'

// ==========================================================
// podcastPolling — 件数増加時
// ==========================================================
describe('shouldStopPolling — new podcast detected', () => {
  test('Given currentCount > baselineCount, returns stop=true with reason=new-podcast', () => {
    const result = shouldStopPolling({
      baselineCount: 5,
      currentCount: 6,
      elapsedMs: 10000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('new-podcast')
  })

  test('Given currentCount significantly higher, still returns stop=true with reason=new-podcast', () => {
    const result = shouldStopPolling({
      baselineCount: 5,
      currentCount: 8,
      elapsedMs: 50000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('new-podcast')
  })
})

// ==========================================================
// podcastPolling — タイムアウト判定
// ==========================================================
describe('shouldStopPolling — timeout', () => {
  test('Given elapsedMs >= timeoutMs and no new podcast, returns stop=true with reason=timeout', () => {
    const result = shouldStopPolling({
      baselineCount: 5,
      currentCount: 5,
      elapsedMs: 120000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('timeout')
  })

  test('Given elapsedMs > timeoutMs, returns stop=true with reason=timeout', () => {
    const result = shouldStopPolling({
      baselineCount: 3,
      currentCount: 3,
      elapsedMs: 125000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('timeout')
  })
})

// ==========================================================
// podcastPolling — ポーリング継続
// ==========================================================
describe('shouldStopPolling — continue polling', () => {
  test('Given no change and within timeout, returns stop=false with reason=null', () => {
    const result = shouldStopPolling({
      baselineCount: 5,
      currentCount: 5,
      elapsedMs: 30000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(false)
    expect(result.reason).toBeNull()
  })

  test('Given multiple polls with no change, continues polling', () => {
    for (let i = 0; i < 5; i++) {
      const result = shouldStopPolling({
        baselineCount: 2,
        currentCount: 2,
        elapsedMs: 5000 * (i + 1),
        timeoutMs: 120000,
      })
      expect(result.stop).toBe(false)
      expect(result.reason).toBeNull()
    }
  })
})

// ==========================================================
// podcastPolling — 新規完成優先（タイムアウトより先）
// ==========================================================
describe('shouldStopPolling — new podcast takes precedence', () => {
  test('Given new podcast near timeout, returns new-podcast not timeout', () => {
    const result = shouldStopPolling({
      baselineCount: 5,
      currentCount: 6,
      elapsedMs: 115000,
      timeoutMs: 120000,
    })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('new-podcast')
  })
})
