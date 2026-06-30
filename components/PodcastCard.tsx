import React from 'react'
import Link from 'next/link'
import type { Podcast } from '@/types/index'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDuration, formatDate } from '@/lib/format'

interface PodcastCardProps {
  podcast: Podcast
  onPlay: (podcast: Podcast) => void
  savedPosition?: number
  // 再生中判定は親ページの責務（currentPodcast?.id === podcast.id）。
  // WHY: Context 非依存の純粋コンポーネントに保ちテストを軽くする（ArticleCard と同方針）
  playing?: boolean
  // 連続再生の導線（issue #81）。親ページがキュー操作を注入する（未指定なら非表示）。
  onPlayNext?: (podcast: Podcast) => void
  onAddToQueue?: (podcast: Podcast) => void
}

export function PodcastCard({
  podcast,
  onPlay,
  savedPosition,
  playing = false,
  onPlayNext,
  onAddToQueue,
}: PodcastCardProps) {
  const hasSavedPosition = typeof savedPosition === 'number' && savedPosition > 0

  return (
    <div
      className={playing ? 'podcast-card playing' : 'podcast-card'}
      data-testid={`podcast-card-${podcast.id}`}
    >
      <div className="podcast-card-top">
        <div className="podcast-badges">
          <DifficultyBadge difficulty={podcast.difficulty} />
          <StatusBadge status={podcast.status} />
          {podcast.type === 'digest' && <span className="badge">DIGEST</span>}
        </div>
        {/* 再生ボタンはリンク外に配置し、カード内クリックの伝播も止める
            （詳細ページ遷移と再生操作を干渉させないため） */}
        <button
          type="button"
          className="podcast-play-btn"
          aria-label="再生"
          onClick={(event) => {
            event.stopPropagation()
            onPlay(podcast)
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
        {/* 連続再生の導線（issue #81）。注入時のみ表示。 */}
        {(onPlayNext || onAddToQueue) && (
          <div className="podcast-queue-actions">
            {onPlayNext && (
              <button
                type="button"
                className="ctrl-btn"
                aria-label="次に再生"
                title="次に再生"
                onClick={(event) => {
                  event.stopPropagation()
                  onPlayNext(podcast)
                }}
              >
                次に再生
              </button>
            )}
            {onAddToQueue && (
              <button
                type="button"
                className="ctrl-btn"
                aria-label="キューに追加"
                title="キューに追加"
                onClick={(event) => {
                  event.stopPropagation()
                  onAddToQueue(podcast)
                }}
              >
                ＋キュー
              </button>
            )}
          </div>
        )}
      </div>

      <Link href={`/podcast/${podcast.id}`}>
        {/* 80 文字 slice は撤去（CSS の 2 行クランプが代替） */}
        <p className="podcast-intro">{podcast.japanese_intro_text}</p>
      </Link>

      <div className="podcast-footer">
        <div className="podcast-meta">
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
          {hasSavedPosition && <span>続きから {formatDuration(savedPosition)}</span>}
        </div>

        {playing && (
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <div className="waveform-mini">
              <div className="waveform-mini-bar" style={{ height: '8px' }} />
              <div className="waveform-mini-bar" style={{ height: '14px' }} />
              <div className="waveform-mini-bar" style={{ height: '6px' }} />
              <div className="waveform-mini-bar" style={{ height: '12px' }} />
            </div>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--teal)',
                marginLeft: '4px',
                fontFamily: 'var(--font-mono), monospace',
              }}
            >
              再生中
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
