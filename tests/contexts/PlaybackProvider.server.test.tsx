// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { AppProvider } from '@/contexts/AppContext'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { PlaybackProvider, usePlayback } from '@/contexts/PlaybackProvider'
import { ToastProvider } from '@/components/ui/Toast'

// server render（window が無い）の Provider。配線を組まず、query は idle の値、操作は決まった Error を投げる stub になる (web-dec-36)。
// jsdom の renderToString (tests/app/layout.test.tsx) は window があり client の分岐を通るので、stub はここでだけ検査される。

const SERVER_ERROR = 'PlaybackProvider is not available during server rendering'

type Playback = ReturnType<typeof usePlayback>

// server の stub は、呼ばれたら決まった Error を投げる。描画の中で呼んで、投げられた文言を出力に含める。
const OPERATIONS: Readonly<Record<string, (pb: Playback) => unknown>> = {
  startEpisode: (pb) => pb.startEpisode('a'),
  retry: (pb) => pb.retry(),
  addToQueue: (pb) => pb.addToQueue({ id: 'a', title: null, intro: '' }),
  playNext: (pb) => pb.playNext({ id: 'a', title: null, intro: '' }),
  removeFromQueue: (pb) => pb.removeFromQueue('a'),
  reorder: (pb) => pb.reorder(0, 1),
  skipToNext: (pb) => pb.skipToNext(),
  play: (pb) => pb.play(),
  pause: (pb) => pb.pause(),
  seek: (pb) => pb.seek(1),
  seekRelative: (pb) => pb.seekRelative(1),
  setSpeed: (pb) => pb.setSpeed(1.5),
  setVolume: (pb) => pb.setVolume(0.5),
  'offline.save': (pb) => pb.offline.save('a'),
  'offline.get': (pb) => pb.offline.get('a'),
  'offline.has': (pb) => pb.offline.has('a'),
  'offline.remove': (pb) => pb.offline.remove('a'),
  'offline.clear': (pb) => pb.offline.clear(),
  'offline.list': (pb) => pb.offline.list(),
  'offline.usage': (pb) => pb.offline.usage(),
}

function thrownMessage(call: () => unknown): string | null {
  try {
    call()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function Consumer() {
  const pb = usePlayback()
  return (
    <pre>
      {JSON.stringify({
        nowPlaying: pb.nowPlaying(),
        upNext: pb.upNext(),
        queueView: pb.queueView(),
        playbackView: pb.playbackView(),
        playback: pb.playback,
        savedPosition: pb.savedPosition('a'),
        volume: pb.volume,
        thrown: Object.fromEntries(Object.entries(OPERATIONS).map(([name, call]) => [name, thrownMessage(() => call(pb))])),
      })}
    </pre>
  )
}

function renderOnServer(playbackSpeed = 1.0): string {
  return renderToString(
    <AppProvider initialState={{ playbackSpeed }}>
      <ToastProvider>
        <ApiClientProvider>
          <PlaybackProvider>
            <Consumer />
          </PlaybackProvider>
        </ApiClientProvider>
      </ToastProvider>
    </AppProvider>,
  )
}

function decode(html: string): Record<string, unknown> {
  const match = /<pre>([\s\S]*?)<\/pre>/.exec(html)
  expect(match).not.toBeNull()
  return JSON.parse((match as RegExpExecArray)[1].replace(/&quot;/g, '"')) as Record<string, unknown>
}

const IDLE_VIEW = { status: 'idle', position: 0, duration: 0, speed: 1.5, primaryAction: 'none', failure: null }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlaybackProvider の server render', () => {
  test('window が無い環境で Audio を呼ばずに描画でき、query は idle の値を返す (verifies: CI-P4-12; T-P4-22, web-dec-36)', () => {
    expect(typeof window).toBe('undefined')
    const AudioSpy = vi.fn()
    vi.stubGlobal('Audio', AudioSpy)

    const html = renderOnServer(1.5)

    expect(AudioSpy).not.toHaveBeenCalled()
    expect(decode(html)).toMatchObject({
      nowPlaying: null,
      upNext: [],
      queueView: { nowPlaying: null, upNext: [], canSkipNext: false },
      playbackView: IDLE_VIEW,
      playback: IDLE_VIEW,
      savedPosition: null,
      volume: 1,
    })
  })

  test('既定速度が 8 段に無い値なら、表示速度は 1.0 に狭められる (verifies: CI-P4-12, CI-P4-15; T-P4-22, web-dec-35)', () => {
    const html = renderOnServer(1.1)

    expect(decode(html)).toMatchObject({ playback: { speed: 1 }, playbackView: { speed: 1 } })
  })

  test.each(Object.keys(OPERATIONS))('%s を呼ぶと決まった文言の Error を投げる (verifies: CI-P4-12; T-P4-22)', (name) => {
    const { thrown } = decode(renderOnServer()) as { thrown: Record<string, string | null> }

    expect(thrown[name]).toBe(SERVER_ERROR)
  })
})
