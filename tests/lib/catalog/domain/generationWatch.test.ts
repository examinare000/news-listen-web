// 生成の監視（web-rule-catalog-06・web-usecase-19）: 完了の検知 `detectCompleted` と、ポーリングの停止の判定 `shouldStopWatching`・定数。
// 旧 `lib/podcastPolling.ts` のテストの全観点（件数の増加・大幅な増加・timeout 以上・超過・継続・優先順位）を `shouldStopWatching` へ移す。
//
// RED 理由（実装前）: `@/lib/catalog/domain/generationWatch` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import {
  GENERATION_WATCH_INTERVAL_MS,
  GENERATION_WATCH_TIMEOUT_MS,
  detectCompleted,
  shouldStopWatching,
} from '@/lib/catalog/domain/generationWatch'
import type { GenerationSnapshot } from '@/lib/catalog/domain/generationWatch'

const snap = (id: string, generation: GenerationSnapshot['generation']): GenerationSnapshot => ({ id, generation })

describe('定数', () => {
  test('verifies: CI-G3 — 間隔は 5000ms・timeout は 120000ms', () => {
    expect(GENERATION_WATCH_INTERVAL_MS).toBe(5000)
    expect(GENERATION_WATCH_TIMEOUT_MS).toBe(120000)
  })
})

describe('shouldStopWatching — 件数の増加', () => {
  test('verifies: CI-G2 — 件数が増えたら new-podcast で停止する（5→6）', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 6, elapsedMs: 10000 })).toEqual({
      stop: true,
      reason: 'new-podcast',
    })
  })

  test('verifies: CI-G2 — 大幅に増えても new-podcast（5→8）', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 8, elapsedMs: 50000 })).toEqual({
      stop: true,
      reason: 'new-podcast',
    })
  })
})

describe('shouldStopWatching — timeout', () => {
  test('verifies: CI-G2 — 経過がちょうど timeout（120000）なら、増加がなくても timeout で停止する', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 5, elapsedMs: 120000 })).toEqual({
      stop: true,
      reason: 'timeout',
    })
  })

  test('verifies: CI-G2 — timeout を超えても timeout で停止する', () => {
    expect(shouldStopWatching({ baselineCount: 3, currentCount: 3, elapsedMs: 125000 })).toEqual({
      stop: true,
      reason: 'timeout',
    })
  })
})

describe('shouldStopWatching — 継続', () => {
  test('verifies: CI-G2 — 変化なしで timeout 前なら継続する', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 5, elapsedMs: 30000 })).toEqual({
      stop: false,
      reason: null,
    })
  })

  test('verifies: CI-G2 — 変化なしの複数回の経過（5 秒刻み）でも継続する', () => {
    for (let i = 0; i < 5; i++) {
      expect(shouldStopWatching({ baselineCount: 2, currentCount: 2, elapsedMs: 5000 * (i + 1) })).toEqual({
        stop: false,
        reason: null,
      })
    }
  })

  test('verifies: CI-G2 — timeout の 1ms 前（119999）で増加なしなら継続する。件数の減少（5→4）も停止しない', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 5, elapsedMs: 119999 })).toEqual({
      stop: false,
      reason: null,
    })
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 4, elapsedMs: 10000 })).toEqual({
      stop: false,
      reason: null,
    })
  })
})

describe('shouldStopWatching — 件数の増加の優先', () => {
  test('verifies: CI-G2 — timeout の近くで増えたら timeout でなく new-podcast', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 6, elapsedMs: 115000 })).toEqual({
      stop: true,
      reason: 'new-podcast',
    })
  })

  test('verifies: CI-G2 — timeout 以上かつ増加もあるときは new-podcast（増加が優先）', () => {
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 6, elapsedMs: 120000 })).toEqual({
      stop: true,
      reason: 'new-podcast',
    })
    expect(shouldStopWatching({ baselineCount: 5, currentCount: 6, elapsedMs: 200000 })).toEqual({
      stop: true,
      reason: 'new-podcast',
    })
  })
})

describe('detectCompleted — 生成の完了の検知 (web-usecase-19)', () => {
  test('web-usecase-19 verifies: CI-G1 — previous が空なら、next に completed があっても空（初回は演出なし）', () => {
    expect(detectCompleted([], [snap('a', 'completed'), snap('b', 'processing')])).toEqual([])
  })

  test('web-usecase-19 verifies: CI-G1 — processing → completed の id を返す', () => {
    expect(detectCompleted([snap('a', 'processing')], [snap('a', 'completed')])).toEqual(['a'])
  })

  test('web-usecase-19 verifies: CI-G1 — failed → completed の id を返す', () => {
    expect(detectCompleted([snap('a', 'failed')], [snap('a', 'completed')])).toEqual(['a'])
  })

  test('web-usecase-19 verifies: CI-G1 — previous に無い id が completed なら、前回は完了でないものとして返す', () => {
    expect(detectCompleted([snap('a', 'completed')], [snap('a', 'completed'), snap('new', 'completed')])).toEqual([
      'new',
    ])
  })

  test('web-usecase-19 verifies: CI-G1 — completed → completed は含めない（対照）', () => {
    expect(detectCompleted([snap('a', 'completed')], [snap('a', 'completed')])).toEqual([])
  })

  test('web-usecase-19 verifies: CI-G1 — processing → processing は含めない', () => {
    expect(detectCompleted([snap('a', 'processing')], [snap('a', 'processing')])).toEqual([])
  })

  test('web-usecase-19 verifies: CI-G1 — processing → failed は含めない', () => {
    expect(detectCompleted([snap('a', 'processing')], [snap('a', 'failed')])).toEqual([])
  })

  test('web-usecase-19 verifies: CI-G1 — 複数 id は next の順で返し、完了でないものは混ぜない', () => {
    const previous = [snap('a', 'processing'), snap('b', 'completed'), snap('c', 'failed'), snap('d', 'processing')]
    const next = [snap('d', 'completed'), snap('b', 'completed'), snap('c', 'completed'), snap('a', 'processing')]
    expect(detectCompleted(previous, next)).toEqual(['d', 'c'])
  })
})
