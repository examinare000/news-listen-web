/**
 * BFF proxy: forwards requests from the frontend to the backend API.
 *
 * Security:
 * - Validates X-Backend-Base-Url scheme (http/https only) to prevent SSRF
 * - Does NOT add secrets to requests — the API key is forwarded from the header
 */

import { NextRequest, NextResponse } from 'next/server'

type Context = { params: Promise<{ path: string[] }> }

function getBackendUrl(req: NextRequest, pathSegments: string[]): string | null {
  const baseUrl = req.headers.get('X-Backend-Base-Url')
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

  // Reconstruct the target URL preserving query string
  const requestUrl = new URL(req.url)
  const joinedPath = pathSegments.join('/')
  const search = requestUrl.search // includes leading '?'
  return `${baseUrl.replace(/\/$/, '')}/${joinedPath}${search}`
}

async function forward(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const targetUrl = getBackendUrl(req, pathSegments)

  if (!targetUrl) {
    return NextResponse.json(
      { detail: 'Missing or invalid X-Backend-Base-Url header' },
      { status: 400 },
    )
  }

  // Build forwarded headers (pass through X-API-Key; strip Next.js-internal headers)
  const apiKey = req.headers.get('X-API-Key')
  const forwardedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    forwardedHeaders['X-API-Key'] = apiKey
  }

  let backendResponse: Response
  try {
    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined
    backendResponse = await fetch(targetUrl, {
      method: req.method,
      headers: forwardedHeaders,
      body,
    })
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 502 })
  }

  // Pass through the backend response (including error status codes)
  const responseBody = await backendResponse.text()
  return new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}

export async function POST(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const { path } = await ctx.params
  return forward(req, path)
}
