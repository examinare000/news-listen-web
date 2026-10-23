// 再生セッションの遷移の決定: 状態と入力から、次の状態・音声要素への指示・事象を返す純関数 transition。
// 状態変化は 13 遷移と、表の外の操作 stop・fail だけ。表にない入力は no-op（throw しない）。
// 契約の正本は docs/design/modules/web/2026-09-16-implementation-spec-domain-model.md §3.1。
import type { AudioHandle, PlayableEpisode } from '@/lib/catalog/domain/episode'
import type { ApiFailure } from '@/lib/shared/apiFailure'

// 型の定義は Catalog が持つ（web-dep-12: Playback → Catalog の向き）。既存の import path を保つため再 export する。
export type { AudioHandle, PlayableEpisode }

/** 8 段の再生速度。 */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** 取得前・開始前の失敗で、再生できるエピソードが無いときに errored が持つ参照。 */
export type EpisodeRef = { readonly id: string }

export function isPlayableEpisode(e: PlayableEpisode | EpisodeRef): e is PlayableEpisode {
  return 'audioUrl' in e
}

export type PlaybackErrorReason =
  | { readonly kind: 'media' }
  | { readonly kind: 'autoplay_blocked' }
  | { readonly kind: 'source_unavailable' }
  | { readonly kind: 'fetch_failed'; readonly failure: ApiFailure }

export type PlaybackState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading'
      readonly episode: PlayableEpisode
      readonly resumePosition: number
      readonly speed: PlaybackSpeed
    }
  | {
      readonly status: 'paused' | 'playing'
      readonly episode: PlayableEpisode
      readonly position: number
      /** 0 は不明。 */
      readonly duration: number
      readonly speed: PlaybackSpeed
    }
  | { readonly status: 'ended'; readonly episode: PlayableEpisode; readonly duration: number }
  | {
      readonly status: 'errored'
      readonly episode: PlayableEpisode | EpisodeRef
      readonly position: number
      readonly speed: PlaybackSpeed
      readonly reason: PlaybackErrorReason
    }

export type PlaybackEvent =
  | { readonly type: 'stateChanged'; readonly state: PlaybackState }
  | { readonly type: 'positionChanged'; readonly episodeId: string; readonly seconds: number }
  | { readonly type: 'listenCompleted'; readonly episodeId: string }

/** transition への入力。currentTime は呼出側が音声要素から読んだ値。 */
export type PlaybackInput =
  | {
      readonly type: 'start'
      readonly episode: PlayableEpisode
      readonly resumePosition: number
      readonly speed: PlaybackSpeed
      readonly currentTime: number
    }
  | { readonly type: 'play' }
  | { readonly type: 'pause'; readonly currentTime: number }
  | { readonly type: 'seek'; readonly seconds: number }
  | { readonly type: 'seekRelative'; readonly deltaSeconds: number }
  | { readonly type: 'setSpeed'; readonly speed: PlaybackSpeed }
  | { readonly type: 'stop' }
  | {
      readonly type: 'fail'
      readonly ref: EpisodeRef
      readonly reason: Extract<PlaybackErrorReason, { readonly kind: 'source_unavailable' | 'fetch_failed' }>
    }
  | { readonly type: 'loadedmetadata'; readonly duration: number }
  | { readonly type: 'timeupdate'; readonly currentTime: number }
  | { readonly type: 'ended' }
  | { readonly type: 'error'; readonly currentTime: number }
  | { readonly type: 'playRejected'; readonly autoplayBlocked: boolean; readonly currentTime: number }

/** transition が返す、音声要素への指示。 */
export type AudioCommand =
  | { readonly type: 'load'; readonly src: string; readonly resumePosition: number; readonly speed: PlaybackSpeed }
  | { readonly type: 'unload' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'seek'; readonly seconds: number }
  | { readonly type: 'setPlaybackRate'; readonly speed: PlaybackSpeed }
  // 並びの最後に置く。実行は事象の発行の後（新しい音源の load の後でなければ再生中の URL を失う）。
  | { readonly type: 'releaseHandle'; readonly handle: AudioHandle }

export type Transition = {
  readonly state: PlaybackState
  readonly commands: ReadonlyArray<AudioCommand>
  readonly events: ReadonlyArray<PlaybackEvent>
  /** 前段。loading・playing からの start だけが持つ（中間状態 idle・paused への遷移。releaseHandle を含まない）。 */
  readonly prelude?: Transition
}

const DEFAULT_SPEED: PlaybackSpeed = 1.0

function normalizeSpeed(speed: number): PlaybackSpeed {
  return PLAYBACK_SPEEDS.find((s) => s === speed) ?? DEFAULT_SPEED
}

function normalizeResume(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

function normalizeDuration(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/** duration が不明（0）のときは上限を掛けない。 */
function clampPosition(seconds: number, duration: number): number {
  const lower = Math.max(0, seconds)
  return duration > 0 ? Math.min(duration, lower) : lower
}

/** 呼出側の値を共有しないよう、plain object と配列だけを全深さで複製する。release 口の audioHandle は同一参照のまま。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneDeep(v)) as T
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) copy[key] = key === 'audioHandle' ? v : cloneDeep(v)
    return copy as T
  }
  return value
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    for (const v of value as unknown[]) freezeDeep(v)
  } else if (isPlainObject(value)) {
    for (const [key, v] of Object.entries(value)) if (key !== 'audioHandle') freezeDeep(v)
  } else {
    return value
  }
  return Object.freeze(value)
}

function handleOf(state: PlaybackState): AudioHandle | undefined {
  if (state.status === 'idle') return undefined
  return isPlayableEpisode(state.episode) ? state.episode.audioHandle : undefined
}

// 入力の state は深く凍結済みであることを前提にする。ここで新しく作る値だけを凍結し、
// 前の状態から引き継ぐ参照と呼出側の値は凍結し直さない。
function noop(state: PlaybackState): Transition {
  return { state, commands: [], events: [] }
}

function change(state: PlaybackState, commands: ReadonlyArray<AudioCommand>, events: ReadonlyArray<PlaybackEvent>): Transition {
  return { state: Object.freeze(state), commands, events }
}

function changed(state: PlaybackState): PlaybackEvent {
  return { type: 'stateChanged', state }
}

function releaseCommands(previous: AudioHandle | undefined, next: AudioHandle | undefined): ReadonlyArray<AudioCommand> {
  return previous !== undefined && previous !== next ? [{ type: 'releaseHandle', handle: previous }] : []
}

function loadFrom(episode: PlayableEpisode, resumePosition: number, speed: PlaybackSpeed): PlaybackState {
  return Object.freeze({ status: 'loading', episode, resumePosition, speed })
}

function start(state: PlaybackState, input: Extract<PlaybackInput, { type: 'start' }>): Transition {
  const episode = freezeDeep(cloneDeep(input.episode))
  const resumePosition = normalizeResume(input.resumePosition)
  const speed = normalizeSpeed(input.speed)
  const loading = loadFrom(episode, resumePosition, speed)
  const body = change(
    loading,
    [{ type: 'load', src: episode.audioUrl, resumePosition, speed }, ...releaseCommands(handleOf(state), episode.audioHandle)],
    [changed(loading)],
  )
  if (state.status === 'playing') {
    const paused: PlaybackState = Object.freeze({
      ...state,
      status: 'paused',
      position: clampPosition(input.currentTime, state.duration),
    })
    return { ...body, prelude: change(paused, [{ type: 'pause' }], [changed(paused)]) }
  }
  if (state.status === 'loading') {
    const idle: PlaybackState = Object.freeze({ status: 'idle' })
    return { ...body, prelude: change(idle, [{ type: 'unload' }], [changed(idle)]) }
  }
  return body
}

function play(state: PlaybackState): Transition {
  if (state.status === 'errored') {
    // id だけの参照は音源を持たない。再試行は Coordinator が再生元の解決からやり直して start を呼ぶ。
    if (!isPlayableEpisode(state.episode)) return noop(state)
    const loading = loadFrom(state.episode, state.position, state.speed)
    return change(
      loading,
      [{ type: 'load', src: state.episode.audioUrl, resumePosition: state.position, speed: state.speed }],
      [changed(loading)],
    )
  }
  if (state.status !== 'paused') return noop(state)
  const playing: PlaybackState = Object.freeze({ ...state, status: 'playing' })
  return change(playing, [{ type: 'play' }], [changed(playing)])
}

function pause(state: PlaybackState, currentTime: number): Transition {
  if (state.status !== 'playing') return noop(state)
  const paused: PlaybackState = Object.freeze({
    ...state,
    status: 'paused',
    position: clampPosition(currentTime, state.duration),
  })
  return change(paused, [{ type: 'pause' }], [changed(paused)])
}

function seekTo(state: PlaybackState, seconds: number): Transition {
  if (state.status !== 'paused' && state.status !== 'playing') return noop(state)
  const position = clampPosition(seconds, state.duration)
  const commands: ReadonlyArray<AudioCommand> = [{ type: 'seek', seconds: position }]
  if (position === state.position) return { state, commands, events: [] }
  const next: PlaybackState = Object.freeze({ ...state, position })
  return change(next, commands, [changed(next), { type: 'positionChanged', episodeId: state.episode.id, seconds: position }])
}

function setSpeed(state: PlaybackState, speed: PlaybackSpeed): Transition {
  if (!PLAYBACK_SPEEDS.some((v) => v === speed)) return noop(state)
  if (state.status === 'idle' || state.status === 'ended') return noop(state)
  const commands: ReadonlyArray<AudioCommand> = [{ type: 'setPlaybackRate', speed }]
  if (state.speed === speed) return { state, commands, events: [] }
  const next: PlaybackState = Object.freeze({ ...state, speed })
  return change(next, commands, [changed(next)])
}

function stop(state: PlaybackState): Transition {
  if (state.status === 'idle') return noop(state)
  const idle: PlaybackState = Object.freeze({ status: 'idle' })
  return change(idle, [{ type: 'unload' }, ...releaseCommands(handleOf(state), undefined)], [changed(idle)])
}

function fail(state: PlaybackState, input: Extract<PlaybackInput, { type: 'fail' }>): Transition {
  // ref が full episode でも id だけを写す。ref の audioHandle を保持・release しない。
  const errored: PlaybackState = Object.freeze({
    status: 'errored',
    episode: freezeDeep({ id: input.ref.id }),
    position: 0,
    speed: 'speed' in state ? state.speed : DEFAULT_SPEED,
    reason: freezeDeep(cloneDeep(input.reason)),
  })
  const detach: ReadonlyArray<AudioCommand> =
    state.status === 'idle' ? [] : [{ type: 'unload' }, ...releaseCommands(handleOf(state), undefined)]
  return change(errored, detach, [changed(errored)])
}

function loadedMetadata(state: PlaybackState, rawDuration: number): Transition {
  if (state.status !== 'loading') return noop(state)
  const duration = normalizeDuration(rawDuration)
  const position = clampPosition(state.resumePosition, duration)
  const paused: PlaybackState = Object.freeze({
    status: 'paused',
    episode: state.episode,
    position,
    duration,
    speed: state.speed,
  })
  return change(
    paused,
    [
      { type: 'seek', seconds: position },
      { type: 'setPlaybackRate', speed: state.speed },
    ],
    [changed(paused)],
  )
}

function timeUpdate(state: PlaybackState, currentTime: number): Transition {
  if (state.status !== 'playing') return noop(state)
  const position = clampPosition(currentTime, state.duration)
  if (position === state.position) return noop(state)
  const next: PlaybackState = Object.freeze({ ...state, position })
  return change(next, [], [changed(next), { type: 'positionChanged', episodeId: state.episode.id, seconds: position }])
}

function ended(state: PlaybackState): Transition {
  if (state.status !== 'playing') return noop(state)
  const next: PlaybackState = Object.freeze({ status: 'ended', episode: state.episode, duration: state.duration })
  // 完聴の記録を次エピソードへの遷移より先に行えるよう、listenCompleted を先に出す。
  return change(next, [], [{ type: 'listenCompleted', episodeId: state.episode.id }, changed(next)])
}

function mediaError(state: PlaybackState, currentTime: number, kind: 'media' | 'autoplay_blocked'): Transition {
  if (state.status !== 'loading' && state.status !== 'playing') return noop(state)
  const position = state.status === 'loading' ? state.resumePosition : clampPosition(currentTime, state.duration)
  const errored: PlaybackState = Object.freeze({
    status: 'errored',
    episode: state.episode,
    position,
    speed: state.speed,
    reason: freezeDeep({ kind }),
  })
  return change(errored, [], [changed(errored)])
}

export function transition(state: PlaybackState, input: PlaybackInput): Transition {
  switch (input.type) {
    case 'start':
      return start(state, input)
    case 'play':
      return play(state)
    case 'pause':
      return pause(state, input.currentTime)
    case 'seek':
      return Number.isFinite(input.seconds) ? seekTo(state, input.seconds) : noop(state)
    case 'seekRelative':
      if (!Number.isFinite(input.deltaSeconds)) return noop(state)
      return state.status === 'paused' || state.status === 'playing' ? seekTo(state, state.position + input.deltaSeconds) : noop(state)
    case 'setSpeed':
      return setSpeed(state, input.speed)
    case 'stop':
      return stop(state)
    case 'fail':
      return fail(state, input)
    case 'loadedmetadata':
      return loadedMetadata(state, input.duration)
    case 'timeupdate':
      return timeUpdate(state, input.currentTime)
    case 'ended':
      return ended(state)
    case 'error':
      return mediaError(state, input.currentTime, 'media')
    case 'playRejected':
      return state.status === 'playing' ? mediaError(state, input.currentTime, input.autoplayBlocked ? 'autoplay_blocked' : 'media') : noop(state)
  }
}
