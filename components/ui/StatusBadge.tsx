import React from 'react'
import type { Episode } from '@/lib/catalog/domain/episode'

const STATUS_LABELS: Record<Episode['kind'], string> = {
  playable: '完成',
  generating: '生成中',
  failed: '失敗',
}

// WHY: Design defines 3 tones (easy/medium/hard) for podcast status as well
// Map episode kinds to visual tones: generating (waiting) → medium, playable → easy, failed → hard
const STATUS_TONES: Record<Episode['kind'], string> = {
  playable: 'badge-easy',
  generating: 'badge-medium',
  failed: 'badge-hard',
}

interface StatusBadgeProps {
  status: Episode['kind']
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`badge ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>
}
