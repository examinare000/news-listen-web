// 週の目標の進捗の比（product-learn-09）。goal はダッシュボードの goal_episodes（number）。
export function progress(listened: number, goal: number): number {
  return Math.min(listened / goal, 1)
}
