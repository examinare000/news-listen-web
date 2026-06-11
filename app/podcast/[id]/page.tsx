'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration } from '@/lib/format'
import { createApiClient, ApiError } from '@/lib/api'
import { useStartPodcast } from '@/hooks/useStartPodcast'
import type { Podcast } from '@/types/index'

interface PodcastDetailPageProps {
  params: Promise<{ id: string }>
}

export default function PodcastDetailPage({ params }: PodcastDetailPageProps) {
  const { state } = useApp()
  const { showToast } = useToast()
  const startPodcast = useStartPodcast()

  const [podcast, setPodcast] = useState<Podcast | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [podcastId, setPodcastId] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => setPodcastId(p.id))
  }, [params])

  useEffect(() => {
    if (!podcastId) return

    async function fetch() {
      try {
        const data = await createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }).getPodcast(podcastId!)
        setPodcast(data)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          showToast('読み込みに失敗しました', 'error')
        }
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [podcastId, state.baseUrl, state.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePlay() {
    if (!podcast) return
    // Delegate to shared hook: re-fetches fresh URL (spec §9 L151),
    // restores saved position (spec §10.3 L201/L209 "一覧と同フロー").
    await startPodcast(podcast.id)
  }

  if (notFound) {
    return (
      <div>
        <p>エピソードが見つかりません</p>
        <Link href="/podcast">一覧へ戻る</Link>
      </div>
    )
  }

  if (loading || !podcast) {
    return <div>読み込み中...</div>
  }

  return (
    <div>
      <DifficultyBadge difficulty={podcast.difficulty} />
      <p>{podcast.japanese_intro_text}</p>
      <p>{formatDuration(podcast.duration_seconds)}</p>

      <div>
        <strong>記事ID:</strong>
        {podcast.article_ids.map((id) => (
          <span key={id}>{id}</span>
        ))}
      </div>

      <button onClick={handlePlay} aria-label="再生">
        再生
      </button>
    </div>
  )
}
