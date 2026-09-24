// TP1（createApiClient 互換 adapter）の factory 形式 mock 経路のピン。
// 対応: reports/plan.md A3-1、reports/spec.md T-W18・T-W19（CI-W18・CI-W19・CI-W20・CI-W7）。
// factory 形式の mock（vi.hoisted + vi.mock('@/lib/api/gateway', () => ({ createGateway: () => fake }))、
// importOriginal なし）は @/lib/api/gateway の named export をまるごと fake に置き換える。
// TP1（lib/api.ts の request()）・ApiClientProvider がこの module から値として import するのは
// createGateway だけなので、この形の mock でも両経路が同じ fake に届く（CI-W18。SR-9 対処）。
// T-W18・T-W19 は T-W6・T-W7・T-W20（実 gateway が要る `tests/lib/api.tp1.test.ts`）と mock の範囲が
// 違うため別ファイルに置く（vitest の vi.mock はファイル単位で効く）。
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { ApiClientProvider, useApiClient } from '@/contexts/ApiClientProvider'
import type { ApiFailure } from '@/lib/api/gateway'

const fake = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/lib/api/gateway', () => ({
  createGateway: () => fake,
}))

import { createGateway } from '@/lib/api/gateway'
import { createApiClient, ApiError } from '@/lib/api'

function failureOf(failure: ApiFailure) {
  return { ok: false, failure } as const
}

beforeEach(() => {
  fake.request.mockReset()
})

function Probe({ onRead }: { onRead: (gw: unknown) => void }) {
  onRead(useApiClient())
  return null
}

describe('TP1 factory mock pin: verifies: [CI-W18, CI-W20]', () => {
  test('ApiClientProvider 経由と TP1（createApiClient）経由は同じ fake インスタンスに届く', () => {
    const seen: unknown[] = []
    render(
      <ApiClientProvider>
        <Probe onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )

    expect(seen).toEqual([fake])
    expect(createGateway()).toBe(fake)
  })

  test('updatePosition は body {position_seconds:150} で fake.request を呼ぶ', async () => {
    fake.request.mockResolvedValue({ ok: true, value: { id: 'a' } })

    await createApiClient().updatePosition('a', 150)

    expect(fake.request).toHaveBeenCalledWith(
      '/api/backend/podcasts/a/position',
      expect.objectContaining({ method: 'PATCH', body: { position_seconds: 150 } }),
    )
  })
})

describe('TP1 factory mock pin: verifies: [CI-W19, CI-W7, CI-W18]', () => {
  test.each([
    ['network', { kind: 'network' } satisfies ApiFailure, 0, 'Network error'],
    ['timeout', { kind: 'timeout' } satisfies ApiFailure, 0, 'Network error'],
    ['unauthorized', { kind: 'unauthorized' } satisfies ApiFailure, 401, 'Unknown error'],
    ['forbidden', { kind: 'forbidden' } satisfies ApiFailure, 403, 'Unknown error'],
    ['not_found', { kind: 'not_found' } satisfies ApiFailure, 404, 'Unknown error'],
    ['conflict', { kind: 'conflict' } satisfies ApiFailure, 409, 'Unknown error'],
    ['validation', { kind: 'validation', detail: 'bad input' } satisfies ApiFailure, 422, 'bad input'],
    ['server', { kind: 'server', status: 503 } satisfies ApiFailure, 503, 'Unknown error'],
    ['unknown(非204)', { kind: 'unknown', status: 418 } satisfies ApiFailure, 418, 'Unknown error'],
  ] as const)(
    'raw を持たない失敗 kind=%s は ApiError(status=%i, detail=%s) に逆写像される',
    async (_label, failure, status, detail) => {
      fake.request.mockResolvedValue(failureOf(failure))

      await expect(createApiClient().getFeed()).rejects.toMatchObject(
        expect.objectContaining(new ApiError(status, detail)) as object,
      )
    },
  )

  test('rate_limited は retryAfterSeconds を伴って ApiError(429) に逆写像される', async () => {
    fake.request.mockResolvedValue(
      failureOf({ kind: 'rate_limited', retryAfterSeconds: 42, scope: 'unknown' }),
    )

    await expect(createApiClient().getFeed()).rejects.toMatchObject(
      expect.objectContaining(new ApiError(429, 'Unknown error', 42)) as object,
    )
  })

  test('unknown かつ status 204 は throw せず undefined を返す（CI-W7 の型の穴）', async () => {
    fake.request.mockResolvedValue(failureOf({ kind: 'unknown', status: 204 }))

    await expect(createApiClient().deleteAccount('current-pw')).resolves.toBeUndefined()
  })
})
