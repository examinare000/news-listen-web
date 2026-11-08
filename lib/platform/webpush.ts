/**
 * VAPID 公開鍵（base64url 形式）を applicationServerKey 用の Uint8Array に変換する。
 *
 * Web Push の applicationServerKey は Base64URL エンコードされているが、
 * SubtleCrypto は Uint8Array を要求する。ブラウザの atob は標準 base64 のみ対応なので
 * URL-safe 文字（- と _）を + と / に戻し、パディングを補完してから変換する。
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  // URL-safe → 標準 base64
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  // padding 補完（4の倍数に）
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  // binary string → Uint8Array
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
