// 保存庫（OfflineLibrary の実装）。Cache の 3 entry の順序と key を持つ。Response と JSON を扱ってよいのはこのファイルと offlineRecord.ts だけ。
import type { ApiGateway } from '@/lib/api/gateway'
import { decodeEpisode } from '@/lib/catalog/infrastructure/episodeMapper'
import type { OfflineLibrary } from '@/lib/playback/application/ports'
import { toOfflineEpisodeView, toStorageUsageView } from '@/lib/playback/application/readModels'
import type { OfflineEpisodeView } from '@/lib/playback/application/readModels'
import type { CacheStore } from '@/lib/platform/cacheStore'
import type { ObjectUrl } from '@/lib/platform/objectUrl'
import type { StorageEstimate } from '@/lib/platform/storageEstimate'
import type { Podcast } from '@/types'
import { episodeResponse, metaResponse, readEpisodeRecord, readMeta } from './offlineRecord'

// 主体別の名前へ替えるのは別 slice。それまでは旧実装と同じ名前を使う。
const CACHE_NAME = 'audio-v1'

const audioKey = (id: string): string => `/_audio/${id}`
const metaKey = (id: string): string => `/_audio-meta/${id}`
const episodeKey = (id: string): string => `/_audio-podcast/${id}`
const META_MARKER = '/_audio-meta/'

export interface OfflineLibraryDeps {
  readonly cacheStore: CacheStore | null
  readonly gateway: ApiGateway
  readonly objectUrl: ObjectUrl
  readonly estimate: StorageEstimate
}

/** logout 時など Provider の外から保存庫全体を消す。cacheStore が無ければ何もしない。 */
export async function clearOfflineAudio(cacheStore: CacheStore | null): Promise<void> {
  await cacheStore?.delete(CACHE_NAME)
}

export function createOfflineLibrary(deps: OfflineLibraryDeps): OfflineLibrary {
  const { cacheStore, gateway, objectUrl, estimate } = deps

  // 音声の大きさは参考値なので、取れなければ null にして保存自体は成功させる。
  async function audioSize(id: string): Promise<number | null> {
    if (cacheStore === null) return null
    try {
      const bucket = await cacheStore.open(CACHE_NAME)
      const response = await bucket.match(audioKey(id))
      return response === undefined ? null : (await response.blob()).size
    } catch {
      return null
    }
  }

  return {
    async save(id) {
      if (cacheStore === null) return { ok: false, failure: { kind: 'unsupported' } }
      const fetched = await gateway.request<Podcast>(`/api/backend/podcasts/${id}`)
      if (!fetched.ok) return { ok: false, failure: { kind: 'download_failed', failure: fetched.failure } }
      const dto = fetched.value
      if (decodeEpisode(dto).kind !== 'playable') return { ok: false, failure: { kind: 'not_playable' } }

      const audio = await cacheStore.putFromUrl(CACHE_NAME, audioKey(id), dto.audio_url)
      if (!audio.ok) return { ok: false, failure: audio.failure }

      const sizeBytes = await audioSize(id)
      try {
        const bucket = await cacheStore.open(CACHE_NAME)
        await bucket.put(
          metaKey(id),
          metaResponse({
            id: dto.id,
            title: dto.japanese_intro_text,
            duration_seconds: dto.duration_seconds,
            size_bytes: sizeBytes,
            saved_at: new Date().toISOString(),
          }),
        )
        // has() が判定に使う entry なので最後に書く。
        await bucket.put(episodeKey(id), episodeResponse(dto))
      } catch {
        return { ok: false, failure: { kind: 'storage_full' } }
      }
      return { ok: true, value: undefined }
    },

    async get(id) {
      if (cacheStore === null) return null
      const bucket = await cacheStore.open(CACHE_NAME)
      const [audio, stored] = await Promise.all([bucket.match(audioKey(id)), bucket.match(episodeKey(id))])
      if (audio === undefined || stored === undefined) return null
      const dto = await readEpisodeRecord(stored)
      if (dto === null) return null
      const url = objectUrl.create(await audio.blob())
      const episode = decodeEpisode({ ...dto, audio_url: url })
      if (episode.kind !== 'playable') {
        objectUrl.revoke(url)
        return null
      }
      return Object.freeze({
        ...episode,
        audioHandle: {
          release: () => {
            objectUrl.revoke(url)
          },
        },
      })
    },

    async has(id) {
      if (cacheStore === null) return false
      const bucket = await cacheStore.open(CACHE_NAME)
      return (await bucket.match(episodeKey(id))) !== undefined
    },

    async remove(id) {
      if (cacheStore === null) return
      const bucket = await cacheStore.open(CACHE_NAME)
      await bucket.delete(audioKey(id))
      await bucket.delete(metaKey(id))
      await bucket.delete(episodeKey(id))
    },

    async clear() {
      await clearOfflineAudio(cacheStore)
    },

    async list() {
      if (cacheStore === null) return []
      const bucket = await cacheStore.open(CACHE_NAME)
      const entries = (await bucket.keys()).filter((entry) => entry.url.includes(META_MARKER))
      const views: OfflineEpisodeView[] = []
      for (const entry of entries) {
        // 列挙の後に消えた entry は飛ばす。
        const response = await bucket.match(entry.url)
        const meta = response === undefined ? null : await readMeta(response)
        if (meta === null) continue
        views.push(
          toOfflineEpisodeView({
            episodeId: meta.id,
            title: meta.title,
            durationSeconds: meta.duration_seconds,
            sizeBytes: meta.size_bytes,
            savedAt: meta.saved_at,
          }),
        )
      }
      return Object.freeze(views)
    },

    async usage() {
      return toStorageUsageView(await estimate())
    },
  }
}
