import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import userEvent from '@testing-library/user-event'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import type { FeaturedSource } from '@/types/index'

import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const render = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: ApiClientProvider, ...options })

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const FEATURED_PATH = '/api/backend/settings/featured-sources'

let gw: GatewayDouble

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
  gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: [] } })
})

const defaultProps = {
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
  onDone: vi.fn(),
}

describe('OnboardingSourcesModal', () => {
  test('renders the modal title and description', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    expect(screen.getByText('おすすめサイトを購読')).toBeInTheDocument()
    expect(screen.getByText(/気になるサイトを選んで購読しましょう/)).toBeInTheDocument()
  })

  test('renders skip and complete buttons', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'スキップ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument()
  })

  test('calls onDone when complete button is clicked', async () => {
    const onDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: '完了' }))

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled()
    })
  })

  test('calls onDone when skip button is clicked', async () => {
    const onDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: 'スキップ' }))

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled()
    })
  })

  test('focuses first focusable element (skip button) when featured list is empty on mount (focus trap)', async () => {
    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      // When no featured sources, the first button should be the skip button
      const skipButton = screen.getByRole('button', { name: 'スキップ' })
      expect(skipButton).toHaveFocus()
    })
  })

  test('Modal uses design classes (modal-backdrop / modal-box)', () => {
    render(<OnboardingSourcesModal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('modal-box')).toBe(true)
    expect(dialog.parentElement?.classList.contains('modal-backdrop')).toBe(true)
  })

  test('displays category section headers in fixed order (テクノロジー→ビジネス→スポーツ→芸能→カルチャー)', async () => {
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: '1', name: 'Tech Site', url: 'https://tech.example.com', order: 0, category: 'tech' } as FeaturedSource,
          { id: '2', name: 'Business Site', url: 'https://business.example.com', order: 1, category: 'business' } as FeaturedSource,
          { id: '3', name: 'Sports Site', url: 'https://sports.example.com', order: 2, category: 'sports' } as FeaturedSource,
        ],
      },
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.getByText('ビジネス')).toBeInTheDocument()
      expect(screen.getByText('スポーツ')).toBeInTheDocument()
    })
  })

  test('hides category headers when category has 0 items', async () => {
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: '1', name: 'Tech Site', url: 'https://tech.example.com', order: 0, category: 'tech' } as FeaturedSource,
        ],
      },
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
      expect(screen.queryByText('ビジネス')).not.toBeInTheDocument()
    })
  })

  test('normalizes missing category field to tech', async () => {
    gw.respond('GET', FEATURED_PATH, {
      ok: true,
      value: {
        sites: [
          { id: '1', name: 'Legacy Site', url: 'https://legacy.example.com', order: 0 } as FeaturedSource,
          { id: '2', name: 'Explicit Tech', url: 'https://tech.example.com', order: 1, category: 'tech' } as FeaturedSource,
        ],
      },
    })

    render(<OnboardingSourcesModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Legacy Site')).toBeInTheDocument()
      expect(screen.getByText('Explicit Tech')).toBeInTheDocument()
      expect(screen.getByText('テクノロジー')).toBeInTheDocument()
    })
  })
})

// ==========================================================
// 購読・完了の pin（web-slice-catalog-04）— 現行の振る舞いを固定する特性化テスト
// ==========================================================
describe('OnboardingSourcesModal — 購読・完了の pin (web-slice-catalog-04)', () => {
  const SOURCES_PATH = '/api/backend/settings/sources'
  const COMPLETE_PATH = '/api/backend/settings/onboarding/complete'
  const SITE = { id: 'f1', name: 'Tech Site', url: 'https://tech.example.com/rss', order: 0, category: 'tech' }

  const callsTo = (method: string, path: string) =>
    gw.calls.filter((c) => c.method === method && c.path === path)

  function renderWithSite(onDone: () => void = vi.fn()) {
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: [SITE] } })
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)
  }
  const subscribeButton = () => screen.findByRole('button', { name: 'Tech Site を購読' })

  test('web-slice-catalog-04: 購読が成功するとボタンが「購読済み」で disabled になり、POST の body は { name, url }', async () => {
    gw.respond('POST', SOURCES_PATH, { ok: true, value: { sources: [{ name: SITE.name, url: SITE.url }] } })
    renderWithSite()

    await userEvent.click(await subscribeButton())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tech Site を購読' })).toHaveTextContent('購読済み')
    })
    expect(screen.getByRole('button', { name: 'Tech Site を購読' })).toBeDisabled()
    expect(callsTo('POST', SOURCES_PATH)).toEqual([
      { method: 'POST', path: SOURCES_PATH, body: { name: SITE.name, url: SITE.url } },
    ])
  })

  test('web-slice-catalog-04: 購読が 409 でも「購読済み」になる', async () => {
    gw.respond('POST', SOURCES_PATH, { ok: false, failure: { kind: 'conflict' } })
    renderWithSite()

    await userEvent.click(await subscribeButton())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tech Site を購読' })).toHaveTextContent('購読済み')
    })
    expect(screen.getByRole('button', { name: 'Tech Site を購読' })).toBeDisabled()
  })

  test('web-slice-catalog-04: 購読が 422 と 500 のときは「購読」のまま有効（追加済みにするのは 409 だけ）', async () => {
    renderWithSite()
    const button = await subscribeButton()

    gw.respond('POST', SOURCES_PATH, { ok: false, failure: { kind: 'validation', detail: 'bad', reason: 'schema' } })
    await userEvent.click(button)
    await waitFor(() => expect(callsTo('POST', SOURCES_PATH)).toHaveLength(1))
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveTextContent('購読')
    expect(button).not.toHaveTextContent('購読済み')

    gw.respond('POST', SOURCES_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    await userEvent.click(button)
    await waitFor(() => expect(callsTo('POST', SOURCES_PATH)).toHaveLength(2))
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveTextContent('購読済み')
  })

  test('web-slice-catalog-04: 購読が reject しても何も起きず、ボタンが再び有効になる', async () => {
    gw.respondWith('POST', SOURCES_PATH, () => Promise.reject(new Error('boom')))
    renderWithSite()
    const button = await subscribeButton()

    await userEvent.click(button)

    await waitFor(() => expect(callsTo('POST', SOURCES_PATH)).toHaveLength(1))
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveTextContent('購読済み')
  })

  test('web-slice-catalog-04: 完了で POST onboarding/complete が 1 回、失敗・reject でも onDone が 1 回だけ呼ばれる', async () => {
    // 成功
    gw.respond('POST', COMPLETE_PATH, { ok: true, value: { onboarding_completed: true } })
    const okDone = vi.fn()
    const first = render(<OnboardingSourcesModal {...defaultProps} onDone={okDone} />)
    await userEvent.click(screen.getByRole('button', { name: '完了' }))
    await waitFor(() => expect(okDone).toHaveBeenCalledTimes(1))
    expect(callsTo('POST', COMPLETE_PATH)).toHaveLength(1)
    first.unmount()

    // 失敗（5xx）
    gw.respond('POST', COMPLETE_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    const failDone = vi.fn()
    const second = render(<OnboardingSourcesModal {...defaultProps} onDone={failDone} />)
    await userEvent.click(screen.getByRole('button', { name: '完了' }))
    await waitFor(() => expect(failDone).toHaveBeenCalledTimes(1))
    expect(callsTo('POST', COMPLETE_PATH)).toHaveLength(2)
    second.unmount()

    // reject
    gw.respondWith('POST', COMPLETE_PATH, () => Promise.reject(new Error('boom')))
    const rejectDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={rejectDone} />)
    await userEvent.click(screen.getByRole('button', { name: 'スキップ' }))
    await waitFor(() => expect(rejectDone).toHaveBeenCalledTimes(1))
    expect(callsTo('POST', COMPLETE_PATH)).toHaveLength(3)
  })

  test('web-slice-catalog-04: GET sources は 0 件で featured を全件出し、featured の取得失敗（!ok）でもスキップ・完了が使える', async () => {
    const second = { id: 'f2', name: 'Biz Site', url: 'https://biz.example.com/rss', order: 1, category: 'business' }
    gw.respond('GET', FEATURED_PATH, { ok: true, value: { sites: [SITE, second] } })
    const first = render(<OnboardingSourcesModal {...defaultProps} />)

    expect(await screen.findByRole('button', { name: 'Tech Site を購読' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Biz Site を購読' })).toBeInTheDocument()
    expect(callsTo('GET', SOURCES_PATH)).toHaveLength(0)
    first.unmount()

    gw.respond('GET', FEATURED_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    const onDone = vi.fn()
    render(<OnboardingSourcesModal {...defaultProps} onDone={onDone} />)

    await waitFor(() => expect(callsTo('GET', FEATURED_PATH)).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'スキップ' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '完了' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '完了' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
})
