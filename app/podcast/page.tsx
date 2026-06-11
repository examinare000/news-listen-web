'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { PodcastCard } from '@/components/PodcastCard'
import { getSavedPosition } from '@/hooks/useAudioPlayer'
import { useStartPodcast } from '@/hooks/useStartPodcast'
import { createApiClient, ApiError } from '@/lib/api'
import type { Podcast } from '@/types/index'

function SkeletonCard() {
  return <div data-testid="skeleton-card" className="skeleton-card" />
}

export default function PodcastPage() {
  const { state } = useApp()
  const { showToast } = useToast()
  const startPodcast = useStartPodcast()

  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPodcasts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).getPodcasts()
      setPodcasts(data.podcasts)
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`エラーが発生しました (${err.status})`, 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [state.baseUrl, state.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPodcasts()
  }, [fetchPodcasts])

  function handlePlay(podcast: Podcast) {
    startPodcast(podcast.id)
  }

  if (loading) {
    return <SkeletonCard />
  }

  if (podcasts.length === 0) {
    return (
      <div>
        <p>Podcast がまだありません</p>
        <p>Star した記事が溜まると Podcast が生成されます</p>
        <button onClick={fetchPodcasts} aria-label="リフレッシュ">リフレッシュ</button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={fetchPodcasts} aria-label="リフレッシュ">リフレッシュ</button>
      {podcasts.map((podcast) => {
        const savedPosition = getSavedPosition(podcast.id)
        return (
          <PodcastCard
            key={podcast.id}
            podcast={podcast}
            onPlay={handlePlay}
            savedPosition={savedPosition > 0 ? savedPosition : undefined}
          />
        )
      })}
    </div>
  )
}
