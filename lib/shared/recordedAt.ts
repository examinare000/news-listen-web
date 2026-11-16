// 記録時刻の読み。ランタイムの Date.parse は小数 4 桁以上の解釈や暦として不正な日の扱いが環境依存なので、
// 正規表現で分解し、小数をミリ秒に切り捨てて自前で epoch ms にする。
const RECORDED_AT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/

export function parseRecordedAt(text: string): number | null {
  const m = RECORDED_AT.exec(text)
  if (m === null) return null
  const [, y, mo, d, h, mi, s, fraction = ''] = m
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number)
  // 小数は 3 桁に揃えてミリ秒に切り捨てる（浮動小数の誤差を避け、文字列のまま上位 3 桁を取る）
  const millis = Number(fraction.padEnd(3, '0').replace(/^(\d{3}).*$/, '$1'))
  const offsetHours = m[9] === undefined ? 0 : Number(m[9])
  const offsetMinutes = m[10] === undefined ? 0 : Number(m[10])
  if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return null
  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day)
  utc.setUTCHours(hour, minute, second, millis)
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  const offset = (offsetHours * 60 + offsetMinutes) * 60_000 * (m[8] === '-' ? -1 : 1)
  return utc.getTime() - offset
}
