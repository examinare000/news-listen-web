'use client'

import React, { createContext, useContext } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'

// Single shared player instance for the entire app.
// Without this provider, each component calling useAudioPlayer() would get
// its own Audio element — making AudioPlayerBar unable to control pages' audio.
type AudioPlayerContextValue = ReturnType<typeof useAudioPlayer>

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  // Owned once here; all consumers receive the same Audio element via context.
  const player = useAudioPlayer()
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
