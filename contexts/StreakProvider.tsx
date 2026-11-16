'use client'

import React, { createContext, use, useCallback, useEffect, useRef, useState } from 'react'
import { useSfx } from '@/contexts/SfxProvider'
import { useLearningQueries } from '@/contexts/useLearningQueries'
import { isStale } from '@/lib/learning/domain/streak'
import type { StreakView } from '@/lib/learning/application/readModels'

interface StreakContextValue {
  streak: StreakView | null
  refresh: () => Promise<void>
  isPulsing: boolean
}

const StreakContext = createContext<StreakContextValue | null>(null)

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const queries = useLearningQueries()
  const { play } = useSfx()
  const [streak, setStreak] = useState<StreakView | null>(null)
  const [isPulsing, setIsPulsing] = useState(false)
  const streakRef = useRef<StreakView | null>(null)
  const lastFetchedAtRef = useRef(0)
  const requestRef = useRef<Promise<void> | null>(null)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (!isStale(lastFetchedAtRef.current, Date.now())) return
    if (requestRef.current) return requestRef.current

    // getStreak は reject しない。取得できなかったとき（null）は state・取得時刻を変えず、次の focus で取り直す。
    const request = queries
      .getStreak(streakRef.current)
      .then((view) => {
        if (view === null) return
        streakRef.current = view
        lastFetchedAtRef.current = Date.now()
        setStreak(view)
        if (view.justIncreased) {
          play('streak')
          setIsPulsing(true)
          if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
          pulseTimeoutRef.current = setTimeout(() => {
            setIsPulsing(false)
          }, 300)
        }
      })
      .finally(() => {
        requestRef.current = null
      })

    requestRef.current = request
    return request
  }, [queries, play])

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
