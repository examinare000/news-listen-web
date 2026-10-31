// verifies: web-contract-20（registry の key と codec。保存形式は変えない）
// infrastructure の設定の key と codec を、KeyValueStore の double と結んで検証する。
// 記述子は settings.ts を値で import せず、束ね物（LOCAL_SETTING_BINDINGS）から得る。
//
// RED 理由（実装前）: `@/lib/preferences/infrastructure/localSettingsStore` が無い（module not found）。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  KEY_DEFAULT_PLAYBACK_SPEED,
  KEY_PLAYER_VOLUME,
  KEY_SEEN_ACHIEVEMENT_IDS,
  KEY_SFX_ENABLED,
  KEY_THEME,
  KEY_TIME_FORMAT,
  LOCAL_SETTING_BINDINGS,
  createLocalSettingsStore,
} from '@/lib/preferences/infrastructure/localSettingsStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

const B = LOCAL_SETTING_BINDINGS

function memoryStore(initial: Record<string, string> = {}, setResult = true) {
  const data = new Map<string, string>(Object.entries(initial))
  const sets: Array<[string, string]> = []
  const store: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      sets.push([key, value])
      if (setResult) data.set(key, value)
      return setResult
    },
    remove: (key) => {
      data.delete(key)
    },
  }
  return { store, data, sets }
}

// 値域外の値を渡す 1 箇所の型の外し口（this を保つためメソッド呼出のまま渡す）
function writeUnchecked(
  settings: ReturnType<typeof createLocalSettingsStore>,
  setting: unknown,
  value: unknown,
): unknown {
  return (settings as unknown as { write: (s: unknown, v: unknown) => unknown }).write(setting, value)
}

describe('web-contract-20: key 定数と束ね物', () => {
  test('6 つの key 定数は保存形式の表の文字列と一致する', () => {
    expect(KEY_DEFAULT_PLAYBACK_SPEED).toBe('default_playback_speed')
    expect(KEY_SEEN_ACHIEVEMENT_IDS).toBe('seen_achievement_ids')
    expect(KEY_TIME_FORMAT).toBe('time_format')
    expect(KEY_THEME).toBe('theme')
    expect(KEY_SFX_ENABLED).toBe('sfx_enabled')
    expect(KEY_PLAYER_VOLUME).toBe('player_volume')
  })

  test('束ね物は記述子の id をキーにした 6 件で、podcastPosition を含まない', () => {
    expect(Object.keys(B).sort()).toEqual([
      'defaultPlaybackSpeed',
      'seenAchievementIds',
      'sfxEnabled',
      'theme',
      'timeFormat',
      'volume',
    ])
  })

  test('各束ね物の setting.id は自分のキーと一致し、key は対応する定数である', () => {
    expect(B.defaultPlaybackSpeed.setting.id).toBe('defaultPlaybackSpeed')
    expect(B.seenAchievementIds.setting.id).toBe('seenAchievementIds')
    expect(B.timeFormat.setting.id).toBe('timeFormat')
    expect(B.theme.setting.id).toBe('theme')
    expect(B.sfxEnabled.setting.id).toBe('sfxEnabled')
    expect(B.volume.setting.id).toBe('volume')

    expect(B.defaultPlaybackSpeed.key).toBe(KEY_DEFAULT_PLAYBACK_SPEED)
    expect(B.seenAchievementIds.key).toBe(KEY_SEEN_ACHIEVEMENT_IDS)
    expect(B.timeFormat.key).toBe(KEY_TIME_FORMAT)
    expect(B.theme.key).toBe(KEY_THEME)
    expect(B.sfxEnabled.key).toBe(KEY_SFX_ENABLED)
    expect(B.volume.key).toBe(KEY_PLAYER_VOLUME)
  })
})

describe('web-contract-20: read（保存形式の表どおりに復元し、不正値は既定へ）', () => {
  test.each<[string, string, string, unknown]>([
    ['defaultPlaybackSpeed の JSON 数値', 'default_playback_speed', '1.5', 1.5],
    ['defaultPlaybackSpeed の 8 段外', 'default_playback_speed', '1.2', 1],
    ['defaultPlaybackSpeed の壊れた JSON', 'default_playback_speed', 'not-json', 1],
    ['timeFormat の JSON 文字列', 'time_format', '"relative"', 'relative'],
    ['timeFormat の列挙外', 'time_format', '"weekly"', 'absolute'],
    ['timeFormat の壊れた JSON', 'time_format', 'relative', 'absolute'],
    ['sfxEnabled の false', 'sfx_enabled', 'false', false],
    ['sfxEnabled の true', 'sfx_enabled', 'true', true],
    ['sfxEnabled の壊れた JSON', 'sfx_enabled', 'abc', true],
    ['sfxEnabled の JSON 文字列 "abc"', 'sfx_enabled', '"abc"', true],
    ['volume の範囲内', 'player_volume', '0.5', 0.5],
    ['volume の範囲外', 'player_volume', '2', 1],
    ['volume の壊れた JSON', 'player_volume', 'loud', 1],
  ])('%s', (_label, key, stored, expected) => {
    const { store } = memoryStore({ [key]: stored })
    const settings = createLocalSettingsStore(store)
    const binding = Object.values(B).find((b) => b.key === key)!
    expect(settings.read(binding.setting as never)).toEqual(expected)
  })

  test('seenAchievementIds は JSON の文字列配列を復元し、壊れた値・配列以外・文字列以外の要素は []', () => {
    const read = (stored: string) =>
      createLocalSettingsStore(memoryStore({ seen_achievement_ids: stored }).store).read(B.seenAchievementIds.setting)
    expect(read('["a","b"]')).toEqual(['a', 'b'])
    expect(read('not-json')).toEqual([])
    expect(read('{"a":1}')).toEqual([])
    expect(read('["a",1]')).toEqual([])
  })

  test('theme は生文字列で読む（JSON の "light" は不正値として dark）', () => {
    const read = (stored: string) =>
      createLocalSettingsStore(memoryStore({ theme: stored }).store).read(B.theme.setting)
    expect(read('light')).toBe('light')
    expect(read('dark')).toBe('dark')
    expect(read('"light"')).toBe('dark')
    expect(read('blue')).toBe('dark')
  })

  test('欠落した key は 6 設定とも既定値を返す', () => {
    const settings = createLocalSettingsStore(memoryStore().store)
    expect(settings.read(B.defaultPlaybackSpeed.setting)).toBe(1.0)
    expect(settings.read(B.seenAchievementIds.setting)).toEqual([])
    expect(settings.read(B.timeFormat.setting)).toBe('absolute')
    expect(settings.read(B.theme.setting)).toBe('dark')
    expect(settings.read(B.sfxEnabled.setting)).toBe(true)
    expect(settings.read(B.volume.setting)).toBe(1.0)
  })
})

describe('web-contract-20: 読み込みが失敗する環境（private browsing 等）', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test('getItem が投げても 6 設定とも投げずに既定値を返す（保存値があれば読めることとの対）', () => {
    localStorage.setItem('time_format', '"relative"')
    localStorage.setItem('theme', 'light')
    localStorage.setItem('sfx_enabled', 'false')
    localStorage.setItem('player_volume', '0.3')
    localStorage.setItem('default_playback_speed', '1.5')
    localStorage.setItem('seen_achievement_ids', '["a"]')
    const settings = createLocalSettingsStore(createBrowserKeyValueStore())
    expect(settings.read(B.timeFormat.setting)).toBe('relative')
    expect(settings.read(B.theme.setting)).toBe('light')
    expect(settings.read(B.sfxEnabled.setting)).toBe(false)
    expect(settings.read(B.volume.setting)).toBe(0.3)
    expect(settings.read(B.defaultPlaybackSpeed.setting)).toBe(1.5)
    expect(settings.read(B.seenAchievementIds.setting)).toEqual(['a'])

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    expect(settings.read(B.timeFormat.setting)).toBe('absolute')
    expect(settings.read(B.theme.setting)).toBe('dark')
    expect(settings.read(B.sfxEnabled.setting)).toBe(true)
    expect(settings.read(B.volume.setting)).toBe(1.0)
    expect(settings.read(B.defaultPlaybackSpeed.setting)).toBe(1.0)
    expect(settings.read(B.seenAchievementIds.setting)).toEqual([])
  })
})

describe('web-contract-20: write（保存形式の表どおりに保存し、正規化値を返す）', () => {
  test('正常値は表の形式で保存され、同じ値が返る', () => {
    const { store, data } = memoryStore()
    const settings = createLocalSettingsStore(store)
    expect(settings.write(B.defaultPlaybackSpeed.setting, 1.5)).toBe(1.5)
    expect(settings.write(B.timeFormat.setting, 'relative')).toBe('relative')
    expect(settings.write(B.theme.setting, 'light')).toBe('light')
    expect(settings.write(B.sfxEnabled.setting, false)).toBe(false)
    expect(settings.write(B.volume.setting, 0.4)).toBe(0.4)
    expect(settings.write(B.seenAchievementIds.setting, ['a', 'b'])).toEqual(['a', 'b'])

    expect(data.get('default_playback_speed')).toBe('1.5')
    expect(data.get('time_format')).toBe('"relative"')
    expect(data.get('theme')).toBe('light')
    expect(data.get('sfx_enabled')).toBe('false')
    expect(data.get('player_volume')).toBe('0.4')
    expect(data.get('seen_achievement_ids')).toBe('["a","b"]')
  })

  test('値域外の値は既定へ正規化して保存し、正規化値を返す', () => {
    const { store, data } = memoryStore()
    const settings = createLocalSettingsStore(store)
    expect(writeUnchecked(settings, B.defaultPlaybackSpeed.setting, 1.2)).toBe(1)
    expect(writeUnchecked(settings, B.timeFormat.setting, 'x')).toBe('absolute')
    expect(writeUnchecked(settings, B.theme.setting, 'blue')).toBe('dark')
    expect(writeUnchecked(settings, B.sfxEnabled.setting, 'abc')).toBe(true)
    expect(writeUnchecked(settings, B.volume.setting, 2)).toBe(1)
    expect(writeUnchecked(settings, B.seenAchievementIds.setting, ['a', 1])).toEqual([])

    expect(data.get('default_playback_speed')).toBe('1')
    expect(data.get('time_format')).toBe('"absolute"')
    expect(data.get('theme')).toBe('dark')
    expect(data.get('sfx_enabled')).toBe('true')
    expect(data.get('player_volume')).toBe('1')
    expect(data.get('seen_achievement_ids')).toBe('[]')
  })

  test('書込み一巡: write した値を新しい store から read できる', () => {
    const { store } = memoryStore()
    const writer = createLocalSettingsStore(store)
    writer.write(B.timeFormat.setting, 'relative')
    writer.write(B.theme.setting, 'light')
    const reader = createLocalSettingsStore(store)
    expect(reader.read(B.timeFormat.setting)).toBe('relative')
    expect(reader.read(B.theme.setting)).toBe('light')
  })

  test('KeyValueStore の set が false を返しても投げず、正規化値を返す', () => {
    const { store, sets } = memoryStore({}, false)
    const settings = createLocalSettingsStore(store)
    expect(() => settings.write(B.timeFormat.setting, 'relative')).not.toThrow()
    expect(settings.write(B.timeFormat.setting, 'relative')).toBe('relative')
    expect(sets.length).toBeGreaterThan(0)
  })

  test('同値の 2 回の write は保存値・返り値とも 1 回と同じ', () => {
    const { store, data } = memoryStore()
    const settings = createLocalSettingsStore(store)
    const first = settings.write(B.volume.setting, 0.4)
    const second = settings.write(B.volume.setting, 0.4)
    expect(second).toBe(first)
    expect(data.get('player_volume')).toBe('0.4')
  })
})

describe('web-contract-20: 束ね物に無い記述子は拒否する（registry 外）', () => {
  test('read は既定値を返し、KeyValueStore を読まない', () => {
    const { store } = memoryStore({ theme: 'light' })
    const get = vi.spyOn(store, 'get')
    const settings = createLocalSettingsStore(store)
    // 同じ id・同じ中身でも別オブジェクトは registry の記述子ではない
    const stranger = { ...B.theme.setting }
    expect(settings.read(stranger)).toBe('dark')
    expect(get).not.toHaveBeenCalled()
    // 正方向の対照: 登録済みの記述子なら保存値が読める
    expect(settings.read(B.theme.setting)).toBe('light')
    expect(get).toHaveBeenCalledWith('theme')
  })

  test('write は KeyValueStore へ書かず、既定値を返す', () => {
    const { store, sets, data } = memoryStore()
    const settings = createLocalSettingsStore(store)
    const stranger = { ...B.theme.setting }
    expect(settings.write(stranger, 'light')).toBe('dark')
    expect(sets).toEqual([])
    expect(data.has('theme')).toBe(false)
    // 正方向の対照: 登録済みの記述子なら書ける
    settings.write(B.theme.setting, 'light')
    expect(data.get('theme')).toBe('light')
  })
})
