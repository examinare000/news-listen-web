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

const { getPodcast, updatePosition, markCompleted } = vi.hoisted(() => ({
  getPodcast: vi.fn((id: string) => Promise.resolve({
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
  })),
  updatePosition: vi.fn(() => Promise.resolve()),
  markCompleted: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcast,
    updatePosition,
    markCompleted,
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

describe('AudioPlayerContext completion event (ADR-075)', () => {
  test('calls markCompleted with the podcast id when playback ends', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    mockAudio.fireEnded()

    await waitFor(() => expect(markCompleted).toHaveBeenCalledWith('a'))
  })

  test('does not interrupt playback state when markCompleted rejects (fire-and-forget)', async () => {
    markCompleted.mockRejectedValueOnce(new Error('network error'))
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByText('playA'))
    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))

    mockAudio.fireEnded()

    await waitFor(() => expect(markCompleted).toHaveBeenCalledWith('a'))
    // 'ended' 発火のため isPlaying=false（markCompleted の失敗が例外化して再生状態を壊さない）
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

    expect(markCompleted).toHaveBeenCalledTimes(2)
    expect(markCompleted).toHaveBeenNthCalledWith(1, 'a')
    expect(markCompleted).toHaveBeenNthCalledWith(2, 'b')
  })
})
