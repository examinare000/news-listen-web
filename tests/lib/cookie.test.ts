import { describe, test, expect } from 'vitest'
import { readCookie } from '@/lib/cookie'

// ==========================================================
// readCookie(name: string, cookieString: string): string | undefined
// Pure function to extract named cookie value from a cookie string.
// - Takes a cookie string (from document.cookie or test fixture)
// - Returns the value of the named cookie, or undefined if not found
// - Handles multiple cookies, edge cases (empty strings, equals in values)
// ==========================================================
describe('readCookie', () => {
  test('Returns the value of the named cookie when present', () => {
    const cookieString = 'csrf_token=abc123'
    expect(readCookie('csrf_token', cookieString)).toBe('abc123')
  })

  test('Returns correct value when multiple cookies exist', () => {
    const cookieString = 'a=1; csrf_token=abc123; b=2'
    expect(readCookie('csrf_token', cookieString)).toBe('abc123')
  })

  test('Returns undefined when the cookie name is not found', () => {
    const cookieString = 'a=1; b=2; c=3'
    expect(readCookie('csrf_token', cookieString)).toBeUndefined()
  })

  test('Returns undefined for empty string input', () => {
    expect(readCookie('csrf_token', '')).toBeUndefined()
  })

  test('Handles cookies with values containing equals signs (e.g., base64)', () => {
    const cookieString = 'csrf_token=base64+val==; other=value'
    expect(readCookie('csrf_token', cookieString)).toBe('base64+val==')
  })

  test('Returns the correct value when the cookie is the first in the string', () => {
    const cookieString = 'csrf_token=first; a=1; b=2'
    expect(readCookie('csrf_token', cookieString)).toBe('first')
  })

  test('Returns the correct value when the cookie is the last in the string', () => {
    const cookieString = 'a=1; b=2; csrf_token=last'
    expect(readCookie('csrf_token', cookieString)).toBe('last')
  })

  test('Handles cookies with empty values', () => {
    const cookieString = 'csrf_token=; other=value'
    expect(readCookie('csrf_token', cookieString)).toBe('')
  })

  test('Does not match partial cookie names (e.g., csrf vs csrf_token)', () => {
    const cookieString = 'csrf=abc; csrf_token=xyz'
    expect(readCookie('csrf', cookieString)).toBe('abc')
    expect(readCookie('csrf_token', cookieString)).toBe('xyz')
  })

  test('Handles leading/trailing spaces around cookie pairs', () => {
    const cookieString = ' csrf_token=abc123 ; other=value '
    expect(readCookie('csrf_token', cookieString)).toBe('abc123')
  })
})
