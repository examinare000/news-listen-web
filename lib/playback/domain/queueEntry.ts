// Playback application が Catalog の関数を直接 import しないための薄い委譲。規則は Catalog が持ち、ここは呼ぶだけ。
import { displayTitle, queuedEpisode } from '@/lib/catalog/domain/episode'
import type { EpisodeLabel, QueuedEpisode, QueuedEpisodeInput } from '@/lib/catalog/domain/episode'

export function queueEntryOf(input: QueuedEpisodeInput): QueuedEpisode {
  return queuedEpisode(input)
}

export function nowPlayingTitle(label: EpisodeLabel): string {
  return displayTitle(label, 50)
}

export function upNextTitle(label: EpisodeLabel): string {
  return displayTitle(label, 40)
}
