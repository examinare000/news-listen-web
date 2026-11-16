// 再生位置の送信と取り込み。端末の記録（LocalPositionStore）を正とし、送信済みの印は記録時刻の一致でだけ付ける。
import { isNewerRecord } from '@/lib/playback/domain/positionRecord'
import type {
  LocalPositionStore,
  PositionSubject,
  PositionSync,
  RemotePosition,
  UnsentPosition,
} from '@/lib/playback/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface IntakeItem {
  readonly id: string
  readonly positionSeconds: number
  readonly recordedAt: number | null
}

/** capture した時点の主体の記録にだけ、サーバーの値を取り込む。 */
type IntakeSink = (items: ReadonlyArray<IntakeItem>) => void

/** 一覧・詳細の取得が見た位置を取り込む入口。 */
export interface PositionIntake {
  /** 呼出時点の sending の主体を控える。応答の時点で主体が変わっていれば何もしない。 */
  capture(): IntakeSink
}

export interface PositionOutbox extends PositionIntake {
  /** unpersisted は保存庫に無い記録で、その回の送信にだけ加える。実行中なら待たずに ok で戻る。 */
  flush(unpersisted?: UnsentPosition): Promise<Result<void, ApiFailure>>
  /** 厳密に新しい値だけが既存の記録を置き換える。記録は作らない。 */
  adopt(userId: string, episodeId: string, remote: RemotePosition): void
}

type Pending = { readonly owner: string; readonly item: UnsentPosition }

const OK: Result<void, ApiFailure> = { ok: true, value: undefined }

// 再送しても結果が変わらない失敗。送信済みにして記録を残す。
const isPermanent = (failure: ApiFailure): boolean =>
  failure.kind === 'not_found' || (failure.kind === 'validation' && failure.reason === 'schema')

const keyOf = (userId: string, item: UnsentPosition): string =>
  `${userId}\u0000${item.episodeId}\u0000${item.record.recordedAt}`

export function createPositionOutbox(deps: {
  readonly sync: PositionSync
  readonly local: LocalPositionStore
  readonly subject: PositionSubject
  /** 取り込みで端末の記録を置き換えた直後に 1 回呼ぶ。 */
  readonly onAdopted?: (episodeId: string, remote: RemotePosition) => void
}): PositionOutbox {
  const { sync, local, subject, onAdopted } = deps
  let running = false
  let pending: Pending[] = []

  function adopt(userId: string, episodeId: string, remote: RemotePosition): void {
    const existing = local.read(userId, episodeId)
    if (existing === null || remote.recordedAt === null) return
    if (!isNewerRecord(remote, existing)) return
    local.write(userId, episodeId, {
      positionSeconds: remote.positionSeconds,
      recordedAt: remote.recordedAt,
      synced: true,
    })
    onAdopted?.(episodeId, remote)
  }

  async function run(): Promise<Result<void, ApiFailure>> {
    // 1 回の flush の中で同じ (主体, episode, 記録時刻) を 2 度送らない。印が付かなくても止まるため。
    const sent = new Set<string>()
    try {
      for (;;) {
        const owner = subject.sending()
        if (owner === null) return OK
        pending = pending.filter((p) => p.owner === owner)
        const next = [...local.unsent(owner), ...pending.map((p) => p.item)]
          .filter((item) => !sent.has(keyOf(owner, item)))
          .sort((a, b) => a.record.recordedAt - b.record.recordedAt)[0]
        if (next === undefined) return OK
        sent.add(keyOf(owner, next))

        const response = await sync.updatePosition(next.episodeId, next.record.positionSeconds, next.record.recordedAt)

        // 応答の時点で主体が変わっていれば、印も取り込みもせず新しい主体でやり直す。
        if (subject.sending() !== owner) continue

        if (response.ok) {
          local.markSynced(owner, next.episodeId, next.record.recordedAt)
          adopt(owner, next.episodeId, response.value)
        } else if (isPermanent(response.failure)) {
          local.markSynced(owner, next.episodeId, next.record.recordedAt)
        } else {
          return response
        }
      }
    } finally {
      pending = []
      running = false
    }
  }

  return {
    flush(unpersisted) {
      if (unpersisted !== undefined) {
        const owner = subject.recording()
        if (owner !== null) pending.push({ owner, item: unpersisted })
      }
      if (running) return Promise.resolve(OK)
      running = true
      return run()
    },
    adopt,
    capture() {
      const owner = subject.sending()
      return (items) => {
        if (owner === null || subject.sending() !== owner) return
        for (const item of items) {
          adopt(owner, item.id, { positionSeconds: item.positionSeconds, recordedAt: item.recordedAt })
        }
      }
    },
  }
}
