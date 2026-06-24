import { describe, test, expect } from 'vitest'
import { urlBase64ToUint8Array } from '@/lib/webpush'

describe('urlBase64ToUint8Array', () => {
  test('既知のベクタを正しく変換する（padding なし）', () => {
    // "hello" の base64url エンコード（padding なし）
    // "hello" -> base64 = "aGVsbG8=" -> base64url = "aGVsbG8"
    const result = urlBase64ToUint8Array('aGVsbG8')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]) // "hello"
  })

  test('padding あり base64url も正しく変換する', () => {
    // "hi" -> base64 = "aGk=" -> base64url = "aGk"
    const result = urlBase64ToUint8Array('aGk')
    expect(Array.from(result)).toEqual([104, 105]) // "hi"
  })

  test('URL-safe 文字（- と _）を変換する', () => {
    // base64url で - は +、_ は / に相当。
    // bytes [0xFB, 0xFF] -> base64 = "+/8=" -> base64url = "-_8"
    const result = urlBase64ToUint8Array('-_8')
    expect(Array.from(result)).toEqual([0xFB, 0xFF])
  })

  test('VAPID 公開鍵サイズ（65 bytes）を正しく変換する', () => {
    // 65 バイトの Uint8Array を base64url エンコードしたものを複合して検証
    const bytes = new Uint8Array(65).fill(0xAB)
    const base64 = btoa(String.fromCharCode(...bytes))
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    const result = urlBase64ToUint8Array(base64url)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(65)
    expect(Array.from(result).every(b => b === 0xAB)).toBe(true)
  })

  test('padding を自動補完する（2文字不足の例）', () => {
    // "Man" -> base64 = "TWFu"（padding なし）
    const result = urlBase64ToUint8Array('TWFu')
    expect(Array.from(result)).toEqual([77, 97, 110]) // "Man"
  })
})
