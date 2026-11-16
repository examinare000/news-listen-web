import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { AuthProvider } from '@/contexts/AuthProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import { MockAudio } from '../helpers/mockAudio'
import { setupMockCaches } from '../helpers/mockCaches'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'
import type { Podcast } from '@/types'

// 実の AuthProvider・PlaybackProvider・AudioPlayerBar を、Audio の stub・localStorage（jsdom）・gateway の double で動かし、
// 他の端末の位置が取り込まれた後の再生ボタンの確認（ADR-109 決定 11・12）を、利用者の操作から固定する。

const memoryStore = (): KeyValueStore => {
  const data = new Map<string, string>()
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

// AuthProvider が組む API クライアントの gateway だけを double にする。再生側の gateway とは別の double。
const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const LOGOUT_PATH = '/api/backend/auth/logout'
const DURATION = 600

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
    duration_seconds: DURATION,
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

type PatchResult = ReturnType<typeof patchResult>

const recordKey = (userId: string, episodeId: string) => `playback_position_record:${userId}:${episodeId}`

function readRecord(userId: string, episodeId: string): { position: number; recorded_at: number; synced: boolean } | null {
  const raw = localStorage.getItem(recordKey(userId, episodeId))
  return raw === null ? null : (JSON.parse(raw) as { position: number; recorded_at: number; synced: boolean })
}

interface Captured {
  pb: ReturnType<typeof usePlayback>
}

let cap: Captured

function Capture() {
  const pb = usePlayback()
  useEffect(() => {
    cap = { pb }
  })
  return null
}

let gateway: GatewayDouble
let authGw: GatewayDouble
let audio: TestAudio
let setProviderMounted: (mounted: boolean) => void = () => {}

// PlaybackProvider だけを作り直せる木。ほかの Provider は同じ instance のまま残る。
function Harness() {
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    setProviderMounted = setMounted
  }, [])
  return (
    <PreferencesProvider store={memoryStore()}>
      <AuthProvider
        initialSession={{
          kind: 'authenticated',
          user: { username: 'alice', role: 'user', display_name: 'Alice', userId: 'u-a' },
        }}
      >
        <ToastProvider>
          <ApiClientProvider gateway={gateway}>
            {mounted && (
              <PlaybackProvider>
                <Capture />
                <AudioPlayerBar />
              </PlaybackProvider>
            )}
          </ApiClientProvider>
        </ToastProvider>
      </AuthProvider>
    </PreferencesProvider>
  )
}

const patchesTo = (id: string) =>
  gateway.calls.filter((call) => call.method === 'PATCH' && call.path === `/api/backend/podcasts/${id}/position`)

const patchPath = (id: string) => `/api/backend/podcasts/${id}/position`
const getPath = (id: string) => `/api/backend/podcasts/${id}`

async function start(id: string): Promise<void> {
  await act(async () => {
    await cap.pb.startEpisode(id)
  })
}

async function loaded(duration = DURATION): Promise<void> {
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

function pauseAt(seconds: number): void {
  audio.currentTime = seconds
  act(() => {
    cap.pb.pause()
  })
}

// 最初の呼出だけ外から解決できるよう保留し、2 回目以降は取り込みを起こさない応答（時刻なし）を返す。
function holdFirstPatch(id: string): { release: (result: PatchResult) => Promise<void> } {
  let resolveFirst: (result: PatchResult) => void = () => {}
  let count = 0
  gateway.respondWith('PATCH', patchPath(id), () => {
    count += 1
    if (count === 1) {
      return new Promise((resolve) => {
        resolveFirst = resolve
      })
    }
    return Promise.resolve(patchResult(id, 0, null))
  })
  return {
    release: async (result) => {
      await act(async () => {
        resolveFirst(result)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
  }
}

// a を再生 → 位置 100 で pause → PATCH の応答で他の端末の 500 が新しい時刻で取り込まれる、までを作る。
async function adoptRemoteWhilePaused(remote = 500, newer = Date.now() + 60_000): Promise<number> {
  gateway.respond('PATCH', patchPath('a'), patchResult('a', remote, new Date(newer).toISOString()))
  await startAndPlay('a')
  pauseAt(100)
  await waitFor(() => expect(readRecord('u-a', 'a')).toEqual({ position: remote, recorded_at: newer, synced: true }))
  expect(cap.pb.playback.status).toBe('paused')
  return newer
}

const playButton = () => screen.getByRole('button', { name: '再生' })

async function pressPlay(): Promise<void> {
  await act(async () => {
    fireEvent.click(playButton())
  })
}

const dialog = () => screen.queryByRole('dialog')

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

beforeEach(() => {
  localStorage.clear()
  audio = new TestAudio()
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      audio = new TestAudio()
      return audio
    }),
  )
  setupMockCaches()
  authGw = createGatewayDouble()
  holder.gw = authGw
  authGw.respond('POST', LOGOUT_PATH, { ok: true, value: { status: 'ok' } })
  gateway = createGatewayDouble()
  for (const id of ['a', 'b', 'c']) {
    gateway.respond('GET', getPath(id), { ok: true, value: pod(id) })
    gateway.respond('PATCH', patchPath(id), patchResult(id, 0, null))
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'visibilityState')
  localStorage.clear()
})

describe('PlaybackProvider の再開時の確認', () => {
  test('shared-sync-10 / shared-sync-12 / ADR-109 決定 11: 他の端末の応答が取り込まれた後、一時停止中の再生ボタンで確認が出て、選択した位置から再生される', async () => {
    render(<Harness />)
    await adoptRemoteWhilePaused()
    expect(dialog()).toBeNull()

    await pressPlay()

    expect(dialog()).not.toBeNull()
    expect(cap.pb.playback.status).toBe('paused')
    expect(screen.getByText('別の端末: 8:20 ／ この端末: 1:40')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '別の端末の位置から' }))
    })

    await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
    expect(cap.pb.playback.position).toBe(500)
    expect(audio.currentTime).toBe(500)
    expect(dialog()).toBeNull()
  })

  test('shared-sync-13: 「この端末の位置から」は今の位置を記録して送る', async () => {
    render(<Harness />)
    const newer = await adoptRemoteWhilePaused()
    expect(patchesTo('a')).toHaveLength(1)
    // 2 回目以降の PATCH は取り込みを起こさない応答にして、この端末の記録がそのまま残るかを見る。
    gateway.respond('PATCH', patchPath('a'), patchResult('a', 100, null))

    await pressPlay()
    expect(dialog()).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この端末の位置から' }))
    })

    await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
    expect(cap.pb.playback.position).toBe(100)
    expect(audio.currentTime).toBe(100)
    await waitFor(() => expect(patchesTo('a')).toHaveLength(2))
    const body = patchesTo('a')[1].body as { position_seconds: number; recorded_at: string }
    expect(body.position_seconds).toBe(100)
    expect(Date.parse(body.recorded_at)).toBeLessThan(newer)
    expect(readRecord('u-a', 'a')?.position).toBe(100)
  })

  test('shared-sync-10: 前面でない（visibilityState が hidden）ときは尋ねずに再生する', async () => {
    render(<Harness />)
    await adoptRemoteWhilePaused()

    // 正方向の対照: 前面なら同じ構成で確認が出る。閉じても控えは残る。
    await pressPlay()
    expect(dialog()).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    })
    expect(dialog()).toBeNull()
    expect(cap.pb.playback.status).toBe('paused')

    setVisibility('hidden')
    await pressPlay()

    expect(dialog()).toBeNull()
    await waitFor(() => expect(cap.pb.playback.status).toBe('playing'))
    expect(cap.pb.playback.position).toBe(100)
  })

  test('shared-sync-11 / ADR-109 決定 12: 控えがあるとき session の play（Provider の play）を直接呼んでも確認は出ない', async () => {
    render(<Harness />)
    await adoptRemoteWhilePaused()

    await act(async () => {
      await cap.pb.play()
    })

    expect(cap.pb.playback.status).toBe('playing')
    expect(dialog()).toBeNull()
    expect(cap.pb.playback.position).toBe(100)
  })

  test('shared-sync-11 / ADR-109 決定 12（対照）: 同じ構成で bar の再生ボタンは確認を出す', async () => {
    render(<Harness />)
    await adoptRemoteWhilePaused()

    await pressPlay()

    expect(dialog()).not.toBeNull()
    expect(cap.pb.playback.status).toBe('paused')
  })

  test('shared-sync-15: 確認を出した後に解決待ちの別 episode の開始が終わると nowPlaying が替わり、chooseResume は何もしない', async () => {
    render(<Harness />)
    await adoptRemoteWhilePaused()
    let resolveB: (result: { ok: true; value: Podcast }) => void = () => {}
    gateway.respondWith(
      'GET',
      getPath('b'),
      () =>
        new Promise((resolve) => {
          resolveB = resolve
        }),
    )
    await act(async () => {
      void cap.pb.startEpisode('b')
    })
    await pressPlay()
    expect(dialog()).not.toBeNull()

    await act(async () => {
      resolveB({ ok: true, value: pod('b') })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(cap.pb.nowPlaying()?.episodeId).toBe('b'))

    expect(dialog()).toBeNull()
    const positionBefore = cap.pb.playback.position
    await act(async () => {
      cap.pb.chooseResume('remote')
    })
    expect(cap.pb.nowPlaying()?.episodeId).toBe('b')
    expect(cap.pb.playback.position).toBe(positionBefore)
    expect(audio.currentTime).not.toBe(500)
  })

  test('web-dec-165: 応答待ちの間に Provider を unmount → 再 mount し、保留した応答を完了させても、新しい Provider の一時停止中の再生ボタンは尋ねない', async () => {
    render(<Harness />)
    const gate = holdFirstPatch('a')
    gateway.respond('GET', getPath('a'), { ok: true, value: pod('a') })
    await startAndPlay('a')
    pauseAt(100)
    await waitFor(() => expect(patchesTo('a')).toHaveLength(1))

    // PlaybackProvider だけを作り直す。旧い session は止まらず paused の a のまま残る。
    act(() => setProviderMounted(false))
    act(() => setProviderMounted(true))

    const newer = Date.now() + 60_000
    await gate.release(patchResult('a', 500, new Date(newer).toISOString()))
    await waitFor(() => expect(readRecord('u-a', 'a')).toEqual({ position: 500, recorded_at: newer, synced: true }))
    await settle()
    expect(readRecord('u-a', 'a')).toEqual({ position: 500, recorded_at: newer, synced: true })

    // 新しい Provider で a を開始（端末の 500 から）→ 開始位置のまま pause → paused のまま seek(100)。
    await startAndPlay('a')
    expect(cap.pb.playback.position).toBe(500)
    pauseAt(500)
    expect(cap.pb.playback.status).toBe('paused')
    act(() => {
      cap.pb.seek(100)
    })
    await settle()
    expect(cap.pb.playback.status).toBe('paused')
    expect(cap.pb.playback.position).toBe(100)
    // 前提: 控えを外す記録（書込）が起きていない。
    expect(readRecord('u-a', 'a')).toEqual({ position: 500, recorded_at: newer, synced: true })

    let result: unknown
    await act(async () => {
      result = cap.pb.requestResume()
    })

    expect(result).toEqual({ kind: 'resumed' })
    expect(cap.pb.playback.status).toBe('playing')
  })

  test('web-dec-165: 一時停止中の別の episode の取り込みは控えず、その episode を後で開いても尋ねない', async () => {
    render(<Harness />)
    const gate = holdFirstPatch('b')
    await startAndPlay('b')
    pauseAt(40)
    await waitFor(() => expect(patchesTo('b')).toHaveLength(1))

    await startAndPlay('a')
    pauseAt(10)
    expect(cap.pb.nowPlaying()?.episodeId).toBe('a')
    expect(cap.pb.playback.status).toBe('paused')

    const newer = Date.now() + 60_000
    await gate.release(patchResult('b', 300, new Date(newer).toISOString()))
    await waitFor(() => expect(readRecord('u-a', 'b')).toEqual({ position: 300, recorded_at: newer, synced: true }))

    // b を開始（端末の 300 から）→ 開始位置のまま pause → paused のまま seek(100)。
    await startAndPlay('b')
    expect(cap.pb.playback.position).toBe(300)
    pauseAt(300)
    act(() => {
      cap.pb.seek(100)
    })
    await settle()
    expect(cap.pb.playback.status).toBe('paused')
    expect(cap.pb.playback.position).toBe(100)
    // 前提: 書込は起きていない。
    expect(readRecord('u-a', 'b')).toEqual({ position: 300, recorded_at: newer, synced: true })

    let result: unknown
    await act(async () => {
      result = cap.pb.requestResume()
    })

    expect(result).toEqual({ kind: 'resumed' })
    expect(cap.pb.playback.status).toBe('playing')
  })

  test('web-dec-165 / shared-sync-10: 一時停止中の episode の取り込みで控えができ、requestResume が choose を返す（bar を通さない）', async () => {
    render(<Harness />)
    const newer = await adoptRemoteWhilePaused()
    expect(readRecord('u-a', 'a')).toEqual({ position: 500, recorded_at: newer, synced: true })

    let result: unknown
    await act(async () => {
      result = cap.pb.requestResume()
    })

    expect(result).toEqual({ kind: 'choose', remoteSeconds: 500, localSeconds: 100 })
    expect(cap.pb.playback.status).toBe('paused')
  })
})
