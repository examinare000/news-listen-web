/**
 * Offline audio caching for downloaded episodes (issue #167).
 *
 * WHY a synthetic same-origin cache key (`/_audio/{id}`) instead of the signed
 * URL itself: signed URLs expire, and a fresh call to getPodcast() would issue
 * a new signature each time — matching on the raw URL would never hit the
 * cache after expiry. Normalizing to a stable path keyed by podcast id makes
 * the cache lookup independent of signature/expiry churn.
 *
 * WHY Blob URLs (not a cached SW Range passthrough) for playback: Safari's
 * Service Worker Range-request handling for cached audio is unreliable
 * (seeking breaks), so we resolve the cached Response to a Blob and hand the
 * <audio> element a `blob:` URL instead.
 *
 * WHY string cache keys, never `new Request(path)`: a relative-path Request
 * requires base-URL resolution that Node's fetch implementation cannot do
 * without a real document, which is unnecessary anyway — Cache.{put,match,delete}
 * all accept a plain string.
 */
import { createApiClient } from '@/lib/api'
import type { Podcast } from '@/types'

const AUDIO_CACHE_NAME = 'audio-v1'

function audioKey(podcastId: string): string {
  return `/_audio/${podcastId}`
}

function metaKey(podcastId: string): string {
  return `/_audio-meta/${podcastId}`
}

// WHY a separate full-Podcast entry, distinct from the listing meta above:
// AudioPlayerContext's queue operations (Q.jump/Q.playNext) and AudioPlayerBar
// (difficulty badge, created_at) need the complete Podcast shape to keep working
// offline. Reconstructing a fake Podcast from the 3-field listing meta would
// either break those or require inventing placeholder values, so we persist the
// full object we already fetched at download time instead.
function podcastKey(podcastId: string): string {
  return `/_audio-podcast/${podcastId}`
}

export interface CachedEpisodeMeta {
  id: string
  title: string
  duration_seconds: number
}

export interface StorageEstimate {
  usage: number
  quota: number
}

// WHY feature-detect rather than assume: Cache Storage is unavailable in some
// browsers/private-browsing modes, and AudioPlayerContext.playById() calls the
// read paths (isCached/getCachedAudioUrl/getCachedPodcast) unconditionally on
// every play — they must resolve to "not cached" rather than throw, so normal
// (non-offline) playback keeps working wherever this API is missing.
function isCacheStorageSupported(): boolean {
  return typeof caches !== 'undefined'
}

/** 新鮮な署名付き URL を取得し、音声本体とメタデータをキャッシュへ保存する。 */
export async function downloadAudio(podcastId: string): Promise<void> {
  if (!isCacheStorageSupported()) {
    throw new Error('この端末はオフライン保存に対応していません')
  }
  const podcast = await createApiClient().getPodcast(podcastId)
  const response = await fetch(podcast.audio_url)
  const cache = await caches.open(AUDIO_CACHE_NAME)
  await cache.put(audioKey(podcastId), response)

  const meta: CachedEpisodeMeta = {
    id: podcast.id,
    title: podcast.japanese_intro_text,
    duration_seconds: podcast.duration_seconds,
  }
  await cache.put(metaKey(podcastId), new Response(JSON.stringify(meta)))

  // review指摘3: 署名付き audio_url をそのまま永続化しない。読み出し側
  // （AudioPlayerContext.resolveCachedPodcast）は常に blob: URL で上書きするため実害はないが、
  // 署名URLは期限切れするので、いずれ無効になる値を Cache Storage に残さないための防御。
  const podcastToPersist: Podcast = { ...podcast, audio_url: '' }
  await cache.put(podcastKey(podcastId), new Response(JSON.stringify(podcastToPersist)))
}

/** キャッシュ済みエピソードの完全な Podcast オブジェクト（オフライン再生時のキュー/UI 再構築用）。 */
export async function getCachedPodcast(podcastId: string): Promise<Podcast | null> {
  if (!isCacheStorageSupported()) return null
  const cache = await caches.open(AUDIO_CACHE_NAME)
  const response = await cache.match(podcastKey(podcastId))
  if (!response) return null
  return (await response.json()) as Podcast
}

/** キャッシュ済み音声を Blob URL として返す。未キャッシュなら null。 */
export async function getCachedAudioUrl(podcastId: string): Promise<string | null> {
  if (!isCacheStorageSupported()) return null
  const cache = await caches.open(AUDIO_CACHE_NAME)
  const response = await cache.match(audioKey(podcastId))
  if (!response) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function isCached(podcastId: string): Promise<boolean> {
  if (!isCacheStorageSupported()) return false
  const cache = await caches.open(AUDIO_CACHE_NAME)
  const response = await cache.match(audioKey(podcastId))
  return response !== undefined
}

export async function deleteAudio(podcastId: string): Promise<void> {
  if (!isCacheStorageSupported()) return
  const cache = await caches.open(AUDIO_CACHE_NAME)
  await cache.delete(audioKey(podcastId))
  await cache.delete(metaKey(podcastId))
  await cache.delete(podcastKey(podcastId))
}

/** ログアウト時等、キャッシュ全体を消す（共有端末でのデータ残留防止）。 */
export async function deleteAllAudio(): Promise<void> {
  if (!isCacheStorageSupported()) return
  await caches.delete(AUDIO_CACHE_NAME)
}

/** キャッシュ済みエピソードのメタデータ一覧（設定画面の一覧表示用）。 */
export async function listCachedEpisodes(): Promise<CachedEpisodeMeta[]> {
  if (!isCacheStorageSupported()) return []
  const cache = await caches.open(AUDIO_CACHE_NAME)
  const keys = await cache.keys()
  const metaKeys = keys.filter((key) => key.url.includes('/_audio-meta/'))

  const metas = await Promise.all(
    metaKeys.map(async (key) => {
      const response = await cache.match(key.url)
      return (await response!.json()) as CachedEpisodeMeta
    }),
  )
  return metas
}

/** ストレージ使用量の見積もり。API 未対応環境では null（graceful degradation）。 */
export async function estimateUsage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null
  }
  const { usage, quota } = await navigator.storage.estimate()
  return { usage: usage ?? 0, quota: quota ?? 0 }
}
