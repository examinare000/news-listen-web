import { describe, test, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { renderHook } from '@testing-library/react'
import { PositionIntakeContext, usePositionIntake } from '@/contexts/PositionIntakeContext'

// PlaybackProvider の外では、何も取り込まない共有の intake を返す。
// useCatalogQueries の useMemo の依存になるので、参照が変わらないことが契約。

describe('usePositionIntake', () => {
  test('Provider の外では、再描画しても別の描画でも同じ参照を返す', () => {
    const first = renderHook(() => usePositionIntake())
    const firstValue = first.result.current

    first.rerender()
    const second = renderHook(() => usePositionIntake())

    expect(first.result.current).toBe(firstValue)
    expect(second.result.current).toBe(firstValue)
  })

  test('Provider の外の intake は凍結されており、capture は常に同じ何もしない関数を返す', () => {
    const { result } = renderHook(() => usePositionIntake())

    const ignore = result.current.capture()

    expect(Object.isFrozen(result.current)).toBe(true)
    expect(result.current.capture()).toBe(ignore)
    expect(ignore([{ id: 'a', positionSeconds: 10, recordedAt: 1000 }])).toBeUndefined()
  })

  test('server render でも Provider の外と同じ参照を返す', () => {
    const seen: Array<ReturnType<typeof usePositionIntake>> = []
    function Probe() {
      seen.push(usePositionIntake())
      return null
    }
    const outside = renderHook(() => usePositionIntake())

    renderToString(<Probe />)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(outside.result.current)
  })

  test('Provider の中では、供給された値をそのまま返す', () => {
    const supplied = { capture: () => () => undefined }

    const { result } = renderHook(() => usePositionIntake(), {
      wrapper: ({ children }) => <PositionIntakeContext.Provider value={supplied}>{children}</PositionIntakeContext.Provider>,
    })

    expect(result.current).toBe(supplied)
  })
})
