// 招待コードの任意の数値欄の検査（web-rule-admin-03）。空なら未指定、正の整数なら値、それ以外は 'invalid'。
export function parseOptionalPositiveInt(raw: string): number | undefined | 'invalid' {
  if (!raw.trim()) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return 'invalid'
  return n
}
