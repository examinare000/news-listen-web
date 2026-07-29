'use client'

import React, { createContext, use, useCallback, useEffect, useRef, useState } from 'react'
import { createApiClient } from '@/lib/api'
import { playSfx } from '@/lib/sfx'
import type { ListeningStreak } from '@/types/index'

const STALE_AFTER_MS = 5 * 60 * 1000

interface StreakContextValue {
  streak: ListeningStreak | null
  refresh: () => Promise<void>
  isPulsing: boolean
}

const StreakContext = createContext<StreakContextValue | null>(null)

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const [streak, setStreak] = useState<ListeningStreak | null>(null)
  const [isPulsing, setIsPulsing] = useState(false)
  const streakRef = useRef<ListeningStreak | null>(null)
  const lastFetchedAtRef = useRef(0)
  const requestRef = useRef<Promise<void> | null>(null)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (Date.now() - lastFetchedAtRef.current < STALE_AFTER_MS) return
    if (requestRef.current) return requestRef.current

    let response: ReturnType<ReturnType<typeof createApiClient>['getListeningStreak']>
    try {
      response = createApiClient().getListeningStreak()
    } catch {
      return
    }

    const request = response
      .then((nextStreak) => {
        const previousStreak = streakRef.current
        streakRef.current = nextStreak
        lastFetchedAtRef.current = Date.now()
        setStreak(nextStreak)
        if (
          previousStreak !== null
          && nextStreak.current_streak_days > previousStreak.current_streak_days
        ) {
          playSfx('streak')
          setIsPulsing(true)
          if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
          pulseTimeoutRef.current = setTimeout(() => {
            setIsPulsing(false)
          }, 300)
        }
      })
      .catch(() => {
        // This shell-wide status is supportive context: retain the previous value and
        // retry silently on a later stale focus.
      })
      .finally(() => {
        requestRef.current = null
      })

    requestRef.current = request
    return request
  }, [])

  useEffect(() => {
    void refresh()
    const refreshWhenFocused = () => {
      void refresh()
    }
    window.addEventListener('focus', refreshWhenFocused)
    return () => window.removeEventListener('focus', refreshWhenFocused)
  }, [refresh])

  return (
    <StreakContext value={{ streak, refresh, isPulsing }}>
      {children}
    </StreakContext>
  )
}

export function useStreak(): StreakContextValue {
  const context = use(StreakContext)
  if (!context) throw new Error('useStreak must be used within StreakProvider')
  return context
}
