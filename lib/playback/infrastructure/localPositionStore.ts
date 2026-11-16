// 端末の再生位置（主体 × episode の最新 1 件）。key は旧形式（podcast_position:*）と衝突させず、旧形式は取り込まずに捨てる。
// 旧 key の接頭辞は 設定 module と共有せず、この store が持つ（web-dec-162）。
import type { LocalPositionStore, StoredPosition } from '@/lib/playback/application/ports'
import type { KeyEnumerableStore } from '@/lib/platform/keyValueStore'

const RECORD_PREFIX = 'playback_position_record:'
const LEGACY_PREFIX = 'podcast_position:'

export function positionRecordKey(userId: string, episodeId: string): string {
  return `${RECORD_PREFIX}${userId}:${episodeId}`
}

function parseRecord(raw: string | null): StoredPosition | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { position, recorded_at: recordedAt, synced } = parsed as Record<string, unknown>
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt)) return null
  if (typeof synced !== 'boolean') return null
  return { positionSeconds: position, recordedAt, synced }
}

function serialize(record: StoredPosition): string {
  return JSON.stringify({ position: record.positionSeconds, recorded_at: record.recordedAt, synced: record.synced })
}

/** `playback_position_record:` の後ろを最初の `:` で主体と episode に分ける。 */
function splitKey(key: string): { userId: string; episodeId: string } | null {
  if (!key.startsWith(RECORD_PREFIX)) return null
  const rest = key.slice(RECORD_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon < 0) return null
  return { userId: rest.slice(0, colon), episodeId: rest.slice(colon + 1) }
}

export function createLocalPositionStore(kv: KeyEnumerableStore): LocalPositionStore {
  const read = (userId: string, episodeId: string) => parseRecord(kv.get(positionRecordKey(userId, episodeId)))
  return {
    read,
    write(userId, episodeId, record) {
      return kv.set(positionRecordKey(userId, episodeId), serialize(record))
    },
    unsent(userId) {
      const found: { episodeId: string; record: StoredPosition }[] = []
      for (const key of kv.keys()) {
        const parts = splitKey(key)
        if (parts === null || parts.userId !== userId) continue
        const record = parseRecord(kv.get(key))
        if (record !== null && !record.synced) found.push({ episodeId: parts.episodeId, record })
      }
      return found
    },
    markSynced(userId, episodeId, recordedAt) {
      const stored = read(userId, episodeId)
      if (stored === null || stored.recordedAt !== recordedAt) return
      kv.set(positionRecordKey(userId, episodeId), serialize({ ...stored, synced: true }))
    },
    clearSubject(userId) {
      const prefix = `${RECORD_PREFIX}${userId}:`
      for (const key of kv.keys()) if (key.startsWith(prefix)) kv.remove(key)
    },
    reclaim(keep) {
      for (const key of kv.keys()) {
        const parts = splitKey(key)
        if (parts !== null && parts.userId !== keep) kv.remove(key)
      }
    },
    discardLegacy() {
      for (const key of kv.keys()) if (key.startsWith(LEGACY_PREFIX)) kv.remove(key)
    },
  }
}
