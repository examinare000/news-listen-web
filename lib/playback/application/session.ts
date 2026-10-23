// 再生セッション: transition（domain の純関数）が返した指示を AudioElement に実行し、事象を購読者へ発行する。
// 状態 × 入力の分岐は持たない。持つのは、指示の実行・音声要素の事象の入力への変換・play() の遅延 reject の世代・購読者・音量の正規化だけ。
import type { AudioElement } from '@/lib/playback/application/ports'
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

function isAutoplayBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
}

// 音源・再生状態を変える指示だけが世代を進める。seek・setPlaybackRate は進めない。
function advancesGeneration(command: AudioCommand): boolean {
  return command.type === 'load' || command.type === 'unload' || command.type === 'pause' || command.type === 'play'
}

export function createPlaybackSession(audio: AudioElement): PlaybackSession {
  let state: PlaybackState = Object.freeze({ status: 'idle' })
  // play() の遅延 reject が、その後の操作を上書きしないための世代。
  let token = 0
  const listeners = new Set<(event: PlaybackEvent) => void>()

  const emit = (event: PlaybackEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }

  // 1 段の適用: state の置き換え → releaseHandle 以外の指示 → 事象の発行 → releaseHandle。
  // release が投げた例外は捕捉せず呼出側へ伝える（そのとき state の置き換えと事象の発行は済んでいる）。
  const applyStep = (step: Transition): Promise<void> | undefined => {
    state = step.state
    let settled: Promise<void> | undefined
    let handle: AudioHandle | undefined
    for (const command of step.commands) {
      switch (command.type) {
        case 'load':
          audio.setPlaybackRate(command.speed)
          audio.load(command.src)
          audio.seek(command.resumePosition)
          break
        case 'unload':
          audio.unload()
          break
        case 'play':
          settled = audio.play()
          break
        case 'pause':
          audio.pause()
          break
        case 'seek':
          audio.seek(command.seconds)
          break
        case 'setPlaybackRate':
          audio.setPlaybackRate(command.speed)
          break
        case 'releaseHandle':
          handle = command.handle
          break
      }
    }
    for (const event of step.events) emit(event)
    handle?.release()
    return settled
  }

  // 入力を transition に渡して結果を適用する。play の指示があれば、その promise の完了（reject は吸収済み）を返す。
  const dispatch = (input: PlaybackInput): Promise<void> => {
    const result = transition(state, input)
    const steps = result.prelude === undefined ? [result] : [result.prelude, result]
    if (steps.some((step) => step.commands.some(advancesGeneration))) token += 1
    const mine = token
    let settled: Promise<void> | undefined
    for (const step of steps) settled = applyStep(step) ?? settled
    if (settled === undefined) return Promise.resolve()
    return settled.then(
      () => undefined,
      (error: unknown) => {
        if (token !== mine) return
        return dispatch({ type: 'playRejected', autoplayBlocked: isAutoplayBlocked(error), currentTime: audio.currentTime })
      },
    )
  }

  // 音声要素の事象は Promise を返さない入力なので、完了は待たない。
  const feed = (input: PlaybackInput): void => {
    void dispatch(input)
  }

  audio.addEventListener('loadedmetadata', () => {
    feed({ type: 'loadedmetadata', duration: audio.duration })
  })
  audio.addEventListener('timeupdate', () => {
    feed({ type: 'timeupdate', currentTime: audio.currentTime })
  })
  audio.addEventListener('ended', () => {
    feed({ type: 'ended' })
  })
  audio.addEventListener('error', () => {
    feed({ type: 'error', currentTime: audio.currentTime })
  })

  return {
    state: () => state,

    start(episode, resumePosition, speed) {
      feed({ type: 'start', episode, resumePosition, speed, currentTime: audio.currentTime })
    },

    play() {
      return dispatch({ type: 'play' })
    },

    pause() {
      feed({ type: 'pause', currentTime: audio.currentTime })
    },

    seek(seconds) {
      feed({ type: 'seek', seconds })
    },

    seekRelative(deltaSeconds) {
      feed({ type: 'seekRelative', deltaSeconds })
    },

    setSpeed(speed) {
      feed({ type: 'setSpeed', speed })
    },

    setVolume(volume) {
      if (Number.isFinite(volume)) audio.setVolume(Math.min(1, Math.max(0, volume)))
    },

    stop() {
      feed({ type: 'stop' })
    },

    fail(ref, reason) {
      feed({ type: 'fail', ref, reason })
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
