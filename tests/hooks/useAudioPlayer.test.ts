import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioPlayer, PLAYBACK_SPEEDS } from '@/hooks/useAudioPlayer'
import { setupMockAudio } from '../helpers/mockAudio'

let mockAudio: ReturnType<typeof setupMockAudio>

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  mockAudio = setupMockAudio()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ==========================================================
// PLAYBACK_SPEEDS — 8 段階の定数
// ==========================================================
describe('PLAYBACK_SPEEDS constant', () => {
  test('exports exactly 8 speed values', () => {
    expect(PLAYBACK_SPEEDS).toHaveLength(8)
  })

  test('includes required speed values: 0.5, 1.0, 1.5, 2.0, 2.5', () => {
    expect(PLAYBACK_SPEEDS).toContain(0.5)
    expect(PLAYBACK_SPEEDS).toContain(1.0)
    expect(PLAYBACK_SPEEDS).toContain(1.5)
    expect(PLAYBACK_SPEEDS).toContain(2.0)
    expect(PLAYBACK_SPEEDS).toContain(2.5)
  })
})

// ==========================================================
// load(url, resumePosition, podcastId) — 再生開始・位置復元
// ==========================================================
describe('load', () => {
  test('Given resumePosition=30, sets currentTime to 30', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 30, 'p1')
    })

    expect(mockAudio.currentTime).toBe(30)
  })

  test('Given resumePosition=0, starts from the beginning', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    expect(mockAudio.currentTime).toBe(0)
  })

  test('Given resumePosition >= duration, starts from 0 (out-of-range guard)', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.duration = 100

    act(() => {
      result.current.load('https://example.com/audio.mp3', 100, 'p1')
      // loadedmetadata で duration が確定すると仮定
      mockAudio.fireLoadedMetadata(100)
    })

    expect(mockAudio.currentTime).toBe(0)
  })

  test('When loading a second episode, pauses and releases the first audio', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio1.mp3', 0, 'p1')
      mockAudio.paused = false // 再生中をシミュレート
    })

    act(() => {
      result.current.load('https://example.com/audio2.mp3', 0, 'p2')
    })

    // 旧 Audio が pause され src が解放されている
    expect(mockAudio.paused).toBe(true)
  })
})

// ==========================================================
// play / pause
// ==========================================================
describe('play', () => {
  test('sets isPlaying to true', async () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    expect(result.current.isPlaying).toBe(true)
  })
})

describe('pause', () => {
  test('sets isPlaying to false', async () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    act(() => {
      result.current.pause()
    })

    expect(result.current.isPlaying).toBe(false)
  })
})

// ==========================================================
// seek — シーク操作
// ==========================================================
describe('seek', () => {
  test('seek to 60 sets currentTime to 60', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.seek(60)
    })

    expect(mockAudio.currentTime).toBe(60)
  })

  test('seekRelative(-15) moves back 15 seconds', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.currentTime = 30
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 30, 'p1')
      result.current.seekRelative(-15)
    })

    expect(mockAudio.currentTime).toBe(15)
  })

  test('seekRelative(+30) moves forward 30 seconds', () => {
    const { result } = renderHook(() => useAudioPlayer())
    mockAudio.currentTime = 60
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 60, 'p1')
      result.current.seekRelative(30)
    })

    expect(mockAudio.currentTime).toBe(90)
  })
})

// ==========================================================
// setSpeed
// ==========================================================
describe('setSpeed', () => {
  test('sets Audio.playbackRate to given speed', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setSpeed(1.5)
    })

    expect(mockAudio.playbackRate).toBe(1.5)
  })
})

// ==========================================================
// timeupdate — 10 秒間隔スロットルで localStorage 保存
// ==========================================================
describe('timeupdate throttle', () => {
  test('saves position to localStorage after 10 seconds of playback', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    // 9 秒経過: まだ保存されない
    act(() => {
      mockAudio.fireTimeUpdate(9)
      vi.advanceTimersByTime(9000)
    })
    expect(localStorage.getItem('podcast_position:p1')).toBeNull()

    // 10 秒以上経過: 保存される
    act(() => {
      mockAudio.fireTimeUpdate(10)
      vi.advanceTimersByTime(1000)
    })
    expect(localStorage.getItem('podcast_position:p1')).not.toBeNull()
  })
})

// ==========================================================
// ended イベント
// ==========================================================
describe('ended event', () => {
  test('sets isPlaying to false when audio ends', async () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
      mockAudio.fireEnded()
    })

    expect(result.current.isPlaying).toBe(false)
  })

  test('resets saved position to 0 when audio ends', () => {
    const { result } = renderHook(() => useAudioPlayer())
    localStorage.setItem('podcast_position:p1', JSON.stringify(250))

    act(() => {
      result.current.load('https://example.com/audio.mp3', 250, 'p1')
      mockAudio.fireEnded()
    })

    const saved = localStorage.getItem('podcast_position:p1')
    // 終了後は 0 にリセット
    expect(saved === null || JSON.parse(saved!) === 0).toBe(true)
  })
})

// ==========================================================
// error イベント — isPlaying=false にし呼び出し元へ通知
// ==========================================================
describe('error event', () => {
  test('sets isPlaying to false when audio error occurs', async () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
      mockAudio.fireError()
    })

    expect(result.current.isPlaying).toBe(false)
  })

  test('notifies error to callers via onError callback or error state', () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useAudioPlayer({ onError }))

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      mockAudio.fireError()
    })

    expect(onError).toHaveBeenCalled()
  })
})

// ==========================================================
// setVolume — [0, 1] クランプ + Audio.volume 反映 + localStorage 保存
// ==========================================================
describe('setVolume', () => {
  test('Given v=0.5, sets Audio.volume to 0.5', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(0.5)
    })

    expect(mockAudio.volume).toBe(0.5)
  })

  test('Given v=0.0 (minimum), sets Audio.volume to 0.0', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(0.0)
    })

    expect(mockAudio.volume).toBe(0.0)
  })

  test('Given v=1.0 (maximum), sets Audio.volume to 1.0', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(1.0)
    })

    expect(mockAudio.volume).toBe(1.0)
  })

  test('Given v=-0.1 (below minimum), clamps to 0.0', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(-0.1)
    })

    expect(mockAudio.volume).toBe(0.0)
  })

  test('Given v=1.5 (above maximum), clamps to 1.0', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(1.5)
    })

    expect(mockAudio.volume).toBe(1.0)
  })

  test('Given v=-999, clamps to 0.0', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(-999)
    })

    expect(mockAudio.volume).toBe(0.0)
  })

  test('saves volume to localStorage under player_volume key', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
      result.current.setVolume(0.75)
    })

    expect(localStorage.getItem('player_volume')).toBe(JSON.stringify(0.75))
  })
})

// ==========================================================
// load 時の音量復元
// ==========================================================
describe('Volume restoration on load', () => {
  test('restores saved volume on load', () => {
    localStorage.setItem('player_volume', JSON.stringify(0.6))
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    expect(mockAudio.volume).toBe(0.6)
  })

  test('falls back to 1.0 when no volume is stored', () => {
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    expect(mockAudio.volume).toBe(1.0)
  })

  test('falls back to 1.0 when stored volume is invalid (not a number)', () => {
    localStorage.setItem('player_volume', JSON.stringify('invalid'))
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    expect(mockAudio.volume).toBe(1.0)
  })

  test('falls back to 1.0 when stored volume is out of range', () => {
    localStorage.setItem('player_volume', JSON.stringify(2.0))
    const { result } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    expect(mockAudio.volume).toBe(1.0)
  })
})

// ==========================================================
// アンマウント — リーク防止
// ==========================================================
describe('Unmount cleanup', () => {
  test('pauses audio when component unmounts', async () => {
    const { result, unmount } = renderHook(() => useAudioPlayer())

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    unmount()

    expect(mockAudio.paused).toBe(true)
  })
})

// ==========================================================
// onPositionSave callback — サーバー同期
// ==========================================================
describe('onPositionSave callback', () => {
  test('Given onPositionSave provided, calls it when position is saved during playback', async () => {
    const onPositionSave = vi.fn()
    const { result } = renderHook(() => useAudioPlayer({ onPositionSave }))
    mockAudio.duration = 300

    act(() => {
      // Load from position 0 so lastSavedPositionRef is 0
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    // Play and advance to trigger position save (POSITION_SAVE_INTERVAL = 10)
    await act(async () => {
      await result.current.play()
    })

    // First save triggers at currentTime = 10 (10 - 0 >= 10)
    act(() => {
      mockAudio.fireTimeUpdate(10)
    })

    expect(onPositionSave).toHaveBeenCalledWith('p1', 10)
  })

  test('Given onPositionSave not provided, does not throw', async () => {
    const { result } = renderHook(() => useAudioPlayer({}))
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    act(() => {
      mockAudio.fireTimeUpdate(10)
    })

    // Should not throw
    expect(true).toBe(true)
  })

  test('Given track ended, calls onPositionSave with position=0', async () => {
    const onPositionSave = vi.fn()
    const { result } = renderHook(() => useAudioPlayer({ onPositionSave }))
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    act(() => {
      mockAudio.fireEnded()
    })

    expect(onPositionSave).toHaveBeenCalledWith('p1', 0)
  })

  test('Multiple position saves are throttled and only called for intervals', async () => {
    const onPositionSave = vi.fn()
    const { result } = renderHook(() => useAudioPlayer({ onPositionSave }))
    mockAudio.duration = 300

    act(() => {
      result.current.load('https://example.com/audio.mp3', 0, 'p1')
    })

    await act(async () => {
      await result.current.play()
    })

    // First save at 10 seconds
    act(() => {
      mockAudio.fireTimeUpdate(10)
    })
    expect(onPositionSave).toHaveBeenCalledTimes(1)

    // Sub-interval update should not trigger callback
    act(() => {
      mockAudio.fireTimeUpdate(12)
    })
    expect(onPositionSave).toHaveBeenCalledTimes(1)

    // Next interval save at 20 seconds
    act(() => {
      mockAudio.fireTimeUpdate(20)
    })
    expect(onPositionSave).toHaveBeenCalledTimes(2)
  })
})
