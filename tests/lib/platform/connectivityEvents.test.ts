// 接続復帰（window の online）の購読 adapter の契約テスト。再送の契機を composition へ渡す。
//
// RED 理由: `@/lib/platform/connectivityEvents` がまだ存在しない。
import { describe, test, expect, vi } from 'vitest'
import { createBrowserConnectivityEvents } from '@/lib/platform/connectivityEvents'

describe('createBrowserConnectivityEvents', () => {
  test('online イベントで listener が呼ばれ、解除後は呼ばれない', () => {
    const listener = vi.fn()
    const unsubscribe = createBrowserConnectivityEvents().onOnline(listener)

    window.dispatchEvent(new Event('online'))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    window.dispatchEvent(new Event('online'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('online 以外のイベントでは呼ばれない', () => {
    const listener = vi.fn()
    const unsubscribe = createBrowserConnectivityEvents().onOnline(listener)
    window.dispatchEvent(new Event('offline'))
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('購読ごとに独立して解除でき、解除を 2 回呼んでも他の購読に影響しない', () => {
    const first = vi.fn()
    const second = vi.fn()
    const events = createBrowserConnectivityEvents()
    const offFirst = events.onOnline(first)
    const offSecond = events.onOnline(second)

    offFirst()
    offFirst()
    window.dispatchEvent(new Event('online'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    offSecond()
  })
})
