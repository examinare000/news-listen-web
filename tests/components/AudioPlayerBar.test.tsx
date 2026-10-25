import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AudioPlayerBar } from '@/components/AudioPlayerBar'
import { AppProvider, useApp } from '@/contexts/AppContext'
import { formatDate } from '@/lib/format'

// 再生バーは usePlayback / usePlaybackActions の値を表示し、操作を委譲するだけ。
// 値の導出（題の切り詰め・総時間の代替・主操作の分岐表）は application の読み取りモデルが持つので、ここでは与えた値が見えること・
// 操作が正しい委譲先に届くことを固定する。失敗の toast は PlaybackToasts.test.tsx、Provider を通した振る舞いは PlaybackProvider.*.test.tsx が持つ。

const double = vi.hoisted(() => ({
  pb: {},
  actions: {},
}))

vi.mock('@/contexts/PlaybackProvider', () => ({ usePlayback: () => double.pb }))
vi.mock('@/components/PlaybackToasts', () => ({ usePlaybackActions: () => double.actions }))

interface NowPlayingValue {
  episodeId: string
  title: string
  difficulty: string | null
  createdAt: string | null
  durationSeconds: number | null
}

interface PlaybackValue {
  status: string
  position: number
  duration: number
  speed: number
  primaryAction: 'play' | 'pause' | 'retry' | 'replay' | 'none'
  failure: 'media' | 'unavailable' | null
}

const CREATED_AT = '2026-06-10T00:00:00+00:00'

const NOW_PLAYING: NowPlayingValue = {
  episodeId: 'p1',
  title: '今日のニュース',
  difficulty: 'toeic_900',
  createdAt: CREATED_AT,
  durationSeconds: 300,
}

const UP_NEXT = [
  { id: 'q1', title: 'First' },
  { id: 'q2', title: 'Second' },
  { id: 'q3', title: 'Third' },
]

interface Setup {
  nowPlaying?: NowPlayingValue | null
  playback?: Partial<PlaybackValue>
  upNext?: ReadonlyArray<{ id: string; title: string }>
  volume?: number
}

let fns: ReturnType<typeof install>

function install(setup: Setup = {}) {
  const nowPlaying = setup.nowPlaying === undefined ? NOW_PLAYING : setup.nowPlaying
  const upNext = setup.upNext ?? []
  const playback: PlaybackValue = {
    status: 'paused',
    position: 0,
    duration: 300,
    speed: 1,
    primaryAction: 'play',
    failure: null,
    ...setup.playback,
  }
  const calls = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    seekRelative: vi.fn(),
    setSpeed: vi.fn(),
    setVolume: vi.fn(),
    reorder: vi.fn(),
    removeFromQueue: vi.fn(),
    startEpisode: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(async () => undefined),
    skipToNext: vi.fn(async () => ({ ok: true })),
  }
  double.pb = {
    nowPlaying: () => nowPlaying,
    queueView: () => ({ nowPlaying, upNext, canSkipNext: upNext.length > 0 }),
    playback,
    volume: setup.volume ?? 1,
    play: calls.play,
    pause: calls.pause,
    seek: calls.seek,
    seekRelative: calls.seekRelative,
    setSpeed: calls.setSpeed,
    setVolume: calls.setVolume,
    reorder: calls.reorder,
    removeFromQueue: calls.removeFromQueue,
  }
  double.actions = { startEpisode: calls.startEpisode, retry: calls.retry, skipToNext: calls.skipToNext }
  return calls
}

function DefaultSpeedProbe() {
  return <output data-testid="default-speed">{useApp().state.playbackSpeed}</output>
}

function renderBar(setup: Setup = {}, defaultSpeed = 1.5) {
  fns = install(setup)
  return render(
    <AppProvider initialState={{ playbackSpeed: defaultSpeed }}>
      <AudioPlayerBar />
      <DefaultSpeedProbe />
    </AppProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  double.pb = {}
  double.actions = {}
})

// ==========================================================
// 非表示条件
// ==========================================================
describe('AudioPlayerBar visibility', () => {
  test('nowPlaying() が null なら何も描かない (verifies: CI-P4-24)', () => {
    const { container } = renderBar({ nowPlaying: null })

    expect(screen.queryByTestId('audio-player-bar')).not.toBeInTheDocument()
    expect(container.querySelector('.player-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: /再生|一時停止/ })).not.toBeInTheDocument()
  })

  test('nowPlaying() があれば再生バーを描く (verifies: CI-P4-24)', () => {
    renderBar()

    expect(screen.getByRole('contentinfo', { name: 'プレイヤー' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument()
  })
})

// ==========================================================
// コンテンツ表示
// ==========================================================
describe('AudioPlayerBar content', () => {
  test('題は nowPlaying().title をそのまま出す (切り詰めは読み取りモデルの責務) (verifies: CI-P4-25)', () => {
    const title = 'あ'.repeat(50)
    renderBar({ nowPlaying: { ...NOW_PLAYING, title } })

    expect(screen.getByText(title)).toBeInTheDocument()
  })

  test('難易度と日付が揃っていれば、難易度のバッジと日付を出す (verifies: CI-P4-25)', () => {
    renderBar()

    expect(screen.getByText('TOEIC 900')).toBeInTheDocument()
    expect(screen.getByText(formatDate(CREATED_AT))).toBeInTheDocument()
  })

  test('難易度・日付・総時間が null (解決の前に失敗した errored) なら、バッジも日付も出さず、題と再試行のボタンだけ見える (verifies: CI-P4-25, CI-P4-26; web-dec-38)', () => {
    renderBar({
      nowPlaying: { ...NOW_PLAYING, title: '次の回', difficulty: null, createdAt: null, durationSeconds: null },
      playback: { status: 'errored', duration: 0, primaryAction: 'retry', failure: 'unavailable' },
    })

    const bar = screen.getByTestId('audio-player-bar')
    expect(within(bar).getByText('次の回')).toBeInTheDocument()
    expect(within(bar).queryByText(/TOEIC|IELTS|英検/)).not.toBeInTheDocument()
    expect(bar.querySelector('.player-subtitle')?.textContent).toBe('')
    expect(within(bar).getByRole('button', { name: '再生' })).toBeInTheDocument()
  })

  test.each([
    ['総時間は playback.duration', { duration: 125 }, 300, '2:05', 125],
    ['playback.duration が 0 なら nowPlaying().durationSeconds', { duration: 0 }, 300, '5:00', 300],
    ['どちらも無ければ 0', { duration: 0 }, null, '0:00', 0],
  ] as const)('%s (verifies: CI-P4-25)', (_name, playback, durationSeconds, total, max) => {
    renderBar({ nowPlaying: { ...NOW_PLAYING, durationSeconds }, playback })

    const seek = screen.getByRole('slider', { name: 'シーク' })
    expect(seek).toHaveAttribute('max', String(max))
    expect(screen.getAllByText(total).length).toBeGreaterThanOrEqual(1)
  })

  test('経過時間は playback.position を M:SS で出す (verifies: CI-P4-25)', () => {
    renderBar({ playback: { position: 125 } })

    expect(screen.getByText('2:05')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'シーク' })).toHaveValue('125')
  })
})

// ==========================================================
// 主ボタン（primaryAction で分岐する）
// ==========================================================
describe('Primary button', () => {
  const rows = [
    ['pause', 'playing', '一時停止', 'pause'],
    ['play', 'paused', '再生', 'play'],
    ['retry', 'errored', '再生', 'retry'],
    ['replay', 'ended', '再生', 'startEpisode'],
    ['none', 'loading', '再生', null],
  ] as const

  test.each(rows)(
    'primaryAction=%s (status=%s) のボタンは「%s」で、押すと %s だけを呼ぶ (verifies: CI-P4-26, CI-P4-51; web-deriv-14)',
    async (primaryAction, status, label, expected) => {
      renderBar({ playback: { status, primaryAction } })

      await userEvent.click(screen.getByRole('button', { name: label }))

      const all = ['play', 'pause', 'retry', 'startEpisode'] as const
      for (const name of all) {
        if (name === expected) expect(fns[name]).toHaveBeenCalledTimes(1)
        else expect(fns[name]).not.toHaveBeenCalled()
      }
      if (expected === 'startEpisode') expect(fns.startEpisode).toHaveBeenCalledWith('p1')
    },
  )

  test('一時停止中の「再生」は play() を呼ぶだけで、再生元の解決 (startEpisode) をやり直さない (verifies: CI-P4-26)', async () => {
    renderBar({ playback: { status: 'paused', primaryAction: 'play', position: 120 } })

    await userEvent.click(screen.getByRole('button', { name: '再生' }))

    expect(fns.play).toHaveBeenCalledTimes(1)
    expect(fns.startEpisode).not.toHaveBeenCalled()
  })

  test.each([
    ['playing', 'pause', 'running'],
    ['paused', 'play', 'paused'],
    ['loading', 'none', 'paused'],
    ['errored', 'retry', 'paused'],
    ['ended', 'replay', 'paused'],
  ] as const)('status=%s の波形は %s (verifies: CI-P4-26)', (status, primaryAction, state) => {
    const { container } = renderBar({ playback: { status, primaryAction } })

    const bars = container.querySelectorAll('.player-art-waveform .player-art-bar')
    expect(bars).toHaveLength(5)
    bars.forEach((bar) => {
      expect((bar as HTMLElement).style.animationPlayState).toBe(state)
    })
  })
})

// ==========================================================
// シーク操作
// ==========================================================
describe('Seek controls', () => {
  test('-15 秒・+30 秒のボタンは seekRelative を呼ぶ', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: /-15|15秒戻/ }))
    await userEvent.click(screen.getByRole('button', { name: /\+30|30秒進/ }))

    expect(fns.seekRelative.mock.calls).toEqual([[-15], [30]])
  })

  test('シークバーを動かすと seek を呼ぶ', () => {
    renderBar({ playback: { position: 10 } })
    const seekSlider = screen.getByRole('slider', { name: 'シーク' })
    expect(seekSlider).toHaveAttribute('type', 'range')

    fireEvent.change(seekSlider, { target: { value: '90' } })

    expect(fns.seek).toHaveBeenCalledWith(90)
  })

  test.each([
    ['位置 60・総時間 240 なら 25%', { position: 60, duration: 240 }, '25%'],
    ['総時間 0 (未読込) ならゼロ除算せず 0%', { position: 0, duration: 0 }, '0%'],
    ['位置が総時間を超えても 100% で止まる', { position: 150, duration: 100 }, '100%'],
  ] as const)('シークバーの塗り: %s', (_name, playback, fill) => {
    renderBar({ playback })

    expect(screen.getByRole('slider', { name: 'シーク' }).style.getPropertyValue('--seek-fill')).toBe(fill)
  })
})

// ==========================================================
// 音量
// ==========================================================
describe('Volume slider', () => {
  test('0 から 100 の範囲で、値は volume を 100 倍して丸めたもの (verifies: CI-P4-28)', () => {
    renderBar({ volume: 0.6 })

    const volumeSlider = screen.getByRole('slider', { name: '音量' })
    expect(volumeSlider).toHaveAttribute('type', 'range')
    expect(volumeSlider).toHaveAttribute('min', '0')
    expect(volumeSlider).toHaveAttribute('max', '100')
    expect(volumeSlider).toHaveValue('60')
    expect(volumeSlider.style.getPropertyValue('--seek-fill')).toBe('')
  })

  test.each([
    ['50', 0.5],
    ['0', 0],
    ['100', 1],
  ])('スライダーを %s にすると setVolume(%s) を呼ぶ (verifies: CI-P4-28)', (value, expected) => {
    renderBar({ volume: 0.3 })

    fireEvent.change(screen.getByRole('slider', { name: '音量' }), { target: { value } })

    expect(fns.setVolume).toHaveBeenCalledWith(expected)
  })
})

// ==========================================================
// 速度（shared-session-10）
// ==========================================================
describe('Speed selector', () => {
  test('8 段の選択肢を出し、値は既定速度でなく playback.speed (verifies: CI-P4-27; shared-session-10)', () => {
    renderBar({ playback: { speed: 2 } }, 1.5)

    const speedSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: '速度' })
    expect(within(speedSelect).getAllByRole('option')).toHaveLength(8)
    expect(Number(speedSelect.value)).toBe(2)
  })

  test('変更すると setSpeed(数値) を呼び、既定速度 (AppContext.playbackSpeed) は書き換えない (verifies: CI-P4-27, CI-P4-45; shared-session-10)', async () => {
    renderBar({ playback: { speed: 2 } }, 1.5)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '速度' }), '1.25')

    expect(fns.setSpeed).toHaveBeenCalledTimes(1)
    expect(fns.setSpeed).toHaveBeenCalledWith(1.25)
    expect(screen.getByTestId('default-speed')).toHaveTextContent('1.5')
  })

  test('既定速度が変わっても、バーは再生中の回の速度に何も流さない (verifies: CI-P4-27; shared-session-10)', () => {
    renderBar({ playback: { speed: 2 } }, 1.5)

    expect(fns.setSpeed).not.toHaveBeenCalled()
  })
})

// ==========================================================
// 次へ・再生待ち
// ==========================================================
describe('Up next', () => {
  test('canSkipNext が false なら「次へ」を出さない (verifies: CI-P4-29)', () => {
    renderBar({ upNext: [] })

    expect(screen.queryByRole('button', { name: '次のエピソードへ' })).not.toBeInTheDocument()
  })

  test('canSkipNext が true なら「次へ」を出し、押すと skipToNext を呼ぶ (verifies: CI-P4-29)', async () => {
    renderBar({ upNext: UP_NEXT })

    await userEvent.click(screen.getByRole('button', { name: '次のエピソードへ' }))

    expect(fns.skipToNext).toHaveBeenCalledTimes(1)
  })

  test('プレイリストの件数と、各題 (そのまま) を出す (verifies: CI-P4-29)', async () => {
    renderBar({ upNext: UP_NEXT })
    const toggle = screen.getByRole('button', { name: 'プレイリスト' })
    expect(toggle).toHaveTextContent('3')

    await userEvent.click(toggle)

    const panel = screen.getByRole('region', { name: 'プレイリスト' })
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent?.replace(/[↑↓✕]/g, ''))).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  test('再生待ちが無ければ空の表示 (verifies: CI-P4-29)', async () => {
    renderBar({ upNext: [] })

    await userEvent.click(screen.getByRole('button', { name: 'プレイリスト' }))

    expect(screen.getByText('再生待ちはありません')).toBeInTheDocument()
  })

  test('↑ は reorder(i, i-1)、↓ は reorder(i, i+2)、✕ は removeFromQueue(id) を呼ぶ (verifies: CI-P4-29; 削除前オフセットの意味論)', async () => {
    renderBar({ upNext: UP_NEXT })
    await userEvent.click(screen.getByRole('button', { name: 'プレイリスト' }))

    await userEvent.click(screen.getAllByRole('button', { name: '上へ' })[1])
    await userEvent.click(screen.getAllByRole('button', { name: '下へ' })[0])
    await userEvent.click(screen.getAllByRole('button', { name: 'キューから削除' })[2])

    expect(fns.reorder.mock.calls).toEqual([
      [1, 0],
      [0, 2],
    ])
    expect(fns.removeFromQueue).toHaveBeenCalledWith('q3')
  })

  test('先頭の ↑ と末尾の ↓ は押せない (verifies: CI-P4-29)', async () => {
    renderBar({ upNext: UP_NEXT })
    await userEvent.click(screen.getByRole('button', { name: 'プレイリスト' }))

    expect(screen.getAllByRole('button', { name: '上へ' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '下へ' })[2]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '上へ' })[1]).toBeEnabled()
  })
})
