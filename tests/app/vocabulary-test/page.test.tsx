import React from 'react'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import VocabularyTestPage from '@/app/(app)/vocabulary-test/page'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

const { playSfx, prepareSfx, showToast } = vi.hoisted(
  () => ({
    playSfx: vi.fn(),
    prepareSfx: vi.fn(),
    showToast: vi.fn(),
  }),
)

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

vi.mock('@/lib/sfx', () => ({ playSfx, prepareSfx }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}))

const SESSION_PATH = '/api/backend/vocabulary/test-session'
const RESULT_PATH = '/api/backend/vocabulary/test-result'

let gw: GatewayDouble

function callsTo(method: string, path: string) {
  return gw.calls.filter((c) => c.method === method && c.path === path)
}

const ITEMS = [
  {
    vocabulary_id: 'v1',
    term: 'accelerate',
    meaning: '加速する',
    example: 'The rollout will accelerate.',
    distractors: ['延期する', '停止する', '検証する'],
  },
  {
    vocabulary_id: 'v2',
    term: 'resilient',
    meaning: '回復力がある',
    example: 'The system is resilient.',
    distractors: ['壊れやすい', '一時的な', '複雑な'],
  },
  {
    vocabulary_id: 'v3',
    term: 'concise',
    meaning: '簡潔な',
    example: 'Keep the report concise.',
    distractors: ['冗長な', '曖昧な', '正式な'],
  },
]

describe('VocabularyTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw = createGatewayDouble()
    holder.gw = gw
    gw.respond('GET', SESSION_PATH, { ok: true, value: { items: ITEMS } })
    gw.respond('POST', RESULT_PATH, { ok: true, value: { updated: 3 } })
  })

  test('supports button and swipe classification, then retests only unknown words and submits a bare result batch', async () => {
    const user = userEvent.setup()
    render(<VocabularyTestPage />)

    expect(await screen.findByRole('heading', { name: 'accelerate' })).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    // Button alternative: known.
    await user.click(screen.getByRole('button', { name: '知ってる' }))

    // Button alternative for the unknown direction.
    expect(await screen.findByRole('heading', { name: 'resilient' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'まだ' }))

    // Touch swipe: unknown (left).
    const swipeCard = await screen.findByTestId('vocabulary-swipe-card')
    fireEvent.touchStart(swipeCard, { touches: [{ clientX: 180 }] })
    fireEvent.touchEnd(swipeCard, { changedTouches: [{ clientX: 60 }] })

    // Only v2 and v3 enter the meaning retest; v1 never appears here.
    expect(await screen.findByText('意味を選んでください')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'resilient' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'accelerate' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '回復力がある' }))
    await waitFor(() => expect(playSfx).toHaveBeenCalledWith('correct'))
    expect(screen.getByTestId('vocabulary-correct-check')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: '冗長な' }))

    await screen.findByText('知ってる 1 語')
    expect(playSfx).toHaveBeenCalledWith('incorrect')
    expect(gw.calls).toContainEqual({
      method: 'POST',
      path: RESULT_PATH,
      body: [
        { vocabulary_id: 'v1', self_known: true, retest_correct: null },
        { vocabulary_id: 'v2', self_known: false, retest_correct: true },
        { vocabulary_id: 'v3', self_known: false, retest_correct: false },
      ],
    })
  })

  test('submits directly when every word is known', async () => {
    gw.respond('GET', SESSION_PATH, { ok: true, value: { items: [ITEMS[0]] } })
    gw.respond('POST', RESULT_PATH, { ok: true, value: { updated: 1 } })

    render(<VocabularyTestPage />)
    await screen.findByRole('heading', { name: 'accelerate' })

    await userEvent.click(screen.getByRole('button', { name: '知ってる' }))

    await waitFor(() => expect(prepareSfx).toHaveBeenCalled())
    await waitFor(() => expect(callsTo('POST', RESULT_PATH).length).toBeGreaterThan(0))
    expect(await screen.findByText('すべて知っている単語でした')).toBeInTheDocument()
    expect(gw.calls).toContainEqual({
      method: 'POST',
      path: RESULT_PATH,
      body: [{ vocabulary_id: 'v1', self_known: true, retest_correct: null }],
    })
  })

  test('supports arrow-key classification from the focusable assessment surface', async () => {
    gw.respond('GET', SESSION_PATH, { ok: true, value: { items: [ITEMS[0]] } })
    gw.respond('POST', RESULT_PATH, { ok: true, value: { updated: 1 } })

    render(<VocabularyTestPage />)

    const card = await screen.findByTestId('vocabulary-swipe-card')
    expect(card).toHaveAttribute('tabindex', '0')
    expect(
      screen.getByText('キーボードでは左矢印で「まだ」、右矢印で「知ってる」'),
    ).toBeInTheDocument()

    fireEvent.keyDown(card, { key: 'ArrowRight' })

    expect(await screen.findByText('すべて知っている単語でした')).toBeInTheDocument()
    expect(gw.calls).toContainEqual({
      method: 'POST',
      path: RESULT_PATH,
      body: [{ vocabulary_id: 'v1', self_known: true, retest_correct: null }],
    })
  })

  test('limits a defensive oversized response to ten words', async () => {
    gw.respond('GET', SESSION_PATH, {
      ok: true,
      value: {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...ITEMS[0],
          vocabulary_id: `v${index}`,
          term: `term-${index}`,
        })),
      },
    })

    render(<VocabularyTestPage />)

    expect(await screen.findByText('1 / 10')).toBeInTheDocument()
  })

  test('shows a neutral direct-route empty state when no words are due', async () => {
    gw.respond('GET', SESSION_PATH, { ok: true, value: { items: [] } })

    render(<VocabularyTestPage />)

    expect(await screen.findByText('いま復習する単語はありません')).toBeInTheDocument()
  })
})
