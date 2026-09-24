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

// issue #167: オフライン再生分岐の結合テスト。
// キャッシュ済みエピソードは gateway 経由の取得（GET /api/backend/podcasts/:id）をスキップし、
// キャッシュ済み Blob URL で再生する。

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

// WHY vi.hoisted: vi.mock() factories run before this file's own top-level
// statements (they're hoisted above imports), so a factory can only reference
// variables created via vi.hoisted() — a bare outer `const` would hit a TDZ
// ReferenceError at mock-evaluation time.
const { getCachedAudioUrl, getCachedPodcast } = vi.hoisted(() => ({
  getCachedAudioUrl: vi.fn<(id: string) => Promise<string | null>>(),
  getCachedPodcast: vi.fn<(id: string) => Promise<Podcast | null>>(),
}))

vi.mock('@/lib/audioCache', () => ({
  getCachedAudioUrl,
  getCachedPodcast,
}))

function Harness() {
  const ctx = useAudioPlayerContext()
  return (
    <div>
      <button onClick={() => void ctx.playById('a')}>playA</button>
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
  getCachedAudioUrl.mockResolvedValue(null)
  getCachedPodcast.mockResolvedValue(null)
  gateway = createGatewayDouble()
  gateway.respond('GET', '/api/backend/podcasts/a', { ok: true, value: pod('a') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AudioPlayerContext offline playback (issue #167)', () => {
  test('plays from the cached blob URL and skips the gateway re-fetch when the episode is cached', async () => {
    getCachedAudioUrl.mockResolvedValue('blob:fake-cached-url')
    getCachedPodcast.mockResolvedValue(pod('a'))
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))

    await waitFor(() => expect(mockAudio.src).toBe('blob:fake-cached-url'))
    expect(gateway.calls).toHaveLength(0)
  })

  test('falls back to the network flow when nothing is cached', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))

    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))
    expect(gateway.calls).toContainEqual({ method: 'GET', path: '/api/backend/podcasts/a', body: undefined })
  })
})
