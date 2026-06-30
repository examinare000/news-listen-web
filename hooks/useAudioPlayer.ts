'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { KEY_PLAYER_VOLUME, podcastPositionKey } from '@/lib/config'

/** 8-stage playback speed options (exported for UI selectors) */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5] as const

/** Minimum save interval in seconds (position-based throttle) */
const POSITION_SAVE_INTERVAL = 10

interface UseAudioPlayerOptions {
  onError?: () => void
  // Callback to save position to backend (network call)
  // WHY: Hook does not import fetch to keep it pure; server sync is caller's responsibility
  onPositionSave?: (podcastId: string, seconds: number) => void
  // Called when the current episode finishes playing (issue #81: auto-advance to queue's next).
  // WHY: queue/advance logic belongs in the provider, not in this pure audio hook.
  onEnded?: () => void
}

interface AudioPlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
}

interface AudioPlayerControls {
  load: (url: string, resumePosition: number, podcastId: string) => void
  play: () => Promise<void>
  pause: () => void
  seek: (time: number) => void
  seekRelative: (delta: number) => void
  setSpeed: (speed: number) => void
  setVolume: (v: number) => void
}

function readSavedVolume(): number {
  try {
    const raw = localStorage.getItem(KEY_PLAYER_VOLUME)
    if (raw === null) return 1.0
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'number' || parsed < 0 || parsed > 1) return 1.0
    return parsed
  } catch {
    return 1.0
  }
}

/**
 * Reads the saved playback position for a podcast from localStorage.
 * Exported so pages can restore position without duplicating key logic.
 */
export function getSavedPosition(podcastId: string): number {
  try {
    const raw = localStorage.getItem(podcastPositionKey(podcastId))
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    return typeof parsed === 'number' ? parsed : 0
  } catch {
    return 0
  }
}

function savePosition(podcastId: string, time: number): void {
  try {
    localStorage.setItem(podcastPositionKey(podcastId), JSON.stringify(time))
  } catch {
    // Storage failure is non-fatal
  }
}

export function useAudioPlayer(
  opts?: UseAudioPlayerOptions,
): AudioPlayerState & AudioPlayerControls {
  // Stable refs for the callbacks to avoid re-running effects when they change
  const onErrorRef = useRef(opts?.onError)
  const onPositionSaveRef = useRef(opts?.onPositionSave)
  const onEndedRef = useRef(opts?.onEnded)
  useEffect(() => {
    onErrorRef.current = opts?.onError
    onPositionSaveRef.current = opts?.onPositionSave
    onEndedRef.current = opts?.onEnded
  })

  // Single audio element shared across the hook's lifetime
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const podcastIdRef = useRef<string | null>(null)
  const pendingResumeRef = useRef<number>(0)
  const lastSavedPositionRef = useRef<number>(0)

  // --- State ---
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState<number>(() => readSavedVolume())

  // Ensure audio element exists (created once per hook instance)
  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio()
    }
    return audioRef.current
  }

  // Set up event listeners once after mount
  useEffect(() => {
    const audio = getAudio()

    const handleTimeUpdate = () => {
      const t = audio.currentTime
      setCurrentTime(t)

      // Position-based throttle: save every POSITION_SAVE_INTERVAL seconds
      if (
        podcastIdRef.current &&
        t - lastSavedPositionRef.current >= POSITION_SAVE_INTERVAL
      ) {
        lastSavedPositionRef.current = t
        savePosition(podcastIdRef.current, t)
        // Also notify server via callback (network: caller's responsibility)
        onPositionSaveRef.current?.(podcastIdRef.current, t)
      }
    }

    const handleEnded = () => {
      setIsPlaying(false)
      if (podcastIdRef.current) {
        savePosition(podcastIdRef.current, 0)
        // Save ended position to server as well
        onPositionSaveRef.current?.(podcastIdRef.current, 0)
      }
      audio.currentTime = 0
      // issue #81: notify the queue to auto-advance to the next episode (if any).
      onEndedRef.current?.()
    }

    const handleError = () => {
      setIsPlaying(false)
      onErrorRef.current?.()
    }

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
      // Out-of-range guard: if saved position exceeds duration, start from 0
      if (pendingResumeRef.current >= audio.duration) {
        audio.currentTime = 0
      }
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [])

  const load = useCallback(
    (url: string, resumePosition: number, podcastId: string) => {
      const audio = getAudio()

      // Pause current playback before switching episodes
      audio.pause()
      setIsPlaying(false)

      pendingResumeRef.current = resumePosition
      podcastIdRef.current = podcastId
      lastSavedPositionRef.current = resumePosition

      // Restore saved volume on every load
      const savedVol = readSavedVolume()
      audio.volume = savedVol
      setVolumeState(savedVol)

      audio.src = url
      audio.currentTime = resumePosition
      setCurrentTime(resumePosition)
    },
    [],
  )

  const play = useCallback(async () => {
    const audio = getAudio()
    await audio.play()
    setIsPlaying(true)
  }, [])

  const pause = useCallback(() => {
    const audio = getAudio()
    audio.pause()
    setIsPlaying(false)
  }, [])

  const seek = useCallback((time: number) => {
    const audio = getAudio()
    audio.currentTime = time
    setCurrentTime(time)
  }, [])

  const seekRelative = useCallback((delta: number) => {
    const audio = getAudio()
    const next = Math.max(0, Math.min(audio.currentTime + delta, audio.duration || 0))
    audio.currentTime = next
    setCurrentTime(next)
  }, [])

  const setSpeed = useCallback((speed: number) => {
    const audio = getAudio()
    audio.playbackRate = speed
  }, [])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    const audio = getAudio()
    audio.volume = clamped
    setVolumeState(clamped)
    try {
      localStorage.setItem(KEY_PLAYER_VOLUME, JSON.stringify(clamped))
    } catch {
      // Storage failure is non-fatal
    }
  }, [])

  return {
    isPlaying,
    currentTime,
    duration,
    volume,
    load,
    play,
    pause,
    seek,
    seekRelative,
    setSpeed,
    setVolume,
  }
}
