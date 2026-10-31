// verifies: web-contract-20（registry の合成: get / set / ready だけを公開し、列挙外・型不正は既定へ正規化する）
// PreferencesProvider を実物の KeyValueStore 互換 double と結んで描画し、公開面・初回描画の timing・同一性・sfx の注入を検証する。
// 記述子は settings.ts を値で import せず、INFRA の束ね物（LOCAL_SETTING_BINDINGS）から得る。
//
// RED 理由（実装前）: `@/contexts/PreferencesProvider` が無い（module not found）。
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesProvider'
import { LOCAL_SETTING_BINDINGS } from '@/lib/preferences/infrastructure/localSettingsStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

const configureSfx = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sfx', () => ({
  configureSfx,
  prepareSfx: vi.fn(),
  playSfx: vi.fn(),
}))

const B = LOCAL_SETTING_BINDINGS
const TIME_FORMAT = B.timeFormat.setting
const SFX = B.sfxEnabled.setting

function memoryStore(initial: Record<string, string> = {}, setResult = true) {
  const data = new Map<string, string>(Object.entries(initial))
  const getSpy = vi.fn((key: string) => data.get(key) ?? null)
  const setSpy = vi.fn((key: string, value: string) => {
    if (setResult) data.set(key, value)
    return setResult
  })
  const store: KeyValueStore = {
    get: getSpy,
    set: setSpy,
    remove: (key) => {
      data.delete(key)
    },
  }
  return { store, data, getSpy, setSpy }
}

type Prefs = ReturnType<typeof usePreferences>

/** 描画ごとに usePreferences() の返り値を記録し、timeFormat を表示する consumer */
function Recorder({ log }: { log: Array<{ prefs: Prefs; timeFormat: string; ready: boolean }> }) {
  const prefs = usePreferences()
  const timeFormat = prefs.get(TIME_FORMAT)
  log.push({ prefs, timeFormat, ready: prefs.ready })
  return <p data-testid="tf">{timeFormat}</p>
}

function renderWith(store: KeyValueStore | undefined) {
  const log: Array<{ prefs: Prefs; timeFormat: string; ready: boolean }> = []
  const view = render(
    <PreferencesProvider store={store}>
      <Recorder log={log} />
    </PreferencesProvider>,
  )
  const latest = () => log[log.length - 1].prefs
  return { ...view, log, latest }
}

beforeEach(() => {
  configureSfx.mockClear()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web-contract-20: usePreferences の公開面', () => {
  test('provider の外で呼ぶと、決まった文言の Error を投げる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Naked() {
      usePreferences()
      return null
    }
    expect(() => render(<Naked />)).toThrow('usePreferences must be used within PreferencesProvider')
  })

  test('返り値の own key は get・set・ready の 3 つだけ（raw dispatch・subscribe を出さない）', () => {
    const { latest } = renderWith(memoryStore().store)
    expect(Object.keys(latest()).sort()).toEqual(['get', 'ready', 'set'])
  })
})

describe('web-contract-20: 初回描画の timing', () => {
  test('初回描画から保存値で描き、ready は初回 false → mount 後 true で、以後 false に戻らない', () => {
    const { store } = memoryStore({ time_format: '"relative"' })
    const { log } = renderWith(store)

    expect(log[0].timeFormat).toBe('relative')
    expect(log[0].ready).toBe(false)
    expect(log[log.length - 1].ready).toBe(true)
    const firstReady = log.findIndex((entry) => entry.ready)
    expect(log.slice(firstReady).every((entry) => entry.ready)).toBe(true)
    expect(screen.getByTestId('tf').textContent).toBe('relative')
  })

  test('保存値が無ければ既定値で描く（保存値があるときとの対照）', () => {
    const { log } = renderWith(memoryStore().store)
    expect(log[0].timeFormat).toBe('absolute')
  })

  test('store を省くと、既定の browser adapter（localStorage）から保存値を読む', () => {
    localStorage.setItem('time_format', '"relative"')
    const { log } = renderWith(undefined)
    expect(log[0].timeFormat).toBe('relative')
  })

  test('保存値の読み込みは初回描画だけで、再描画では store を読み直さない', () => {
    const { store, getSpy } = memoryStore({ time_format: '"relative"' })
    const { rerender, log } = renderWith(store)
    const readsAfterMount = getSpy.mock.calls.length
    expect(readsAfterMount).toBeGreaterThan(0)

    rerender(
      <PreferencesProvider store={store}>
        <Recorder log={log} />
      </PreferencesProvider>,
    )
    expect(getSpy.mock.calls.length).toBe(readsAfterMount)
  })
})

describe('web-contract-20: set', () => {
  test('set の直後（再描画の前）でも get は新しい正規化値を返し、保存され、consumer が再描画される', () => {
    const { store, data } = memoryStore()
    const { latest } = renderWith(store)

    let seenInsideAct: string | undefined
    act(() => {
      latest().set(TIME_FORMAT, 'relative')
      seenInsideAct = latest().get(TIME_FORMAT)
    })

    expect(seenInsideAct).toBe('relative')
    expect(data.get('time_format')).toBe('"relative"')
    expect(screen.getByTestId('tf').textContent).toBe('relative')
    expect(latest().get(TIME_FORMAT)).toBe('relative')
  })

  test('列挙外・型不正の値は既定を保存し、get も既定を返す', () => {
    const { store, data } = memoryStore({ time_format: '"relative"' })
    const { latest } = renderWith(store)
    expect(latest().get(TIME_FORMAT)).toBe('relative')

    act(() => {
      ;(latest().set as unknown as (s: unknown, v: unknown) => void)(TIME_FORMAT, 'weekly')
    })
    expect(data.get('time_format')).toBe('"absolute"')
    expect(latest().get(TIME_FORMAT)).toBe('absolute')

    act(() => {
      latest().set(TIME_FORMAT, 'relative')
    })
    act(() => {
      ;(latest().set as unknown as (s: unknown, v: unknown) => void)(TIME_FORMAT, 42)
    })
    expect(data.get('time_format')).toBe('"absolute"')
    expect(latest().get(TIME_FORMAT)).toBe('absolute')
  })

  test('書込みが失敗（set が false）でも投げず、get と表示は新しい値になる', () => {
    const { store } = memoryStore({}, false)
    const { latest } = renderWith(store)

    expect(() => {
      act(() => {
        latest().set(TIME_FORMAT, 'relative')
      })
    }).not.toThrow()

    expect(latest().get(TIME_FORMAT)).toBe('relative')
    expect(screen.getByTestId('tf').textContent).toBe('relative')
  })

  test('同値の set を繰り返しても保存値は同じ', () => {
    const { store, data } = memoryStore()
    const { latest } = renderWith(store)
    act(() => {
      latest().set(TIME_FORMAT, 'relative')
    })
    act(() => {
      latest().set(TIME_FORMAT, 'relative')
    })
    expect(data.get('time_format')).toBe('"relative"')
    expect(latest().get(TIME_FORMAT)).toBe('relative')
  })

  test('登録されていない記述子は保存も状態更新もせず、get は記述子の既定値を返す', () => {
    const { store, data, setSpy } = memoryStore()
    const { latest } = renderWith(store)
    const stranger = { ...TIME_FORMAT }

    act(() => {
      latest().set(stranger, 'relative')
    })

    expect(setSpy).not.toHaveBeenCalled()
    expect(data.has('time_format')).toBe(false)
    expect(latest().get(TIME_FORMAT)).toBe('absolute')
    expect(latest().get(stranger)).toBe(stranger.default)
    // 正方向の対照: 登録済みの記述子なら書ける
    act(() => {
      latest().set(TIME_FORMAT, 'relative')
    })
    expect(data.get('time_format')).toBe('"relative"')
  })
})

describe('web-contract-20: get / set の同一性', () => {
  test('set と再描画をまたいでも get・set は同じ参照で、context の値だけが新しくなる', () => {
    const { latest, rerender, log } = renderWith(memoryStore().store)
    const before = latest()

    act(() => {
      latest().set(TIME_FORMAT, 'relative')
    })
    const afterSet = latest()
    expect(afterSet.get).toBe(before.get)
    expect(afterSet.set).toBe(before.set)
    expect(afterSet).not.toBe(before)

    rerender(
      <PreferencesProvider store={undefined}>
        <Recorder log={log} />
      </PreferencesProvider>,
    )
    expect(latest().get).toBe(before.get)
    expect(latest().set).toBe(before.set)
  })
})

describe('web-contract-20: 効果音の有効判定の注入', () => {
  test('provider の mount 時に 1 回だけ configureSfx を呼び、渡した関数は最新の sfxEnabled を返す', () => {
    const { store } = memoryStore({ sfx_enabled: 'false' })
    const { latest, rerender, log } = renderWith(store)

    expect(configureSfx).toHaveBeenCalledTimes(1)
    const isEnabled = configureSfx.mock.calls[0][0] as () => boolean
    expect(isEnabled()).toBe(false)

    act(() => {
      latest().set(SFX, true)
    })
    expect(isEnabled()).toBe(true)

    rerender(
      <PreferencesProvider store={store}>
        <Recorder log={log} />
      </PreferencesProvider>,
    )
    expect(configureSfx).toHaveBeenCalledTimes(1)
  })

  test('子の mount effect より前に注入される（子が prepareSfx を呼ぶ時点で注入済み）', () => {
    let callsSeenByChildEffect = -1
    function Child() {
      React.useEffect(() => {
        callsSeenByChildEffect = configureSfx.mock.calls.length
      }, [])
      return null
    }
    render(
      <PreferencesProvider store={memoryStore().store}>
        <Child />
      </PreferencesProvider>,
    )
    expect(callsSeenByChildEffect).toBe(1)
  })

  test('StrictMode でも、最後に注入された判定関数が切替後の値を返す', () => {
    const { store } = memoryStore({ sfx_enabled: 'false' })
    const log: Array<{ prefs: Prefs; timeFormat: string; ready: boolean }> = []
    render(
      <React.StrictMode>
        <PreferencesProvider store={store}>
          <Recorder log={log} />
        </PreferencesProvider>
      </React.StrictMode>,
    )
    const latestInjected = () => configureSfx.mock.calls[configureSfx.mock.calls.length - 1][0] as () => boolean
    expect(latestInjected()()).toBe(false)

    act(() => {
      log[log.length - 1].prefs.set(SFX, true)
    })
    expect(latestInjected()()).toBe(true)
  })
})
