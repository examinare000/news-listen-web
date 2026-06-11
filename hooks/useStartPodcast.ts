'use client'

import { useApp } from '@/contexts/AppContext'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { getSavedPosition } from '@/hooks/useAudioPlayer'
import { createApiClient, ApiError } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'

/**
 * Returns a `startPodcast(podcastId)` callback implementing the canonical
 * podcast play-start flow:
 *   1. Re-fetch fresh podcast data (signed audio URL may expire — spec §9 L151)
 *   2. Restore saved playback position (spec §10.3 L201)
 *   3. Load and start the audio
 *   4. Update AppContext
 *
 * Both the list page and the detail page use this hook so the flow is
 * identical in both locations (spec §10.3 L209 "一覧と同フロー").
 */
export function useStartPodcast(): (podcastId: string) => Promise<void> {
  const { state, dispatch } = useApp()
  const player = useAudioPlayerContext()
  const { showToast } = useToast()

  return async function startPodcast(podcastId: string): Promise<void> {
    try {
      const fresh = await createApiClient({
        baseUrl: state.baseUrl,
        apiKey: state.apiKey,
      }).getPodcast(podcastId)
      const savedPosition = getSavedPosition(fresh.id)
      player.load(fresh.audio_url, savedPosition, fresh.id)
      await player.play()
      dispatch({ type: 'SET_PODCAST', podcast: fresh })
      dispatch({ type: 'PLAY' })
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`再生できませんでした (${err.status})`, 'error')
      }
    }
  }
}
