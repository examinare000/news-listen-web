// 実績の id の集合と順（Spec §5.6）。画面の並びはこの順で、名前・説明・見た目は presentation が id から引く。
// 集合を変えるときは presentation の対応表（型で key を縛っている）も同時に直す。
export const ACHIEVEMENT_IDS = Object.freeze([
  'first_episode_completed',
  'first_quiz_correct',
  'streak_7',
  'streak_30',
  'streak_100',
  'completed_10',
  'completed_50',
] as const)

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number]

// 既読に無い解錠済みの実績の id（web-rule-learning-05・ADR-086）。
// 現行は filter した要素ごとに toast を出すので、重複は除かない。
export function newlyUnlocked(
  unlocked: ReadonlyArray<{ readonly id: string }>,
  seen: ReadonlySet<string>,
): ReadonlyArray<string> {
  return Object.freeze(unlocked.filter((achievement) => !seen.has(achievement.id)).map((achievement) => achievement.id))
}
