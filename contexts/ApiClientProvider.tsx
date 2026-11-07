'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { createGateway } from '@/lib/api/gateway'
import type {
  ApiFailure,
  ApiGateway,
  GatewayJsonRequest,
  GatewayNoContentRequest,
  GatewayRequest,
  Result,
} from '@/lib/api/gateway'

// SG5「最小注入点」: 1 つの gateway インスタンスを保持し、context/hook から取得させる。
// リソース別の分割（Playback / Catalog / Account …）は web-slice-gateway-01 では作らない（rejected_overdesign）。
const ApiClientContext = createContext<ApiGateway | null>(null)

// unauthorized の失敗を見たら callback を 1 回呼び、path・init・Result はそのまま渡す。
function withUnauthorizedHook(inner: ApiGateway, onUnauthorized: () => void): ApiGateway {
  function request(path: string, init: GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
  function request<T>(path: string, init?: GatewayJsonRequest): Promise<Result<T, ApiFailure>>
  async function request(path: string, init?: GatewayRequest): Promise<Result<unknown, ApiFailure>> {
    // 両分岐は同じ呼出だが、init を絞り込んで ApiGateway の overload を選ぶために分けている。
    const result = init?.noContent === true ? await inner.request(path, init) : await inner.request(path, init)
    if (!result.ok && result.failure.kind === 'unauthorized') onUnauthorized()
    return result
  }
  return { request }
}

// useRef の読み取りや useState の値の直接更新は react-hooks/refs・immutability が error にするので、更新口を持つ cell にする。
function createCallbackCell(initial: (() => void) | undefined) {
  let current = initial
  return {
    set: (next: (() => void) | undefined) => {
      current = next
    },
    call: () => current?.(),
  }
}

export function ApiClientProvider({
  gateway,
  onUnauthorized,
  children,
}: {
  gateway?: ApiGateway
  /** 有無は最初の render で決まる。渡されたとき、gateway の unauthorized 失敗ごとに呼ぶ。 */
  onUnauthorized?: () => void
  children: React.ReactNode
}) {
  // callback は最新のものを呼ぶため、gateway は cell 経由で呼び、effect で cell を更新する。
  const [cell] = useState(() => createCallbackCell(onUnauthorized))
  useEffect(() => {
    cell.set(onUnauthorized)
  }, [cell, onUnauthorized])

  // 遅延初期化で 1 回だけ生成し、再描画をまたいで同一インスタンスを保つ。
  const [gw] = useState<ApiGateway>(() => {
    const inner = gateway ?? createGateway()
    if (onUnauthorized === undefined) return inner
    return withUnauthorizedHook(inner, cell.call)
  })
  return <ApiClientContext.Provider value={gw}>{children}</ApiClientContext.Provider>
}

export function useApiClient(): ApiGateway {
  const ctx = useContext(ApiClientContext)
  if (!ctx) {
    throw new Error('useApiClient must be used within ApiClientProvider')
  }
  return ctx
}
