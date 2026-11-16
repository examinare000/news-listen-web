// 難易度の提案を出すか（web-rule-learning-06）。null は取得できなかったことを表し、提案なしと同じに扱う。
export function isOffered(hasSuggestion: boolean | null): boolean {
  return hasSuggestion === true
}
