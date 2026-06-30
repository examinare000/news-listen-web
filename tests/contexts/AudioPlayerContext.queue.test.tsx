import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider, useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { MockAudio } from '../helpers/mockAudio'
import { setupMockAudio } from '../helpers/mockAudio'
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

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    // getPodcast は id ごとに新しい署名付き URL を返す体で、id をそのまま反映する。
    getPodcast: vi.fn((id: string) => Promise.resolve(pod(id))),
    updatePosition: vi.fn(() => Promise.resolve()),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

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

function renderHarness() {
  return render(
    <AppProvider>
      <ToastProvider>
        <AudioPlayerProvider>
          <Harness />
        </AudioPlayerProvider>
      </ToastProvider>
    </AppProvider>,
  )
}

let mockAudio: MockAudio

beforeEach(() => {
  vi.clearAllMocks()
  mockAudio = setupMockAudio()
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
