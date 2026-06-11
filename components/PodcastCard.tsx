import React from 'react'
import Link from 'next/link'
import type { Podcast } from '@/types/index'
import { DifficultyBadge } from '@/components/ui/DifficultyBadge'
import { formatDuration, formatDate } from '@/lib/format'

interface PodcastCardProps {
  podcast: Podcast
  onPlay: (podcast: Podcast) => void
  savedPosition?: number
}

export function PodcastCard({ podcast, onPlay, savedPosition }: PodcastCardProps) {
  const intro80 = podcast.japanese_intro_text.slice(0, 80)
  const hasSavedPosition = typeof savedPosition === 'number' && savedPosition > 0

  return (
    <div className="podcast-card">
      <Link href={`/podcast/${podcast.id}`} aria-label={intro80}>
        <p>{intro80}{podcast.japanese_intro_text.length > 80 ? '…' : ''}</p>
      </Link>

      <DifficultyBadge difficulty={podcast.difficulty} />
      <span className="duration">{formatDuration(podcast.duration_seconds)}</span>
      <span className="created-at">{formatDate(podcast.created_at)}</span>

      {hasSavedPosition && (
        <span className="saved-position">続きから {formatDuration(savedPosition)}</span>
      )}

      <button onClick={() => onPlay(podcast)} aria-label="再生">
        再生
      </button>
    </div>
  )
}
