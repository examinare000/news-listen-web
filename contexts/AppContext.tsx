'use client'

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import type { Podcast } from '@/types/index'
import { KEY_DEFAULT_PLAYBACK_SPEED, KEY_TIME_FORMAT } from '@/lib/config'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AppState {
  /** True until the localStorage restore effect has completed (prevents flash of UI). */
  isRestoring: boolean
  currentPodcast: Podcast | null
  playbackSpeed: number
  /** Time format for article dates: 'absolute' (M/D HH:MM) or 'relative' (3時間前) */
  timeFormat: 'absolute' | 'relative'
  // NOTE: volume is intentionally NOT here — managed by useAudioPlayer (spec §9)
  // NOTE: isPlaying/currentTime/duration are intentionally NOT here — managed by useAudioPlayer (single source of truth)
}

const DEFAULT_STATE: AppState = {
  isRestoring: true,
  currentPodcast: null,
  playbackSpeed: 1.0,
  timeFormat: 'absolute',
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'RESTORE_DONE' }
  | { type: 'SET_PODCAST'; podcast: Podcast }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'SET_TIME_FORMAT'; timeFormat: 'absolute' | 'relative' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'RESTORE_DONE':
      return { ...state, isRestoring: false }
    case 'SET_PODCAST':
      return { ...state, currentPodcast: action.podcast }
    case 'SET_SPEED':
      return { ...state, playbackSpeed: action.speed }
    case 'SET_TIME_FORMAT':
      return { ...state, timeFormat: action.timeFormat }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
  setTimeFormat: (timeFormat: 'absolute' | 'relative') => void
}

const AppContext = createContext<AppContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AppProviderProps {
  children: React.ReactNode
  /** Test-only: override the initial state (partial merge) */
  initialState?: Partial<AppState>
}

export function AppProvider({ children, initialState }: AppProviderProps) {
  const mergedInitial: AppState = initialState
    ? { ...DEFAULT_STATE, ...initialState }
    : DEFAULT_STATE

  const [state, dispatch] = useReducer(reducer, mergedInitial)

  // Restore persisted settings from localStorage on mount.
  // RESTORE_DONE is always dispatched so isRestoring clears.
  useEffect(() => {
    // Restore default playback speed regardless of state (spec §10.5).
    // Invalid or absent values fall back to the default 1.0.
    try {
      const rawSpeed = localStorage.getItem(KEY_DEFAULT_PLAYBACK_SPEED)
      if (rawSpeed !== null) {
        const speed = JSON.parse(rawSpeed)
        if (typeof speed === 'number' && speed > 0) {
          dispatch({ type: 'SET_SPEED', speed })
        }
      }
    } catch {
      // Corrupted storage — stay at default speed 1.0
    }

    // Restore time format preference (article dates: absolute or relative).
    // Invalid or absent values fall back to the default 'absolute'.
    try {
      const rawTimeFormat = localStorage.getItem(KEY_TIME_FORMAT)
      if (rawTimeFormat !== null) {
        const timeFormat = JSON.parse(rawTimeFormat)
        if (timeFormat === 'absolute' || timeFormat === 'relative') {
          dispatch({ type: 'SET_TIME_FORMAT', timeFormat })
        }
      }
    } catch {
      // Corrupted storage — stay at default timeFormat 'absolute'
    }

    dispatch({ type: 'RESTORE_DONE' })
  }, [])

  const setTimeFormat = useCallback((timeFormat: 'absolute' | 'relative') => {
    try {
      localStorage.setItem(KEY_TIME_FORMAT, JSON.stringify(timeFormat))
    } catch {
      // Storage write failure is non-fatal
    }
    dispatch({ type: 'SET_TIME_FORMAT', timeFormat })
  }, [])

  return (
    <AppContext.Provider value={{ state, dispatch, setTimeFormat }}>
      {children}
    </AppContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useApp must be used within AppProvider')
  }
  return ctx
}
