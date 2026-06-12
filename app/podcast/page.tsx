'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { PodcastCard } from '@/components/PodcastCard'
import { getSavedPosition } from '@/hooks/useAudioPlayer'
import { useStartPodcast } from '@/hooks/useStartPodcast'
import { createApiClient, ApiError } from '@/lib/api'
import type { Podcast } from '@/types/index'

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function SkeletonCard() {
  // カード形状（高さは .podcast-card のおおよその実寸）の .skeleton をローディング表示に使う
  return (
    <div
      data-testid="skeleton-card"
      className="skeleton"
      style={{ height: 150, borderRadius: 'var(--radius-md)' }}
    />
  )
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

  function renderContent() {
    if (loading) {
      return (
        <div className="podcast-grid">
          <SkeletonCard />
        </div>
      )
    }

    if (podcasts.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            🎙️
          </div>
          <p className="empty-state-title">Podcast がまだありません</p>
          <p className="empty-state-desc">Star した記事が溜まると Podcast が生成されます</p>
        </div>
      )
    }

    return (
      <div className="podcast-grid">
        {podcasts.map((podcast) => {
          const savedPosition = getSavedPosition(podcast.id)
          return (
            <PodcastCard
              key={podcast.id}
              podcast={podcast}
              onPlay={handlePlay}
              savedPosition={savedPosition > 0 ? savedPosition : undefined}
              // 再生中強調（D24）: 判定はページ責務（PodcastCard を Context 非依存に保つ）
              playing={state.currentPodcast?.id === podcast.id}
            />
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">ポッドキャスト</div>
          <div className="page-subtitle">AI生成エピソード一覧</div>
        </div>
        <div className="header-actions">
          {/* 「新規生成」は実装しない（D12: 生成は日次バッチのみ） */}
          <button
            type="button"
            className="btn btn-icon"
            onClick={fetchPodcasts}
            aria-label="リフレッシュ"
            title="更新"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="content-area">{renderContent()}</div>
    </>
  )
}
