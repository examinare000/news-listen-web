// 端末の位置 adapter の契約テスト（web-deriv-20）。key と形式は旧実装（hooks/useAudioPlayer.ts）と同じ。
//
// RED 理由: `@/lib/playback/infrastructure/localPositionStore` がまだ存在しない。
import { describe, test, expect } from 'vitest'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

function createKv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const sets: Array<[string, string]> = []
  const kv: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      sets.push([key, value])
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
  return { kv, sets }
}

describe('verifies: CI-T41 createLocalPositionStore（web-deriv-20）', () => {
  test('write は podcast_position:{id} に JSON.stringify(seconds) を書く', () => {
    const { kv, sets } = createKv()
    createLocalPositionStore(kv).write('p1', 12.5)
    expect(sets).toEqual([['podcast_position:p1', '12.5']])
  })

  test('read は write した値を返す（往復）', () => {
    const { kv } = createKv()
    const store = createLocalPositionStore(kv)
    store.write('p1', 42)
    expect(store.read('p1')).toBe(42)
  })

  test('旧実装が書いた値を読める', () => {
    const { kv } = createKv({ 'podcast_position:old': '73.25' })
    expect(createLocalPositionStore(kv).read('old')).toBe(73.25)
  })

  test.each([
    ['未保存', null],
    ['0', '0'],
    ['負', '-3'],
    ['数でない JSON', '"5"'],
    ['null', 'null'],
    ['壊れた JSON', 'abc'],
    ['有限でない（1e999）', '1e999'],
  ])('有限の正数でなければ null: %s', (_name, raw) => {
    const { kv } = createKv(raw === null ? {} : { 'podcast_position:p1': raw })
    expect(createLocalPositionStore(kv).read('p1')).toBeNull()
  })

  test('clearAll を宣言しない（web-slice-departure-02 が足す）', () => {
    const { kv } = createKv()
    expect('clearAll' in createLocalPositionStore(kv)).toBe(false)
  })
})
