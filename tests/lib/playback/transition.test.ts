// transition（domain の純関数）の表駆動テスト: 状態 6 × 入力 13 の 78 セル（web-rule-playback-01）。
// 分類: 既存 Spec §3.1 の 13 遷移（T1〜T13）／表の外の start・stop・fail／状態の種類を変えない値の更新／no-op（web-contract-01）。
// RED 理由（実装前）: transition が `@/lib/playback/domain/session` から export されていない。
import { describe, expect, test } from 'vitest'
import { transition } from '@/lib/playback/domain/session'
import type {
  AudioCommand,
  AudioHandle,
  EpisodeRef,
  PlayableEpisode,
  PlaybackErrorReason,
  PlaybackEvent,
  PlaybackInput,
  PlaybackSpeed,
  PlaybackState,
  Transition,
} from '@/lib/playback/domain/session'

// --- fixture（各層を Object.freeze する。audioHandle の先だけ凍結しない） ---
const H1: AudioHandle = { release: () => {} }
const H2: AudioHandle = { release: () => {} }

const E1: PlayableEpisode = Object.freeze({
  kind: 'playable',
  id: 'e1',
  title: 't',
  label: { title: 't', intro: 'i-e1' },
  audioUrl: 'u-e1',
  durationSeconds: 100,
  difficulty: 'toeic_600',
  createdAt: '',
  serverPositionSeconds: 0,
  audioHandle: H1,
})
const E2: PlayableEpisode = Object.freeze({
  kind: 'playable',
  id: 'e2',
  title: 't',
  label: { title: 't', intro: 'i-e2' },
  audioUrl: 'u-e2',
  durationSeconds: 100,
  difficulty: 'toeic_600',
  createdAt: '',
  serverPositionSeconds: 0,
  audioHandle: H2,
})

const SPEED: PlaybackSpeed = 1.25

const IDLE: PlaybackState = Object.freeze({ status: 'idle' })
const LOADING: PlaybackState = Object.freeze({ status: 'loading', episode: E1, resumePosition: 10, speed: SPEED })
const pausedAt = (position: number): PlaybackState =>
  Object.freeze({ status: 'paused', episode: E1, position, duration: 100, speed: SPEED })
const playingAt = (position: number): PlaybackState =>
  Object.freeze({ status: 'playing', episode: E1, position, duration: 100, speed: SPEED })
const ERRORED: PlaybackState = Object.freeze({
  status: 'errored',
  episode: E1,
  position: 10,
  speed: SPEED,
  reason: Object.freeze({ kind: 'media' }),
})
const ENDED: PlaybackState = Object.freeze({ status: 'ended', episode: E1, duration: 100 })

const STATES = {
  idle: IDLE,
  loading: LOADING,
  paused: pausedAt(10),
  playing: playingAt(10),
  ended: ENDED,
  errored: ERRORED,
} as const satisfies Record<string, PlaybackState>

const FAIL_REF: EpisodeRef = Object.freeze({ id: 'e3' })
const FAIL_REASON: Extract<PlaybackErrorReason, { readonly kind: 'source_unavailable' }> = Object.freeze({
  kind: 'source_unavailable',
})

const INPUTS = {
  start: { type: 'start', episode: E2, resumePosition: 5, speed: 1.5, currentTime: 12 },
  play: { type: 'play' },
  pause: { type: 'pause', currentTime: 12 },
  seek: { type: 'seek', seconds: 30 },
  seekRelative: { type: 'seekRelative', deltaSeconds: 5 },
  setSpeed: { type: 'setSpeed', speed: 1.5 },
  stop: { type: 'stop' },
  fail: { type: 'fail', ref: FAIL_REF, reason: FAIL_REASON },
  loadedmetadata: { type: 'loadedmetadata', duration: 100 },
  timeupdate: { type: 'timeupdate', currentTime: 12 },
  ended: { type: 'ended' },
  error: { type: 'error', currentTime: 12 },
  playRejected: { type: 'playRejected', autoplayBlocked: true, currentTime: 12 },
} as const satisfies Record<string, PlaybackInput>

type StateName = keyof typeof STATES
type InputName = keyof typeof INPUTS
type Kind =
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12' | 'T13'
  | 'outside' | 'value' | 'noop'

interface Expected {
  readonly state: PlaybackState
  readonly commands: ReadonlyArray<AudioCommand>
  readonly events: ReadonlyArray<PlaybackEvent>
  readonly prelude?: Expected
}

const stateChanged = (state: PlaybackState): PlaybackEvent => ({ type: 'stateChanged', state })
const positionChanged = (seconds: number): PlaybackEvent => ({ type: 'positionChanged', episodeId: 'e1', seconds })

/** start の本体: load と（前の音源があれば）その解放、loading への遷移。 */
const startBody = (releases: boolean): Expected => {
  const loading: PlaybackState = { status: 'loading', episode: E2, resumePosition: 5, speed: 1.5 }
  return {
    state: loading,
    commands: [
      { type: 'load', src: 'u-e2', resumePosition: 5, speed: 1.5 },
      ...(releases ? ([{ type: 'releaseHandle', handle: H1 }] as const) : []),
    ],
    events: [stateChanged(loading)],
  }
}

const stopped: Expected = {
  state: { status: 'idle' },
  commands: [{ type: 'unload' }, { type: 'releaseHandle', handle: H1 }],
  events: [stateChanged({ status: 'idle' })],
}

const failedFrom = (speed: PlaybackSpeed, commands: ReadonlyArray<AudioCommand>): Expected => {
  const errored: PlaybackState = {
    status: 'errored',
    episode: { id: 'e3' },
    position: 0,
    speed,
    reason: { kind: 'source_unavailable' },
  }
  return { state: errored, commands, events: [stateChanged(errored)] }
}
const failDetach: ReadonlyArray<AudioCommand> = [{ type: 'unload' }, { type: 'releaseHandle', handle: H1 }]

const seekedTo = (status: 'paused' | 'playing', position: number): Expected => {
  const next: PlaybackState = { status, episode: E1, position, duration: 100, speed: SPEED }
  return { state: next, commands: [{ type: 'seek', seconds: position }], events: [stateChanged(next), positionChanged(position)] }
}

const speedChanged = (state: PlaybackState): Expected => {
  if (state.status === 'idle' || state.status === 'ended') throw new Error('setSpeed の値の更新セルではない')
  const next: PlaybackState = { ...state, speed: 1.5 }
  return { state: next, commands: [{ type: 'setPlaybackRate', speed: 1.5 }], events: [stateChanged(next)] }
}

const erroredAt = (position: number, kind: 'media' | 'autoplay_blocked'): Expected => {
  const errored: PlaybackState = { status: 'errored', episode: E1, position, speed: SPEED, reason: { kind } }
  return { state: errored, commands: [], events: [stateChanged(errored)] }
}

/** noop 以外のセル。キーは `${状態}:${入力}`。ここに無いセルはすべて no-op。 */
const ACTIVE: Readonly<Record<string, { readonly kind: Kind; readonly expected: Expected }>> = {
  'idle:start': { kind: 'T1', expected: startBody(false) },
  'paused:start': { kind: 'T6', expected: startBody(true) },
  'ended:start': { kind: 'T11', expected: startBody(true) },
  'errored:start': { kind: 'T13', expected: startBody(true) },
  'loading:start': {
    kind: 'outside',
    expected: {
      ...startBody(true),
      prelude: { state: { status: 'idle' }, commands: [{ type: 'unload' }], events: [stateChanged({ status: 'idle' })] },
    },
  },
  'playing:start': {
    kind: 'outside',
    expected: {
      ...startBody(true),
      prelude: {
        state: { status: 'paused', episode: E1, position: 12, duration: 100, speed: SPEED },
        commands: [{ type: 'pause' }],
        events: [stateChanged({ status: 'paused', episode: E1, position: 12, duration: 100, speed: SPEED })],
      },
    },
  },
  'paused:play': {
    kind: 'T4',
    expected: {
      state: { status: 'playing', episode: E1, position: 10, duration: 100, speed: SPEED },
      commands: [{ type: 'play' }],
      events: [stateChanged({ status: 'playing', episode: E1, position: 10, duration: 100, speed: SPEED })],
    },
  },
  'errored:play': {
    kind: 'T12',
    expected: {
      state: { status: 'loading', episode: E1, resumePosition: 10, speed: SPEED },
      commands: [{ type: 'load', src: 'u-e1', resumePosition: 10, speed: SPEED }],
      events: [stateChanged({ status: 'loading', episode: E1, resumePosition: 10, speed: SPEED })],
    },
  },
  'playing:pause': {
    kind: 'T7',
    expected: {
      state: { status: 'paused', episode: E1, position: 12, duration: 100, speed: SPEED },
      commands: [{ type: 'pause' }],
      events: [stateChanged({ status: 'paused', episode: E1, position: 12, duration: 100, speed: SPEED })],
    },
  },
  'paused:seek': { kind: 'T5', expected: seekedTo('paused', 30) },
  'paused:seekRelative': { kind: 'T5', expected: seekedTo('paused', 15) },
  'playing:seek': { kind: 'value', expected: seekedTo('playing', 30) },
  'playing:seekRelative': { kind: 'value', expected: seekedTo('playing', 15) },
  'loading:setSpeed': { kind: 'value', expected: speedChanged(LOADING) },
  'paused:setSpeed': { kind: 'value', expected: speedChanged(STATES.paused) },
  'playing:setSpeed': { kind: 'value', expected: speedChanged(STATES.playing) },
  'errored:setSpeed': { kind: 'value', expected: speedChanged(ERRORED) },
  'loading:stop': { kind: 'outside', expected: stopped },
  'paused:stop': { kind: 'outside', expected: stopped },
  'playing:stop': { kind: 'outside', expected: stopped },
  'ended:stop': { kind: 'outside', expected: stopped },
  'errored:stop': { kind: 'outside', expected: stopped },
  'idle:fail': { kind: 'outside', expected: failedFrom(1.0, []) },
  'loading:fail': { kind: 'outside', expected: failedFrom(SPEED, failDetach) },
  'paused:fail': { kind: 'outside', expected: failedFrom(SPEED, failDetach) },
  'playing:fail': { kind: 'outside', expected: failedFrom(SPEED, failDetach) },
  'ended:fail': { kind: 'outside', expected: failedFrom(1.0, failDetach) },
  'errored:fail': { kind: 'outside', expected: failedFrom(SPEED, failDetach) },
  'loading:loadedmetadata': {
    kind: 'T2',
    expected: {
      state: { status: 'paused', episode: E1, position: 10, duration: 100, speed: SPEED },
      commands: [
        { type: 'seek', seconds: 10 },
        { type: 'setPlaybackRate', speed: SPEED },
      ],
      events: [stateChanged({ status: 'paused', episode: E1, position: 10, duration: 100, speed: SPEED })],
    },
  },
  'loading:error': { kind: 'T3', expected: erroredAt(10, 'media') },
  'playing:error': { kind: 'T9', expected: erroredAt(12, 'media') },
  'playing:playRejected': { kind: 'T9', expected: erroredAt(12, 'autoplay_blocked') },
  'playing:timeupdate': {
    kind: 'T10',
    expected: {
      state: { status: 'playing', episode: E1, position: 12, duration: 100, speed: SPEED },
      commands: [],
      events: [stateChanged({ status: 'playing', episode: E1, position: 12, duration: 100, speed: SPEED }), positionChanged(12)],
    },
  },
  'playing:ended': {
    kind: 'T8',
    expected: {
      state: { status: 'ended', episode: E1, duration: 100 },
      commands: [],
      events: [{ type: 'listenCompleted', episodeId: 'e1' }, stateChanged({ status: 'ended', episode: E1, duration: 100 })],
    },
  },
}

interface Cell {
  readonly stateName: StateName
  readonly inputName: InputName
  readonly kind: Kind
  readonly expected: Expected | undefined
}

const stateNames = Object.keys(STATES) as StateName[]
const inputNames = Object.keys(INPUTS) as InputName[]
const cases: readonly Cell[] = stateNames.flatMap((stateName) =>
  inputNames.map((inputName): Cell => {
    const active = ACTIVE[`${stateName}:${inputName}`]
    return { stateName, inputName, kind: active?.kind ?? 'noop', expected: active?.expected }
  }),
)

const run = (c: Cell): { readonly from: PlaybackState; readonly result: Transition } => {
  const from = STATES[c.stateName]
  return { from, result: transition(from, INPUTS[c.inputName]) }
}

const isNoopShape = (from: PlaybackState, result: Transition): boolean =>
  result.state === from && result.commands.length === 0 && result.events.length === 0 && result.prelude === undefined

describe('web-rule-playback-01 transition: 状態 6 × 入力 13 の全セル', () => {
  test.each(cases)('web-rule-playback-01 $stateName × $inputName → $kind', (c) => {
    const { from, result } = run(c)
    if (c.expected === undefined) {
      expect(result.state).toBe(from)
      expect(result.commands).toEqual([])
      expect(result.events).toEqual([])
      expect(result.prelude).toBeUndefined()
      return
    }
    expect(result.state).toEqual(c.expected.state)
    expect(result.commands).toEqual(c.expected.commands)
    expect(result.events).toEqual(c.expected.events)
    if (c.expected.prelude === undefined) {
      expect(result.prelude).toBeUndefined()
    } else {
      expect(result.prelude).toEqual(c.expected.prelude)
    }
  })

  test('web-rule-playback-01 分類の件数: 78 セル = 13 遷移 15・表の外 13・値の更新 6・no-op 44', () => {
    expect(cases.length).toBe(78)
    const isTransition = (k: Kind): boolean => k.startsWith('T')
    expect(cases.filter((c) => isTransition(c.kind)).length).toBe(15)
    expect(cases.filter((c) => c.kind === 'outside').length).toBe(13)
    expect(cases.filter((c) => c.kind === 'value').length).toBe(6)
    expect(cases.filter((c) => c.kind === 'noop').length).toBe(44)

    expect(new Set(cases.filter((c) => isTransition(c.kind)).map((c) => c.kind)).size).toBe(13)
    expect([...new Set(cases.filter((c) => c.kind === 'outside').map((c) => c.inputName))].sort()).toEqual(['fail', 'start', 'stop'])
    expect([...new Set(cases.filter((c) => c.kind === 'value').map((c) => c.inputName))].sort()).toEqual([
      'seek',
      'seekRelative',
      'setSpeed',
    ])

    const changing = cases.filter((c) => {
      const { from, result } = run(c)
      return result.state.status !== from.status
    })
    expect(changing.length).toBeGreaterThan(0)
    expect(changing.every((c) => isTransition(c.kind) || c.kind === 'outside')).toBe(true)

    const noops = cases.filter((c) => c.kind === 'noop')
    expect(
      noops.every((c) => {
        const { from, result } = run(c)
        return isNoopShape(from, result)
      }),
    ).toBe(true)

    // prelude を持つのは loading・playing からの start の 2 セルだけ。
    const withPrelude = cases.filter((c) => run(c).result.prelude !== undefined)
    expect(withPrelude.map((c) => `${c.stateName}:${c.inputName}`).sort()).toEqual(['loading:start', 'playing:start'])
  })

  test('web-rule-playback-01 errored（id だけの参照）× play は no-op', () => {
    const idOnly: PlaybackState = Object.freeze({
      status: 'errored',
      episode: Object.freeze({ id: 'e1' }),
      position: 10,
      speed: SPEED,
      reason: Object.freeze({ kind: 'media' }),
    })
    const result = transition(idOnly, { type: 'play' })
    expect(result.state).toBe(idOnly)
    expect(result.commands).toEqual([])
    expect(result.events).toEqual([])
    expect(result.prelude).toBeUndefined()
  })
})

describe('web-check-06 transition の純度', () => {
  test('web-check-06 transition は純関数: 同じ入力で等しい結果、入力を書き換えず、返す state は深く凍結済み', () => {
    // 同じ state・input を 2 回: 等しい結果で、配列は共有しない。1 回目の配列を書き換えても 3 回目に影響しない。
    const tick: PlaybackInput = { type: 'timeupdate', currentTime: 12 }
    const playing = playingAt(10)
    const first = transition(playing, tick)
    const second = transition(playing, tick)
    expect(second).toEqual(first)
    expect(second.commands).not.toBe(first.commands)
    expect(second.events).not.toBe(first.events)
    Reflect.set(first.commands, 'length', 0)
    Reflect.set(first.events, 'length', 0)
    expect(transition(playing, tick)).toEqual(second)

    // start: 呼出側の episode を凍結せず、別の参照の凍結した写しを state に入れる。
    const given: PlayableEpisode = { ...E2 }
    const started = transition(pausedAt(10), { type: 'start', episode: given, resumePosition: 5, speed: 1.5, currentTime: 12 })
    if (started.state.status !== 'loading') throw new Error(`loading のはずが ${started.state.status}`)
    expect(Object.isFrozen(started.state)).toBe(true)
    expect(Object.isFrozen(started.state.episode)).toBe(true)
    expect(started.state.episode).not.toBe(given)
    expect(started.state.episode).toEqual(E2)
    expect(Object.isFrozen(given)).toBe(false)
    expect(given).toEqual(E2)

    // fail: 呼出側の reason を凍結せず、別の参照の凍結した写しを state に入れる。episode は id だけの新しい凍結済み object。
    const r: Extract<PlaybackErrorReason, { readonly kind: 'source_unavailable' }> = { kind: 'source_unavailable' }
    const failed = transition(pausedAt(10), { type: 'fail', ref: { id: 'e3' }, reason: r })
    if (failed.state.status !== 'errored') throw new Error(`errored のはずが ${failed.state.status}`)
    expect(Object.isFrozen(failed.state)).toBe(true)
    expect(Object.isFrozen(failed.state.reason)).toBe(true)
    expect(failed.state.reason).not.toBe(r)
    expect(Object.isFrozen(r)).toBe(false)
    expect(failed.state.episode).toEqual({ id: 'e3' })
    expect(Object.isFrozen(failed.state.episode)).toBe(true)

    // error: 事象由来の reason と、引き継いだ episode を含めて state が深く凍結済み。
    const errored = transition(playingAt(10), { type: 'error', currentTime: 12 })
    if (errored.state.status !== 'errored') throw new Error(`errored のはずが ${errored.state.status}`)
    expect(Object.isFrozen(errored.state)).toBe(true)
    expect(Object.isFrozen(errored.state.reason)).toBe(true)
    expect(Object.isFrozen(errored.state.episode)).toBe(true)
  })
})
