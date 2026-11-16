import type { Podcast } from '@/lib/api/dto'

/** 古いキャッシュの応答に残る `partial_failed`（ADR-108 で DTO の値域から外れた）を、型を通して fixture に渡す。 */
export function legacyPartialFailed(): Podcast['status'] {
  return 'partial_failed' as unknown as Podcast['status']
}
