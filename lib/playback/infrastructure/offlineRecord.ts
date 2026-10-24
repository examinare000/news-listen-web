// 保存庫に永続化する record の形と読み書き（JSON）。旧 lib/audioCache.ts が書いた entry をそのまま読める。
// DTO → PlayableEpisode の変換は持たない（Catalog infrastructure の mapper が行う）。
import type { Podcast } from '@/types'

/** 一覧用の meta。後ろ 2 field は新しく書く entry だけが持つ。旧 entry は欠ける。 */
export interface OfflineMeta {
  readonly id: string
  /** 旧と同じ意味（japanese_intro_text）。 */
  readonly title: string
  readonly duration_seconds: number
  readonly size_bytes?: number | null
  readonly saved_at?: string | null
}

export function metaResponse(meta: OfflineMeta): Response {
  return new Response(JSON.stringify(meta))
}

/** episode の entry。署名付き URL は期限切れするので永続化しない。 */
export function episodeResponse(dto: Podcast): Response {
  const persisted: Podcast = { ...dto, audio_url: '' }
  return new Response(JSON.stringify(persisted))
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function readMeta(response: Response): Promise<OfflineMeta | null> {
  const value = await readJson(response)
  if (!isRecord(value)) return null
  const { id, title, duration_seconds: duration, size_bytes: size, saved_at: savedAt } = value
  if (typeof id !== 'string' || typeof title !== 'string' || typeof duration !== 'number') return null
  return {
    id,
    title,
    duration_seconds: duration,
    size_bytes: typeof size === 'number' ? size : null,
    saved_at: typeof savedAt === 'string' ? savedAt : null,
  }
}

export async function readEpisodeRecord(response: Response): Promise<Podcast | null> {
  const value = await readJson(response)
  return isRecord(value) ? (value as unknown as Podcast) : null
}
