'use client'

import React, { createContext, useContext, useState } from 'react'
import { createGateway } from '@/lib/api/gateway'
import type { ApiGateway } from '@/lib/api/gateway'

// SG5「最小注入点」: 1 つの gateway インスタンスを保持し、context/hook から取得させる。
// リソース別の分割（Playback / Catalog / Account …）は W-S1 では作らない（rejected_overdesign）。
const ApiClientContext = createContext<ApiGateway | null>(null)

export function ApiClientProvider({
  gateway,
  children,
}: {
  gateway?: ApiGateway
  children: React.ReactNode
}) {
  // 遅延初期化で 1 回だけ生成し、再描画をまたいで同一インスタンスを保つ。
  const [gw] = useState<ApiGateway>(() => gateway ?? createGateway())
  return <ApiClientContext.Provider value={gw}>{children}</ApiClientContext.Provider>
}

export function useApiClient(): ApiGateway {
  const ctx = useContext(ApiClientContext)
  if (!ctx) {
    throw new Error('useApiClient must be used within ApiClientProvider')
  }
  return ctx
}
