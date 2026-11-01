import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useEffect } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AuthProvider } from '@/contexts/AuthProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import { PlaybackErrorToaster, usePlaybackActions } from '@/components/PlaybackToasts'
import { ToastProvider } from '@/components/ui/Toast'
import { podcastPositionKey } from '@/lib/config'
import { MockAudio } from '../helpers/mockAudio'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'
import type { Podcast } from '@/types'

// 設定の保存先は、テストごとに新しい in-memory の KeyValueStore
const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

// 実の PlaybackProvider・再生バー・Toaster を並べ、再生の終わり方（完聴・取得失敗・再生の拒否・オフライン）が
// 利用者に見える形（状態・バー・toast）でどうなるかを固定する。旧 AudioPlayerContext.completion の観点を新しい入口に対して書く。

// 実の adapter は load(src) を `el.src = src; el.load()` の順に呼ぶ。引数なしの load() で src を消さない stub にする。
class TestAudio extends MockAudio {
  load(src?: string): void {
    if (src !== undefined) this.src = src
  }
}

function pod(id: string, over: Partial<Podcast> = {}): Podcast {
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
    ...over,
  }
}

const entry = (id: string) => ({ id, title: `Title ${id}`, intro: `intro ${id}` })

interface Captured {
  pb: ReturnType<typeof usePlayback>
  actions: ReturnType<typeof usePlaybackActions>
}

let cap: Captured

function Capture() {
  const pb = usePlayback()
  const actions = usePlaybackActions()
  useEffect(() => {
    cap = { pb, actions }
  })
  return null
}

let gateway: GatewayDouble
let audio: TestAudio

function renderApp() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider
        initialSession={{
          kind: 'authenticated',
          user: { username: 'alice', role: 'user', display_name: 'Alice', userId: 'user-test' },
        }}
      >
        <ToastProvider>
          <ApiClientProvider gateway={gateway}>
            <PlaybackProvider>
              <Capture />
              <AudioPlayerBar />
              <PlaybackErrorToaster />
            </PlaybackProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>,
  )
}

const callsTo = (method: string, path: string) => gateway.calls.filter((call) => call.method === method && call.path === path)

// 開始（loading の描画）と loadedmetadata は別の act で起こす。
async function start(id: string): Promise<void> {
  await act(async () => {
    await cap.actions.startEpisode(id)
  })
}

async function loaded(duration = 60): Promise<void> {
  await act(async () => {
    audio.fireLoadedMetadata(duration)
  })
}

async function startAndPlay(id: string): Promise<void> {
  await start(id)
  await loaded()
  await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
}

beforeEach(() => {
  localStorage.clear()
  audio = new TestAudio()
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      return audio
    }),
  )
  gateway = createGatewayDouble()
  for (const id of ['a', 'b']) {
    gateway.respond('GET', `/api/backend/podcasts/${id}`, { ok: true, value: pod(id) })
    gateway.respond('POST', `/api/backend/podcasts/${id}/completed`, { ok: true, value: undefined })
    gateway.respond('PATCH', `/api/backend/podcasts/${id}/position`, { ok: true, value: undefined })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('自動の次へ送りの取得失敗 (shared-session-01, shared-session-02, shared-session-03)', () => {
  test('次の回の取得に失敗すると errored で止まり、バーは次の回の題と再試行のボタンを出し、toast を 1 回出す (verifies: CI-P4-41; T-P4-18, shared-session-01, shared-session-02, shared-session-03, web-dec-38)', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })
    renderApp()
    await startAndPlay('a')
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    // 次の回を待つ間 (ended) はバーが消えて描き直されるので、操作のたびに取り直す。
    const bar = () => screen.getByTestId('audio-player-bar')
    // 対照: 再生中の a では題（DTO に title が無いので intro の先頭）と難易度が出ている。
    expect(within(bar()).getByText('intro a')).toBeInTheDocument()
    expect(within(bar()).getByText('TOEIC 900')).toBeInTheDocument()

    await act(async () => {
      audio.fireEnded()
    })

    await waitFor(() => expect(cap.pb.playback.status).toBe('errored'))
    expect(cap.pb.playback.primaryAction).toBe('retry')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('再生できませんでした')
    expect(within(bar()).getByText('Title b')).toBeInTheDocument()
    expect(within(bar()).queryByText('intro a')).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: '再生' })).toBeInTheDocument()
    expect(within(bar()).queryByText('TOEIC 900')).not.toBeInTheDocument()
  })

  test('取得に失敗した errored の再生ボタンは、再生元の解決からやり直す (verifies: CI-P4-41; T-P4-18, shared-session-02)', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })
    renderApp()
    await startAndPlay('a')
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    await act(async () => {
      audio.fireEnded()
    })
    await waitFor(() => expect(cap.pb.playback.status).toBe('errored'))
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: true, value: pod('b') })

    await userEvent.click(within(screen.getByTestId('audio-player-bar')).getByRole('button', { name: '再生' }))
    await loaded()

    await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
    expect(audio.src).toBe('https://storage.example.com/b.mp3')
  })

  test('idle と errored では位置を送らない (verifies: CI-P4-44; T-P4-18, shared-session-05)', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })
    renderApp()
    act(() => {
      audio.fireTimeUpdate(5)
    })
    expect(callsTo('PATCH', '/api/backend/podcasts/a/position')).toEqual([])

    await startAndPlay('a')
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    await act(async () => {
      audio.fireEnded()
    })
    await waitFor(() => expect(cap.pb.playback.status).toBe('errored'))
    const sentAtError = gateway.calls.filter((call) => call.method === 'PATCH').length
    act(() => {
      audio.fireTimeUpdate(30)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(callsTo('PATCH', '/api/backend/podcasts/b/position')).toEqual([])
    expect(gateway.calls.filter((call) => call.method === 'PATCH')).toHaveLength(sentAtError)
  })
})

describe('一時停止での位置の保存 (web-dec-07)', () => {
  test('再生中に一時停止すると、位置を local と server へ 1 回書く (verifies: CI-P4-47; T-P4-20, web-dec-07)', async () => {
    renderApp()
    await startAndPlay('a')
    audio.currentTime = 12

    act(() => {
      cap.pb.pause()
    })

    expect(callsTo('PATCH', '/api/backend/podcasts/a/position')).toEqual([
      { method: 'PATCH', path: '/api/backend/podcasts/a/position', body: { position_seconds: 12 } },
    ])
    expect(localStorage.getItem(podcastPositionKey('a'))).toBe('12')
  })
})

describe('開始後の play() の拒否 (web-dec-41)', () => {
  test('autoplay 制限で play() が拒否されると、toast「音声を再生できません」が 1 回出て、主ボタンが再試行になる (verifies: CI-P4-49; T-P4-21, web-dec-41)', async () => {
    vi.spyOn(audio, 'play').mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
    renderApp()

    await start('a')
    expect(cap.pb.playback.status).toBe('loading')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await loaded()

    await waitFor(() => expect(cap.pb.playback.status).toBe('errored'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('音声を再生できません')
    expect(cap.pb.playback.primaryAction).toBe('retry')
    expect(within(screen.getByTestId('audio-player-bar')).getByRole('button', { name: '再生' })).toBeInTheDocument()
  })

  test('その再試行は再生元の解決からやり直し、再生に進む (verifies: CI-P4-49; T-P4-21, web-dec-41)', async () => {
    vi.spyOn(audio, 'play').mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
    renderApp()
    await start('a')
    await loaded()
    await waitFor(() => expect(cap.pb.playback.status).toBe('errored'))
    expect(callsTo('GET', '/api/backend/podcasts/a')).toHaveLength(1)

    await userEvent.click(within(screen.getByTestId('audio-player-bar')).getByRole('button', { name: '再生' }))
    await loaded()

    await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
    expect(callsTo('GET', '/api/backend/podcasts/a')).toHaveLength(2)
  })
})

describe('オフラインで未保存の回 (web-dec-11)', () => {
  test('バーやページと同じ startEpisode で開始すると、toast「オフラインのため再生できません」が 1 回出る (verifies: CI-P4-48, CI-P4-22; T-P4-35, web-dec-11)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderApp()

    await act(async () => {
      expect(await cap.actions.startEpisode('a')).toEqual({ ok: false, notice: 'offline_uncached' })
    })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('オフラインのため再生できません')
    expect(gateway.calls).toEqual([])
  })
})
