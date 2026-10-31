// @vitest-environment node
// Preferences の設定宣言と codec の不変性（web-check-06）。渡した入力・返した値（入れ子を含む）を後から書き換えても、
// 次の読みと不変条件が変わらないことを検証する。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-06。
// verifies: web-contract-20
//
// 分類の理由: DOMAIN の settings.ts を値で import するので、台帳の閉じた集合 domainImportingNonUnit で固定される。
// infrastructure の localSettingsStore も値で import する（adapter 分類の実行時 import 検査を満たし、書込み・読込の複製を検証する）。
//
// RED 理由（実装前）: `@/lib/preferences/domain/settings`・`@/lib/preferences/infrastructure/localSettingsStore` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import {
  SETTING_CLASSIFICATION,
  WEEKLY_GOALS,
  defaultPlaybackSpeed,
  podcastPosition,
  seenAchievementIds,
  sfxEnabled,
  theme,
  timeFormat,
  volume,
} from '@/lib/preferences/domain/settings'
import { LOCAL_SETTING_BINDINGS, createLocalSettingsStore } from '@/lib/preferences/infrastructure/localSettingsStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

// ---------------------------------------------------------------------------
// 深い凍結の検査 helper: plain object と配列をすべての深さで辿る（関数は辿らない）。
// ---------------------------------------------------------------------------
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function unfrozenNodes(value: unknown, where = '$'): string[] {
  const found: string[] = []
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    ;(value as unknown[]).forEach((item, index) => found.push(...unfrozenNodes(item, `${where}[${index}]`)))
  } else if (isPlain(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    for (const [key, child] of Object.entries(value)) {
      found.push(...unfrozenNodes(child, `${where}.${key}`))
    }
  }
  return found
}

function expectDeeplyFrozen(label: string, value: unknown): void {
  expect(unfrozenNodes(value, label), `${label} に凍結されていない node がある`).toEqual([])
}

function memoryStore(): { store: KeyValueStore; data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    store: {
      get: (key) => data.get(key) ?? null,
      set: (key, value) => {
        data.set(key, value)
        return true
      },
      remove: (key) => {
        data.delete(key)
      },
    },
  }
}

describe('web-check-06 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
    expect(unfrozenNodes(Object.freeze({ list: [{ x: 1 }] }))).toEqual(['$.list', '$.list[0]'])
  })
})

describe('web-check-06: domain の宣言は全深さで凍結されている', () => {
  test.each([
    ['defaultPlaybackSpeed', defaultPlaybackSpeed],
    ['seenAchievementIds', seenAchievementIds],
    ['podcastPosition', podcastPosition],
    ['timeFormat', timeFormat],
    ['theme', theme],
    ['sfxEnabled', sfxEnabled],
    ['volume', volume],
  ])('記述子 %s', (label, descriptor) => {
    expectDeeplyFrozen(label, descriptor)
  })

  test('分類一覧と WEEKLY_GOALS', () => {
    expectDeeplyFrozen('SETTING_CLASSIFICATION', SETTING_CLASSIFICATION)
    expectDeeplyFrozen('WEEKLY_GOALS', WEEKLY_GOALS)
  })

  test('凍結した記述子の property は代入で変えられない', () => {
    const attempt = () => {
      ;(defaultPlaybackSpeed as unknown as { default: number }).default = 2
    }
    expect(attempt).toThrow()
    expect(defaultPlaybackSpeed.default).toBe(1.0)
  })
})

describe('web-check-06: normalize は入力を複製し、返り値を凍結する', () => {
  test('渡した配列を後から書き換えても返り値は変わらず、返り値は凍結されている', () => {
    const input = ['a']
    const out = seenAchievementIds.normalize(input)
    input.push('b')
    expect(out).toEqual(['a'])
    expect(out).not.toBe(input)
    expectDeeplyFrozen('normalize の返り値', out)
    expect(() => {
      ;(out as string[]).push('c')
    }).toThrow()
    expect(seenAchievementIds.normalize(['a'])).toEqual(['a'])
  })

  test('値域外の入力から返す既定の配列も凍結され、書き換えても次の返り値は空のまま', () => {
    const out = seenAchievementIds.normalize(null)
    expectDeeplyFrozen('既定の返り値', out)
    expect(() => {
      ;(out as string[]).push('x')
    }).toThrow()
    expect(seenAchievementIds.normalize(null)).toEqual([])
    expect(seenAchievementIds.default).toEqual([])
  })
})

describe('web-check-06: infrastructure の束ね物と read/write の不変性', () => {
  test('束ね物とその各要素は凍結されている（key・decode・encode を差し替えられない）', () => {
    expectDeeplyFrozen('LOCAL_SETTING_BINDINGS', LOCAL_SETTING_BINDINGS)
    expect(() => {
      ;(LOCAL_SETTING_BINDINGS.theme as unknown as { key: string }).key = 'other'
    }).toThrow()
    expect(LOCAL_SETTING_BINDINGS.theme.key).toBe('theme')
  })

  test('write に渡した配列を後から書き換えても、保存値・次の read・write の返り値は変わらない', () => {
    const { store, data } = memoryStore()
    const settings = createLocalSettingsStore(store)
    const setting = LOCAL_SETTING_BINDINGS.seenAchievementIds.setting
    const input = ['a']

    const written = settings.write(setting, input)
    input.push('b')

    expect(written).toEqual(['a'])
    expect(written).not.toBe(input)
    expect(Object.isFrozen(written)).toBe(true)
    expect(data.get('seen_achievement_ids')).toBe('["a"]')
    expect(settings.read(setting)).toEqual(['a'])
  })

  test('read の返り値は凍結され、書き換えを試みても次の read は変わらない', () => {
    const { store, data } = memoryStore()
    data.set('seen_achievement_ids', '["a"]')
    const settings = createLocalSettingsStore(store)
    const setting = LOCAL_SETTING_BINDINGS.seenAchievementIds.setting

    const first = settings.read(setting)
    expect(Object.isFrozen(first)).toBe(true)
    expect(() => {
      ;(first as string[]).push('b')
    }).toThrow()
    expect(settings.read(setting)).toEqual(['a'])
    expect(data.get('seen_achievement_ids')).toBe('["a"]')
  })
})
