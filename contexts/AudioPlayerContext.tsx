'use client'

import React, { createContext, useContext, useCallback } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useToast } from '@/components/ui/Toast'
import { createApiClient } from '@/lib/api'

// Single shared player instance for the entire app.
// Without this provider, each component calling useAudioPlayer() would get
// its own Audio element — making AudioPlayerBar unable to control pages' audio.
type AudioPlayerContextValue = ReturnType<typeof useAudioPlayer>

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast()

  // Callback to save playback position to server (B群#12).
  // WHY: Network calls belong at the page/provider level, not in the hook.
  // Errors are silently ignored to prevent breaking the UI.
  const onPositionSave = useCallback(
    (podcastId: string, seconds: number) => {
      createApiClient()
        .updatePosition(podcastId, Math.max(0, seconds))
        .catch(() => {
          // Silent catch: network failures should not interrupt playback
        })
    },
    [],
  )

  // Wire audio-element error events to the toast system (spec §9 L144).
  // ToastProvider wraps AudioPlayerProvider in layout.tsx, so useToast() is safe here.
  const player = useAudioPlayer({
    onError: () => showToast('音声を再生できません', 'error'),
    onPositionSave,
  })

  return (
    <AudioPlayerContext.Provider value={player}>
      {children}
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayerContext(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) {
    throw new Error('useAudioPlayerContext must be used within AudioPlayerProvider')
  }
  return ctx
}
