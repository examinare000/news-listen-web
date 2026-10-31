import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import React, { useEffect } from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { podcastPositionKey } from '@/lib/config'
import { MockAudio } from '../helpers/mockAudio'
import { setupMockCaches } from '../helpers/mockCaches'
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

// 実の PlaybackProvider が組む保存庫（Cache Storage・Object URL・fetch）を、test-local の差し替えで動かす結合テスト。
// 保存済みの回は gateway を引かず、Object URL の音源で再生する。旧 AudioPlayerContext.offline の観点を新しい入口に対して固定する。

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

let cap: ReturnType<typeof usePlayback>

function Capture() {
  const pb = usePlayback()
  useEffect(() => {
    cap = pb
  })
  return null
}

let gateway: GatewayDouble
let audio: TestAudio
let fetchMock: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>

const urlDescriptors = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
}

function restoreUrl(name: 'createObjectURL' | 'revokeObjectURL'): void {
  const original = urlDescriptors[name]
  if (original === undefined) {
    delete (URL as unknown as Record<string, unknown>)[name]
  } else {
    Object.defineProperty(URL, name, original)
  }
}

function renderProvider() {
  return render(
    <PreferencesProvider store={memoryStore()}>
      <ToastProvider>
        <ApiClientProvider gateway={gateway}>
          <PlaybackProvider>
            <Capture />
          </PlaybackProvider>
        </ApiClientProvider>
      </ToastProvider>
    </PreferencesProvider>,
  )
}

async function saveA(): Promise<void> {
  await act(async () => {
    expect(await cap.offline.save('a')).toEqual({ ok: true, value: undefined })
  })
  await act(async () => {
    expect(await cap.offline.has('a')).toBe(true)
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
  // Cache Storage は Provider の生成のときに見られるので、描画の前に差し替える。
  setupMockCaches()
  // 実の cacheStore は音声を global の fetch で取る。stub しないと外へ通信しうる。
  fetchMock = vi.fn(async () => new Response('audio-bytes'))
  vi.stubGlobal('fetch', fetchMock)
  createObjectURL = vi.fn(() => 'blob:test/a')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
  gateway = createGatewayDouble()
  gateway.respond('GET', '/api/backend/podcasts/a', { ok: true, value: pod('a', { playback_position_seconds: 0 }) })
  gateway.respond('PATCH', '/api/backend/podcasts/a/position', { ok: true, value: undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  restoreUrl('createObjectURL')
  restoreUrl('revokeObjectURL')
  localStorage.clear()
})

describe('PlaybackProvider のオフライン', () => {
  test('オフラインで未保存の回を開始すると offline_uncached を返し、取得も再生もしない (verifies: CI-P4-17; T-P4-16, web-dec-11)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderProvider()

    await act(async () => {
      expect(await cap.startEpisode('a')).toEqual({ ok: false, notice: 'offline_uncached' })
    })

    expect(gateway.calls).toEqual([])
    expect(audio.src).toBe('')
    expect(cap.playback.status).toBe('idle')
  })

  test('保存済みの回の開始は gateway も fetch も引かず、Object URL の音源で再生に進む (verifies: CI-P4-52; T-P4-16)', async () => {
    renderProvider()
    await saveA()
    const gatewayAfterSave = gateway.calls.length
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      expect(await cap.startEpisode('a')).toEqual({ ok: true })
    })
    await act(async () => {
      audio.fireLoadedMetadata(60)
    })

    expect(gateway.calls.length - gatewayAfterSave).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe('blob:test/a')
    expect(cap.playback.status).toBe('playing')
  })

  test('保存済みで、オフラインでも開始できる (verifies: CI-P4-17, CI-P4-52; T-P4-16)', async () => {
    renderProvider()
    await saveA()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await act(async () => {
      expect(await cap.startEpisode('a')).toEqual({ ok: true })
    })

    expect(audio.src).toBe('blob:test/a')
  })

  test.each([
    ['42', 42],
    ['0', null],
    ['-3', null],
    ['x', null],
    [null, null],
  ])('savedPosition は端末の保存値 %s を %s として返す (verifies: CI-P4-18; T-P4-16)', (stored, expected) => {
    if (stored !== null) localStorage.setItem(podcastPositionKey('a'), stored)

    renderProvider()

    expect(cap.savedPosition('a')).toBe(expected)
  })

  test('save の後の offline.list は、その回の 1 件を返す (verifies: CI-P4-18, CI-P4-52; T-P4-16)', async () => {
    renderProvider()
    await saveA()

    await act(async () => {
      expect(await cap.offline.list()).toMatchObject([{ episodeId: 'a', title: 'intro a', durationSeconds: 60 }])
    })
  })
})

describe('末尾 2 秒窓の resume (shared-dec-27)', () => {
  test.each([
    ['総時間 − 1', '59', 0],
    ['総時間 − 2', '58', 0],
    ['総時間 − 3', '57', 57],
  ])('端末の位置が %s (%s) なら再生位置は %s (verifies: CI-P4-46; T-P4-17, shared-resume-03, shared-resume-04, shared-resume-05)', async (_name, stored, expected) => {
    renderProvider()
    await saveA()
    localStorage.setItem(podcastPositionKey('a'), stored)

    await act(async () => {
      await cap.startEpisode('a')
    })
    await act(async () => {
      audio.fireLoadedMetadata(60)
    })

    expect(audio.currentTime).toBe(expected)
  })
})
