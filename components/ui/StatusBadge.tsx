import React from 'react'
import type { PodcastStatus } from '@/types/index'

const STATUS_LABELS: Record<string, string> = {
  processing: '生成中',
  completed: '完成',
  failed: '失敗',
  partial_failed: '一部失敗',
}

// WHY: Design defines 3 tones (easy/medium/hard) for podcast status as well
// Map status states to visual tones: processing (waiting) → medium, completed → easy, failures → hard
const STATUS_TONES: Record<string, string> = {
  processing: 'badge-medium',
  completed: 'badge-easy',
  failed: 'badge-hard',
  partial_failed: 'badge-hard',
}

interface StatusBadgeProps {
  status: PodcastStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const label = STATUS_LABELS[status] ?? status
  // Unknown values show raw text with .badge only, no tone class (consistent with DifficultyBadge boundary behavior)
  const tone = STATUS_TONES[status]
  return <span className={tone ? `badge ${tone}` : 'badge'}>{label}</span>
}
