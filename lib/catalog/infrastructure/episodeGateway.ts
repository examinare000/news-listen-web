// port EpisodeSource の実装。取得は lib/api/podcasts.ts の getPodcast を呼ぶ。
import type { ApiGateway } from '@/lib/api/gateway'
import { getPodcast } from '@/lib/api/podcasts'
import type { EpisodeSource } from '@/lib/playback/application/ports'
import { decodeEpisode } from './episodeMapper'

export function createEpisodeGateway(gateway: ApiGateway): EpisodeSource {
  return {
    async fetch(id) {
      const result = await getPodcast(gateway, id)
      return result.ok ? { ok: true, value: decodeEpisode(result.value) } : result
    },
  }
}
