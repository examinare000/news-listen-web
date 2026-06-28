import { describe, test, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { AppProvider, useApp } from '@/contexts/AppContext'
import type { Podcast } from '@/types/index'

beforeEach(() => {
  localStorage.clear()
})

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>
}

const SAMPLE_PODCAST: Podcast = {
  id: 'p1',
  type: 'single',
  article_ids: ['a1'],
  difficulty: 'toeic_900',
  audio_url: 'https://storage.example.com/audio.mp3',
  japanese_intro_text: 'これはテストです',
  duration_seconds: 300,
  created_at: '2026-06-10T00:00:00+00:00',
  status: 'completed',
  error_message: null,
  playback_position_seconds: 0,
}

// ==========================================================
// 初期状態
// ==========================================================
describe('Initial state', () => {
  test('currentPodcast is null initially', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state.currentPodcast).toBeNull()
  })
})

// ==========================================================
// useApp() — Provider 外で呼ぶと throw
// ==========================================================
describe('useApp outside Provider', () => {
  test('throws when called outside AppProvider', () => {
    // renderHook without wrapper = no Provider
    expect(() => {
      renderHook(() => useApp())
    }).toThrow()
  })
})


// ==========================================================
// localStorage 復元 — マウント時に復元完了
// ==========================================================
describe('localStorage restore on mount', () => {
  test('isRestoring becomes false after restore effect completes', () => {
    localStorage.clear()
    const { result } = renderHook(() => useApp(), { wrapper })

    // RESTORE_DONE clears isRestoring
    expect(result.current.state.isRestoring).toBe(false)
  })
})

// ==========================================================
// Reducer actions — 再生状態
// ==========================================================
describe('SET_PODCAST action', () => {
  test('sets currentPodcast when SET_PODCAST is dispatched', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_PODCAST', podcast: SAMPLE_PODCAST })
    })

    expect(result.current.state.currentPodcast).toEqual(SAMPLE_PODCAST)
  })
})

// NOTE: PLAY/PAUSE actions and state.isPlaying were removed.
// isPlaying is the single source of truth in useAudioPlayer (spec §9).
// AudioPlayerBar reads player.isPlaying directly from useAudioPlayerContext().
// NOTE: SET_TIME action and state.currentTime/state.duration were also removed.
// AudioPlayerBar.resume no longer re-loads the audio; it calls player.play() directly.

describe('SET_SPEED action', () => {
  test('updates playbackSpeed', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_SPEED', speed: 1.5 })
    })

    expect(result.current.state.playbackSpeed).toBe(1.5)
  })
})

describe('SET_TIME_FORMAT action', () => {
  test('updates timeFormat to "relative"', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_TIME_FORMAT', timeFormat: 'relative' })
    })

    expect(result.current.state.timeFormat).toBe('relative')
  })

  test('updates timeFormat back to "absolute"', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_TIME_FORMAT', timeFormat: 'relative' })
    })
    expect(result.current.state.timeFormat).toBe('relative')

    act(() => {
      result.current.dispatch({ type: 'SET_TIME_FORMAT', timeFormat: 'absolute' })
    })
    expect(result.current.state.timeFormat).toBe('absolute')
  })
})

describe('setTimeFormat method', () => {
  test('calls SET_TIME_FORMAT action and persists to localStorage', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.setTimeFormat('relative')
    })

    expect(result.current.state.timeFormat).toBe('relative')
    expect(localStorage.getItem('time_format')).toBe(JSON.stringify('relative'))
  })
})

// ==========================================================
// localStorage 復元 — default_playback_speed (spec §10.5)
// ==========================================================
describe('localStorage restore — default_playback_speed', () => {
  test('restores playbackSpeed from default_playback_speed on mount', () => {
    localStorage.setItem('default_playback_speed', JSON.stringify(1.5))

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.playbackSpeed).toBe(1.5)
  })

  test('uses default playbackSpeed 1.0 when default_playback_speed is not set', () => {
    // localStorage is cleared in beforeEach
    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.playbackSpeed).toBe(1.0)
  })

  test('uses default playbackSpeed 1.0 when default_playback_speed contains invalid value', () => {
    localStorage.setItem('default_playback_speed', 'not-valid-json{')

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.playbackSpeed).toBe(1.0)
  })

  test('uses default playbackSpeed 1.0 when stored value is not a positive number', () => {
    localStorage.setItem('default_playback_speed', JSON.stringify(-1))

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.playbackSpeed).toBe(1.0)
  })
})

// ==========================================================
// localStorage 復元 — time_format (relative/absolute)
// ==========================================================
describe('localStorage restore — time_format', () => {
  test('restores timeFormat "relative" from localStorage on mount', () => {
    localStorage.setItem('time_format', JSON.stringify('relative'))

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.timeFormat).toBe('relative')
  })

  test('restores timeFormat "absolute" from localStorage on mount', () => {
    localStorage.setItem('time_format', JSON.stringify('absolute'))

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.timeFormat).toBe('absolute')
  })

  test('uses default timeFormat "absolute" when time_format is not set', () => {
    // localStorage is cleared in beforeEach
    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.timeFormat).toBe('absolute')
  })

  test('uses default timeFormat "absolute" when time_format contains invalid value', () => {
    localStorage.setItem('time_format', JSON.stringify('invalid-value'))

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.timeFormat).toBe('absolute')
  })

  test('uses default timeFormat "absolute" when time_format is corrupted JSON', () => {
    localStorage.setItem('time_format', 'not-valid-json{')

    const { result } = renderHook(() => useApp(), { wrapper })

    expect(result.current.state.timeFormat).toBe('absolute')
  })
})

// ==========================================================
// 状態の不変条件: 音量・再生位置は AppContext に置かない
// ==========================================================
describe('State fields managed in useAudioPlayer are NOT in AppContext', () => {
  test('AppContext state does not contain a volume field (volume managed in useAudioPlayer)', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    // volume フィールドが存在しないことを確認（spec §9 の設計判断）
    expect(result.current.state).not.toHaveProperty('volume')
  })

  test('AppContext state does not contain currentTime or duration (managed in useAudioPlayer)', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state).not.toHaveProperty('currentTime')
    expect(result.current.state).not.toHaveProperty('duration')
  })

  test('AppContext state does not contain isPlaying (managed in useAudioPlayer as single source of truth)', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    // isPlaying は useAudioPlayer が唯一の正規源 — AppContext に持つと二重管理になる
    expect(result.current.state).not.toHaveProperty('isPlaying')
  })
})
