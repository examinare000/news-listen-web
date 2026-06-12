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

// デザインの 3 トーン（app-ui.html L614-616）を 6 難易度に割当（03-ui-parts.md §4）
// WHY: デザインは easy/medium/hard の 3 色しか定義しないため、難易度の高低で機械的に対応付ける
const DIFFICULTY_TONES: Record<string, string> = {
  toeic_600: 'badge-easy',
  eiken_2: 'badge-easy',
  toeic_900: 'badge-medium',
  ielts_55: 'badge-medium',
  ielts_7: 'badge-hard',
  eiken_p1: 'badge-hard',
}

interface DifficultyBadgeProps {
  difficulty: DifficultyLevel
}

export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const label = DIFFICULTY_LABELS[difficulty] ?? difficulty
  // 未知の値はトーンクラスなしの .badge のみで生値を表示（既存の境界値挙動を維持）
  const tone = DIFFICULTY_TONES[difficulty]
  return <span className={tone ? `badge ${tone}` : 'badge'}>{label}</span>
}
