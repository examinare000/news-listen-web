'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useApp } from '@/contexts/AppContext'
import { useToast } from '@/components/ui/Toast'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration, formatDate } from '@/lib/format'
import { createApiClient, ApiError } from '@/lib/api'
import { useStartPodcast } from '@/hooks/useStartPodcast'
import type { Podcast } from '@/types/index'

interface PodcastDetailPageProps {
  params: Promise<{ id: string }>
}

function PageHeader({ showBackLink }: { showBackLink: boolean }) {
  return (
    <div className="page-header">
      <div>
        <div className="page-title">エピソード詳細</div>
      </div>
      {/* 404 時は本文の empty-state 側に戻るリンクを置くため、ヘッダーには出さない
          （同名リンクの重複でアクセシビリティ上の曖昧さを生まないため） */}
      {showBackLink && (
        <div className="header-actions">
          <Link href="/podcast" className="btn btn-ghost">
            一覧へ戻る
          </Link>
        </div>
      )}
    </div>
  )
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
      <>
        <PageHeader showBackLink={false} />
        <div className="content-area">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              🔍
            </div>
            <p className="empty-state-title">エピソードが見つかりません</p>
            <p className="empty-state-desc">
              <Link href="/podcast" className="btn btn-ghost">
                一覧へ戻る
              </Link>
            </p>
          </div>
        </div>
      </>
    )
  }

  if (loading || !podcast) {
    return (
      <>
        <PageHeader showBackLink />
        <div className="content-area content-narrow">
          {/* 読み込み中テキストは維持しつつ .skeleton のシマーで視覚表現する */}
          <div className="skeleton" style={{ height: 150, borderRadius: 'var(--radius-md)' }}>
            <span className="sr-only">読み込み中...</span>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader showBackLink />
      <div className="content-area content-narrow">
        <div className="podcast-badges" style={{ marginBottom: 14 }}>
          <DifficultyBadge difficulty={podcast.difficulty} />
          {podcast.type === 'digest' && <span className="badge">DIGEST</span>}
        </div>

        {/* イントロは全文表示（.podcast-intro は一覧用の 2 行クランプを持つため使わない） */}
        <p style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 16 }}>
          {podcast.japanese_intro_text}
        </p>

        <div className="podcast-meta" style={{ marginBottom: 16 }}>
          <span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatDuration(podcast.duration_seconds)}
          </span>
          <span>{formatDate(podcast.created_at)}</span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <strong>記事ID:</strong>
          {podcast.article_ids.map((id) => (
            <span key={id} style={{ fontFamily: 'var(--font-mono), monospace' }}>
              {id}
            </span>
          ))}
        </div>

        <button type="button" className="btn btn-primary" onClick={handlePlay} aria-label="再生">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          再生
        </button>
      </div>
    </>
  )
}
