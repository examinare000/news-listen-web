// 端末の位置 adapter の契約テスト（web-deriv-20）。主体 × episode ごとに最新 1 件の記録を localStorage 相当の KV に持つ。
//
// RED 理由: 旧実装は podcast_position:{id} に位置の数値だけを書く。主体・記録時刻・送信済みの印・unsent・markSynced・
// clearSubject・reclaim・discardLegacy が未実装。
import { describe, test, expect } from 'vitest'
import { createLocalPositionStore, positionRecordKey } from '@/lib/playback/infrastructure/localPositionStore'
import type { KeyEnumerableStore } from '@/lib/platform/keyValueStore'

function createKv(initial: Record<string, string> = {}, opts: { failSet?: boolean } = {}) {
  const data = new Map(Object.entries(initial))
  const sets: Array<[string, string]> = []
  const kv: KeyEnumerableStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      if (opts.failSet) return false
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

function json(position: number, recordedAt: number, synced: boolean): string {
  return JSON.stringify({ position, recorded_at: recordedAt, synced })
}

describe('verifies: CI-T41 createLocalPositionStore（web-deriv-20）', () => {
  test('ADR-109 決定 7（新規）: write は playback_position_record:{userId}:{episodeId} に JSON を書く', () => {
    const { kv, sets } = createKv()
    const written = createLocalPositionStore(kv).write('u-a', 'p1', { positionSeconds: 12.5, recordedAt: 1000, synced: false })
    expect(written).toBe(true)
    expect(sets).toEqual([['playback_position_record:u-a:p1', '{"position":12.5,"recorded_at":1000,"synced":false}']])
  })

  test('write は保存に失敗すると false を返し、何も書かない', () => {
    const { kv, data } = createKv({}, { failSet: true })
    const written = createLocalPositionStore(kv).write('u-a', 'p1', { positionSeconds: 1, recordedAt: 1000, synced: false })
    expect(written).toBe(false)
    expect(data.size).toBe(0)
  })

  test('write は同じ主体・episode の記録を上書きし、主体が違えば別の key に持つ', () => {
    const { kv, data } = createKv()
    const store = createLocalPositionStore(kv)
    store.write('u-a', 'p1', { positionSeconds: 1, recordedAt: 1000, synced: false })
    store.write('u-a', 'p1', { positionSeconds: 2, recordedAt: 2000, synced: false })
    store.write('u-b', 'p1', { positionSeconds: 9, recordedAt: 3000, synced: false })
    expect([...data.keys()].sort()).toEqual(['playback_position_record:u-a:p1', 'playback_position_record:u-b:p1'])
    expect(store.read('u-a', 'p1')).toEqual({ positionSeconds: 2, recordedAt: 2000, synced: false })
    expect(store.read('u-b', 'p1')).toEqual({ positionSeconds: 9, recordedAt: 3000, synced: false })
  })

  test('positionRecordKey は書き込みの key と同じ形を返す', () => {
    expect(positionRecordKey('u-a', 'p1')).toBe('playback_position_record:u-a:p1')
  })

  test('read は write した記録を返す（往復。位置 0 も有効）', () => {
    const { kv } = createKv()
    const store = createLocalPositionStore(kv)
    store.write('u-a', 'p1', { positionSeconds: 42, recordedAt: 1000, synced: false })
    store.write('u-a', 'p0', { positionSeconds: 0, recordedAt: 1000, synced: true })
    expect(store.read('u-a', 'p1')).toEqual({ positionSeconds: 42, recordedAt: 1000, synced: false })
    expect(store.read('u-a', 'p0')).toEqual({ positionSeconds: 0, recordedAt: 1000, synced: true })
  })

  test('shared-dec-32 / ADR-109 決定 10（旧い記録）: 旧い形は読まず、discardLegacy が消す', () => {
    const { kv, data } = createKv({
      'podcast_position:old': '73.25',
      'podcast_position:p2': '5',
      [positionRecordKey('u-a', 'new')]: json(10, 1000, true),
      theme: 'dark',
    })
    const store = createLocalPositionStore(kv)
    expect(store.read('u-a', 'old')).toBeNull()
    expect(store.read('u-a', 'new')).toEqual({ positionSeconds: 10, recordedAt: 1000, synced: true })

    store.discardLegacy()

    expect([...data.keys()].filter((k) => k.startsWith('podcast_position:'))).toEqual([])
    expect([...data.keys()].sort()).toEqual(['playback_position_record:u-a:new', 'theme'])
  })

  test.each([
    ['未保存', null],
    ['負', '{"position":-3,"recorded_at":1000,"synced":false}'],
    ['数でない位置', '{"position":"5","recorded_at":1000,"synced":false}'],
    ['null', 'null'],
    ['壊れた JSON', 'abc'],
    ['有限でない位置（1e999）', '{"position":1e999,"recorded_at":1000,"synced":false}'],
    ['必須の項目が無い（recorded_at）', '{"position":5,"synced":false}'],
    ['必須の項目が無い（synced）', '{"position":5,"recorded_at":1000}'],
    ['recorded_at が有限でない', '{"position":5,"recorded_at":1e999,"synced":false}'],
    ['synced が boolean でない', '{"position":5,"recorded_at":1000,"synced":"false"}'],
    ['オブジェクトでない（数値）', '12.5'],
  ])('JSON が壊れている・位置が負・有限でない・必須の項目が無いとき null。位置 0 は null でない: %s', (_name, raw) => {
    const { kv } = createKv(raw === null ? {} : { [positionRecordKey('u-a', 'p1')]: raw })
    expect(createLocalPositionStore(kv).read('u-a', 'p1')).toBeNull()
  })

  test('位置 0 の JSON は記録として返る（null でない）', () => {
    const { kv } = createKv({ [positionRecordKey('u-a', 'p1')]: '{"position":0,"recorded_at":1000,"synced":false}' })
    expect(createLocalPositionStore(kv).read('u-a', 'p1')).toEqual({ positionSeconds: 0, recordedAt: 1000, synced: false })
  })

  test('read は書かない（純粋な読み取り）', () => {
    const { kv, sets } = createKv({ [positionRecordKey('u-a', 'p1')]: 'abc' })
    createLocalPositionStore(kv).read('u-a', 'p1')
    expect(sets).toEqual([])
  })
})

describe('unsent: 主体の未送信の記録', () => {
  test('その主体の synced:false の有効な記録だけを episode と一緒に返す', () => {
    const { kv } = createKv({
      [positionRecordKey('u-a', 'p1')]: json(10, 1000, false),
      [positionRecordKey('u-a', 'p2')]: json(20, 2000, true),
      [positionRecordKey('u-a', 'p3')]: 'abc',
      [positionRecordKey('u-b', 'p4')]: json(40, 4000, false),
      'podcast_position:p5': '50',
      theme: 'dark',
    })
    const unsent = createLocalPositionStore(kv).unsent('u-a')
    expect(unsent).toEqual([{ episodeId: 'p1', record: { positionSeconds: 10, recordedAt: 1000, synced: false } }])
  })

  test('主体の前方一致で別の主体を拾わない（u-a と u-ab）', () => {
    const { kv } = createKv({
      [positionRecordKey('u-a', 'p1')]: json(10, 1000, false),
      [positionRecordKey('u-ab', 'p2')]: json(20, 2000, false),
    })
    expect(createLocalPositionStore(kv).unsent('u-a').map((u) => u.episodeId)).toEqual(['p1'])
    expect(createLocalPositionStore(kv).unsent('u-ab').map((u) => u.episodeId)).toEqual(['p2'])
  })

  test('未送信の記録が無い主体は空を返し、書かない', () => {
    const { kv, sets } = createKv({ [positionRecordKey('u-a', 'p1')]: json(10, 1000, true) })
    expect(createLocalPositionStore(kv).unsent('u-a')).toEqual([])
    expect(createLocalPositionStore(kv).unsent('u-zzz')).toEqual([])
    expect(sets).toEqual([])
  })
})

describe('markSynced: 送った記録時刻と一致するときだけ送信済みにする', () => {
  test('recordedAt が一致すると synced:true で書き直し、位置と時刻は保つ', () => {
    const { kv } = createKv({ [positionRecordKey('u-a', 'p1')]: json(10, 1000, false) })
    const store = createLocalPositionStore(kv)
    store.markSynced('u-a', 'p1', 1000)
    expect(store.read('u-a', 'p1')).toEqual({ positionSeconds: 10, recordedAt: 1000, synced: true })
    expect(store.unsent('u-a')).toEqual([])
  })

  test('recordedAt が一致しなければ何もしない（応答待ちの間に書いた新しい記録を送信済みにしない）', () => {
    const { kv, sets } = createKv({ [positionRecordKey('u-a', 'p1')]: json(20, 2000, false) })
    const store = createLocalPositionStore(kv)
    store.markSynced('u-a', 'p1', 1000)
    expect(sets).toEqual([])
    expect(store.read('u-a', 'p1')).toEqual({ positionSeconds: 20, recordedAt: 2000, synced: false })
  })

  test('記録が無い・壊れているときは何も書かず、作らない', () => {
    const { kv, sets, data } = createKv({ [positionRecordKey('u-a', 'bad')]: 'abc' })
    const store = createLocalPositionStore(kv)
    store.markSynced('u-a', 'none', 1000)
    store.markSynced('u-a', 'bad', 1000)
    expect(sets).toEqual([])
    expect(data.has(positionRecordKey('u-a', 'none'))).toBe(false)
  })

  test('別の主体の同じ episode の記録は変えない', () => {
    const { kv } = createKv({
      [positionRecordKey('u-a', 'p1')]: json(10, 1000, false),
      [positionRecordKey('u-b', 'p1')]: json(10, 1000, false),
    })
    const store = createLocalPositionStore(kv)
    store.markSynced('u-a', 'p1', 1000)
    expect(store.read('u-a', 'p1')?.synced).toBe(true)
    expect(store.read('u-b', 'p1')?.synced).toBe(false)
  })

  test('2 回目は同じ状態のまま（冪等）', () => {
    const { kv } = createKv({ [positionRecordKey('u-a', 'p1')]: json(10, 1000, false) })
    const store = createLocalPositionStore(kv)
    store.markSynced('u-a', 'p1', 1000)
    store.markSynced('u-a', 'p1', 1000)
    expect(store.read('u-a', 'p1')).toEqual({ positionSeconds: 10, recordedAt: 1000, synced: true })
  })
})

describe('主体の離脱と回収', () => {
  function seed() {
    return createKv({
      [positionRecordKey('u-a', 'p1')]: json(1, 1000, false),
      [positionRecordKey('u-a', 'p2')]: json(2, 1000, true),
      [positionRecordKey('u-b', 'p1')]: json(3, 1000, false),
      [positionRecordKey('u-ab', 'p1')]: json(4, 1000, false),
      'podcast_position:old': '5',
      theme: 'dark',
      default_playback_speed: '1.5',
    })
  }

  test('shared-leave-01: clearSubject は主体の key だけを消す', () => {
    const { kv, data } = seed()
    createLocalPositionStore(kv).clearSubject('u-a')
    expect([...data.keys()].sort()).toEqual(
      [
        'default_playback_speed',
        'playback_position_record:u-ab:p1',
        'playback_position_record:u-b:p1',
        'podcast_position:old',
        'theme',
      ].sort(),
    )
  })

  test('shared-leave-01: clearSubject の後の read は null で、2 回目は何も消さない', () => {
    const { kv, data } = seed()
    const store = createLocalPositionStore(kv)
    store.clearSubject('u-a')
    expect(store.read('u-a', 'p1')).toBeNull()
    const after = [...data.keys()].sort()
    store.clearSubject('u-a')
    expect([...data.keys()].sort()).toEqual(after)
  })

  describe('ADR-109 追記 ③: reclaim', () => {
    test.each([
      [
        'reclaim(u-a) は u-a 以外の主体の記録を消し、u-a の記録と他の key は残す',
        'u-a',
        ['default_playback_speed', 'playback_position_record:u-a:p1', 'playback_position_record:u-a:p2', 'podcast_position:old', 'theme'],
      ],
      [
        'reclaim(u-b) は u-b 以外を消す',
        'u-b',
        ['default_playback_speed', 'playback_position_record:u-b:p1', 'podcast_position:old', 'theme'],
      ],
      [
        'reclaim(null) は全主体の記録を消し、他の key は残す',
        null,
        ['default_playback_speed', 'podcast_position:old', 'theme'],
      ],
    ] as const)('reclaim の表: %s', (_name, keep, expected) => {
      const { kv, data } = seed()
      createLocalPositionStore(kv).reclaim(keep)
      expect([...data.keys()].sort()).toEqual([...expected].sort())
    })

    test('2 回目は何も消さない（冪等）', () => {
      const { kv, data } = seed()
      const store = createLocalPositionStore(kv)
      store.reclaim('u-a')
      const after = [...data.keys()].sort()
      store.reclaim('u-a')
      expect([...data.keys()].sort()).toEqual(after)
    })
  })

  test('shared-dec-32（新規）: discardLegacy は podcast_position: の key だけを全部消す', () => {
    const { kv, data } = createKv({
      'podcast_position:p1': '1',
      'podcast_position:p2': '2',
      podcast_positionX: '3',
      [positionRecordKey('u-a', 'p1')]: json(1, 1000, false),
      theme: 'dark',
    })
    createLocalPositionStore(kv).discardLegacy()
    expect([...data.keys()].sort()).toEqual(['playback_position_record:u-a:p1', 'podcast_positionX', 'theme'])
  })

  test('shared-dec-32（新規）: discardLegacy の 2 回目は何も消さない', () => {
    const { kv, data } = createKv({ 'podcast_position:p1': '9', theme: 'dark' })
    const store = createLocalPositionStore(kv)
    store.discardLegacy()
    store.discardLegacy()
    expect([...data.keys()]).toEqual(['theme'])
  })
})
