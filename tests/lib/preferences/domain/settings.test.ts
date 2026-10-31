// @vitest-environment node
// verifies: web-contract-20（registry の値域・既定値・分類。I/O なし）
// 設定の宣言（値域の検査・既定値・主体依存の分類）を、保存先や React から切り離して検証する。
// 速度の一覧は @/lib/playback/domain/session を import せず、リテラルの値と比べる（台帳の unit 分類を保つため）。
//
// RED 理由（実装前）: `@/lib/preferences/domain/settings` が無い（module not found）。
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

const EIGHT_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5]

describe('web-contract-20: defaultPlaybackSpeed の値域', () => {
  test.each(EIGHT_SPEEDS)('8 段の速度 %s はそのまま返す', (speed) => {
    expect(defaultPlaybackSpeed.normalize(speed)).toBe(speed)
  })

  test.each<[string, unknown]>([
    ['8 段にない数値 1.2', 1.2],
    ['0', 0],
    ['負数', -1],
    ['数値の文字列 "1.5"', '1.5'],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('値域外（%s）は 1.0 にする', (_label, raw) => {
    expect(defaultPlaybackSpeed.normalize(raw)).toBe(1.0)
  })

  test('既定値は 1.0', () => {
    expect(defaultPlaybackSpeed.default).toBe(1.0)
  })
})

describe('web-contract-20: seenAchievementIds の値域', () => {
  test('文字列だけの配列は等値の別参照（凍結）で返す', () => {
    const input = ['a', 'b']
    const out = seenAchievementIds.normalize(input)
    expect(out).toEqual(['a', 'b'])
    expect(out).not.toBe(input)
  })

  test('空配列はそのまま空配列', () => {
    expect(seenAchievementIds.normalize([])).toEqual([])
  })

  test.each<[string, unknown]>([
    ['数値を含む配列', ['a', 1]],
    ['null を含む配列', ['a', null]],
    ['オブジェクト', {}],
    ['文字列', 'x'],
    ['null', null],
    ['undefined', undefined],
  ])('値域外（%s）は空配列にする', (_label, raw) => {
    expect(seenAchievementIds.normalize(raw)).toEqual([])
  })

  test('既定値は空配列', () => {
    expect(seenAchievementIds.default).toEqual([])
  })
})

describe('web-contract-20: timeFormat・theme の値域', () => {
  test.each(['absolute', 'relative'])('timeFormat %s はそのまま返す', (value) => {
    expect(timeFormat.normalize(value)).toBe(value)
  })

  test.each<[string, unknown]>([
    ['列挙外の文字列', 'x'],
    ['数値', 1],
    ['null', null],
    ['引用符つき', '"relative"'],
  ])('timeFormat の値域外（%s）は absolute にする', (_label, raw) => {
    expect(timeFormat.normalize(raw)).toBe('absolute')
  })

  test.each(['dark', 'light'])('theme %s はそのまま返す', (value) => {
    expect(theme.normalize(value)).toBe(value)
  })

  test.each<[string, unknown]>([
    ['引用符つきの "light"', '"light"'],
    ['列挙外の文字列', 'blue'],
    ['数値', 0],
    ['null', null],
  ])('theme の値域外（%s）は dark にする', (_label, raw) => {
    expect(theme.normalize(raw)).toBe('dark')
  })

  test('既定値は timeFormat=absolute・theme=dark', () => {
    expect(timeFormat.default).toBe('absolute')
    expect(theme.default).toBe('dark')
  })
})

describe('web-contract-20: sfxEnabled・volume の値域', () => {
  test('sfxEnabled は false のときだけ false、true はそのまま', () => {
    expect(sfxEnabled.normalize(false)).toBe(false)
    expect(sfxEnabled.normalize(true)).toBe(true)
  })

  test.each<[string, unknown]>([
    ['文字列 "abc"', 'abc'],
    ['数値 0', 0],
    ['null', null],
    ['undefined', undefined],
  ])('sfxEnabled の値域外（%s）は有効（true）にする', (_label, raw) => {
    expect(sfxEnabled.normalize(raw)).toBe(true)
  })

  test.each([0, 1, 0.4])('volume は [0, 1] の %s をそのまま返す', (value) => {
    expect(volume.normalize(value)).toBe(value)
  })

  test.each<[string, unknown]>([
    ['-0.1', -0.1],
    ['1.1', 1.1],
    ['文字列 "0.5"', '0.5'],
    ['NaN', Number.NaN],
    ['null', null],
  ])('volume の値域外（%s）は 1.0 にする', (_label, raw) => {
    expect(volume.normalize(raw)).toBe(1.0)
  })

  test('既定値は sfxEnabled=true・volume=1.0', () => {
    expect(sfxEnabled.default).toBe(true)
    expect(volume.default).toBe(1.0)
  })
})

describe('web-contract-20: normalize は冪等（値域外の入力でも 2 回目で変わらない）', () => {
  const cases: ReadonlyArray<readonly [string, { normalize: (raw: unknown) => unknown }, unknown]> = [
    ['defaultPlaybackSpeed', defaultPlaybackSpeed, 1.2],
    ['seenAchievementIds', seenAchievementIds, ['a', 1]],
    ['timeFormat', timeFormat, 'x'],
    ['theme', theme, '"light"'],
    ['sfxEnabled', sfxEnabled, 'abc'],
    ['volume', volume, 2],
  ]

  test.each(cases)('%s', (_id, setting, raw) => {
    const once = setting.normalize(raw)
    expect(setting.normalize(once)).toEqual(once)
  })
})

describe('web-contract-20: 主体依存の分類（共有仕様 §6.5 の web 列）', () => {
  const idsBy = (subjectScoped: boolean) =>
    SETTING_CLASSIFICATION.filter((s) => s.subjectScoped === subjectScoped)
      .map((s) => s.id)
      .sort()

  test('主体依存は defaultPlaybackSpeed・seenAchievementIds・podcastPosition だけ', () => {
    expect(idsBy(true)).toEqual(['defaultPlaybackSpeed', 'podcastPosition', 'seenAchievementIds'])
  })

  test('主体非依存は sfxEnabled・theme・timeFormat・volume だけ', () => {
    expect(idsBy(false)).toEqual(['sfxEnabled', 'theme', 'timeFormat', 'volume'])
  })

  test('分類一覧は 7 件で、全て scope が local', () => {
    expect(SETTING_CLASSIFICATION).toHaveLength(7)
    expect(new Set(SETTING_CLASSIFICATION.map((s) => s.scope))).toEqual(new Set(['local']))
  })

  test('分類一覧の要素は export した記述子そのもの（podcastPosition を含む）', () => {
    expect(SETTING_CLASSIFICATION).toEqual(
      expect.arrayContaining([
        defaultPlaybackSpeed,
        seenAchievementIds,
        podcastPosition,
        timeFormat,
        theme,
        sfxEnabled,
        volume,
      ]),
    )
    expect(SETTING_CLASSIFICATION.every((s) => typeof s.id === 'string')).toBe(true)
  })

  test('podcastPosition は分類だけを宣言し、主体依存の local 設定である', () => {
    expect(podcastPosition.id).toBe('podcastPosition')
    expect(podcastPosition.scope).toBe('local')
    expect(podcastPosition.subjectScoped).toBe(true)
  })
})

describe('web-contract-20: WEEKLY_GOALS', () => {
  test('3・5・7・10 をこの順で持つ', () => {
    expect([...WEEKLY_GOALS]).toEqual([3, 5, 7, 10])
  })
})
