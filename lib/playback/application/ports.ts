// Playback application の port。実装は Catalog の infrastructure が持つ（HTTP・DTO はここに現れない）。
import type { Episode } from '@/lib/catalog/domain/episode'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface EpisodeSource {
  fetch(id: string): Promise<Result<Episode, ApiFailure>>
}
