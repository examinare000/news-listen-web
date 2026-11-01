// 端末の位置 adapter の契約テスト（web-deriv-20）。key と形式は旧実装（hooks/useAudioPlayer.ts）と同じ。
//
// RED 理由（clearAll）: LocalPositionStore.clearAll と KeyEnumerableStore が未実装。
import { describe, test, expect } from 'vitest'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import type { KeyEnumerableStore } from '@/lib/platform/keyValueStore'

function createKv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const sets: Array<[string, string]> = []
  const kv: KeyEnumerableStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      sets.push([key, value])
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
    keys: () => [...data.keys()],
  }
  return { kv, sets, data }
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

  test('shared-leave-01: clearAll は podcast_position: で始まる key だけを消し、他の key は残す', () => {
    const { kv, data } = createKv({
      'podcast_position:p1': '1',
      'podcast_position:p2': '2',
      podcast_positionX: '3',
      theme: 'dark',
      default_playback_speed: '1.5',
    })
    createLocalPositionStore(kv).clearAll()
    expect([...data.keys()].sort()).toEqual(['default_playback_speed', 'podcast_positionX', 'theme'])
  })

  test('shared-leave-01: clearAll の後の read は null で、2 回目の clearAll は何も消さない', () => {
    const { kv, data } = createKv({ 'podcast_position:p1': '9', theme: 'dark' })
    const store = createLocalPositionStore(kv)
    store.clearAll()
    expect(store.read('p1')).toBeNull()
    store.clearAll()
    expect([...data.keys()]).toEqual(['theme'])
  })
})
