import React from 'react'
import type { DifficultyLevel } from '@/types/index'

const DIFFICULTY_LABELS: Record<string, string> = {
  toeic_600: 'TOEIC 600',
  toeic_900: 'TOEIC 900',
  ielts_55: 'IELTS 5.5',
  ielts_7: 'IELTS 7.0',
  eiken_2: '英検2級',
  eiken_p1: '英検準1級',
}

interface DifficultyBadgeProps {
  difficulty: DifficultyLevel
}

export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const label = DIFFICULTY_LABELS[difficulty] ?? difficulty
  return <span className="difficulty-badge">{label}</span>
}
