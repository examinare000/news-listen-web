import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // App Router is used (default in Next.js 13+)
  // Docker（PoC）用に最小ランタイムの standalone 出力を有効化する。
  // .next/standalone に server.js と必要な node_modules のみが同梱される。
  // 全ビルドに影響する横断的設定だが、本番デプロイ先の Vercel は独自ビルドのため
  // この値を無視する。ゆえに Vercel への影響は無く、Docker PoC のためだけに意図的に有効化している。
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          // CSP に script-src をあえて含めない。app/layout.tsx には FOUC 防止のための
          // インラインテーマ初期化スクリプトがあり、加えて Next.js App Router 自体が
          // RSC ペイロード転送用のインラインスクリプトをページに注入する。script-src を
          // 絞るには nonce 発行ミドルウェアが必要になり、その結果すべてのページが
          // 動的レンダリングに落ちてしまう（静的最適化・ISR の恩恵を失う）。
          // frame-ancestors / object-src / base-uri の制限だけでもクリックジャッキングや
          // レガシー Flash/Java 経由の攻撃・base タグ書き換えは防げるため、このトレードオフを許容する。
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
