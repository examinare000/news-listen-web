// @vitest-environment node
// verifies: web-resp-prefs（端末の設定の値の持ち主は application。React・localStorage なしで観測する）
// storage は手書きの fake（Map）で置き換える。infrastructure・platform・@/lib/playback/domain/session は import しない
// （台帳の subject 対応を変えないため。速度はリテラルで書く）。
//
// RED 理由（実装前）: `@/lib/preferences/application/localSettings` が無い（module not found）。
import { describe, expect, test, vi } from 'vitest'
import { createLocalSettings } from '@/lib/preferences/application/localSettings'
import type { LocalSettingsStorage } from '@/lib/preferences/application/localSettings'
import {
  defaultPlaybackSpeed,
  theme,
  timeFormat,
} from '@/lib/preferences/domain/settings'
import type { SettingDescriptor } from '@/lib/preferences/domain/settings'

interface FakeStorage extends LocalSettingsStorage {
  readonly saved: Map<string, unknown>
  readonly reads: string[]
  readonly writes: string[]
  readonly clears: { count: number }
}

/** 保存が無ければ default、あれば normalize を通した値を返す（infrastructure の責務を模す）。 */
function createFakeStorage(
  initial: Record<string, unknown> = {},
  options: { readonly writeError?: Error } = {},
): FakeStorage {
  const saved = new Map<string, unknown>(Object.entries(initial))
  const reads: string[] = []
  const writes: string[] = []
  const clears = { count: 0 }
  return {
    saved,
    reads,
    writes,
    clears,
    read: <T>(setting: SettingDescriptor<T>): T => {
      reads.push(setting.id)
      return saved.has(setting.id) ? setting.normalize(saved.get(setting.id)) : setting.default
    },
    write: <T>(setting: SettingDescriptor<T>, value: T): T => {
      if (options.writeError) throw options.writeError
      writes.push(setting.id)
      const normalized = setting.normalize(value)
      saved.set(setting.id, normalized)
      return normalized
    },
    clearSubjectScoped: () => {
      clears.count += 1
    },
  }
}

const REGISTERED = [timeFormat, theme, defaultPlaybackSpeed] as const

function build(storage: LocalSettingsStorage) {
  return createLocalSettings({ storage, settings: REGISTERED })
}

describe('createLocalSettings: 組み立て', () => {
  test('記述子ごとに storage を 1 回読み、その値を初期値にする。version は 0', () => {
    const storage = createFakeStorage({ timeFormat: 'relative' })
    const settings = build(storage)

    expect(settings.get(timeFormat)).toBe('relative')
    expect(settings.get(theme)).toBe('dark')
    expect([...storage.reads].sort()).toEqual(['defaultPlaybackSpeed', 'theme', 'timeFormat'])
    expect(settings.version()).toBe(0)
  })
})

describe('createLocalSettings: set（登録済み）', () => {
  test('write の戻り値（正規化済み）を保持し、直後の get が新しい値を返す。範囲外は既定へ正規化', () => {
    const storage = createFakeStorage()
    const settings = build(storage)

    settings.set(timeFormat, 'relative')
    expect(settings.get(timeFormat)).toBe('relative')
    expect(storage.saved.get('timeFormat')).toBe('relative')

    settings.set(defaultPlaybackSpeed, 9 as never)
    expect(storage.saved.get('defaultPlaybackSpeed')).toBe(1.0)
    expect(settings.get(defaultPlaybackSpeed)).toBe(1.0)
  })

  test('write が throw したら例外を伝播し、値・version・通知は変わらない', () => {
    const failure = new Error('write failed')
    const settings = build(createFakeStorage({}, { writeError: failure }))
    const listener = vi.fn()
    settings.subscribe(listener)

    expect(() => settings.set(timeFormat, 'relative')).toThrow(failure)
    expect(settings.get(timeFormat)).toBe('absolute')
    expect(settings.version()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createLocalSettings: set（登録外）', () => {
  test('登録外（複製した記述子）は write・保持・通知・version のどれも起こさず、既定値を返す', () => {
    const storage = createFakeStorage()
    const settings = build(storage)
    const listener = vi.fn()
    settings.subscribe(listener)
    const stranger: SettingDescriptor<'absolute' | 'relative'> = { ...timeFormat }

    settings.set(stranger, 'relative')

    expect(storage.writes).toEqual([])
    expect(listener).not.toHaveBeenCalled()
    expect(settings.version()).toBe(0)
    expect(settings.get(stranger)).toBe('absolute')

    // 対照: 登録済みの記述子は書ける
    settings.set(timeFormat, 'relative')
    expect(storage.writes).toEqual(['timeFormat'])
    expect(settings.get(timeFormat)).toBe('relative')
  })
})

describe('createLocalSettings: 通知と version', () => {
  test('通知は 1 回ずつで、listener の中の version は増えた後の値。解除後は通知されない', () => {
    const settings = build(createFakeStorage())
    const seen: number[] = []
    const unsubscribe = settings.subscribe(() => {
      seen.push(settings.version())
    })

    settings.set(timeFormat, 'relative')
    settings.clearSubjectScoped()
    expect(seen).toEqual([1, 2])

    unsubscribe()
    settings.set(theme, 'light')
    expect(seen).toEqual([1, 2])
    expect(settings.version()).toBe(3)
  })
})

describe('createLocalSettings: clearSubjectScoped', () => {
  test('主体依存の設定だけを既定へ戻し、他は保持する。storage の clearSubjectScoped を 1 回呼ぶ', () => {
    const storage = createFakeStorage()
    const settings = build(storage)
    settings.set(defaultPlaybackSpeed, 1.5)
    settings.set(timeFormat, 'relative')
    settings.set(theme, 'light')

    settings.clearSubjectScoped()

    expect(settings.get(defaultPlaybackSpeed)).toBe(1.0)
    expect(settings.get(timeFormat)).toBe('relative')
    expect(settings.get(theme)).toBe('light')
    expect(storage.clears.count).toBe(1)
  })
})
