import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import React from 'react'
import { PlaybackErrorToaster, usePlaybackActions } from '@/components/PlaybackToasts'
import { ToastProvider } from '@/components/ui/Toast'

// 再生の知らせを toast に写す部品の契約。usePlayback は double にし、失敗の値の変化と各操作の結果だけを与える。

const double = vi.hoisted(() => ({ value: {} }))

vi.mock('@/contexts/PlaybackProvider', () => ({
  usePlayback: () => double.value,
}))

type Failure = 'media' | 'unavailable' | null

const MEDIA = '音声を再生できません'
const UNAVAILABLE = '再生できませんでした'
const OFFLINE = 'オフラインのため再生できません'

function playbackDouble(failure: Failure) {
  return { playback: { status: failure === null ? 'loading' : 'errored', failure } }
}

function renderToaster(failure: Failure) {
  const tree = (f: Failure) => {
    double.value = playbackDouble(f)
    return (
      <ToastProvider>
        <PlaybackErrorToaster />
      </ToastProvider>
    )
  }
  const view = render(tree(failure))
  return {
    container: view.container,
    // 値の変更は 1 つずつ別の act (rerender) で行い、null の描画をまとめない。
    change: (next: Failure) => view.rerender(tree(next)),
  }
}

beforeEach(() => {
  double.value = {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlaybackErrorToaster', () => {
  test('failure が null から値に変わったときだけ toast を 1 回出す。errored のままの再描画や、値から別の値への変化では出さない (verifies: CI-P4-20, CI-P4-21; T-P4-23, web-dec-09)', () => {
    const toaster = renderToaster(null)
    // 部品自身は何も描かない（描画されるのは ToastProvider の空の toast 領域だけ）。
    expect(toaster.container.querySelectorAll('*')).toHaveLength(1)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)

    const steps: ReadonlyArray<readonly [Failure, ReadonlyArray<string>]> = [
      ['media', [MEDIA]],
      ['media', [MEDIA]],
      ['unavailable', [MEDIA]],
      [null, [MEDIA]],
      ['unavailable', [MEDIA, UNAVAILABLE]],
      ['unavailable', [MEDIA, UNAVAILABLE]],
      ['media', [MEDIA, UNAVAILABLE]],
    ]
    for (const [failure, shown] of steps) {
      toaster.change(failure)
      const alerts = screen.queryAllByRole('alert')
      expect(alerts.map((alert) => alert.textContent?.replace(/^!/, ''))).toEqual([...shown])
    }
  })
})

describe('usePlaybackActions: 開始系 4 操作の結果を toast に写す', () => {
  const input = { id: 'a', title: 'Title a', intro: 'intro a' }
  const operations: ReadonlyArray<
    readonly [string, (actions: ReturnType<typeof usePlaybackActions>) => Promise<unknown>, ReadonlyArray<unknown>]
  > = [
    ['startEpisode', (actions) => actions.startEpisode('a'), ['a']],
    ['addToQueue', (actions) => actions.addToQueue(input), [input]],
    ['playNext', (actions) => actions.playNext(input), [input]],
    ['skipToNext', (actions) => actions.skipToNext(), []],
  ]
  const results = [
    [{ ok: false, notice: 'offline_uncached' }, OFFLINE],
    [{ ok: false, notice: 'not_playable' }, UNAVAILABLE],
    [{ ok: false, notice: 'fetch_failed' }, UNAVAILABLE],
    [{ ok: true }, null],
  ] as const

  let actions: ReturnType<typeof usePlaybackActions>

  function Probe() {
    actions = usePlaybackActions()
    return null
  }

  test.each(operations.flatMap(([name, call, args]) => results.map(([result, text]) => [name, call, args, result, text] as const)))(
    '%s が %j を返すと、結果はそのまま返り、toast は %s (verifies: CI-P4-22; T-P4-24, web-dec-11)',
    async (name, call, args, result, text) => {
      const command = vi.fn(async () => result)
      double.value = { ...playbackDouble(null), [name]: command }
      render(
        <ToastProvider>
          <Probe />
        </ToastProvider>,
      )

      let returned: unknown
      await act(async () => {
        returned = await call(actions)
      })

      expect(returned).toEqual(result)
      expect(command).toHaveBeenCalledWith(...args)
      const alerts = screen.queryAllByRole('alert')
      if (text === null) {
        expect(alerts).toHaveLength(0)
      } else {
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toHaveTextContent(text)
      }
    },
  )
})

describe('usePlaybackActions: retry の再失敗 (web-dec-37)', () => {
  let actions: ReturnType<typeof usePlaybackActions>

  function Probe() {
    actions = usePlaybackActions()
    return null
  }

  // retry の中で状態が変わる。await の後に同期の query を読まないと、古い値を見て間違える。
  test.each([
    ['errored/unavailable', { status: 'errored', failure: 'unavailable' }, UNAVAILABLE],
    ['errored/media', { status: 'errored', failure: 'media' }, MEDIA],
    ['playing', { status: 'playing', failure: null }, null],
    ['loading', { status: 'loading', failure: null }, null],
  ] as const)('retry の後の playbackView() が %s なら、toast は %s (verifies: CI-P4-23; T-P4-25, web-dec-37)', async (_name, after, text) => {
    let view: unknown = { status: 'playing', failure: null }
    const retry = vi.fn(async () => {
      view = after
    })
    double.value = { ...playbackDouble(null), retry, playbackView: () => view }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    )

    await act(async () => {
      await actions.retry()
    })

    expect(retry).toHaveBeenCalledTimes(1)
    const alerts = screen.queryAllByRole('alert')
    if (text === null) {
      expect(alerts).toHaveLength(0)
    } else {
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent(text)
    }
  })
})
