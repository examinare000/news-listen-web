import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesProvider'
import { LOCAL_SETTING_BINDINGS } from '@/lib/preferences/infrastructure/localSettingsStore'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { PlaybackErrorToaster, usePlaybackActions } from '@/components/PlaybackToasts'
import { ToastProvider } from '@/components/ui/Toast'
import type { ApiGateway } from '@/lib/api/gateway'
import { MockAudio } from '../helpers/mockAudio'
import { setupMockCaches } from '../helpers/mockCaches'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'
import type { Podcast } from '@/types'

// AuthProvider は initialSession で認証済みの A を渡す。logout・login だけ API を double にする（実通信を起こさない）。
const { authLogout, authLogin } = vi.hoisted(() => ({ authLogout: vi.fn(), authLogin: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, createApiClient: () => ({ logout: authLogout, login: authLogin }) }
})

// 実の PlaybackProvider と実の browser adapter を、Audio の stub と gateway の double で動かす結合テスト。
// 旧 AudioPlayerContext.queue / completion / gateway の観点（キュー・自動の次へ・完聴の送信・取得失敗）を新しい入口に対して固定する。

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
  prefs: ReturnType<typeof usePreferences>
  auth: ReturnType<typeof useAuth>
}

// 描画した consumer の最新の値を、テストから操作できるように取り出す。
let cap: Captured

function Capture() {
  const pb = usePlayback()
  const actions = usePlaybackActions()
  const prefs = usePreferences()
  const auth = useAuth()
  useEffect(() => {
    cap = { pb, actions, prefs, auth }
  })
  return null
}

let gateway: GatewayDouble
let audio: TestAudio
let AudioCtor: ReturnType<typeof vi.fn>

// 既定速度の保存値は、描画の前に localStorage へ seed する（browser adapter を通る）。
const DEFAULT_SPEED = LOCAL_SETTING_BINDINGS.defaultPlaybackSpeed.setting
function seedDefaultSpeed(speed: number): void {
  localStorage.setItem('default_playback_speed', JSON.stringify(speed))
}

function tree(options: { readonly gateway?: ApiGateway } = {}) {
  return (
    <PreferencesProvider>
      <AuthProvider
        initialSession={{
          kind: 'authenticated',
          user: { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-a' },
        }}
      >
        <ToastProvider>
          <ApiClientProvider gateway={options.gateway ?? gateway}>
            <PlaybackProvider>
              <Capture />
              <PlaybackErrorToaster />
            </PlaybackProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  )
}

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

async function startAndPlay(id: string, duration = 60): Promise<void> {
  await start(id)
  await loaded(duration)
  await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
}

beforeEach(() => {
  localStorage.clear()
  audio = new TestAudio()
  // new で呼ばれるので通常の関数にする（アロー関数だと constructor にならない）。
  AudioCtor = vi.fn(function () {
    return audio
  })
  vi.stubGlobal('Audio', AudioCtor)
  authLogout.mockReset().mockResolvedValue({ status: 'ok' })
  authLogin.mockReset()
  gateway = createGatewayDouble()
  for (const id of ['a', 'b', 'c', 'd']) {
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

describe('PlaybackProvider の配線', () => {
  test('配線は 1 回だけ組まれ、再描画しても作り直されない。開始すると gateway が返した音源で再生に進む (verifies: CI-P4-11, CI-P4-14; T-P4-10, web-dec-36)', async () => {
    localStorage.setItem('player_volume', '0.4')
    const view = render(tree())
    expect(AudioCtor).toHaveBeenCalledTimes(1)
    expect(audio.volume).toBe(0.4)

    view.rerender(tree())
    view.rerender(tree())
    view.rerender(tree())
    await startAndPlay('a')

    expect(AudioCtor).toHaveBeenCalledTimes(1)
    expect(cap.pb.playback.status).toBe('playing')
    expect(audio.src).toBe('https://storage.example.com/a.mp3')
  })

  test('Provider の外で usePlayback を呼ぶと投げる (verifies: CI-P4-19; T-P4-10)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Bare() {
      usePlayback()
      return null
    }
    expect(() => render(<Bare />)).toThrow()
  })

  test('通知のたびに再描画され、query は描画のときに評価される (verifies: CI-P4-14; T-P4-10)', async () => {
    render(tree())
    await startAndPlay('a')

    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    expect(cap.pb.upNext().map((item) => item.id)).toEqual(['b'])
    expect(cap.pb.queueView().canSkipNext).toBe(true)

    act(() => {
      audio.fireTimeUpdate(7)
    })
    expect(cap.pb.playback.position).toBe(7)
  })

  test('usePlayback の key はちょうど 22 個で、PlaybackState (episode・audioUrl) を含まない (verifies: CI-P4-13; T-P4-11)', async () => {
    render(tree())
    await startAndPlay('a')

    expect(Object.keys(cap.pb).sort()).toEqual(
      [
        'startEpisode',
        'retry',
        'addToQueue',
        'playNext',
        'removeFromQueue',
        'reorder',
        'skipToNext',
        'stopForSubjectLeave',
        'nowPlaying',
        'upNext',
        'queueView',
        'playbackView',
        'savedPosition',
        'playback',
        'play',
        'pause',
        'seek',
        'seekRelative',
        'setSpeed',
        'setVolume',
        'volume',
        'offline',
      ].sort(),
    )
    expect(Object.keys(cap.pb.playback).sort()).toEqual(['duration', 'failure', 'position', 'primaryAction', 'speed', 'status'])
    const data = Object.fromEntries(Object.entries(cap.pb).filter(([, value]) => typeof value !== 'function'))
    expect(JSON.stringify(data)).not.toContain('audioUrl')
    expect(JSON.stringify(data)).not.toContain('episode"')
  })
})

describe('主体離脱の再生停止 (verifies: web-dec-73, shared-leave-07, web-dec-84)', () => {
  test('web-dec-73: 同じ AuthProvider の logout で、再生中の回は止まり、nowPlaying は null・upNext は空・status は idle になる', async () => {
    render(tree())
    await startAndPlay('a')
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
      await cap.actions.addToQueue(entry('c'))
    })
    expect(cap.pb.upNext().map((item) => item.id)).toEqual(['b', 'c'])

    await act(async () => {
      await cap.auth.logout()
    })

    // logout の後始末は await されないので、止まるのを待って確かめる
    await waitFor(() => expect(cap.pb.nowPlaying()).toBeNull())
    expect(cap.pb.upNext()).toEqual([])
    expect(cap.pb.playback.status).toBe('idle')
  })

  test('shared-leave-07: 遷移④で音声の削除が保留のままでも、login の直後に再生は止まり、A の位置・完聴は 1 件も送られない', async () => {
    const cacheStorage = setupMockCaches()
    await cacheStorage.open('audio-v1-u-a')
    vi.spyOn(cacheStorage, 'delete').mockReturnValue(new Promise<boolean>(() => {}))
    authLogin.mockResolvedValue({
      token: 't',
      user: { user_id: 'u-b', username: 'bob', role: 'user', display_name: 'Bob' },
    })
    render(tree())
    await startAndPlay('a')
    const reportsOfA = () =>
      gateway.calls.filter((call) => /\/podcasts\/a\/(position|completed)$/.test(call.path)).length
    const before = reportsOfA()

    await act(async () => {
      await cap.auth.login('bob', 'pw')
    })

    // waitFor を挟まない: login が解決した時点で A の再生は止まっている
    expect(cap.auth.currentUserId()).toBe('u-b')
    expect(cap.pb.playback.status).toBe('idle')
    expect(cap.pb.nowPlaying()).toBeNull()

    await act(async () => {
      audio.fireTimeUpdate(30)
      audio.fireEnded()
    })
    expect(reportsOfA()).toBe(before)
  })
})

describe('既定速度 (shared-session-10)', () => {
  test('開始のたびに既定速度で始まり、再生中に既定速度を変えても再生中の回は変わらない。バーの速度変更は既定速度を書き換えない (verifies: CI-P4-15, CI-P4-45; T-P4-12, shared-session-10)', async () => {
    seedDefaultSpeed(1.5)
    render(tree())
    await startAndPlay('a')
    expect(audio.playbackRate).toBe(1.5)

    act(() => {
      cap.pb.setSpeed(2.0)
    })
    expect(cap.pb.playback.speed).toBe(2.0)
    expect(cap.prefs.get(DEFAULT_SPEED)).toBe(1.5)

    act(() => {
      // 8 段に無い値は set が既定へ正規化する。型を外すのはこの 1 箇所だけ。
      cap.prefs.set(DEFAULT_SPEED, 1.1 as never)
    })
    expect(cap.pb.playback.speed).toBe(2.0)
    expect(audio.playbackRate).toBe(2.0)

    await startAndPlay('b')
    // 8 段に無い 1.1 は 1.0 に狭められる。
    expect(audio.playbackRate).toBe(1.0)
  })

  test.each([
    [1.25, 1.25],
    [0.5, 0.5],
    [1.1, 1.0],
    [3, 1.0],
  ])('idle の表示速度は、既定速度 %s を 8 段に狭めた %s (verifies: CI-P4-15; T-P4-12, web-dec-35)', (stored, shown) => {
    seedDefaultSpeed(stored)
    render(tree())
    expect(cap.pb.playback.status).toBe('idle')
    expect(cap.pb.playback.speed).toBe(shown)
  })

  test('idle の間に既定速度を変えると、その同じ描画で表示速度が新しい既定速度になる (verifies: CI-P4-15; T-P4-12, web-dec-39)', () => {
    seedDefaultSpeed(1.1)
    render(tree())
    expect(cap.pb.playback.speed).toBe(1.0)

    act(() => {
      cap.prefs.set(DEFAULT_SPEED, 1.5)
    })

    expect(cap.pb.playback.speed).toBe(1.5)
  })
})

describe('キューと再生中の回の一致 (shared-session-04)', () => {
  test('どの操作の後でも nowPlaying() の episodeId と、音声要素が指す回が一致する (verifies: CI-P4-42; T-P4-13, shared-session-04)', async () => {
    render(tree())
    const sourceIs = (id: string) => expect(audio.src).toBe(`https://storage.example.com/${id}.mp3`)
    const consistent = () => {
      const id = cap.pb.nowPlaying()?.episodeId
      expect(id).toBeDefined()
      sourceIs(id!)
    }

    await startAndPlay('a')
    consistent()

    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    consistent()

    await act(async () => {
      await cap.actions.playNext(entry('c'))
    })
    consistent()
    expect(cap.pb.upNext().map((item) => item.id)).toEqual(['c', 'b'])

    await act(async () => {
      await cap.actions.skipToNext()
    })
    await loaded()
    sourceIs('c')
    consistent()

    act(() => {
      cap.pb.removeFromQueue('b')
    })
    consistent()
    expect(cap.pb.upNext()).toEqual([])
  })
})

describe('次へ送りの取得失敗 (shared-dec-17)', () => {
  test('次が再生できないと分かったら、キューも再生も変えずに toast を 1 回出す (verifies: CI-P4-50; T-P4-14, shared-dec-17)', async () => {
    gateway.respond('GET', '/api/backend/podcasts/b', { ok: false, failure: { kind: 'not_found' } })
    render(tree())
    await startAndPlay('a')
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })
    const queueBefore = cap.pb.queueView()

    await act(async () => {
      expect(await cap.actions.skipToNext()).toEqual({ ok: false, notice: 'fetch_failed' })
    })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('再生できませんでした')
    expect(cap.pb.queueView()).toEqual(queueBefore)
    expect(cap.pb.playback.status).toBe('playing')
    expect(audio.src).toBe('https://storage.example.com/a.mp3')
  })
})

describe('音量 (web-dec-10)', () => {
  test.each([
    ['0.3', 0.3],
    ['x', 1],
    ['2', 1],
    ['-0.5', 1],
    ['"0.5"', 1],
    [null, 1],
  ])('保存値 %s の初期の音量は %s (verifies: CI-P4-16; T-P4-15)', (stored, expected) => {
    if (stored !== null) localStorage.setItem('player_volume', stored)

    render(tree())

    expect(cap.pb.volume).toBe(expected)
    expect(audio.volume).toBe(expected)
  })

  test('setVolume は Session・値・保存を更新する (verifies: CI-P4-16; T-P4-15)', () => {
    render(tree())

    act(() => {
      cap.pb.setVolume(0.6)
    })

    expect(cap.pb.volume).toBe(0.6)
    expect(audio.volume).toBe(0.6)
    expect(localStorage.getItem('player_volume')).toBe('0.6')
  })

  test('Storage の getItem が投げても描画は成功し、音量は 1 (verifies: CI-P4-16; T-P4-15, web-temp-08)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('', 'SecurityError')
    })

    render(tree())

    expect(cap.pb.volume).toBe(1)
  })

  test('Storage の setItem が投げても setVolume は投げず、値と音声要素の音量は更新される (verifies: CI-P4-16; T-P4-15, web-temp-08)', () => {
    render(tree())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('', 'SecurityError')
    })

    act(() => {
      expect(() => cap.pb.setVolume(0.6)).not.toThrow()
    })

    expect(cap.pb.volume).toBe(0.6)
    expect(audio.volume).toBe(0.6)
  })
})

describe('完聴の送信 (shared-session-07)', () => {
  test('完聴すると完聴の記録 → 総時間の位置の順に送り、次の開始は応答を待たない (verifies: CI-P4-43; T-P4-19, shared-session-07, shared-dec-26)', async () => {
    let releaseCompleted: () => void = () => undefined
    const completedHeld = new Promise<void>((resolve) => {
      releaseCompleted = resolve
    })
    // 完聴の記録の応答だけを保留する。呼び出しの記録は double に残す。
    const holding = {
      request: ((path: string, init?: Parameters<ApiGateway['request']>[1]) => {
        const result = gateway.request(path, init as never)
        if (path !== '/api/backend/podcasts/a/completed') return result
        return completedHeld.then(() => result)
      }) as ApiGateway['request'],
    }
    render(tree({ gateway: holding }))
    await startAndPlay('a', 60)
    await act(async () => {
      await cap.actions.addToQueue(entry('b'))
    })

    await act(async () => {
      audio.fireEnded()
    })

    const sent = gateway.calls.map((call) => `${call.method} ${call.path}`)
    const completedAt = sent.indexOf('POST /api/backend/podcasts/a/completed')
    const positionAt = sent.indexOf('PATCH /api/backend/podcasts/a/position')
    expect(completedAt).toBeGreaterThanOrEqual(0)
    expect(positionAt).toBeGreaterThan(completedAt)
    expect(gateway.calls.filter((call) => call.path === '/api/backend/podcasts/a/position')).toEqual([
      { method: 'PATCH', path: '/api/backend/podcasts/a/position', body: { position_seconds: 60 } },
    ])
    // 完聴の応答は保留のまま、次の回の取得はもう始まっている。
    await waitFor(() => expect(gateway.calls.some((call) => call.method === 'GET' && call.path === '/api/backend/podcasts/b')).toBe(true))
    releaseCompleted()
  })
})
