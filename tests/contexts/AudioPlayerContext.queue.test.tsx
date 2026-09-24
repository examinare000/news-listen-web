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

// issue #81: provider 配線（再生終了 → キューの次へ自動遷移 / 空キュー停止）の結合テスト。

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

let mockAudio: MockAudio

beforeEach(() => {
  vi.clearAllMocks()
  mockAudio = setupMockAudio()
  gateway = createGatewayDouble()
  // GET /api/backend/podcasts/:id は id ごとに新しい署名付き URL を返す体で、id をそのまま反映する。
  gateway.respond('GET', '/api/backend/podcasts/a', { ok: true, value: pod('a') })
  gateway.respond('GET', '/api/backend/podcasts/b', { ok: true, value: pod('b') })
  gateway.respond('POST', '/api/backend/podcasts/a/completed', { ok: true, value: undefined })
  gateway.respond('POST', '/api/backend/podcasts/b/completed', { ok: true, value: undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AudioPlayerContext queue auto-advance', () => {
  test('plays the next queued episode when the current one ends', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    await user.click(screen.getByText('addB'))
    await waitFor(() => expect(screen.getByTestId('upnext').textContent).toBe('b'))

    // 現在(a)が終了 → 自動で b を再生する。
    mockAudio.fireEnded()
    await waitFor(() => expect(mockAudio.src).toContain('b.mp3'))

    // ADR-075: 完聴イベントは「終了したトラック（a）」の id で 1 回だけ発火する
    // （advance で podcastIdRef が b に切り替わった後の stale-id 誤用が無いことの固定）。
    const completedCalls = gateway.calls.filter((c) => c.path === '/api/backend/podcasts/a/completed')
    expect(completedCalls).toHaveLength(1)
  })

  test('stops when the queue has no next episode', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    // 次が無い → 停止（再生されず isPlaying=false）。
    mockAudio.fireEnded()
    await waitFor(() => expect(screen.getByTestId('playing').textContent).toBe('no'))
    expect(mockAudio.src).toContain('a.mp3') // b へは進まない
  })
})

// verifies: [CI-W11]
describe('AudioPlayerContext playback fetch failure (CI-W11)', () => {
  test('T-W11a: playById failure shows a toast, does not load, and leaves the queue unchanged', async () => {
    gateway.respond('GET', '/api/backend/podcasts/x', { ok: false, failure: { kind: 'not_found' } })

    function HarnessX() {
      const ctx = useAudioPlayerContext()
      return (
        <div>
          <button onClick={() => void ctx.playById('a')}>playA</button>
          <button onClick={() => void ctx.addToQueue(pod('y'))}>addY</button>
          <button onClick={() => void ctx.playById('x')}>playX</button>
          <div data-testid="upnext">{ctx.upNext.map((p) => p.id).join(',')}</div>
        </div>
      )
    }

    const user = userEvent.setup()
    render(
      <AppProvider>
        <ToastProvider>
          <ApiClientProvider gateway={gateway}>
            <AudioPlayerProvider>
              <HarnessX />
            </AudioPlayerProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AppProvider>,
    )

    // a を再生中にしてから y をキューへ積む（何も再生していないと addToQueue が自動再生してしまうため）。
    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))
    await user.click(screen.getByText('addY'))
    await waitFor(() => expect(screen.getByTestId('upnext').textContent).toBe('y'))

    await user.click(screen.getByText('playX'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('再生できませんでした'))
    expect(mockAudio.src).toContain('a.mp3') // x へは切り替わらない
    expect(screen.getByTestId('upnext').textContent).toBe('y') // キューは不変
  })

  test('T-W11b: auto-advance keeps the advanced queue state when the next fetch fails', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))
    await user.click(screen.getByText('addB'))
    await waitFor(() => expect(screen.getByTestId('upnext').textContent).toBe('b'))

    // a が終了 → advance で current=b になった後、b の取得が失敗する。
    mockAudio.fireEnded()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('再生できませんでした'))
    // advance 後の状態（current=b、upNext=[]）を保ち、取り消さない（既存 queue 実装の仕様どおり）。
    expect(screen.getByTestId('upnext').textContent).toBe('')
    expect(mockAudio.src).toContain('a.mp3') // b は load されない
  })

  test('T-W11b: skipToNext keeps the advanced queue state when the next fetch fails', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })

    function HarnessSkip() {
      const ctx = useAudioPlayerContext()
      return (
        <div>
          <button onClick={() => void ctx.playById('a')}>playA</button>
          <button onClick={() => void ctx.addToQueue(pod('b'))}>addB</button>
          <button onClick={() => void ctx.skipToNext()}>skip</button>
          <div data-testid="upnext">{ctx.upNext.map((p) => p.id).join(',')}</div>
        </div>
      )
    }

    const user = userEvent.setup()
    render(
      <AppProvider>
        <ToastProvider>
          <ApiClientProvider gateway={gateway}>
            <AudioPlayerProvider>
              <HarnessSkip />
            </AudioPlayerProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AppProvider>,
    )

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))
    await user.click(screen.getByText('addB'))
    await waitFor(() => expect(screen.getByTestId('upnext').textContent).toBe('b'))

    await user.click(screen.getByText('skip'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('再生できませんでした'))
    expect(screen.getByTestId('upnext').textContent).toBe('')
    expect(mockAudio.src).toContain('a.mp3')
  })
})
