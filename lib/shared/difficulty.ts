export const DIFFICULTY_LEVELS = Object.freeze([
  'toeic_600',
  'toeic_900',
  'ielts_55',
  'ielts_7',
  'eiken_2',
  'eiken_p1',
] as const)

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

export const DEFAULT_DIFFICULTY: DifficultyLevel = 'toeic_600'

/** サーバーが将来の値を返しても読み取りを失敗にしないため、既知の 6 値に無い値は既定値へ倒す（全域関数）。 */
export function normalizeDifficulty(raw: unknown): DifficultyLevel {
  return DIFFICULTY_LEVELS.find((level) => level === raw) ?? DEFAULT_DIFFICULTY
}
