import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  downloadAudio,
  getCachedAudioUrl,
  getCachedPodcast,
  isCached,
  deleteAudio,
  deleteAllAudio,
  listCachedEpisodes,
  estimateUsage,
} from '@/lib/audioCache'
import { setupMockCaches } from '../helpers/mockCaches'
import type { Podcast } from '@/types'

function pod(id: string, overrides: Partial<Podcast> = {}): Podcast {
  return {
    id,
    type: 'single',
    article_ids: [],
    difficulty: 'toeic_900',
    audio_url: `https://storage.example.com/${id}-signed.mp3`,
    japanese_intro_text: `intro ${id}`,
    duration_seconds: 90,
    created_at: '2026-06-10T09:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
    ...overrides,
  }
}

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcast: vi.fn((id: string) => Promise.resolve(pod(id))),
  })),
}))

// audio-cache 専用の cache 名。sw.js の shell 系キャッシュとは別名前空間にして
// activate 時の旧世代削除ロジックが誤って音声を消さないようにする。
const AUDIO_CACHE_NAME = 'audio-v1'

describe('lib/audioCache', () => {
  beforeEach(() => {
    setupMockCaches()
    // WHY a string body, not `new Blob([...])`: jsdom's global Blob lacks `.stream()`,
    // which Node's undici-backed Response/clone/blob() pipeline requires — a jsdom↔undici
    // cross-realm gap that only exists in this Node test environment, not real browsers.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('audio-bytes', { status: 200 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('downloadAudio', () => {
    test('fetches a fresh signed URL via getPodcast then stores the audio under a synthetic same-origin key', async () => {
      await downloadAudio('p1')

      const cache = await caches.open(AUDIO_CACHE_NAME)
      const stored = await cache.match('/_audio/p1')
      expect(stored).toBeDefined()
    })

    test('stores episode metadata alongside the audio for listing', async () => {
      await downloadAudio('p1')

      const cache = await caches.open(AUDIO_CACHE_NAME)
      const metaRes = await cache.match('/_audio-meta/p1')
      expect(metaRes).toBeDefined()
      const meta = await metaRes!.json()
      expect(meta).toEqual({ id: 'p1', title: 'intro p1', duration_seconds: 90 })
    })

    // WHY a separate full-Podcast cache entry (not just the id/title/duration_seconds
    // meta triple above): AudioPlayerContext's queue operations (Q.jump/Q.playNext) and
    // AudioPlayerBar (difficulty badge, created_at) require the complete Podcast shape.
    // Reconstructing a fake Podcast from only 3 fields would either break those or
    // require inventing placeholder values — worse than persisting the object we
    // already have in hand at download time.
    test('also stores the full podcast object for offline queue/UI reconstruction', async () => {
      await downloadAudio('p1')

      const cached = await getCachedPodcast('p1')
      expect(cached).toMatchObject({ id: 'p1', japanese_intro_text: 'intro p1', duration_seconds: 90 })
    })

    // review指摘3（should-fix）: 署名付き audio_url をそのまま永続化すると、期限切れ後も
    // 無効な URL が Cache Storage に残る。読み出し側（AudioPlayerContext.resolveCachedPodcast）
    // は常に blob: URL で上書きするため実害はないが、期限切れ署名 URL を持続化しない防御として
    // 保存前に空文字へ差し替える。
    test('blanks out audio_url before persisting (expiring signed URL must not be persisted)', async () => {
      await downloadAudio('p1')

      const cached = await getCachedPodcast('p1')
      expect(cached?.audio_url).toBe('')
    })
  })

  describe('getCachedPodcast', () => {
    test('returns null when nothing is cached', async () => {
      await expect(getCachedPodcast('missing')).resolves.toBeNull()
    })
  })

  describe('isCached / getCachedAudioUrl', () => {
    test('isCached returns false before download', async () => {
      await expect(isCached('p1')).resolves.toBe(false)
    })

    test('isCached returns true after download', async () => {
      await downloadAudio('p1')
      await expect(isCached('p1')).resolves.toBe(true)
    })

    test('getCachedAudioUrl returns null when nothing is cached', async () => {
      await expect(getCachedAudioUrl('missing')).resolves.toBeNull()
    })

    test('getCachedAudioUrl returns a blob: URL when cached', async () => {
      await downloadAudio('p1')
      const url = await getCachedAudioUrl('p1')
      expect(url).toMatch(/^blob:/)
    })
  })

  describe('deleteAudio / deleteAllAudio', () => {
    test('deleteAudio removes the audio entry, its listing metadata, and the full podcast object', async () => {
      await downloadAudio('p1')
      await deleteAudio('p1')

      await expect(isCached('p1')).resolves.toBe(false)
      const cache = await caches.open(AUDIO_CACHE_NAME)
      await expect(cache.match('/_audio-meta/p1')).resolves.toBeUndefined()
      await expect(getCachedPodcast('p1')).resolves.toBeNull()
    })

    test('deleteAllAudio clears every cached episode', async () => {
      await downloadAudio('p1')
      await downloadAudio('p2')

      await deleteAllAudio()

      await expect(isCached('p1')).resolves.toBe(false)
      await expect(isCached('p2')).resolves.toBe(false)
    })
  })

  describe('listCachedEpisodes', () => {
    test('returns an empty list when nothing is cached', async () => {
      await expect(listCachedEpisodes()).resolves.toEqual([])
    })

    test('returns metadata for every cached episode', async () => {
      await downloadAudio('p1')
      await downloadAudio('p2')

      const list = await listCachedEpisodes()
      expect(list).toHaveLength(2)
      expect(list).toEqual(
        expect.arrayContaining([
          { id: 'p1', title: 'intro p1', duration_seconds: 90 },
          { id: 'p2', title: 'intro p2', duration_seconds: 90 },
        ]),
      )
    })
  })

  describe('estimateUsage', () => {
    test('wraps navigator.storage.estimate()', async () => {
      vi.stubGlobal('navigator', {
        ...navigator,
        storage: { estimate: vi.fn(() => Promise.resolve({ usage: 1234, quota: 5000 })) },
      })

      await expect(estimateUsage()).resolves.toEqual({ usage: 1234, quota: 5000 })
    })

    test('returns null when navigator.storage is unavailable (graceful degradation)', async () => {
      vi.stubGlobal('navigator', { ...navigator, storage: undefined })

      await expect(estimateUsage()).resolves.toBeNull()
    })
  })

  // WHY: environments without Cache Storage support (older browsers, some private-browsing
  // modes, and plain non-PWA-aware test setups that never call setupMockCaches()) must not
  // crash the read paths — callers like AudioPlayerContext.playById() treat "not cached" and
  // "cache API unsupported" identically and fall back to the network flow.
  describe('graceful degradation when Cache Storage API is unavailable', () => {
    beforeEach(() => {
      vi.unstubAllGlobals() // undo this describe block's own setupMockCaches() from the outer beforeEach
    })

    test('isCached resolves false instead of throwing', async () => {
      await expect(isCached('p1')).resolves.toBe(false)
    })

    test('getCachedAudioUrl resolves null instead of throwing', async () => {
      await expect(getCachedAudioUrl('p1')).resolves.toBeNull()
    })

    test('getCachedPodcast resolves null instead of throwing', async () => {
      await expect(getCachedPodcast('p1')).resolves.toBeNull()
    })

    test('listCachedEpisodes resolves to an empty list instead of throwing', async () => {
      await expect(listCachedEpisodes()).resolves.toEqual([])
    })
  })
})
