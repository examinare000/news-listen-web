import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, GatewayJsonRequest } from '@/lib/api/gateway'

// owner: user・導入: W-S1（2026-09-24）。
// 削除条件: app/・components/・hooks/ が既存の API クライアント関数の呼出（ApiError の import）を
// しなくなった時（grep 0。W-S4d1 で満たし、本体削除は W-S4d3）。
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    // Retry-After ヘッダ（秒）。429 等でサーバが提示した場合のみ設定（issue #82）。
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

// TP1（互換 adapter）が読む gateway 失敗オブジェクトの raw。symbol キーは import せず、
// gateway.ts と同じ Symbol.for(...) 文字列で own プロパティを直接読む（factory 形式の
// mock でも壊れない）。読み手はこのファイルだけ。
const GATEWAY_RAW_KEY = Symbol.for('news-listen.web.gateway.raw')

type LegacyRaw =
  | { type: 'network' }
  | { type: 'timeout' }
  | { type: 'error'; status: number; detail: string; retryAfterSeconds: number | undefined }
  | { type: 'no_content'; status: number }
  | { type: 'malformed'; status: number; error: unknown }

function isLegacyRaw(value: unknown): value is LegacyRaw {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  return (
    value.type === 'network' ||
    value.type === 'timeout' ||
    value.type === 'error' ||
    value.type === 'no_content' ||
    value.type === 'malformed'
  )
}

function rawOf(failure: ApiFailure): LegacyRaw | undefined {
  const value = Object.getOwnPropertyDescriptor(failure, GATEWAY_RAW_KEY)?.value
  return isLegacyRaw(value) ? value : undefined
}

type LegacyInit = { method?: GatewayJsonRequest['method']; body?: string }

/** Shared fetch wrapper that normalizes errors to ApiError（内部は gateway 経由で fetch する） */
export async function request<T>(
  path: string,
  init: LegacyInit = {},
): Promise<T> {
  const method = init.method ?? 'GET'
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  const r = await createGateway().request<T>(path, { method, body })
  if (r.ok) return r.value

  const raw = rawOf(r.failure)
  if (raw) {
    if (raw.type === 'network' || raw.type === 'timeout') {
      throw new ApiError(0, 'Network error')
    }
    if (raw.type === 'error') {
      throw new ApiError(raw.status, raw.detail, raw.retryAfterSeconds)
    }
    if (raw.type === 'no_content') {
      // 204 No Content: 旧契約では成功扱いだったため undefined を返す（型の穴。TP1 削除で消える）
      return undefined as T
    }
    // malformed: 本文が JSON として読めなかった元の parse エラーをそのまま再 throw
    throw raw.error
  }

  // raw を持たない失敗（factory 形式 mock 経由。gateway の ApiFailure.kind から旧 ApiError への逆変換）
  const failure = r.failure
  switch (failure.kind) {
    case 'network':
    case 'timeout':
      throw new ApiError(0, 'Network error')
    case 'unauthorized':
      throw new ApiError(401, 'Unknown error')
    case 'forbidden':
      throw new ApiError(403, 'Unknown error')
    case 'not_found':
      throw new ApiError(404, 'Unknown error')
    case 'conflict':
      throw new ApiError(409, 'Unknown error')
    case 'validation':
      throw new ApiError(422, failure.detail)
    case 'rate_limited':
      throw new ApiError(429, 'Unknown error', failure.retryAfterSeconds)
    case 'server':
      throw new ApiError(failure.status, 'Unknown error')
    case 'unknown':
      if (failure.status === 204) {
        // 204 No Content: 旧契約では成功扱いだったため undefined を返す（型の穴。TP1 削除で消える）
        return undefined as T
      }
      throw new ApiError(failure.status, 'Unknown error')
  }
}
