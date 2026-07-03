import { describe, test, expect } from 'vitest'
import nextConfig from '@/next.config'

// next.config.ts の headers() が全パスにセキュリティヘッダーを付与することを検証する。
// Vercel は Next.js の headers() 設定をそのままエッジ/CDN 層に反映するため、
// ここでのアサーションがそのまま本番配信ヘッダーの契約になる。
describe('next.config headers()', () => {
  test('headers() is defined', () => {
    expect(nextConfig.headers).toBeDefined()
  })

  test('applies security headers to all paths', async () => {
    if (!nextConfig.headers) throw new Error('headers() is not defined')
    const rules = await nextConfig.headers()

    expect(rules).toHaveLength(1)
    const rule = rules[0]
    expect(rule.source).toBe('/(.*)')

    const headerMap = Object.fromEntries(
      rule.headers.map((h: { key: string; value: string }) => [h.key, h.value])
    )

    expect(headerMap['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains'
    )
    expect(headerMap['X-Content-Type-Options']).toBe('nosniff')
    expect(headerMap['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headerMap['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
    expect(headerMap['X-Frame-Options']).toBe('DENY')
    expect(headerMap['Content-Security-Policy']).toBe(
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    )
  })

  test('CSP does not restrict script-src (would break inline theme init / RSC payload scripts)', async () => {
    if (!nextConfig.headers) throw new Error('headers() is not defined')
    const rules = await nextConfig.headers()
    const headerMap = Object.fromEntries(
      rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value])
    )

    expect(headerMap['Content-Security-Policy']).not.toContain('script-src')
  })
})
