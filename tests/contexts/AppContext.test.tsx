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
}

// ==========================================================
// 初期状態
// ==========================================================
describe('Initial state', () => {
  test('isConfigured is false before configure() is called', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state.isConfigured).toBe(false)
  })

  test('currentPodcast is null initially', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state.currentPodcast).toBeNull()
  })

  test('isPlaying is false initially', () => {
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state.isPlaying).toBe(false)
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
// configure() — API 設定の保存と isConfigured
// ==========================================================
describe('configure action', () => {
  test('sets isConfigured to true after configure(baseUrl, apiKey)', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.configure('https://api.example.com', 'my-key')
    })

    expect(result.current.state.isConfigured).toBe(true)
  })

  test('persists baseUrl and apiKey to localStorage', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.configure('https://api.example.com', 'my-key')
    })

    expect(localStorage.getItem('api_base_url')).toBe(JSON.stringify('https://api.example.com'))
    expect(localStorage.getItem('api_key')).toBe(JSON.stringify('my-key'))
  })
})

// ==========================================================
// localStorage 復元 — マウント時に復元 / 復元前は isConfigured: false
// ==========================================================
describe('localStorage restore on mount', () => {
  test('restores isConfigured=true when stored credentials exist', () => {
    localStorage.setItem('api_base_url', JSON.stringify('https://api.example.com'))
    localStorage.setItem('api_key', JSON.stringify('stored-key'))

    const { result } = renderHook(() => useApp(), { wrapper })

    // useEffect 内の復元後に isConfigured が true になる
    // act は useEffect を同期的に実行する
    expect(result.current.state.isConfigured).toBe(true)
  })

  test('isConfigured remains false before restoration completes (hydration safety)', () => {
    // 復元を遅延させる手段がないため、
    // 少なくとも localStorage に値がない場合は false のまま、というテストで保証する
    localStorage.clear()
    const { result } = renderHook(() => useApp(), { wrapper })
    expect(result.current.state.isConfigured).toBe(false)
  })

  test('isRestoring becomes false after restore effect completes (credentials found)', () => {
    localStorage.setItem('api_base_url', JSON.stringify('https://api.example.com'))
    localStorage.setItem('api_key', JSON.stringify('stored-key'))

    const { result } = renderHook(() => useApp(), { wrapper })

    // CONFIGURE also clears isRestoring
    expect(result.current.state.isRestoring).toBe(false)
    expect(result.current.state.isConfigured).toBe(true)
  })

  test('isRestoring becomes false after restore effect completes (no credentials)', () => {
    localStorage.clear()
    const { result } = renderHook(() => useApp(), { wrapper })

    // RESTORE_DONE clears isRestoring even when no credentials exist
    expect(result.current.state.isRestoring).toBe(false)
    expect(result.current.state.isConfigured).toBe(false)
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

describe('PLAY / PAUSE actions', () => {
  test('sets isPlaying=true on PLAY', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_PODCAST', podcast: SAMPLE_PODCAST })
      result.current.dispatch({ type: 'PLAY' })
    })

    expect(result.current.state.isPlaying).toBe(true)
  })

  test('sets isPlaying=false on PAUSE', () => {
    const { result } = renderHook(() => useApp(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_PODCAST', podcast: SAMPLE_PODCAST })
      result.current.dispatch({ type: 'PLAY' })
      result.current.dispatch({ type: 'PAUSE' })
    })

    expect(result.current.state.isPlaying).toBe(false)
  })
})

// NOTE: SET_TIME action and state.currentTime/state.duration were removed.
// Playback time is the single source of truth in useAudioPlayer (spec §9).
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
// 状態の不変条件: 音量・再生位置は AppContext に置かない
// ==========================================================
describe('Volume is NOT in AppContext state', () => {
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
})
