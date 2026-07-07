'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { PodcastCard } from '@/components/PodcastCard'
import { getSavedPosition } from '@/hooks/useAudioPlayer'
import { usePodcastListPolling } from '@/hooks/usePodcastListPolling'
import { useStartPodcast } from '@/hooks/useStartPodcast'
import { useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { createApiClient, ApiError } from '@/lib/api'
import { isCached, downloadAudio } from '@/lib/audioCache'
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
  // 連続再生のキュー操作（issue #81）。
  const { playNextInQueue, addToQueue } = useAudioPlayerContext()

  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [loading, setLoading] = useState(true)
  const [pollingEnabled, setPollingEnabled] = useState(true)

  const fetchPodcasts = useCallback(async () => {
    try {
      const data = await createApiClient().getPodcasts()
      setPodcasts(data.podcasts)
      return data
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`エラーが発生しました (${err.status})`, 'error')
      }
      return { podcasts: [] }
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPodcasts()
  }, [fetchPodcasts])

  // オフライン保存（issue #167）。一覧取得のたびに各エピソードのキャッシュ有無を確認する。
  const [cachedIds, setCachedIds] = useState<Set<string>>(() => new Set())

  // WHY depend on a joined-id string, not `podcasts` itself (regression fix): getPodcasts()
  // is an HTTP/JSON round-trip, so it returns a brand-new array reference every poll even when
  // the content is unchanged. Depending on `podcasts` directly re-ran this effect on every
  // poll tick regardless of content, and that extra state update (setCachedIds) fed back into
  // usePodcastListPolling's pre-existing onUpdate-identity instability (its `poll` callback is
  // recreated — and its effect torn down/re-run — on every render), compounding into a
  // render/fetch storm that made e2e/main-flow.e2e.ts's play-button click never stabilize
  // (7898 GET /api/backend/podcasts calls observed in a 14s Playwright trace vs. ~150 without
  // this effect). A joined-id string is a primitive, so React's Object.is dependency check only
  // reruns this effect when the actual set of podcast ids changes, not on every same-content refetch.
  const podcastIds = podcasts.map((p) => p.id).join(',')

  useEffect(() => {
    if (podcasts.length === 0) return
    let cancelled = false
    Promise.all(podcasts.map((p) => isCached(p.id).then((c) => (c ? p.id : null))))
      .then((ids) => {
        if (cancelled) return
        setCachedIds(new Set(ids.filter((id): id is string => id !== null)))
      })
      .catch(() => {
        // 確認失敗は致命的ではない（未保存として扱い、ボタンは表示し続ける）。
      })
    return () => {
      cancelled = true
    }
  }, [podcastIds]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownload(podcast: Podcast) {
    try {
      await downloadAudio(podcast.id)
      setCachedIds((prev) => new Set(prev).add(podcast.id))
    } catch {
      showToast('オフライン保存に失敗しました', 'error')
    }
  }

  // #11 ポーリング: 新規 Podcast 生成完了を待つ
  // WHY: ユーザーが /feed で Star → /podcast に遷移した直後、生成完了を自動検知して表示更新
  // onUpdate で停止時に polling を無効化（過剰ポーリング防止）
  usePodcastListPolling({
    fetchPodcasts,
    onUpdate: () => {
      setPollingEnabled(false)
    },
    enabled: pollingEnabled,
  })

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
              onPlayNext={(p) => { void playNextInQueue(p) }}
              onAddToQueue={(p) => { void addToQueue(p) }}
              savedPosition={savedPosition > 0 ? savedPosition : undefined}
              // 再生中強調（D24）: 判定はページ責務（PodcastCard を Context 非依存に保つ）
              playing={state.currentPodcast?.id === podcast.id}
              // オフライン保存（issue #167）: 状態・ハンドラもページ責務として注入する
              cached={cachedIds.has(podcast.id)}
              onDownload={(p) => void handleDownload(p)}
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
