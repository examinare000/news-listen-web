// username の形式と正規化の単一実装（web-rule-account-04）。純関数で、文言は持たない（文言は呼ぶ側）。
export type UsernameCheck = 'ok' | 'invalid_format'

const USERNAME_FORMAT = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateUsername(raw: string): UsernameCheck {
  return USERNAME_FORMAT.test(normalizeUsername(raw)) ? 'ok' : 'invalid_format'
}
