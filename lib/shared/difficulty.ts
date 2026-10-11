export const DIFFICULTY_LEVELS = Object.freeze([
  'toeic_600',
  'toeic_900',
  'ielts_55',
  'ielts_7',
  'eiken_2',
  'eiken_p1',
] as const)

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]
