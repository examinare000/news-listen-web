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

// 音声の Cache は主体（backend の user_id）ごとに分ける（ADR-104 決定 2）。旧名 audio-v1 は回収が消す。
const OLD_AUDIO_CACHE = 'audio-v1'
const SUBJECT_AUDIO_PREFIX = `${OLD_AUDIO_CACHE}-`

export const audioCacheName = (userId: string): string => `${SUBJECT_AUDIO_PREFIX}${userId}`

const audioKey = (id: string): string => `/_audio/${id}`
const metaKey = (id: string): string => `/_audio-meta/${id}`
const episodeKey = (id: string): string => `/_audio-podcast/${id}`
const META_MARKER = '/_audio-meta/'

export interface OfflineLibraryDeps {
  readonly cacheStore: CacheStore | null
  readonly gateway: ApiGateway
  readonly objectUrl: ObjectUrl
  readonly estimate: StorageEstimate
  /** 現在の主体。各操作は開始時に 1 回だけ読み、その Cache 名を最後まで使う。null は保存庫が無効（shared-leave-10）。 */
  readonly currentUserId: () => string | null
}

/** 主体離脱で、その主体の音声 Cache を消す。cacheStore が無ければ何もしない。 */
export async function deleteSubjectAudio(cacheStore: CacheStore | null, userId: string): Promise<void> {
  await cacheStore?.delete(audioCacheName(userId))
}

/**
 * 起動時の回収。現在の主体以外の audio-v1（旧名を含む）・audio-v1-* を消す。
 * keep は各削除の直前に読む: 掃除の途中で B が確立して保存しても B の Cache を消さない（web-dec-85）。
 */
export async function reclaimAudioCaches(cacheStore: CacheStore | null, keep: () => string | null): Promise<void> {
  if (cacheStore === null) return
  for (const name of await cacheStore.keys()) {
    if (name !== OLD_AUDIO_CACHE && !name.startsWith(SUBJECT_AUDIO_PREFIX)) continue
    const current = keep()
    if (current !== null && name === audioCacheName(current)) continue
    await cacheStore.delete(name)
  }
}

export function createOfflineLibrary(deps: OfflineLibraryDeps): OfflineLibrary {
  const { cacheStore, gateway, objectUrl, estimate, currentUserId } = deps

  // 音声の大きさは参考値なので、取れなければ null にして保存自体は成功させる。
  async function audioSize(cacheName: string, id: string): Promise<number | null> {
    if (cacheStore === null) return null
    try {
      const bucket = await cacheStore.open(cacheName)
      const response = await bucket.match(audioKey(id))
      return response === undefined ? null : (await response.blob()).size
    } catch {
      return null
    }
  }

  return {
    async save(id) {
      const userId = currentUserId()
      if (cacheStore === null || userId === null) return { ok: false, failure: { kind: 'unsupported' } }
      const cacheName = audioCacheName(userId)
      const fetched = await gateway.request<Podcast>(`/api/backend/podcasts/${id}`)
      if (!fetched.ok) return { ok: false, failure: { kind: 'download_failed', failure: fetched.failure } }
      const dto = fetched.value
      if (decodeEpisode(dto).kind !== 'playable') return { ok: false, failure: { kind: 'not_playable' } }

      const audio = await cacheStore.putFromUrl(cacheName, audioKey(id), dto.audio_url)
      if (!audio.ok) return { ok: false, failure: audio.failure }

      const sizeBytes = await audioSize(cacheName, id)
      try {
        const bucket = await cacheStore.open(cacheName)
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
      const userId = currentUserId()
      if (cacheStore === null || userId === null) return null
      const bucket = await cacheStore.open(audioCacheName(userId))
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
      const userId = currentUserId()
      if (cacheStore === null || userId === null) return false
      const bucket = await cacheStore.open(audioCacheName(userId))
      return (await bucket.match(episodeKey(id))) !== undefined
    },

    async remove(id) {
      const userId = currentUserId()
      if (cacheStore === null || userId === null) return
      const bucket = await cacheStore.open(audioCacheName(userId))
      await bucket.delete(audioKey(id))
      await bucket.delete(metaKey(id))
      await bucket.delete(episodeKey(id))
    },

    async clear() {
      const userId = currentUserId()
      if (userId === null) return
      await deleteSubjectAudio(cacheStore, userId)
    },

    async list() {
      const userId = currentUserId()
      if (cacheStore === null || userId === null) return []
      const bucket = await cacheStore.open(audioCacheName(userId))
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
