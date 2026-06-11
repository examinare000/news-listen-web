'use client'

import React, { createContext, useContext } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useToast } from '@/components/ui/Toast'

// Single shared player instance for the entire app.
// Without this provider, each component calling useAudioPlayer() would get
// its own Audio element — making AudioPlayerBar unable to control pages' audio.
type AudioPlayerContextValue = ReturnType<typeof useAudioPlayer>

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast()

  // Wire audio-element error events to the toast system (spec §9 L144).
  // ToastProvider wraps AudioPlayerProvider in layout.tsx, so useToast() is safe here.
  const player = useAudioPlayer({
    onError: () => showToast('音声を再生できません', 'error'),
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
