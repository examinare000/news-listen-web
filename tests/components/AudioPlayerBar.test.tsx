import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import { AppProvider } from '@/contexts/AppContext'
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { Podcast } from '@/types/index'
import { setupMockAudio } from '../helpers/mockAudio'

let mockAudio: ReturnType<typeof setupMockAudio>

beforeEach(() => {
  localStorage.clear()
  mockAudio = setupMockAudio()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_PODCAST: Podcast = {
  id: 'p1',
  type: 'single',
  article_ids: ['a1'],
  difficulty: 'toeic_900',
  audio_url: 'https://storage.example.com/audio.mp3',
  japanese_intro_text: 'これは日本語のイントロテキストです。テストのために書かれた文章です。長い文章でも先頭50文字だけが表示されることを確認します。',
  duration_seconds: 300,
  created_at: '2026-06-10T00:00:00+00:00',
}

function renderWithContext(currentPodcast: Podcast | null = null) {
  return render(
    <AppProvider initialState={{ currentPodcast }}>
      <ToastProvider>
        <AudioPlayerProvider>
          <AudioPlayerBar />
        </AudioPlayerProvider>
      </ToastProvider>
    </AppProvider>
  )
}

// ==========================================================
// 非表示条件
// ==========================================================
describe('AudioPlayerBar visibility', () => {
  test('Given currentPodcast=null, does not render the player bar', () => {
    renderWithContext(null)
    expect(screen.queryByRole('region', { name: /player|プレイヤー/i })).not.toBeInTheDocument()
    // 再生ボタンも表示されない
    expect(screen.queryByRole('button', { name: /再生|play/i })).not.toBeInTheDocument()
  })

  test('Given currentPodcast is set, renders the player bar', () => {
    renderWithContext(SAMPLE_PODCAST)
    expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
  })
})

// ==========================================================
// コンテンツ表示
// ==========================================================
describe('AudioPlayerBar content', () => {
  test('Displays first 50 characters of japanese_intro_text', () => {
    renderWithContext(SAMPLE_PODCAST)
    const introFirst50 = SAMPLE_PODCAST.japanese_intro_text.slice(0, 50)
    expect(screen.getByText(new RegExp(introFirst50.slice(0, 20)))).toBeInTheDocument()
  })

  test('Renders DifficultyBadge for current podcast difficulty', () => {
    renderWithContext(SAMPLE_PODCAST)
    // toeic_900 に対応するラベルが表示される
    expect(screen.getByText(/TOEIC 900/)).toBeInTheDocument()
  })

  test('Displays duration in formatDuration format (M:SS or H:MM:SS)', () => {
    renderWithContext(SAMPLE_PODCAST)
    // 300 秒 → "5:00"
    expect(screen.getByText(/5:00/)).toBeInTheDocument()
  })
})

// ==========================================================
// 再生・一時停止
// ==========================================================
describe('Play / Pause', () => {
  test('Given play button clicked, toggles to pause state', async () => {
    renderWithContext(SAMPLE_PODCAST)
    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))
    // 再生後は一時停止ボタンに変わる
    expect(screen.getByRole('button', { name: /一時停止|pause/i })).toBeInTheDocument()
  })

  test('Given playing podcast paused at mid-position, resume does NOT reset currentTime to 0', async () => {
    renderWithContext(SAMPLE_PODCAST)

    // First play — correctly loads audio via handlePlayPause
    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // Simulate audio advancing to 120 seconds
    mockAudio.currentTime = 120

    // Pause
    await userEvent.click(screen.getByRole('button', { name: /一時停止|pause/i }))

    // Resume — must NOT call load() (which would reset currentTime to 0)
    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // Position should be preserved at 120, not reset to 0
    expect(mockAudio.currentTime).toBe(120)
  })

  test('Given audio element fires error event, shows toast "音声を再生できません" (spec §9 L144)', async () => {
    renderWithContext(SAMPLE_PODCAST)

    // Start playing so audio element is active
    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    // Simulate native Audio error (network failure, codec error, etc.)
    mockAudio.fireError()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('音声を再生できません')
    })
  })
})

// ==========================================================
// シーク操作
// ==========================================================
describe('Seek controls', () => {
  test('-15 second button is present', () => {
    renderWithContext(SAMPLE_PODCAST)
    expect(screen.getByRole('button', { name: /-15|15秒戻/i })).toBeInTheDocument()
  })

  test('+30 second button is present', () => {
    renderWithContext(SAMPLE_PODCAST)
    expect(screen.getByRole('button', { name: /\+30|30秒進/i })).toBeInTheDocument()
  })

  test('Seek slider has aria-label', () => {
    renderWithContext(SAMPLE_PODCAST)
    const seekSlider = screen.getByRole('slider', { name: /シーク|seek|再生位置/i })
    expect(seekSlider).toBeInTheDocument()
    expect(seekSlider).toHaveAttribute('type', 'range')
  })
})

// ==========================================================
// 音量スライダー（spec §9・§10.3。order.md タスク 6 の明示要求）
// ==========================================================
describe('Volume slider', () => {
  test('Renders volume slider with aria-label="音量"', () => {
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })
    expect(volumeSlider).toBeInTheDocument()
    expect(volumeSlider).toHaveAttribute('type', 'range')
  })

  test('Volume slider range is 0 to 100', () => {
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })
    expect(volumeSlider).toHaveAttribute('min', '0')
    expect(volumeSlider).toHaveAttribute('max', '100')
  })

  test('Given volume slider changed to 50, calls setVolume with 0.5 (normalized from 0-100 range)', () => {
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })

    fireEvent.change(volumeSlider, { target: { value: '50' } })

    // Audio.volume が 0〜1 の範囲でセットされる
    // 100スケールの50 → 0.5
    expect(mockAudio.volume).toBeCloseTo(0.5, 1)
  })

  test('Given volume slider at 0, Audio.volume is 0', () => {
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })

    fireEvent.change(volumeSlider, { target: { value: '0' } })

    expect(mockAudio.volume).toBe(0)
  })

  test('Given volume slider at 100, Audio.volume is 1.0', () => {
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })

    fireEvent.change(volumeSlider, { target: { value: '100' } })

    expect(mockAudio.volume).toBe(1.0)
  })

  test('Volume slider initial value reflects saved player_volume', () => {
    localStorage.setItem('player_volume', JSON.stringify(0.6))
    renderWithContext(SAMPLE_PODCAST)
    const volumeSlider = screen.getByRole('slider', { name: '音量' })
    // 0.6 → 60 に変換されて slider に反映
    expect(Number(volumeSlider.getAttribute('value') ?? (volumeSlider as HTMLInputElement).value)).toBeCloseTo(60, 0)
  })
})

// ==========================================================
// 速度セレクタ（8 段階）
// ==========================================================
describe('Speed selector', () => {
  test('Renders speed selector with 8 options', () => {
    renderWithContext(SAMPLE_PODCAST)
    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i })
    expect(speedSelect).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(8)
  })

  test('Speed selector initial value reflects AppContext.playbackSpeed (spec §10.3 "初期値はデフォルト速度")', () => {
    // Render with a non-default playback speed in AppContext (simulates restored default)
    render(
      <AppProvider initialState={{ currentPodcast: SAMPLE_PODCAST, playbackSpeed: 1.5 }}>
        <ToastProvider>
          <AudioPlayerProvider>
            <AudioPlayerBar />
          </AudioPlayerProvider>
        </ToastProvider>
      </AppProvider>
    )

    const speedSelect = screen.getByRole('combobox', { name: /速度|speed/i }) as HTMLSelectElement
    expect(Number(speedSelect.value)).toBe(1.5)
  })
})
