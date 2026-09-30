// port の型と test double（MockAudio・MockCacheStorage）の適合・deferred-put の契約テスト。
// RED 理由: `@/lib/playback/ports` がまだ存在せず（型検査で検出）、MockAudio に defaultPlaybackRate、
// MockCacheStorage に putFromUrl / respondTo / failUrl、MockCache に deferPuts / flushPuts がまだ無い。
//
// helper の API（このテストが固定する形）:
//   MockCacheStorage#respondTo(url, body): 成功する URL を設定する
//   MockCacheStorage#failUrl(url, failure: CacheWriteFailure): 指定の失敗をそのまま返す（ステータス写像は持たない）
//   MockCache#deferPuts(): 以後の put は返す promise と store への反映の両方を保留する
//   MockCache#flushPuts(): 同期。保留中の put を反映して promise を解決し、以後の保留を解除する
import { describe, test, expect } from 'vitest'
import type { AudioElement, CacheStore } from '@/lib/playback/ports'
import { MockAudio } from '../../helpers/mockAudio'
import { MockCacheStorage } from '../../helpers/mockCaches'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('ports の型と helper の適合', () => {
  test('MockAudio は AudioElement として代入でき、defaultPlaybackRate の初期値は 1', () => {
    const a: AudioElement = new MockAudio()
    expect(a.defaultPlaybackRate).toBe(1)
  })

  test('MockCacheStorage は CacheStore として代入できる', () => {
    const c: CacheStore = new MockCacheStorage()
    expect(typeof c.putFromUrl).toBe('function')
  })

  test('ports は型だけを export する（値の export が無い）', async () => {
    const ports = await import('@/lib/playback/ports')
    expect(Object.keys(ports)).toEqual([])
  })
})

describe('MockCache の deferred-put', () => {
  test('deferPuts 後の put は promise が未解決で match にも見えず、flushPuts 後に解決して見える', async () => {
    const storage = new MockCacheStorage()
    const bucket = await storage.open('c')
    bucket.deferPuts()

    let settled = false
    const p = bucket.put('k', new Response('body')).then(() => {
      settled = true
    })
    await tick()
    expect(settled).toBe(false)
    expect(await bucket.match('k')).toBeUndefined()

    bucket.flushPuts()
    await p
    expect(settled).toBe(true)
    expect(await (await bucket.match('k'))?.text()).toBe('body')
  })
})

describe('MockCacheStorage#putFromUrl', () => {
  const url = 'https://storage.example.com/a.mp3'

  test('respondTo 済みの URL は格納して { ok: true, value: undefined }', async () => {
    const storage = new MockCacheStorage()
    storage.respondTo(url, 'audio-bytes')
    const result = await storage.putFromUrl('audio-v1', 'key-1', url)
    expect(result).toEqual({ ok: true, value: undefined })
    const bucket = await storage.open('audio-v1')
    expect(await (await bucket.match('key-1'))?.text()).toBe('audio-bytes')
  })

  test('failUrl の失敗はそのまま返し、格納しない', async () => {
    const storage = new MockCacheStorage()
    storage.failUrl(url, { kind: 'storage_full' })
    const result = await storage.putFromUrl('audio-v1', 'key-1', url)
    expect(result).toEqual({ ok: false, failure: { kind: 'storage_full' } })
    const bucket = await storage.open('audio-v1')
    expect(await bucket.match('key-1')).toBeUndefined()
  })

  test('未設定の URL は download_failed（network）', async () => {
    const storage = new MockCacheStorage()
    const result = await storage.putFromUrl('audio-v1', 'key-1', url)
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'download_failed', failure: { kind: 'network' } },
    })
  })

  test('deferPuts 中の putFromUrl は flushPuts まで未解決', async () => {
    const storage = new MockCacheStorage()
    storage.respondTo(url, 'audio-bytes')
    const bucket = await storage.open('audio-v1')
    bucket.deferPuts()

    let settled = false
    const p = storage.putFromUrl('audio-v1', 'key-1', url).then((r) => {
      settled = true
      return r
    })
    await tick()
    expect(settled).toBe(false)
    expect(await bucket.match('key-1')).toBeUndefined()

    bucket.flushPuts()
    expect(await p).toEqual({ ok: true, value: undefined })
    expect(await (await bucket.match('key-1'))?.text()).toBe('audio-bytes')
  })
})
