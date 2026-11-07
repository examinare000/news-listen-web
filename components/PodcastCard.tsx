import React from 'react'
import Link from 'next/link'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDuration, formatDate } from '@/lib/format'
import type { EpisodeCardView } from '@/lib/catalog/application/readModels'
import { failureMessage } from '@/lib/catalog/presentation/failureMessage'

interface PodcastCardProps {
  // 表示 field も種別（再生可否・失敗の理由）も、呼出元が作ったリードモデルから読む。
  episode: EpisodeCardView
  onPlay: (episode: EpisodeCardView) => void
  savedPosition?: number
  // 再生中判定は親ページの責務（nowPlaying()?.episodeId === episode.id）。
  // WHY: Context 非依存の純粋コンポーネントに保ちテストを軽くする（ArticleCard と同方針）
  playing?: boolean
  // 連続再生の導線（issue #81）。親ページがキュー操作を注入する（未指定なら非表示）。
  onPlayNext?: (episode: EpisodeCardView) => void
  onAddToQueue?: (episode: EpisodeCardView) => void
  // オフライン保存（issue #167）。ダウンロード状態・ハンドラは親ページが注入する
  // （未指定なら非表示。Context 非依存の純粋コンポーネント方針は他の連続再生ボタンと同じ）。
  cached?: boolean
  onDownload?: (episode: EpisodeCardView) => void
  justCompleted?: boolean
}

export function PodcastCard({
  episode,
  onPlay,
  savedPosition,
  playing = false,
  onPlayNext,
  onAddToQueue,
  cached = false,
  justCompleted = false,
  onDownload,
}: PodcastCardProps) {
  const playable = episode.kind === 'playable'
  const hasSavedPosition = typeof savedPosition === 'number' && savedPosition > 0

  return (
    <div
      className={`podcast-card ${playing ? 'playing' : ''} ${justCompleted ? 'just-completed' : ''}`.trim()}
      data-testid={`podcast-card-${episode.id}`}
    >
      <div className="podcast-card-top">
        <div className="podcast-badges">
          <DifficultyBadge difficulty={episode.difficulty} />
          <StatusBadge status={episode.kind} />
          {episode.isDigest && <span className="badge">DIGEST</span>}
        </div>
        {episode.failureReason !== null && (
          <p data-testid={`podcast-failure-message-${episode.id}`}>{failureMessage(episode.failureReason)}</p>
        )}
        {/* 再生ボタンはリンク外に配置し、カード内クリックの伝播も止める
            （詳細ページ遷移と再生操作を干渉させないため）。再生できるエピソードにだけ出す */}
        {playable && (
          <button
            type="button"
            className="podcast-play-btn"
            aria-label="再生"
            onClick={(event) => {
              event.stopPropagation()
              onPlay(episode)
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
        )}
        {/* 連続再生（issue #81）・オフライン保存（issue #167）の導線。再生できるエピソードで、注入時のみ表示。 */}
        {playable && (onPlayNext || onAddToQueue || onDownload) && (
          <div className="podcast-queue-actions">
            {onPlayNext && (
              <button
                type="button"
                className="ctrl-btn"
                aria-label="次に再生"
                title="次に再生"
                onClick={(event) => {
                  event.stopPropagation()
                  onPlayNext(episode)
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
                  onAddToQueue(episode)
                }}
              >
                ＋キュー
              </button>
            )}
            {onDownload &&
              (cached ? (
                <span className="ctrl-btn" aria-label="オフライン保存済み">
                  保存済み
                </span>
              ) : (
                <button
                  type="button"
                  className="ctrl-btn"
                  aria-label="オフライン保存"
                  title="オフライン保存"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDownload(episode)
                  }}
                >
                  オフライン保存
                </button>
              ))}
          </div>
        )}
      </div>

      <Link href={`/podcast/${episode.id}`}>
        {/* 80 文字 slice は撤去（CSS の 2 行クランプが代替） */}
        <p className="podcast-intro">{episode.intro}</p>
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
            {formatDuration(episode.durationSeconds)}
          </span>
          <span>{formatDate(episode.createdAt)}</span>
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
