import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // App Router is used (default in Next.js 13+)
  // Docker（PoC）用に最小ランタイムの standalone 出力を有効化する。
  // .next/standalone に server.js と必要な node_modules のみが同梱される。
  output: 'standalone',
}

export default nextConfig
