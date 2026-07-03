/**
 * BFF proxy: forwards requests from the frontend to the backend API.
 *
 * Security:
 * - Reads backend URL and API key from server-only environment variables (BACKEND_BASE_URL, BACKEND_API_KEY)
 * - Validates BACKEND_BASE_URL scheme (http/https only) to prevent SSRF
 * - Injects the API key from env (not from request headers)
 */

import { NextRequest, NextResponse } from 'next/server'

// Vercel Function のデフォルト実行上限（300秒）のままだとバックエンド障害時に
// 無駄なコンピュートを消費し続ける。下の fetch タイムアウト（25秒）より長い値にして、
// Function が強制終了される前に必ず制御された 504 応答を返せるようにする。
export const maxDuration = 30

type Context = { params: Promise<{ path: string[] }> }

interface BackendConfig {
  baseUrl: string
  path: string
}

function getBackendUrl(pathSegments: string[]): BackendConfig | null {
  const baseUrl = process.env.BACKEND_BASE_URL
  if (!baseUrl) return null

  // SSRF mitigation: only allow http and https schemes
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
  } catch {
    return null
  }

  // Reconstruct the target URL preserving query string (get it from request inside forward())
  const joinedPath = pathSegments.join('/')
  return { baseUrl, path: joinedPath }
}

// AbortSignal.timeout() が期限切れ時に投げる例外は DOMException('TimeoutError')。
// 明示的な abort() 呼び出しも DOMException('AbortError') になるため、どちらもタイムアウト
// 応答（504）として扱い、単純なネットワーク到達不能（502）と区別する。
function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

async function forward(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const backendConfig = getBackendUrl(pathSegments)

  if (!backendConfig) {
    return NextResponse.json(
      { detail: 'Server misconfiguration: BACKEND_BASE_URL is not set' },
      { status: 500 },
    )
  }

  // Construct target URL with query string from request
  const requestUrl = new URL(req.url)
  const search = requestUrl.search // includes leading '?'
  const targetUrl = `${backendConfig.baseUrl.replace(/\/$/, '')}/${backendConfig.path}${search}`

  // Build forwarded headers (inject X-API-Key from env; strip Next.js-internal headers)
  const apiKey = process.env.BACKEND_API_KEY
  const forwardedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    forwardedHeaders['X-API-Key'] = apiKey
  }
  // セッション Cookie（nl_session 等）をバックエンドへ転送する。ログイン認証は
  // サーバーサイドセッション方式で、トークンは httpOnly Cookie で往復する。
  const cookie = req.headers.get('cookie')
  if (cookie) {
    forwardedHeaders['Cookie'] = cookie
  }
  // CSRF トークンを転送する（状態変更リクエストで必須）。
  const csrfToken = req.headers.get('X-CSRF-Token')
  if (csrfToken) {
    forwardedHeaders['X-CSRF-Token'] = csrfToken
  }

  let backendResponse: Response
  try {
    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined
    backendResponse = await fetch(targetUrl, {
      method: req.method,
      headers: forwardedHeaders,
      body,
      // maxDuration（30秒）より短い期限で打ち切り、Function が強制終了される前に
      // 制御された 504 応答をクライアントへ返す。
      signal: AbortSignal.timeout(25_000),
    })
  } catch (err) {
    if (isTimeoutError(err)) {
      return NextResponse.json({ detail: 'Backend timeout' }, { status: 504 })
    }
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 502 })
  }

  // Pass through the backend response (including error status codes)
  const responseBody = await backendResponse.text()
  const response = new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: { 'Content-Type': 'application/json' },
  })

  // バックエンドが発行した Set-Cookie をブラウザへ中継する。バックエンドは Domain 属性を
  // 付けないため、Cookie は Web アプリのオリジンにバインドされる（httpOnly/SameSite は維持）。
  // ログイン時のセッション発行・ログアウト時の失効の双方をこの中継でブラウザに反映する。
  const setCookies =
    typeof backendResponse.headers.getSetCookie === 'function'
      ? backendResponse.headers.getSetCookie()
      : (backendResponse.headers.get('set-cookie')
          ? [backendResponse.headers.get('set-cookie') as string]
          : [])
  for (const c of setCookies) {
    response.headers.append('set-cookie', c)
  }

  return response
}

export async function GET(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}

export async function POST(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}

export async function PUT(req: NextRequest, ctx: Context) {
  // WHY: updatePreferences() は PUT /settings/preferences を呼ぶ。PUT ハンドラが無いと
  //       Next.js が 405 を返し、設定更新が BFF を通らず必ず失敗する。
  const { path } = await ctx.params
  return forward(req, path)
}

export async function PATCH(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}
