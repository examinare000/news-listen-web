// 再生位置の送信規則（web-contract-11）。Session の事象を受けて、端末の位置と server への位置を書く。
// 応答は待たず再送もしない。失敗は lastSyncFailure() で読める。
import type { LocalPositionStore, PositionSync } from '@/lib/playback/application/ports'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackEvent, PlaybackState } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** 最後に保存した位置からこの秒数以上進んだら周期の書込を行う。 */
const SAVE_INTERVAL_SECONDS = 10

export interface PositionReporterDeps {
  readonly sync: PositionSync
  readonly local: LocalPositionStore
}

export interface PositionReporter {
  attach(session: Pick<PlaybackSession, 'subscribe'>): void
  detach(): void
  lastSyncFailure(): ApiFailure | null
}

export function createPositionReporter(deps: PositionReporterDeps): PositionReporter {
  const { sync, local } = deps

  let unsubscribe: (() => void) | null = null
  let episodeId = ''
  let episodeDuration = 0
  let lastStatus: PlaybackState['status'] = 'idle'
  let lastDuration = 0
  let lastKnown = 0
  let lastSaved = 0
  let completedSent = false
  let failure: ApiFailure | null = null

  const track = (pending: Promise<Result<void, ApiFailure>>): void => {
    void pending.then((result) => {
      if (!result.ok) failure = result.failure
    })
  }

  const send = (id: string, seconds: number): void => {
    track(sync.updatePosition(id, seconds))
  }

  const write = (seconds: number): void => {
    local.write(episodeId, seconds)
    send(episodeId, seconds)
    lastSaved = seconds
  }

  // 完聴の総時間: 状態の duration → episode の総時間 → 最後に分かっている位置。すべて 0 なら 0。
  const totalDuration = (): number => {
    if (lastDuration > 0) return lastDuration
    if (episodeDuration > 0) return episodeDuration
    return lastKnown > 0 ? lastKnown : 0
  }

  const onStateChanged = (state: PlaybackState): void => {
    const previous = lastStatus
    lastStatus = state.status
    switch (state.status) {
      case 'loading':
        episodeId = state.episode.id
        episodeDuration = state.episode.durationSeconds
        lastDuration = 0
        lastSaved = state.resumePosition
        lastKnown = state.resumePosition
        completedSent = false
        return
      case 'playing':
        lastDuration = state.duration
        return
      case 'paused':
        lastDuration = state.duration
        if (previous === 'playing') {
          lastKnown = state.position
          // 一時停止した位置は、巻き戻した位置も含めて書く。
          if (lastKnown !== lastSaved) write(lastKnown)
        }
        return
      case 'idle':
        if ((previous === 'playing' || previous === 'paused') && lastKnown !== lastSaved) write(lastKnown)
        return
      case 'ended':
        lastDuration = state.duration
        return
      case 'errored':
        return
    }
  }

  const onPositionChanged = (seconds: number): void => {
    if (lastStatus === 'playing') {
      lastKnown = seconds
      if (seconds - lastSaved >= SAVE_INTERVAL_SECONDS) write(seconds)
    } else if (lastStatus === 'paused') {
      // 一時停止中の seek は周期の書込をしない。次の停止への遷移で書く。
      lastKnown = seconds
    }
  }

  // 完聴の記録は backend の first-write-wins に依存する。同じ再生で 2 回目以降を送らないのはこの前提による。
  const onListenCompleted = (): void => {
    if (completedSent) return
    completedSent = true
    track(sync.markCompleted(episodeId))
    local.write(episodeId, 0)
    const total = totalDuration()
    if (total > 0) send(episodeId, total)
  }

  const handle = (event: PlaybackEvent): void => {
    switch (event.type) {
      case 'stateChanged':
        onStateChanged(event.state)
        return
      case 'positionChanged':
        onPositionChanged(event.seconds)
        return
      case 'listenCompleted':
        onListenCompleted()
        return
    }
  }

  return {
    attach(session) {
      unsubscribe?.()
      unsubscribe = session.subscribe(handle)
    },
    detach() {
      unsubscribe?.()
      unsubscribe = null
    },
    lastSyncFailure: () => failure,
  }
}
