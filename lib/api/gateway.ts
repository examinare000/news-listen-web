/**
 * ApiGateway: BFF-proxied API へのアクセスを Result 型で返す薄い gateway。
 *
 * すべての操作は throw・reject せず `Result<T, ApiFailure>` に解決する（CI-T12-1）。
 * fetch・Response・Headers・CSRF cookie は非公開の `exchange` に閉じ込め、公開型には現れない
 * （CI-T12-7 leakage guard）。
 */
import { readCookie } from '@/lib/cookie'

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: E }

export type ApiFailure =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found'; subject?: string }
  | { kind: 'conflict' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined; scope: 'monthly' | 'daily' | 'unknown' }
  | { kind: 'validation'; detail: string }
  | { kind: 'server'; status: number }
  | { kind: 'unknown'; status: number }

export const REQUEST_DEADLINE_MS = 30_000

type GatewayMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type GatewayJsonRequest = { method?: GatewayMethod; body?: unknown; noContent?: undefined }
export type GatewayNoContentRequest = { method?: GatewayMethod; body?: unknown; noContent: true }
export type GatewayRequest = GatewayJsonRequest | GatewayNoContentRequest

export interface ApiGateway {
  request(path: string, init: GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
  request<T>(path: string, init?: GatewayJsonRequest): Promise<Result<T, ApiFailure>>
}

// ============================================================
// 以下、非公開（CP6 hides: fetch・cookie・Response・AbortController・タイマー）
// ============================================================

type ResponseExpectation = 'json' | 'none'

type RawExchange =
  | { type: 'network' }
  | { type: 'timeout' }
  | { type: 'error'; status: number; detail: string; retryAfterSeconds: number | undefined }
  | { type: 'no_content'; status: number }
  | { type: 'body'; status: number; value: unknown }
  | { type: 'malformed'; status: number; error: unknown }

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

// owner: user・導入: W-S1（2026-09-24）。読み手は互換 adapter（TP1）だけ。
// TP1 削除（W-S4d3）でこのキーの読み手がいなくなるので、そのとき一緒に消してよい（公開契約は変わらない）。
const RAW_KEY = Symbol.for('news-listen.web.gateway.raw')

type JsonReadOutcome =
  | { timedOut: true }
  | { timedOut: false; ok: true; value: unknown }
  | { timedOut: false; ok: false; error: unknown }

function readJsonWithDeadline(response: Response, deadline: Promise<void>): Promise<JsonReadOutcome> {
  return Promise.race([
    response
      .json()
      .then((value: unknown): JsonReadOutcome => ({ timedOut: false, ok: true, value }))
      .catch((error: unknown): JsonReadOutcome => ({ timedOut: false, ok: false, error })),
    deadline.then((): JsonReadOutcome => ({ timedOut: true })),
  ])
}

function detailFromJsonBody(bodyRead: JsonReadOutcome & { timedOut: false }): string {
  if (!bodyRead.ok) return 'Unknown error'
  const body = bodyRead.value
  // 本文が null・プリミティブ・detail 無しでも throw しない（CI-T12-1: 公開操作は reject・throw しない）
  if (typeof body !== 'object' || body === null || !('detail' in body)) return 'Unknown error'
  const detail: unknown = body.detail
  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail)) {
    const first: unknown = detail[0]
    const firstMessage = typeof first === 'object' && first !== null && 'msg' in first ? first.msg : undefined
    if (typeof firstMessage === 'string') {
      const valueErrorPrefix = 'Value error, '
      return firstMessage.startsWith(valueErrorPrefix)
        ? firstMessage.slice(valueErrorPrefix.length)
        : firstMessage
    }
  }
  return 'Unknown error'
}

function parseRetryAfterSeconds(retryAfterHeader: string | null): number | undefined {
  return retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined
}

async function exchange(
  method: GatewayMethod,
  path: string,
  body: unknown,
  expect: ResponseExpectation,
): Promise<RawExchange> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!SAFE_METHODS.has(method.toUpperCase()) && typeof document !== 'undefined') {
    const token = readCookie('csrf_token', document.cookie)
    if (token) headers['X-CSRF-Token'] = token
  }

  const controller = new AbortController()
  let resolveDeadline: () => void
  const deadline = new Promise<void>((resolve) => {
    resolveDeadline = resolve
  })
  const timer = setTimeout(() => {
    controller.abort()
    resolveDeadline()
  }, REQUEST_DEADLINE_MS)

  type FetchOutcome =
    | { kind: 'response'; response: Response }
    | { kind: 'network'; error: unknown }
    | { kind: 'timeout' }

  const fetchOutcome = await Promise.race<FetchOutcome>([
    fetch(path, {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
      .then((response): FetchOutcome => ({ kind: 'response', response }))
      .catch((error: unknown): FetchOutcome => ({ kind: 'network', error })),
    deadline.then((): FetchOutcome => ({ kind: 'timeout' })),
  ])

  if (fetchOutcome.kind === 'timeout') {
    return { type: 'timeout' }
  }
  if (fetchOutcome.kind === 'network') {
    clearTimeout(timer)
    return { type: 'network' }
  }

  const response = fetchOutcome.response

  if (!response.ok) {
    const bodyRead = await readJsonWithDeadline(response, deadline)
    if (bodyRead.timedOut) return { type: 'timeout' }
    clearTimeout(timer)
    const detail = detailFromJsonBody(bodyRead)
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers?.get?.('Retry-After') ?? null)
    return { type: 'error', status: response.status, detail, retryAfterSeconds }
  }

  if (expect === 'none') {
    clearTimeout(timer)
    return { type: 'no_content', status: response.status }
  }

  if (response.status === 204) {
    clearTimeout(timer)
    return { type: 'no_content', status: 204 }
  }

  const bodyRead = await readJsonWithDeadline(response, deadline)
  if (bodyRead.timedOut) return { type: 'timeout' }
  clearTimeout(timer)
  if (bodyRead.ok) {
    return { type: 'body', status: response.status, value: bodyRead.value }
  }
  return { type: 'malformed', status: response.status, error: bodyRead.error }
}

function statusToFailure(raw: { status: number; detail: string; retryAfterSeconds: number | undefined }): ApiFailure {
  switch (raw.status) {
    case 401:
      return { kind: 'unauthorized' }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'not_found' }
    case 409:
      return { kind: 'conflict' }
    case 429:
      return { kind: 'rate_limited', retryAfterSeconds: raw.retryAfterSeconds, scope: 'unknown' }
    case 400:
    case 422:
      return { kind: 'validation', detail: raw.detail }
    default:
      return raw.status >= 500 && raw.status <= 599
        ? { kind: 'server', status: raw.status }
        : { kind: 'unknown', status: raw.status }
  }
}

function failureResult<T>(failure: ApiFailure, raw: RawExchange): Result<T, ApiFailure> {
  Object.defineProperty(failure, RAW_KEY, { value: raw, enumerable: false })
  return { ok: false, failure }
}

function toResult<T>(raw: RawExchange, expect: ResponseExpectation): Result<T, ApiFailure> {
  switch (raw.type) {
    case 'network':
      return failureResult({ kind: 'network' }, raw)
    case 'timeout':
      return failureResult({ kind: 'timeout' }, raw)
    case 'error':
      return failureResult(statusToFailure(raw), raw)
    case 'no_content':
      return expect === 'none'
        ? { ok: true, value: undefined as T }
        : failureResult({ kind: 'unknown', status: raw.status }, raw)
    case 'malformed':
      return failureResult({ kind: 'unknown', status: raw.status }, raw)
    case 'body':
      return { ok: true, value: raw.value as T }
  }
}

export function createGateway(): ApiGateway {
  function request(path: string, init: GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
  function request<T>(path: string, init?: GatewayJsonRequest): Promise<Result<T, ApiFailure>>
  async function request(path: string, init?: GatewayRequest): Promise<Result<unknown, ApiFailure>> {
    const expect: ResponseExpectation = init?.noContent === true ? 'none' : 'json'
    return toResult(await exchange(init?.method ?? 'GET', path, init?.body, expect), expect)
  }
  return { request }
}
