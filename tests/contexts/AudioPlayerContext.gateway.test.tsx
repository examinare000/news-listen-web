// verifies: [CI-W13], Spec R7 (T-W15)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { AppProvider } from '@/contexts/AppContext'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AudioPlayerProvider, useAudioPlayerContext } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import { setupMockAudio } from '../helpers/mockAudio'
import type { MockAudio } from '../helpers/mockAudio'
import type { Podcast } from '@/types'

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

// T-W13: contexts/AudioPlayerContext.tsx に互換 adapter（TP1）を指す文字列（コメント含む）が無い。
test('T-W13: AudioPlayerContext.tsx contains no compat-adapter references', () => {
  const filePath = path.join(process.cwd(), 'contexts', 'AudioPlayerContext.tsx')
  const source = fs.readFileSync(filePath, 'utf8')
  expect((source.match(/createApiClient|ApiError/g) ?? []).length).toBe(0)
})

// T-W15: Provider の gateway prop を省略し、実 gateway（createGw 経由）+ fetch stub で再生が成立する統合テスト。
describe('AudioPlayerContext with the real gateway (Spec R7)', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = setupMockAudio()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('T-W15: playById plays using the real gateway (ApiClientProvider gateway prop omitted)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(pod('a')),
        headers: { get: () => null },
      }),
    )

    function Harness() {
      const ctx = useAudioPlayerContext()
      return <button onClick={() => void ctx.playById('a')}>playA</button>
    }

    const user = userEvent.setup()
    render(
      <AppProvider>
        <ToastProvider>
          <ApiClientProvider>
            <AudioPlayerProvider>
              <Harness />
            </AudioPlayerProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AppProvider>,
    )

    await user.click(screen.getByText('playA'))

    await waitFor(() => expect(mockAudio.src).toContain('a.mp3'))
  })
})
