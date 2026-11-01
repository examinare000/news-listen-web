// 再生の use case: 開始・自動の次へ・再試行・次へ送り・キュー操作と、画面が読む query。
// 外界は port（保存庫・取得・端末の位置・接続・既定速度）と Session で受け、形式や transport を知らない。
//
// 開始には「世代」(epoch) を使う。解決（await）の後で自分の世代と違えば、後から始めた側が優先なので何も変えない。
// 利用者の開始は自動の次へ（onEnded）より優先する。自動の側を捨てるときは、先に進めておいたキューも戻す。
import type { Episode, PlayableEpisode, QueuedEpisode } from '@/lib/catalog/domain/episode'
import type {
  Connectivity,
  DefaultSpeedSource,
  EpisodeSource,
  LocalPositionStore,
  OfflineLibrary,
  QueueEntryInput,
  StartResult,
} from '@/lib/playback/application/ports'
import type { PositionReporter } from '@/lib/playback/application/positionReporter'
import { toNowPlaying, toPlaybackView, toQueueView, toUpNextItems } from '@/lib/playback/application/readModels'
import type { NowPlaying, PlaybackView, QueueView, UpNextItem } from '@/lib/playback/application/readModels'
import type { PlaybackSession } from '@/lib/playback/application/session'
import {
  add as addEntry,
  advance,
  current,
  emptyQueue,
  jump,
  moveUpNext,
  playNext as insertNext,
  remove as removeEntry,
  upNext as waitingEntries,
} from '@/lib/playback/domain/queue'
import type { QueueState } from '@/lib/playback/domain/queue'
import { queueEntryOf } from '@/lib/playback/domain/queueEntry'
import { resolveResumePosition } from '@/lib/playback/domain/resume'
import { resolvePlaybackSource } from '@/lib/playback/domain/source'
import type { PlaybackErrorReason } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'

export interface PlaybackCoordinatorDeps {
  readonly session: PlaybackSession
  readonly offline: OfflineLibrary
  readonly positionReporter: PositionReporter
  readonly episodes: EpisodeSource
  readonly localPositions: LocalPositionStore
  readonly isOnline: Connectivity
  readonly defaultSpeed: DefaultSpeedSource
}

export interface PlaybackCommands {
  startEpisode(id: string): Promise<StartResult>
  retry(): Promise<void>
  addToQueue(input: QueueEntryInput): Promise<StartResult>
  playNext(input: QueueEntryInput): Promise<StartResult>
  removeFromQueue(id: string): void
  reorder(fromIndex: number, toOffset: number): void
  skipToNext(): Promise<StartResult>
  /** 主体離脱の停止（web-cmd-playback-09）。待ち中の解決は捨て、Queue を空にし、位置も完聴も送らない。 */
  stopForSubjectLeave(): void
}

export interface PlaybackQueries {
  nowPlaying(): NowPlaying | null
  upNext(): ReadonlyArray<UpNextItem>
  queueView(): QueueView
  playbackView(): PlaybackView
  savedPosition(id: string): number | null
}

export interface PlaybackSubscription {
  subscribe(listener: () => void): () => void
}

export type PlaybackCoordinator = PlaybackCommands & PlaybackQueries & PlaybackSubscription

type FailureNotice = Extract<StartResult, { readonly ok: false }>['notice']

type Resolution =
  | { readonly ok: true; readonly episode: PlayableEpisode }
  // failure は取得の失敗だけが持つ。無いものは Session へ source_unavailable として渡す。
  | { readonly ok: false; readonly notice: FailureNotice; readonly failure?: ApiFailure }

const OK: StartResult = Object.freeze({ ok: true })

export function createPlaybackCoordinator(deps: PlaybackCoordinatorDeps): PlaybackCoordinator {
  const { session, offline, positionReporter, episodes, localPositions, isOnline, defaultSpeed } = deps

  let queue: QueueState<QueuedEpisode> = emptyQueue
  // 開始の世代。解決を始める利用者の開始・自動の側を捨てるとき・次がある onEnded で 1 つ進める。比較は等値だけ。
  let epoch = 0
  // 解決中の利用者の開始の数。0 より大きい間、onEnded は次へ進まない。
  let userPending = 0
  // advance 済みで解決を待っている自動の開始。endedId は戻し先（session が ended になった episode）。
  let autoPending: { readonly endedId: string } | null = null
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  // 完聴の送信を先に受けさせるため、Reporter の購読を Coordinator の購読より先に張る。
  positionReporter.attach(session)

  const releaseUnused = (resolution: Resolution): void => {
    if (resolution.ok) resolution.episode.audioHandle?.release()
  }

  const failReason = (
    resolution: Extract<Resolution, { readonly ok: false }>,
  ): Extract<PlaybackErrorReason, { readonly kind: 'source_unavailable' | 'fetch_failed' }> =>
    resolution.failure === undefined
      ? { kind: 'source_unavailable' }
      : { kind: 'fetch_failed', failure: resolution.failure }

  // 保存庫の読み出し（Cache Storage）は reject しうる。取得の失敗として扱い、開始系の戻り値と onEnded の fail に乗せる。
  async function resolve(id: string): Promise<Resolution> {
    try {
      return await resolveOrThrow(id)
    } catch {
      return { ok: false, notice: 'fetch_failed' }
    }
  }

  async function resolveOrThrow(id: string): Promise<Resolution> {
    const source = resolvePlaybackSource({ hasCached: await offline.has(id), isOnline: isOnline() })
    if (source === 'unavailable') return { ok: false, notice: 'offline_uncached' }
    let episode: Episode
    if (source === 'cached') {
      const stored = await offline.get(id)
      if (stored === null) return { ok: false, notice: 'fetch_failed' }
      episode = stored
    } else {
      const fetched = await episodes.fetch(id)
      if (!fetched.ok) return { ok: false, notice: 'fetch_failed', failure: fetched.failure }
      episode = fetched.value
    }
    return episode.kind === 'playable' ? { ok: true, episode } : { ok: false, notice: 'not_playable' }
  }

  // 「開始」: 再開位置を合成して Session を始める。合成はここだけ。
  function begin(episode: PlayableEpisode): void {
    const candidate = episode.serverPositionSeconds > 0 ? episode.serverPositionSeconds : (localPositions.read(episode.id) ?? 0)
    session.start(episode, resolveResumePosition(candidate, episode.durationSeconds), defaultSpeed())
    playWhenLoaded(episode.id)
  }

  // 開始した回が loading から paused に移ったとき 1 回だけ play する。domain は loadedmetadata で paused に止まる。
  // loading の間は待ち続け（loading 中の setSpeed は loading のまま）、それ以外で loading を出たら購読を解く。
  // 利用者の pause や置き換え・失敗・停止で終わった回では play しない。
  function playWhenLoaded(id: string): void {
    const started = session.state()
    if (started.status !== 'loading' || started.episode.id !== id) return
    let done = false
    const unsubscribe = session.subscribe((event) => {
      if (done || event.type !== 'stateChanged') return
      const state = event.state
      if (state.status === 'loading' && state.episode.id === id) return
      done = true
      unsubscribe()
      if (state.status === 'paused' && state.episode.id === id) void session.play()
    })
  }

  // キューを整えてから開始する。キューにあればその要素を現在にし、無ければ現在の次に挿入する。
  function arrangeAndBegin(episode: PlayableEpisode): void {
    let jumped = jump(queue, episode.id)
    if (!jumped.found) {
      queue = insertNext(queue, queueEntryOf({ id: episode.id, ...episode.label }))
      jumped = jump(queue, episode.id)
    }
    queue = jumped.queue
    notify()
    begin(episode)
  }

  // 自動の側を捨てる。判定結果に依存せず、1 つの手順として世代を進めて advance を戻し、印を消す。
  // 戻し先 endedId は待ち中は常に現在の直前にあり、戻した後の先頭は捨てた自動が解決していた回になる。
  function discardAuto(): void {
    if (autoPending === null) return
    epoch += 1
    queue = jump(queue, autoPending.endedId).queue
    autoPending = null
    notify()
  }

  async function startResolved(id: string): Promise<StartResult> {
    epoch += 1
    const mine = epoch
    userPending += 1
    try {
      const resolution = await resolve(id)
      if (epoch !== mine) {
        releaseUnused(resolution)
        return OK
      }
      if (!resolution.ok) return { ok: false, notice: resolution.notice }
      arrangeAndBegin(resolution.episode)
      return OK
    } finally {
      userPending -= 1
    }
  }

  async function resolveAuto(id: string, mine: number): Promise<void> {
    const resolution = await resolve(id)
    if (epoch !== mine) {
      releaseUnused(resolution)
      return
    }
    autoPending = null
    if (!resolution.ok) {
      session.fail({ id }, failReason(resolution))
      return
    }
    begin(resolution.episode)
  }

  function onEnded(endedId: string): void {
    if (userPending > 0) return
    const advanced = advance(queue)
    if (advanced.next === null) return
    queue = advanced.queue
    epoch += 1
    autoPending = { endedId }
    void resolveAuto(advanced.next.id, epoch)
  }

  session.subscribe((event) => {
    if (event.type === 'stateChanged' && event.state.status === 'ended') onEnded(event.state.episode.id)
    notify()
  })

  // session が idle でないとき、session の episode と現在の要素は削除・「次に再生」で動かさない
  // （動かすと現在の要素と再生中の episode が食い違う、または自動の戻し先を失う）。
  const isSessionEpisode = (id: string): boolean => {
    const state = session.state()
    return state.status !== 'idle' && state.episode.id === id
  }

  const nowPlaying = (): NowPlaying | null => toNowPlaying(current(queue), session.state())
  const upNext = (): ReadonlyArray<UpNextItem> => toUpNextItems(waitingEntries(queue))

  return {
    async startEpisode(id) {
      discardAuto()
      return startResolved(id)
    },

    async retry() {
      if (session.state().status !== 'errored') return
      const target = current(queue)
      if (target === null) return
      epoch += 1
      const mine = epoch
      userPending += 1
      try {
        const resolution = await resolve(target.id)
        if (epoch !== mine) {
          releaseUnused(resolution)
          return
        }
        if (!resolution.ok) {
          session.fail({ id: target.id }, failReason(resolution))
          return
        }
        begin(resolution.episode)
      } finally {
        userPending -= 1
      }
    },

    async skipToNext() {
      discardAuto()
      const next = waitingEntries(queue)[0]
      if (next === undefined) return OK
      epoch += 1
      const mine = epoch
      userPending += 1
      try {
        const resolution = await resolve(next.id)
        if (epoch !== mine) {
          releaseUnused(resolution)
          return OK
        }
        if (!resolution.ok) return { ok: false, notice: resolution.notice }
        // 待ち中に待機列の先頭が変わったら、解決した回は開始せず解放する。今の再生は続く。
        if (waitingEntries(queue)[0]?.id !== next.id) {
          releaseUnused(resolution)
          return OK
        }
        queue = advance(queue).queue
        notify()
        begin(resolution.episode)
        return OK
      } finally {
        userPending -= 1
      }
    },

    stopForSubjectLeave() {
      // 世代を進めるので、待ち中の解決は待ち明けに解放される。advance は戻さない（web-dec-72）。
      epoch += 1
      autoPending = null
      queue = emptyQueue
      notify()
      // reset してから stop: A の位置・完聴を B の確立後に送らない（web-dec-76）。
      positionReporter.reset()
      session.stop()
    },

    async addToQueue(input) {
      const idle = current(queue) === null
      queue = addEntry(queue, queueEntryOf(input))
      notify()
      return idle ? startResolved(input.id) : OK
    },

    async playNext(input) {
      if (isSessionEpisode(input.id)) return OK
      const idle = current(queue) === null
      queue = insertNext(queue, queueEntryOf(input))
      notify()
      return idle ? startResolved(input.id) : OK
    },

    removeFromQueue(id) {
      if (session.state().status !== 'idle' && (id === current(queue)?.id || isSessionEpisode(id))) return
      const next = removeEntry(queue, id)
      if (next === queue) return
      queue = next
      notify()
    },

    reorder(fromIndex, toOffset) {
      const next = moveUpNext(queue, fromIndex, toOffset)
      if (next === queue) return
      queue = next
      notify()
    },

    nowPlaying,
    upNext,
    queueView: () => toQueueView(nowPlaying(), upNext()),
    playbackView: () => toPlaybackView(session.state(), nowPlaying(), defaultSpeed()),
    savedPosition: (id) => localPositions.read(id),

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
