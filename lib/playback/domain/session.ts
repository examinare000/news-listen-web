// 再生セッション: 1 つの AudioElement を駆動する状態機械。
// 状態変化は 13 遷移と、表の外の操作 stop()・fail() だけ。表にない入力は no-op（throw しない）。
// 契約の正本は docs/design/modules/web/2026-09-16-implementation-spec-domain-model.md §3.1。
import type { AudioHandle, PlayableEpisode } from '@/lib/catalog/domain/episode'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { AudioElement } from './audioElement'

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

export interface PlaybackSession {
  state(): PlaybackState
  start(episode: PlayableEpisode, resumePosition: number, speed: PlaybackSpeed): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  seekRelative(deltaSeconds: number): void
  setSpeed(speed: PlaybackSpeed): void
  setVolume(volume: number): void
  /** どの状態からでも idle へ戻し、音源を外す。13 遷移の外のリセット。 */
  stop(): void
  /** どの状態からでも errored にし、idle 以外なら音源を外す。13 遷移の外。media・autoplay_blocked は音声要素の事象からだけ生まれる。 */
  fail(ref: EpisodeRef, reason: Extract<PlaybackErrorReason, { readonly kind: 'source_unavailable' | 'fetch_failed' }>): void
  subscribe(listener: (event: PlaybackEvent) => void): () => void
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

function isAutoplayBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
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

export function createPlaybackSession(audio: AudioElement): PlaybackSession {
  let state: PlaybackState = Object.freeze({ status: 'idle' })
  // play() の遅延 reject が、その後の pause / play / start / stop / fail を上書きしないための世代。
  let token = 0
  const listeners = new Set<(event: PlaybackEvent) => void>()

  const emit = (event: PlaybackEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  // 状態に入る episode は start と fail が作った凍結済みの写しだけなので辿らない。reason は fail が複製してから渡し、
  // 事象由来の reason は session 内のリテラルなので、ここで凍結するのは呼出側と共有しない値だけ。
  const assign = (next: PlaybackState): void => {
    if (next.status === 'errored') freezeDeep(next.reason)
    state = Object.freeze(next)
  }
  const commit = (next: PlaybackState): void => {
    assign(next)
    emit({ type: 'stateChanged', state })
  }

  const applySpeed = (speed: PlaybackSpeed): void => {
    audio.defaultPlaybackRate = speed
    audio.playbackRate = speed
  }

  const loadSource = (episode: PlayableEpisode, resumePosition: number, speed: PlaybackSpeed): void => {
    audio.src = episode.audioUrl
    applySpeed(speed)
    audio.load()
    audio.currentTime = resumePosition
    commit({ status: 'loading', episode, resumePosition, speed })
  }

  const detachSource = (): void => {
    audio.pause()
    audio.src = ''
    audio.load()
  }

  const seekTo = (seconds: number): void => {
    const s = state
    if (s.status !== 'paused' && s.status !== 'playing') return
    const position = clampPosition(seconds, s.duration)
    audio.currentTime = position
    if (position === s.position) return
    commit({ ...s, position })
    emit({ type: 'positionChanged', episodeId: s.episode.id, seconds: position })
  }

  audio.addEventListener('loadedmetadata', () => {
    const s = state
    if (s.status !== 'loading') return
    const duration = normalizeDuration(audio.duration)
    const position = clampPosition(s.resumePosition, duration)
    audio.currentTime = position
    applySpeed(s.speed)
    commit({ status: 'paused', episode: s.episode, position, duration, speed: s.speed })
  })

  audio.addEventListener('timeupdate', () => {
    const s = state
    if (s.status !== 'playing') return
    const position = clampPosition(audio.currentTime, s.duration)
    if (position === s.position) return
    commit({ ...s, position })
    emit({ type: 'positionChanged', episodeId: s.episode.id, seconds: position })
  })

  audio.addEventListener('ended', () => {
    const s = state
    if (s.status !== 'playing') return
    // 完聴の記録を次エピソードへの遷移より先に行えるよう、listenCompleted を先に出す。
    assign({ status: 'ended', episode: s.episode, duration: s.duration })
    emit({ type: 'listenCompleted', episodeId: s.episode.id })
    emit({ type: 'stateChanged', state })
  })

  audio.addEventListener('error', () => {
    const s = state
    if (s.status === 'loading') {
      commit({
        status: 'errored',
        episode: s.episode,
        position: s.resumePosition,
        speed: s.speed,
        reason: { kind: 'media' },
      })
    } else if (s.status === 'playing') {
      commit({
        status: 'errored',
        episode: s.episode,
        position: clampPosition(audio.currentTime, s.duration),
        speed: s.speed,
        reason: { kind: 'media' },
      })
    }
  })

  return {
    state: () => state,

    start(given, resumePosition, speed) {
      const episode = freezeDeep(cloneDeep(given))
      const previousHandle = handleOf(state)
      token += 1
      const s = state
      if (s.status === 'playing') {
        audio.pause()
        commit({ ...s, status: 'paused', position: clampPosition(audio.currentTime, s.duration) })
      } else if (s.status === 'loading') {
        detachSource()
        commit({ status: 'idle' })
      }
      loadSource(episode, normalizeResume(resumePosition), normalizeSpeed(speed))
      // release は最後の 1 手: 新音源の load() の後でなければ再生中の URL を失う。
      if (previousHandle !== undefined && previousHandle !== episode.audioHandle) previousHandle.release()
    },

    play() {
      const s = state
      if (s.status === 'errored') {
        // id だけの参照は音源を持たない。再試行は Coordinator が再生元の解決からやり直して start を呼ぶ。
        if (isPlayableEpisode(s.episode)) loadSource(s.episode, s.position, s.speed)
        return Promise.resolve()
      }
      if (s.status !== 'paused') return Promise.resolve()

      token += 1
      const mine = token
      assign({ ...s, status: 'playing' })
      const settled = audio.play()
      emit({ type: 'stateChanged', state })
      return settled.then(
        () => undefined,
        (error: unknown) => {
          const current = state
          if (token !== mine || current.status !== 'playing') return
          commit({
            status: 'errored',
            episode: current.episode,
            position: clampPosition(audio.currentTime, current.duration),
            speed: current.speed,
            reason: { kind: isAutoplayBlocked(error) ? 'autoplay_blocked' : 'media' },
          })
        },
      )
    },

    pause() {
      const s = state
      if (s.status !== 'playing') return
      token += 1
      audio.pause()
      commit({ ...s, status: 'paused', position: clampPosition(audio.currentTime, s.duration) })
    },

    seek(seconds) {
      if (Number.isFinite(seconds)) seekTo(seconds)
    },

    seekRelative(deltaSeconds) {
      const s = state
      if (!Number.isFinite(deltaSeconds)) return
      if (s.status === 'paused' || s.status === 'playing') seekTo(s.position + deltaSeconds)
    },

    setSpeed(speed) {
      const s = state
      if (!PLAYBACK_SPEEDS.some((v) => v === speed)) return
      if (s.status === 'idle' || s.status === 'ended') return
      applySpeed(speed)
      if (s.speed !== speed) commit({ ...s, speed })
    },

    setVolume(volume) {
      if (Number.isFinite(volume)) audio.volume = Math.min(1, Math.max(0, volume))
    },

    stop() {
      const s = state
      if (s.status === 'idle') return
      const handle = handleOf(s)
      token += 1
      detachSource()
      commit({ status: 'idle' })
      // release は最後の 1 手: src を外した後でなければ再生中の URL を失う。
      handle?.release()
    },

    fail(ref, reason) {
      const s = state
      const handle = handleOf(s)
      // ref が full episode でも id だけを写す。ref の audioHandle を保持・release しない。
      const episode = freezeDeep({ id: ref.id })
      const copiedReason = freezeDeep(cloneDeep(reason))
      token += 1
      if (s.status !== 'idle') detachSource()
      commit({
        status: 'errored',
        episode,
        position: 0,
        speed: 'speed' in s ? s.speed : DEFAULT_SPEED,
        reason: copiedReason,
      })
      // release は最後の 1 手: src を外した後でなければ再生中の URL を失う。
      handle?.release()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
