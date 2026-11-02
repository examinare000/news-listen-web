import type {
  ApiGateway,
  ApiFailure,
  GatewayJsonRequest,
  GatewayNoContentRequest,
  GatewayRequest,
  Result,
} from '@/lib/api/gateway'

// テスト用 double: 呼出を (method, path, body) で記録し、応答を (method, path) で
// 登録できる。`respondWith` で handler（reject・未解決・外から解決・呼出順）も登録できる。
// 未登録の既定応答は network 失敗（既存 AudioPlayerBar.test.tsx:374-377 の
// fetch reject と同じ意味）。

export interface RecordedGatewayCall {
  method: string
  path: string
  body: unknown
}

export interface GatewayDouble extends ApiGateway {
  calls: RecordedGatewayCall[]
  respond: (method: string, path: string, result: Result<unknown, ApiFailure>) => void
  respondWith: (
    method: string,
    path: string,
    handler: (call: RecordedGatewayCall) => Promise<Result<unknown, ApiFailure>>,
  ) => void
}

const DEFAULT_RESULT: Result<unknown, ApiFailure> = { ok: false, failure: { kind: 'network' } }

export function createGatewayDouble(): GatewayDouble {
  const calls: RecordedGatewayCall[] = []
  const responses = new Map<string, Result<unknown, ApiFailure>>()

  const handlers = new Map<
    string,
    (call: RecordedGatewayCall) => Promise<Result<unknown, ApiFailure>>
  >()

  function key(method: string, path: string): string {
    return `${method} ${path}`
  }

  function respond(method: string, path: string, result: Result<unknown, ApiFailure>): void {
    responses.set(key(method, path), result)
  }

  function respondWith(
    method: string,
    path: string,
    handler: (call: RecordedGatewayCall) => Promise<Result<unknown, ApiFailure>>,
  ): void {
    handlers.set(key(method, path), handler)
  }

  function request(path: string, init: GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
  function request<T>(path: string, init?: GatewayJsonRequest): Promise<Result<T, ApiFailure>>
  function request(path: string, init?: GatewayRequest): Promise<Result<unknown, ApiFailure>> {
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: init?.body })
    const handler = handlers.get(key(method, path))
    if (handler) return handler(calls[calls.length - 1])
    return Promise.resolve(responses.get(key(method, path)) ?? DEFAULT_RESULT)
  }

  return { calls, respond, respondWith, request }
}
