// 既読に無い解錠済みの実績の id（web-rule-learning-05・ADR-086）。
// 現行は filter した要素ごとに toast を出すので、重複は除かない。
export function newlyUnlocked(
  unlocked: ReadonlyArray<{ readonly id: string }>,
  seen: ReadonlySet<string>,
): ReadonlyArray<string> {
  return Object.freeze(unlocked.filter((achievement) => !seen.has(achievement.id)).map((achievement) => achievement.id))
}
