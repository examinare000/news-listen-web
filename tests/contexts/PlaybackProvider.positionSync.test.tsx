import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { usePositionIntake } from '@/contexts/PositionIntakeContext'
import { ToastProvider } from '@/components/ui/Toast'
import { positionRecordKey } from '@/lib/playback/infrastructure/localPositionStore'
import { MockAudio } from '../helpers/mockAudio'
import { setupMockCaches } from '../helpers/mockCaches'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'
import type { Podcast } from '@/lib/api/dto'

// 実の AuthProvider と実の PlaybackProvider を、Audio の stub・localStorage（jsdom）・gateway の double で動かし、
// 端末の位置の記録・再送・取り込み・主体の離脱が、利用者の操作と起動・接続復帰の契機でどう観測されるかを固定する。

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

// AuthProvider が組む API クライアントの gateway だけを double にする。再生側の gateway（ApiClientProvider に渡す）とは別の double。
const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const ME_PATH = '/api/backend/auth/me'
const LOGOUT_PATH = '/api/backend/auth/logout'
const ME_A = { user_id: 'u-a', username: 'alice', role: 'user', display_name: 'Alice' }

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

// PATCH の応答は Podcast の形。サーバーが保存している位置と時刻を返す。
function patchResult(id: string, position: number, recordedAt: string | null) {
  return {
    ok: true as const,
    value: pod(id, { playback_position_seconds: position, playback_position_recorded_at: recordedAt }),
  }
}

// 端末の記録が必ず過去になるよう、実時計より前の固定の時刻で seed する。
const T0 = Date.parse('2026-11-01T00:00:00.000Z')

// 保存値の key は literal で書く（localPositionStore の key の形そのものを固定する）。
const recordKey = (userId: string, episodeId: string) => `playback_position_record:${userId}:${episodeId}`

function seedRecord(userId: string, episodeId: string, position: number, recordedAt: number, synced: boolean): void {
  localStorage.setItem(
    recordKey(userId, episodeId),
    JSON.stringify({ position, recorded_at: recordedAt, synced }),
  )
}

function readRecord(userId: string, episodeId: string): { position: number; recorded_at: number; synced: boolean } | null {
  const raw = localStorage.getItem(recordKey(userId, episodeId))
  return raw === null ? null : (JSON.parse(raw) as { position: number; recorded_at: number; synced: boolean })
}

interface Captured {
  pb: ReturnType<typeof usePlayback>
  auth: ReturnType<typeof useAuth>
}

let cap: Captured

function Capture() {
  const pb = usePlayback()
  const auth = useAuth()
  useEffect(() => {
    cap = { pb, auth }
  })
  return null
}

let gateway: GatewayDouble
let authGw: GatewayDouble
let audio: TestAudio

function tree(options: { readonly initialSession?: boolean; readonly children?: React.ReactNode } = {}) {
  const { initialSession = true, children } = options
  return (
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider
        initialSession={
          initialSession
            ? {
                kind: 'authenticated',
                user: { username: 'alice', role: 'user', displayName: 'Alice', userId: 'u-a' },
              }
            : undefined
        }
      >
        <ToastProvider>
          <ApiClientProvider gateway={gateway}>
            <PlaybackProvider>
              <Capture />
              {children}
            </PlaybackProvider>
          </ApiClientProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  )
}

const patchesTo = (id: string) =>
  gateway.calls.filter((call) => call.method === 'PATCH' && call.path === `/api/backend/podcasts/${id}/position`)

async function start(id: string): Promise<void> {
  await act(async () => {
    await cap.pb.startEpisode(id)
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

// 通信が決着するのを待つための、タスクを数回回すだけの猶予。
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
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
  // 起動時の回収が Cache Storage を見るので、描画の前に差し替える。
  setupMockCaches()
  authGw = createGatewayDouble()
  holder.gw = authGw
  authGw.respond('POST', LOGOUT_PATH, { ok: true, value: { status: 'ok' } })
  gateway = createGatewayDouble()
  for (const id of ['a', 'b', 'c', 'x', 'y']) {
    gateway.respond('GET', `/api/backend/podcasts/${id}`, { ok: true, value: pod(id) })
    gateway.respond('PATCH', `/api/backend/podcasts/${id}/position`, patchResult(id, 0, null))
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('PlaybackProvider の位置同期', () => {
  test('shared-sync-01 / ADR-109 決定 7: 記録が localStorage の playback_position_record:u-a:a に残り、Provider を作り直しても savedPosition が読める', async () => {
    const view = render(tree())
    await startAndPlay('a')
    audio.currentTime = 12

    act(() => {
      cap.pb.pause()
    })

    expect(positionRecordKey('u-a', 'a')).toBe('playback_position_record:u-a:a')
    expect(readRecord('u-a', 'a')).toMatchObject({ position: 12 })
    expect(readRecord('u-a', 'a')?.recorded_at).toBeGreaterThan(T0)

    view.unmount()
    render(tree())

    expect(cap.pb.savedPosition('a', 60)).toBe(12)
  })

  test('shared-sync-03 / ADR-109 決定 8: 失敗した位置が online イベントで再送される', async () => {
    gateway.respond('PATCH', '/api/backend/podcasts/a/position', { ok: false, failure: { kind: 'network' } })
    render(tree())
    await startAndPlay('a')
    audio.currentTime = 12

    act(() => {
      cap.pb.pause()
    })
    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))
    await settle()
    expect(readRecord('u-a', 'a')?.synced).toBe(false)

    gateway.respond('PATCH', '/api/backend/podcasts/a/position', patchResult('a', 12, null))
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(patchesTo('a')).toHaveLength(2))
    expect((patchesTo('a')[1].body as { recorded_at: string }).recorded_at).toBe(
      (patchesTo('a')[0].body as { recorded_at: string }).recorded_at,
    )
    await waitFor(() => expect(readRecord('u-a', 'a')?.synced).toBe(true))
  })

  test('認証の確定（起動）で未送信が送られる', async () => {
    seedRecord('u-a', 'a', 30, T0, false)
    let resolveMe: (result: { ok: true; value: unknown }) => void = () => {}
    authGw.respondWith(
      'GET',
      ME_PATH,
      () =>
        new Promise((resolve) => {
          resolveMe = resolve
        }),
    )
    render(tree({ initialSession: false }))
    await settle()

    // 認証が確定する前は 1 件も送らない。
    expect(patchesTo('a')).toEqual([])

    await act(async () => {
      resolveMe({ ok: true, value: ME_A })
    })

    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))
    expect(patchesTo('a')[0].body).toEqual({ position_seconds: 30, recorded_at: new Date(T0).toISOString() })
  })

  test('unavailable の間は送られず、retry で確定した後に送られる', async () => {
    seedRecord('u-a', 'a', 30, T0, false)
    authGw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'network' } })
    render(tree({ initialSession: false }))
    await waitFor(() => expect(cap.auth.session.kind).toBe('unavailable'))
    await settle()

    expect(patchesTo('a')).toEqual([])
    expect(readRecord('u-a', 'a')).not.toBeNull()

    authGw.respond('GET', ME_PATH, { ok: true, value: ME_A })
    await act(async () => {
      await cap.auth.retry()
    })

    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))
    expect(patchesTo('a')[0].body).toEqual({ position_seconds: 30, recorded_at: new Date(T0).toISOString() })
  })

  test('shared-sync-06 / ADR-109 決定 9: 新しい応答を取り込んでも、一時停止中のセッションの位置・状態は動かず、savedPosition だけが新しくなる', async () => {
    const newer = Date.now() + 60_000
    gateway.respond('PATCH', '/api/backend/podcasts/a/position', patchResult('a', 80, new Date(newer).toISOString()))
    render(tree())
    await startAndPlay('a')
    audio.currentTime = 12

    act(() => {
      cap.pb.pause()
    })
    const pausedPosition = cap.pb.playback.position
    expect(cap.pb.playback.status).toBe('paused')

    await waitFor(() => expect(readRecord('u-a', 'a')).toEqual({ position: 80, recorded_at: newer, synced: true }))

    expect(cap.pb.savedPosition('a', 600)).toBe(80)
    expect(cap.pb.playback.status).toBe('paused')
    expect(cap.pb.playback.position).toBe(pausedPosition)
    expect(audio.currentTime).toBe(12)
  })

  test('ADR-109 決定 10（旧い記録）: 旧い形の記録は送られず、再開位置の候補にも savedPosition にも入らない', async () => {
    localStorage.setItem('podcast_position:a', '300')
    localStorage.setItem('podcast_position:b', '10')
    seedRecord('u-a', 'c', 42, T0, true)
    gateway.respond('GET', '/api/backend/podcasts/a', { ok: true, value: pod('a', { playback_position_seconds: 25 }) })

    render(tree())

    expect(localStorage.getItem('podcast_position:a')).toBeNull()
    expect(localStorage.getItem('podcast_position:b')).toBeNull()
    expect(cap.pb.savedPosition('a', 600)).toBeNull()
    expect(cap.pb.savedPosition('b', 600)).toBeNull()
    // 正方向の対照: 新しい形の記録は残り、読める。
    expect(readRecord('u-a', 'c')).toEqual({ position: 42, recorded_at: T0, synced: true })
    expect(cap.pb.savedPosition('c', 600)).toBe(42)

    await start('a')
    await loaded()
    await settle()

    // 旧い 300 ではなくサーバーの値から始まり、旧い値は送られない。
    expect(audio.currentTime).toBe(25)
    expect(patchesTo('a')).toEqual([])
    expect(patchesTo('b')).toEqual([])
  })

  test('shared-leave-14 / ADR-109 決定 13: 遅延応答が logout の後に来ても記録は作られず、別主体の記録も変わらない', async () => {
    seedRecord('u-b', 'a', 5, T0, true)
    const before = localStorage.getItem(recordKey('u-b', 'a'))
    let resolveLate: (result: ReturnType<typeof patchResult>) => void = () => {}
    gateway.respondWith(
      'PATCH',
      '/api/backend/podcasts/a/position',
      () =>
        new Promise((resolve) => {
          resolveLate = resolve
        }),
    )
    render(tree())
    await startAndPlay('a')
    audio.currentTime = 12
    act(() => {
      cap.pb.pause()
    })
    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))
    expect(readRecord('u-a', 'a')).not.toBeNull()

    await act(async () => {
      await cap.auth.logout()
    })
    // logout の後始末は await されないので、A の記録が消えるのを待つ。
    await waitFor(() => expect(localStorage.getItem(recordKey('u-a', 'a'))).toBeNull())

    resolveLate(patchResult('a', 80, new Date(Date.now() + 60_000).toISOString()))
    await settle()

    expect(localStorage.getItem(recordKey('u-a', 'a'))).toBeNull()
    expect(localStorage.getItem(recordKey('u-b', 'a'))).toBe(before)
    expect(patchesTo('a')).toHaveLength(1)
  })

  test('shared-leave-14 / ADR-109 決定 13: 直接交代の直後（再描画の前）に A の応答が届いても、A の保存に失敗した記録を B のトークンで送らない', async () => {
    authGw.respond('POST', '/api/backend/auth/login', {
      ok: true,
      value: { token: 't', user: { user_id: 'u-b', username: 'bob', role: 'user', display_name: 'Bob' } },
    })
    let resolveA: (result: ReturnType<typeof patchResult>) => void = () => {}
    gateway.respondWith(
      'PATCH',
      '/api/backend/podcasts/a/position',
      () =>
        new Promise((resolve) => {
          resolveA = resolve
        }),
    )
    render(tree())
    await startAndPlay('a')
    audio.currentTime = 12
    act(() => {
      cap.pb.pause()
    })
    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))

    // 以後の保存は失敗する（localStorage が満杯）。記録は保存庫に無いまま、その回の flush にだけ積まれる。
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await act(async () => {
      cap.pb.play()
    })
    audio.currentTime = 30
    act(() => {
      cap.pb.pause()
    })
    setItem.mockRestore()

    // act の中では再描画が act の終了まで保留される。login の確定（lastSubject が B）の直後、再描画の前に A の応答を返す。
    await act(async () => {
      await cap.auth.login('bob', 'pw')
      resolveA(patchResult('a', 12, null))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()

    expect(cap.auth.currentUserId()).toBe('u-b')
    // A の 2 件目（位置 30）は送られない。送られた A の PATCH は 1 回目の 1 件だけ。
    expect(patchesTo('a')).toHaveLength(1)
  })

  test('shared-leave-12 / ADR-109 決定 13（③）: 別主体の未送信の記録を、現在の主体のトークンで送らない', async () => {
    seedRecord('u-b', 'x', 10, T0, false)
    seedRecord('u-a', 'y', 20, T0, false)
    authGw.respond('GET', ME_PATH, { ok: true, value: ME_A })

    render(tree({ initialSession: false }))

    await waitFor(() => expect(patchesTo('y')).toHaveLength(1))
    await settle()
    expect(patchesTo('x')).toEqual([])
    expect(localStorage.getItem(recordKey('u-b', 'x'))).toBeNull()
    expect(readRecord('u-a', 'y')).not.toBeNull()
  })

  test('shared-leave-13: 確定前（unavailable）は再送せず、確定後に現在の主体の分だけ再送する', async () => {
    seedRecord('u-b', 'x', 10, T0, false)
    seedRecord('u-a', 'y', 20, T0, false)
    authGw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'network' } })
    render(tree({ initialSession: false }))
    await waitFor(() => expect(cap.auth.session.kind).toBe('unavailable'))
    await settle()

    // 確定していない間は、送りも回収もしない。
    expect(gateway.calls.filter((call) => call.method === 'PATCH')).toEqual([])
    expect(readRecord('u-b', 'x')).not.toBeNull()
    expect(readRecord('u-a', 'y')).not.toBeNull()

    authGw.respond('GET', ME_PATH, { ok: true, value: ME_A })
    await act(async () => {
      await cap.auth.retry()
    })

    await waitFor(() => expect(patchesTo('y')).toHaveLength(1))
    await settle()
    expect(patchesTo('x')).toEqual([])
    expect(localStorage.getItem(recordKey('u-b', 'x'))).toBeNull()
  })

  test('PlaybackProvider の中で再描画しても usePositionIntake は同じ参照を返す', async () => {
    const seen: Array<ReturnType<typeof usePositionIntake>> = []
    function IntakeProbe() {
      // usePlayback を読むので、session の事象のたびに再描画される。
      usePlayback()
      seen.push(usePositionIntake())
      return null
    }
    render(tree({ children: <IntakeProbe /> }))
    await startAndPlay('a')
    const rendersBefore = seen.length

    act(() => {
      audio.fireTimeUpdate(3)
    })
    act(() => {
      audio.fireTimeUpdate(4)
    })

    expect(seen.length).toBeGreaterThan(rendersBefore)
    expect(new Set(seen).size).toBe(1)
  })
})
