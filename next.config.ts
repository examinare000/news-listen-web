import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // App Router is used (default in Next.js 13+)
  // Docker（PoC）用に最小ランタイムの standalone 出力を有効化する。
  // .next/standalone に server.js と必要な node_modules のみが同梱される。
  // 全ビルドに影響する横断的設定だが、本番デプロイ先の Vercel は独自ビルドのため
  // この値を無視する。ゆえに Vercel への影響は無く、Docker PoC のためだけに意図的に有効化している。
  output: 'standalone',
}

export default nextConfig
