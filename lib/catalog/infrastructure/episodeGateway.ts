// port EpisodeSource の実装。request は lib/api/podcasts.ts の getPodcast と同じ path・method（web-slice-context-06 で getPodcast を呼ぶ形に寄せる）。
import type { ApiGateway } from '@/lib/api/gateway'
import type { EpisodeSource } from '@/lib/playback/application/ports'
import type { Podcast } from '@/types'
import { decodeEpisode } from './episodeMapper'

export function createEpisodeGateway(gateway: ApiGateway): EpisodeSource {
  return {
    async fetch(id) {
      const result = await gateway.request<Podcast>(`/api/backend/podcasts/${id}`)
      return result.ok ? { ok: true, value: decodeEpisode(result.value) } : result
    },
  }
}
