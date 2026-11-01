// パスワード規則の単一実装（ADR-101）。backend と同じ規則: 長さ 12〜20、文字種（小文字・大文字・数字・記号）3 種以上。
// 下限と文字種は shared/domain/identity_access/password_policy.py、上限は account.py の PASSWORD_SET_MAX_LENGTH
// （api/schemas.py の max_length）。文言は持たない（呼出側が決める）。
// 長さは String.prototype.length（UTF-16 code unit）で数える。

export type PasswordViolation = 'too_short' | 'too_long' | 'too_few_classes'

export type PasswordCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PasswordViolation }

const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 20
const PASSWORD_MIN_CLASSES = 3

const OK: PasswordCheck = Object.freeze({ ok: true })

function countCharacterClasses(password: string): number {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((pattern) => pattern.test(password)).length
}

function violation(reason: PasswordViolation): PasswordCheck {
  return Object.freeze({ ok: false, reason })
}

export function validatePassword(password: string): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) return violation('too_short')
  if (password.length > PASSWORD_MAX_LENGTH) return violation('too_long')
  if (countCharacterClasses(password) < PASSWORD_MIN_CLASSES) return violation('too_few_classes')
  return OK
}
