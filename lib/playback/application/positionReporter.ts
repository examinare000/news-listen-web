// 再生位置の記録規則（web-contract-11）。Session の事象を受けて、主体つきの記録を端末に書き、送信は outbox に任せる。
// 応答は待たず、再送の経路は outbox の 1 本だけ。失敗は lastSyncFailure() で読める。
import type { Clock, LocalPositionStore, PositionSubject, PositionSync } from '@/lib/playback/application/ports'
import type { PositionOutbox } from '@/lib/playback/application/positionOutbox'
import type { ResumeAdvisor } from '@/lib/playback/application/resumeAdvisor'
import type { PlaybackSession } from '@/lib/playback/application/session'
import type { PlaybackEvent, PlaybackState } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** 最後に保存した位置からこの秒数以上進んだら周期の書込を行う。 */
const SAVE_INTERVAL_SECONDS = 10

export interface PositionReporterDeps {
  readonly sync: PositionSync
  readonly outbox: Pick<PositionOutbox, 'flush'>
  readonly local: Pick<LocalPositionStore, 'write'>
  readonly clock: Clock
  readonly subject: PositionSubject
  /** この端末が記録したら、その episode の控えを外す（出来事の順で決め、時刻は比べない）。 */
  readonly advisor: Pick<ResumeAdvisor, 'clear'>
}

export interface PositionReporter {
  attach(session: Pick<PlaybackSession, 'subscribe'>): void
  detach(): void
  /** 購読は保ったまま、直前の再生を無かったことにする。以降の idle への遷移で位置を書かない（主体離脱の停止）。 */
  reset(): void
  /** 再生中・一時停止中の今の位置を、今の時刻で記録して送る（「この端末の位置から」の選択）。それ以外では何もしない。 */
  recordCurrent(): void
  lastSyncFailure(): ApiFailure | null
}

export function createPositionReporter(deps: PositionReporterDeps): PositionReporter {
  const { sync, outbox, local, clock, subject, advisor } = deps

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

  // 記録の主体が無いときは記録も送信もしない。保存に失敗した記録も、その回の送信には直接渡す。
  const record = (id: string, seconds: number): void => {
    const user = subject.recording()
    if (user === null) return
    const entry = { positionSeconds: seconds, recordedAt: Math.floor(clock()), synced: false }
    const persisted = local.write(user, id, entry)
    track(persisted ? outbox.flush() : outbox.flush({ episodeId: id, record: entry }))
    advisor.clear(id)
  }

  const write = (seconds: number): void => {
    record(episodeId, seconds)
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
        // paused の間に動かした位置は、次の episode へ切り替わる前に前の episode へ記録する。
        if (previous === 'paused' && lastKnown !== lastSaved) write(lastKnown)
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
    const total = totalDuration()
    if (total > 0) record(episodeId, total)
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
    reset() {
      lastStatus = 'idle'
      episodeId = ''
    },
    recordCurrent() {
      if ((lastStatus !== 'playing' && lastStatus !== 'paused') || episodeId === '') return
      write(lastKnown)
    },
    lastSyncFailure: () => failure,
  }
}
