// 端末の再生位置。key と値の形式は旧 hooks/useAudioPlayer.ts と同じ（web-temp-10: key は @/lib/config と共有する）。
import { KEY_PODCAST_POSITION_PREFIX, podcastPositionKey } from '@/lib/config'
import type { LocalPositionStore } from '@/lib/playback/application/ports'
import type { KeyEnumerableStore } from '@/lib/platform/keyValueStore'

export function createLocalPositionStore(kv: KeyEnumerableStore): LocalPositionStore {
  return {
    read(id) {
      const raw = kv.get(podcastPositionKey(id))
      if (raw === null) return null
      try {
        const parsed: unknown = JSON.parse(raw)
        return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null
      } catch {
        return null
      }
    },
    write(id, seconds) {
      kv.set(podcastPositionKey(id), JSON.stringify(seconds))
    },
    clearAll() {
      for (const key of kv.keys()) {
        if (key.startsWith(`${KEY_PODCAST_POSITION_PREFIX}:`)) kv.remove(key)
      }
    },
  }
}
