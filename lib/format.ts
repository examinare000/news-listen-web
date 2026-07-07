import type { AuthUser } from '@/types/index'

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
 * Retry-After 秒数を「次回可能時刻」のおおまかな日本語表記に整形する（issue #82）。
 * 例: 30 → "まもなく", 3600 → "約1時間後", 43200 → "約12時間後"。
 * undefined/0 以下なら null（時間情報なし）。
 */
export function formatRetryAfter(seconds: number | undefined): string | null {
  if (seconds === undefined || seconds <= 0) return null
  if (seconds < 60) return 'まもなく'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `約${minutes}分後`
  const hours = Math.ceil(seconds / 3600)
  return `約${hours}時間後`
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

/**
 * Formats a Date to relative time in Japanese.
 * WHY now injection: allows deterministic testing without system time dependency.
 * @param date - The date to format
 * @param now - Current time for comparison
 * @returns Relative time string like "3時間前", "2日前", "1か月前", etc.
 */
export function formatRelativeTime(date: Date, now: Date): string {
  // Guard against invalid dates
  if (isNaN(date.getTime()) || isNaN(now.getTime())) {
    return ''
  }

  const diffMs = now.getTime() - date.getTime()

  // Future date or very recent past (< 60 seconds)
  if (diffMs < 0) {
    return 'もうすぐ'
  }
  if (diffMs < 60 * 1000) {
    return 'たった今'
  }

  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  // Years
  if (diffYear >= 1) {
    return `${diffYear}年前`
  }

  // Months (30日単位)
  if (diffMonth >= 1) {
    return `${diffMonth}か月前`
  }

  // Days
  if (diffDay >= 1) {
    return `${diffDay}日前`
  }

  // Hours
  if (diffHour >= 1) {
    return `${diffHour}時間前`
  }

  // Minutes
  return `${diffMin}分前`
}

/**
 * Formats a byte count (navigator.storage.estimate() usage/quota) to a human-readable
 * string. issue #167: 設定画面のオフラインキャッシュ使用量表示。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Formats an authenticated user to a label string.
 * Used in AccountSection and SidebarAccount to display user info consistently.
 * @param user - The authenticated user, or null for unauthenticated state
 * @returns Formatted label like "display_name（username / role）", or "—" if user is null
 */
export function formatAuthUserLabel(user: AuthUser | null): string {
  if (!user) {
    return '—'
  }
  return `${user.display_name}（${user.username} / ${user.role}）`
}
