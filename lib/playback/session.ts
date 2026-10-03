// 再生セッション: 1 つの AudioElement を駆動する状態機械。
// 状態変化は 13 遷移と、表の外のリセット stop() だけ。表にない入力は no-op（throw しない）。
// 契約の正本は docs/design/modules/web/2026-09-16-implementation-spec-domain-model.md §3.1。
import type { ApiFailure } from '@/lib/api/gateway'
import type { Podcast, DifficultyLevel } from '@/types'
import type { AudioElement } from './ports'

/** 8 段の再生速度。 */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** オフライン再生用に発行された音源の解放口。中身（blob URL 等）は露出しない。 */
export interface AudioHandle {
  release(): void
}

export interface PlayableEpisode {
  readonly id: string
  readonly title: string
  readonly audioUrl: string
  readonly durationSeconds: number
  readonly difficulty: DifficultyLevel
  readonly createdAt: string
  readonly serverPositionSeconds: number
  readonly transcript?: Podcast['segments']
  readonly vocabulary?: Podcast['vocabulary']
  readonly quiz?: Podcast['quiz']
  readonly sources?: Podcast['source_articles']
  readonly sourceKind?: Podcast['source_kind']
  /** handle を持つとき audioUrl はその handle だけが包む URL であること（呼出側の責務）。 */
  readonly audioHandle?: AudioHandle
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
      readonly episode: PlayableEpisode
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

function handleOf(state: PlaybackState): AudioHandle | undefined {
  return state.status === 'idle' ? undefined : state.episode.audioHandle
}

export function createPlaybackSession(audio: AudioElement): PlaybackSession {
  let state: PlaybackState = Object.freeze({ status: 'idle' })
  // play() の遅延 reject が、その後の pause / play / start / stop を上書きしないための世代。
  let token = 0
  const listeners = new Set<(event: PlaybackEvent) => void>()

  const emit = (event: PlaybackEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  const assign = (next: PlaybackState): void => {
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

    start(episode, resumePosition, speed) {
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
        loadSource(s.episode, s.position, s.speed)
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

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
