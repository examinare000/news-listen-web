'use client'

import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'

/**
 * Returns a `startPodcast(podcastId)` callback implementing the canonical
 * podcast play-start flow. Delegates to the queue-aware provider so that
 * starting playback also establishes the playback queue (issue #81):
 *   1. Re-fetch fresh podcast data (signed audio URL may expire — spec §9 L151)
 *   2. Restore saved playback position (spec §10.3 L201)
 *   3. Load and start the audio; set this episode as the queue's current
 *   4. Update AppContext
 *
 * Both the list page and the detail page use this hook so the flow is
 * identical in both locations (spec §10.3 L209 "一覧と同フロー").
 */
export function useStartPodcast(): (podcastId: string) => Promise<void> {
  const { playById } = useAudioPlayerContext()
  return playById
}
