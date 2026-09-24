import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AudioPlayerProvider, useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { MockAudio } from '../helpers/mockAudio'
import { setupMockAudio } from '../helpers/mockAudio'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'
import type { Podcast } from '@/types'

// ADR-075 決定3: 再生終了（ended・自然終端）で completed イベントを発火する結合テスト。

function pod(id: string): Podcast {
  return {
    id,
    type: 'single',
    article_ids: [],
    difficulty: 'toeic_900',
    audio_url: `https://storage.example.com/${id}.mp3`,
    japanese_intro_text: `intro ${id}`,
    duration_seconds: 60,
    created_at: '2026-06-10T09:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }
}

function Harness() {
  const ctx = useAudioPlayerContext()
  return (
    <div>
      <button onClick={() => void ctx.playById('a')}>playA</button>
      <button onClick={() => void ctx.addToQueue(pod('b'))}>addB</button>
      <div data-testid="upnext">{ctx.upNext.map((p) => p.id).join(',')}</div>
      <div data-testid="playing">{ctx.isPlaying ? 'yes' : 'no'}</div>
    </div>
  )
}

let gateway: GatewayDouble

function renderHarness() {
  return render(
    <AppProvider>
      <ToastProvider>
        <ApiClientProvider gateway={gateway}>
          <AudioPlayerProvider>
            <Harness />
          </AudioPlayerProvider>
        </ApiClientProvider>
      </ToastProvider>
    </AppProvider>,
  )
}

function completedCallsFor(id: string) {
  return gateway.calls.filter((c) => c.method === 'POST' && c.path === `/api/backend/podcasts/${id}/completed`)
}

let mockAudio: MockAudio

beforeEach(() => {
  vi.clearAllMocks()
  mockAudio = setupMockAudio()
  gateway = createGatewayDouble()
  gateway.respond('GET', '/api/backend/podcasts/a', { ok: true, value: pod('a') })
  gateway.respond('GET', '/api/backend/podcasts/b', { ok: true, value: pod('b') })
  gateway.respond('POST', '/api/backend/podcasts/a/completed', { ok: true, value: undefined })
  gateway.respond('POST', '/api/backend/podcasts/b/completed', { ok: true, value: undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AudioPlayerContext completion event (ADR-075)', () => {
  test('calls markCompleted with the podcast id when playback ends', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    mockAudio.fireEnded()

    await waitFor(() => expect(completedCallsFor('a')).toHaveLength(1))
    // T-W12: 完聴時の位置保存（position=0）も gateway 経由の PATCH で送信されること。
    expect(gateway.calls).toContainEqual({
      method: 'PATCH',
      path: '/api/backend/podcasts/a/position',
      body: { position_seconds: 0 },
    })
  })

  test('does not interrupt playback state when the completed call fails (fire-and-forget)', async () => {
    gateway.respond('POST', '/api/backend/podcasts/a/completed', { ok: false, failure: { kind: 'network' } })
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    mockAudio.fireEnded()

    await waitFor(() => expect(completedCallsFor('a')).toHaveLength(1))
    // 'ended' 発火のため isPlaying=false（completed の失敗が再生状態を壊さない。結果は捨てる）
    expect(screen.getByTestId('playing').textContent).toBe('no')
  })

  test('calls markCompleted once per episode, in order, as a 2-song queue advances (a then b)', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    await user.click(screen.getByText('addB'))
    await waitFor(() => expect(screen.getByTestId('upnext').textContent).toBe('b'))

    // a が終了 → 自動で b へ進む。
    mockAudio.fireEnded()
    await waitFor(() => expect(mockAudio.src).toContain('b.mp3'))

    // b が終了 → 次が無いため停止。
    mockAudio.fireEnded()
    await waitFor(() => expect(screen.getByTestId('playing').textContent).toBe('no'))

    expect(completedCallsFor('a')).toHaveLength(1)
    expect(completedCallsFor('b')).toHaveLength(1)
    const order = gateway.calls
      .filter((c) => c.method === 'POST' && c.path.endsWith('/completed'))
      .map((c) => c.path)
    expect(order).toEqual([
      '/api/backend/podcasts/a/completed',
      '/api/backend/podcasts/b/completed',
    ])
  })
})
