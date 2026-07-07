import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearManagedServiceWorkerCaches } from '@/lib/swCacheCleanup'
import { setupMockCaches } from '../helpers/mockCaches'

/**
 * review指摘2: ログアウト時、SW が管理する shell-pages / api キャッシュ（ユーザー固有の
 * Podcast 一覧やページ HTML）も消さないと、共有端末でユーザー A のデータがユーザー B に
 * 見えてしまう。public/sw.js はクラシックスクリプトで import できないため、
 * 'shell-' / 'api-' という prefix 文字列をこちら側に複製している
 * （変更する際は public/sw.js の isManagedBySW() と揃えること）。
 */
describe('lib/swCacheCleanup', () => {
  beforeEach(() => {
    setupMockCaches()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('deletes caches under the shell- namespace (e.g. shell-pages-v1)', async () => {
    await caches.open('shell-pages-v1')

    await clearManagedServiceWorkerCaches()

    await expect(caches.has('shell-pages-v1')).resolves.toBe(false)
  })

  test('deletes caches under the api- namespace (e.g. api-v1)', async () => {
    await caches.open('api-v1')

    await clearManagedServiceWorkerCaches()

    await expect(caches.has('api-v1')).resolves.toBe(false)
  })

  // SW_VERSION 非依存: バージョン番号がいくつでも prefix マッチで消せる必要がある。
  test('is independent of SW_VERSION (deletes shell-pages-v2 just as well)', async () => {
    await caches.open('shell-pages-v2')

    await clearManagedServiceWorkerCaches()

    await expect(caches.has('shell-pages-v2')).resolves.toBe(false)
  })

  // audio-v1 は lib/audioCache.ts が単独管理する別名前空間。deleteAllAudio() の責務であり、
  // このヘルパーが誤って触れてはならない（sw.js の activate 保護と同じ意図）。
  test('does not touch the audio-v1 cache (owned by lib/audioCache.ts)', async () => {
    await caches.open('audio-v1')

    await clearManagedServiceWorkerCaches()

    await expect(caches.has('audio-v1')).resolves.toBe(true)
  })

  test('does nothing when Cache Storage API is unavailable (graceful degradation)', async () => {
    vi.unstubAllGlobals() // undo this file's own setupMockCaches()

    await expect(clearManagedServiceWorkerCaches()).resolves.toBeUndefined()
  })
})
