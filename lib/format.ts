/**
 * Formats a duration in seconds to M:SS or H:MM:SS string.
 * Used for podcast duration display.
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')

  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/**
 * Formats an ISO 8601 date string to "M/D HH:MM" using local time.
 * Returns empty string for invalid input (new Date() never throws on strings).
 */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) {
    return ''
  }
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hh}:${min}`
}
