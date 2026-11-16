// @vitest-environment node
// PositionOutbox の契約テスト（ADR-109 決定 8・9・13・14、shared-dec-34・36・37）。
// 通信・保存・主体はすべて手書きの fake。保存庫の fake は本物と同じく「主体 × episode で最新 1 件」と
// 「recordedAt が一致するときだけ印を付ける」を守る（守らないと照合の欠陥を検出できない）。
//
// RED 理由（実装前）: `@/lib/playback/application/positionOutbox` が存在せず、ports に新しい型も無い。
import { describe, expect, test } from 'vitest'
import { createPositionOutbox } from '@/lib/playback/application/positionOutbox'
import type {
  LocalPositionStore,
  PositionSubject,
  PositionSync,
  RemotePosition,
  StoredPosition,
  UnsentPosition,
} from '@/lib/playback/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type SyncResult = Result<RemotePosition, ApiFailure>
type Call = { readonly id: string; readonly seconds: number; readonly recordedAt: number }
type Responder = (call: Call) => SyncResult | Promise<SyncResult>

const T0 = 500
const T1 = 1_000
const T2 = 2_000
const T3 = 3_000

const ok = (positionSeconds: number, recordedAt: number | null): SyncResult => ({
  ok: true,
  value: { positionSeconds, recordedAt },
})
const fail = (failure: ApiFailure): SyncResult => ({ ok: false, failure })
// 応答は送った位置を返し、時刻は返さない（取り込みの対象にならない）。
const echo: Responder = (call) => ok(call.seconds, null)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// マイクロタスクを使い切らせる（実時間は待たない）。
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

type Entry = { user: string; id: string; record: StoredPosition }

function createFakeLocal(options: { markSyncedSticks?: boolean } = {}) {
  const entries = new Map<string, Entry>()
  const keyOf = (user: string, id: string) => `${user}\u0000${id}`
  const local: LocalPositionStore = {
    read: (user, id) => entries.get(keyOf(user, id))?.record ?? null,
    write: (user, id, record) => {
      entries.set(keyOf(user, id), { user, id, record })
      return true
    },
    unsent: (user) =>
      [...entries.values()]
        .filter((e) => e.user === user && !e.record.synced)
        .map((e) => ({ episodeId: e.id, record: e.record })),
    markSynced: (user, id, recordedAt) => {
      if (options.markSyncedSticks === false) return
      const current = entries.get(keyOf(user, id))
      if (current && current.record.recordedAt === recordedAt) {
        entries.set(keyOf(user, id), { ...current, record: { ...current.record, synced: true } })
      }
    },
    clearSubject: (user) => {
      for (const [k, e] of [...entries]) if (e.user === user) entries.delete(k)
    },
    reclaim: (keep) => {
      for (const [k, e] of [...entries]) if (e.user !== keep) entries.delete(k)
    },
    discardLegacy: () => {},
  }
  return { local, entries }
}

const MAX_CALLS = 20

function createFakeSync(scripted: ReadonlyArray<Responder> = [], fallback: Responder = echo) {
  const calls: Call[] = []
  let inFlight = 0
  let maxInFlight = 0
  const sync: PositionSync = {
    updatePosition: async (id, seconds, recordedAt) => {
      const call = { id, seconds, recordedAt }
      // 無限に送り続ける実装が test を止めないようにする。
      if (calls.length >= MAX_CALLS) throw new Error('runaway: updatePosition が呼ばれすぎ')
      const responder = scripted[calls.length] ?? fallback
      calls.push(call)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        return await responder(call)
      } finally {
        inFlight -= 1
      }
    },
    markCompleted: async () => ({ ok: true, value: undefined }),
  }
  return { sync, calls, maxInFlight: () => maxInFlight }
}

function setup(
  options: {
    scripted?: ReadonlyArray<Responder>
    fallback?: Responder
    sending?: string | null
    recording?: string | null
    markSyncedSticks?: boolean
  } = {},
) {
  const { local, entries } = createFakeLocal({ markSyncedSticks: options.markSyncedSticks })
  const fake = createFakeSync(options.scripted, options.fallback)
  const state = {
    sending: options.sending === undefined ? 'u-a' : options.sending,
    recording: options.recording === undefined ? (options.sending === undefined ? 'u-a' : options.sending) : options.recording,
  }
  const subject: PositionSubject = { recording: () => state.recording, sending: () => state.sending }
  // onAdopted の呼出を、呼ばれた時点の保存庫の記録とともに控える（write の後に呼ばれたかを見るため）。
  const adopted: Array<{ episodeId: string; remote: RemotePosition; stored: StoredPosition | null }> = []
  const outbox = createPositionOutbox({
    sync: fake.sync,
    local,
    subject,
    onAdopted: (episodeId, remote) => {
      adopted.push({ episodeId, remote, stored: local.read(state.sending ?? state.recording ?? '', episodeId) })
    },
  })
  return { outbox, local, entries, state, adopted, ...fake }
}

const seed = (local: LocalPositionStore, user: string, id: string, positionSeconds: number, recordedAt: number, synced = false) =>
  local.write(user, id, { positionSeconds, recordedAt, synced })

const unsentOf = (episodeId: string, positionSeconds: number, recordedAt: number): UnsentPosition => ({
  episodeId,
  record: { positionSeconds, recordedAt, synced: false },
})

describe('shared-sync-03 / ADR-109 決定 8（新規）: network 失敗で未送信のまま残り、次の flush で同じ記録時刻で再送して送信済みにする', () => {
  test('network 失敗で synced:false のまま、次の flush が同じ (位置, 記録時刻) で再送して synced:true にする', async () => {
    const h = setup({ scripted: [() => fail({ kind: 'network' })] })
    seed(h.local, 'u-a', 'a', 12, T1)

    const first = await h.outbox.flush()
    expect(first).toEqual({ ok: false, failure: { kind: 'network' } })
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 12, recordedAt: T1, synced: false })

    const second = await h.outbox.flush()
    expect(second.ok).toBe(true)
    expect(h.calls).toEqual([
      { id: 'a', seconds: 12, recordedAt: T1 },
      { id: 'a', seconds: 12, recordedAt: T1 },
    ])
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 12, recordedAt: T1, synced: true })
  })

  test('送信済みの記録は次の flush で送らない（正方向の対照: 未送信だけが送られる）', async () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 12, T1, true)
    seed(h.local, 'u-a', 'b', 7, T2, false)

    await h.outbox.flush()

    expect(h.calls).toEqual([{ id: 'b', seconds: 7, recordedAt: T2 }])
  })
})

describe('shared-sync-04: 応答待ちの間の新しい記録を古い応答で送信済みにしない', () => {
  test('T1 の応答待ちの間に T2 を書くと、T1 の成功で T2 は未送信のまま残り、続けて T2 が送られて送信済みになる', async () => {
    const gate1 = deferred<SyncResult>()
    const gate2 = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate1.promise, () => gate2.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)

    const running = h.outbox.flush()
    await settle()
    expect(h.calls).toEqual([{ id: 'a', seconds: 10, recordedAt: T1 }])

    seed(h.local, 'u-a', 'a', 20, T2)
    gate1.resolve(ok(10, null))
    await settle()

    // T1 の成功は T2 の記録を送信済みにしない。
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 20, recordedAt: T2, synced: false })
    expect(h.calls).toEqual([
      { id: 'a', seconds: 10, recordedAt: T1 },
      { id: 'a', seconds: 20, recordedAt: T2 },
    ])

    gate2.resolve(ok(20, null))
    await running
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 20, recordedAt: T2, synced: true })
  })
})

describe('shared-sync-05: 404 と 422（validation の schema）は送信済みにして記録を残し再送しない・400（validation の rule）・401・403・409・429・500・network・timeout は残る', () => {
  const permanent: ReadonlyArray<[string, ApiFailure]> = [
    ['404 not_found', { kind: 'not_found' }],
    ['422 validation(schema)', { kind: 'validation', detail: 'schema', reason: 'schema' }],
  ]
  const transient: ReadonlyArray<[string, ApiFailure]> = [
    ['400 validation(rule)', { kind: 'validation', detail: 'rule', reason: 'rule' }],
    ['validation(reason なし)', { kind: 'validation', detail: 'x' }],
    ['401 unauthorized', { kind: 'unauthorized' }],
    ['403 forbidden', { kind: 'forbidden' }],
    ['409 conflict', { kind: 'conflict' }],
    ['429 rate_limited', { kind: 'rate_limited', retryAfterSeconds: 3, scope: 'unknown', detail: 'slow down' }],
    ['500 server', { kind: 'server', status: 500 }],
    ['unknown', { kind: 'unknown', status: 418 }],
    ['network', { kind: 'network' }],
    ['timeout', { kind: 'timeout' }],
  ]

  test.each(permanent)('恒久失敗 %s: 送信済みにして記録を残し、次の記録へ進み、再送しない', async (_name, failure) => {
    const h = setup({ scripted: [() => fail(failure)] })
    seed(h.local, 'u-a', 'a', 12, T1)
    seed(h.local, 'u-a', 'b', 7, T2)

    const result = await h.outbox.flush()

    expect(result.ok).toBe(true)
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 12, recordedAt: T1, synced: true })
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'b'])
    expect(h.local.read('u-a', 'b')).toEqual({ positionSeconds: 7, recordedAt: T2, synced: true })

    await h.outbox.flush()
    expect(h.calls).toHaveLength(2)
  })

  test.each(transient)('一時失敗 %s: 未送信のまま残り、その回の残りは送らず、失敗を返す', async (_name, failure) => {
    const h = setup({ scripted: [() => fail(failure)] })
    seed(h.local, 'u-a', 'a', 12, T1)
    seed(h.local, 'u-a', 'b', 7, T2)

    const result = await h.outbox.flush()

    expect(result).toEqual({ ok: false, failure })
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 12, recordedAt: T1, synced: false })
    expect(h.local.read('u-a', 'b')).toEqual({ positionSeconds: 7, recordedAt: T2, synced: false })
    expect(h.calls).toEqual([{ id: 'a', seconds: 12, recordedAt: T1 }])
  })
})

describe('送信の対象と順序', () => {
  test('sending が null の間は 1 件も送らない', async () => {
    const h = setup({ sending: null, recording: 'u-a' })
    seed(h.local, 'u-a', 'a', 12, T1)

    const result = await h.outbox.flush()

    expect(result.ok).toBe(true)
    expect(h.calls).toEqual([])
    expect(h.local.read('u-a', 'a')?.synced).toBe(false)
  })

  test('sending の主体の記録だけを送り、別の主体の記録は送らない', async () => {
    const h = setup({ sending: 'u-a' })
    seed(h.local, 'u-a', 'a', 12, T1)
    seed(h.local, 'u-b', 'b', 7, T2)

    await h.outbox.flush()

    expect(h.calls).toEqual([{ id: 'a', seconds: 12, recordedAt: T1 }])
    expect(h.local.read('u-b', 'b')?.synced).toBe(false)
  })

  test('送信は記録時刻の古い順で、同じ episode は同時に 1 件', async () => {
    const gates = [deferred<SyncResult>(), deferred<SyncResult>(), deferred<SyncResult>(), deferred<SyncResult>()]
    const h = setup({ scripted: gates.map((g) => () => g.promise) })
    seed(h.local, 'u-a', 'c', 3, T3)
    seed(h.local, 'u-a', 'a', 1, T1)
    seed(h.local, 'u-a', 'b', 2, T2)

    const running = h.outbox.flush({ episodeId: 'a', record: { positionSeconds: 9, recordedAt: T3 + 1, synced: false } })
    for (const [i, gate] of gates.entries()) {
      await settle()
      // 前の応答を待ってから次を送る。
      expect(h.calls).toHaveLength(i + 1)
      gate.resolve(ok(0, null))
    }
    await running

    expect(h.calls).toEqual([
      { id: 'a', seconds: 1, recordedAt: T1 },
      { id: 'b', seconds: 2, recordedAt: T2 },
      { id: 'c', seconds: 3, recordedAt: T3 },
      { id: 'a', seconds: 9, recordedAt: T3 + 1 },
    ])
    expect(h.maxInFlight()).toBe(1)
  })
})

describe('単一飛行と詰まり・flush(unpersisted)・主体が変わった回のやり直し', () => {
  test('送信中の 2 回目の flush は待たずに { ok: true } で戻り、実行中の 1 回が新しい記録を続けて送る', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)

    const running = h.outbox.flush()
    await settle()
    seed(h.local, 'u-a', 'b', 5, T2)

    // 実行中の 1 回が終わるのを待たずに戻る（待つならこの await で止まる）。
    const second = await h.outbox.flush()
    expect(second.ok).toBe(true)
    expect(h.calls).toHaveLength(1)
    expect(h.maxInFlight()).toBe(1)

    gate.resolve(ok(10, null))
    await running

    expect(h.calls).toEqual([
      { id: 'a', seconds: 10, recordedAt: T1 },
      { id: 'b', seconds: 5, recordedAt: T2 },
    ])
    expect(h.local.read('u-a', 'b')?.synced).toBe(true)
  })

  test('一時失敗が出たら、成功済みの記録だけ送信済みになり、失敗した記録とそれより後ろは送らず未送信のまま残る', async () => {
    const h = setup({
      scripted: [() => ok(1, null), () => fail({ kind: 'server', status: 500 })],
    })
    seed(h.local, 'u-a', 'a', 1, T1)
    seed(h.local, 'u-a', 'b', 2, T2)
    seed(h.local, 'u-a', 'c', 3, T3)

    const result = await h.outbox.flush()

    expect(result).toEqual({ ok: false, failure: { kind: 'server', status: 500 } })
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'b'])
    expect(h.local.read('u-a', 'a')?.synced).toBe(true)
    expect(h.local.read('u-a', 'b')?.synced).toBe(false)
    expect(h.local.read('u-a', 'c')?.synced).toBe(false)
  })

  test('flush(unpersisted) は保存庫に無い記録も送り、成功しても保存庫に記録を作らず壊さない', async () => {
    const h = setup()

    const result = await h.outbox.flush(unsentOf('p', 7, T2))

    expect(result.ok).toBe(true)
    expect(h.calls).toEqual([{ id: 'p', seconds: 7, recordedAt: T2 }])
    expect(h.entries.size).toBe(0)
  })

  test('flush(unpersisted) の記録が保存庫の同じ episode の別の記録時刻の記録を送信済みにしない', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'p', 20, T3)

    const running = h.outbox.flush(unsentOf('p', 7, T2))
    await settle()
    expect(h.calls).toEqual([{ id: 'p', seconds: 7, recordedAt: T2 }])
    gate.resolve(ok(7, null))
    await settle()

    // T2 の成功は T3 の保存済み記録を送信済みにしない。T3 は続けて送られる。
    expect(h.calls).toEqual([
      { id: 'p', seconds: 7, recordedAt: T2 },
      { id: 'p', seconds: 20, recordedAt: T3 },
    ])
    await running
    expect(h.local.read('u-a', 'p')).toEqual({ positionSeconds: 20, recordedAt: T3, synced: true })
  })

  test('flush(unpersisted) が失敗しても、その記録は次の flush() では送らない（その回に限る）', async () => {
    const h = setup({ scripted: [() => fail({ kind: 'network' })] })

    const first = await h.outbox.flush(unsentOf('p', 7, T2))
    expect(first).toEqual({ ok: false, failure: { kind: 'network' } })

    await h.outbox.flush()
    expect(h.calls).toHaveLength(1)
  })

  test('markSynced の印が付かなくても、1 回の flush で同じ (episode, recordedAt) を 2 度送らない', async () => {
    const h = setup({ markSyncedSticks: false })
    seed(h.local, 'u-a', 'a', 12, T1)

    const result = await h.outbox.flush()

    expect(result.ok).toBe(true)
    expect(h.calls).toEqual([{ id: 'a', seconds: 12, recordedAt: T1 }])
  })

  test('A の送信中に主体が B になり B の flush が捨てられても、A の応答の後に B の未送信が送られ、A の記録は印も取り込みもされない', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)
    seed(h.local, 'u-b', 'b', 30, T2)

    const running = h.outbox.flush()
    await settle()
    expect(h.calls).toEqual([{ id: 'a', seconds: 10, recordedAt: T1 }])

    h.state.sending = 'u-b'
    h.state.recording = 'u-b'
    const discarded = await h.outbox.flush()
    expect(discarded.ok).toBe(true)
    expect(h.calls).toHaveLength(1)

    // 新しい時刻の応答でも、離脱した A の記録は書き換わらない。
    gate.resolve(ok(99, T3))
    const result = await running

    expect(result.ok).toBe(true)
    expect(h.calls).toEqual([
      { id: 'a', seconds: 10, recordedAt: T1 },
      { id: 'b', seconds: 30, recordedAt: T2 },
    ])
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 10, recordedAt: T1, synced: false })
    expect(h.local.read('u-b', 'b')).toEqual({ positionSeconds: 30, recordedAt: T2, synced: true })
  })

  test('保存失敗した A の記録は、A の PATCH 保留中に B へ交代して B でやり直した回では 1 度も送られず、B の未送信だけが送られる', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'x', 1, T1)
    seed(h.local, 'u-b', 'z', 3, T3)

    const running = h.outbox.flush()
    await settle()
    expect(h.calls).toEqual([{ id: 'x', seconds: 1, recordedAt: T1 }])

    // A の別の記録は保存に失敗した（保存庫に無い）。持ち主は呼出時点の recording() = A。
    const savedFailed = await h.outbox.flush(unsentOf('y', 2, T2))
    expect(savedFailed.ok).toBe(true)

    // B へ直接交代して B の flush（実行中なので捨てられる）。
    h.state.recording = 'u-b'
    h.state.sending = 'u-b'
    await h.outbox.flush()

    gate.resolve(ok(1, null))
    await running

    expect(h.calls.map((c) => c.id)).toEqual(['x', 'z'])
    expect(h.calls.some((c) => c.id === 'y')).toBe(false)
    expect(h.local.read('u-b', 'z')?.synced).toBe(true)
    expect(h.entries.size).toBe(2)
  })

  test('対照: 交代が無ければ、同じ保存失敗の記録は A の回の中で続けて送られる', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'x', 1, T1)

    const running = h.outbox.flush()
    await settle()
    const savedFailed = await h.outbox.flush(unsentOf('y', 2, T2))
    expect(savedFailed.ok).toBe(true)

    gate.resolve(ok(1, null))
    await running

    expect(h.calls).toEqual([
      { id: 'x', seconds: 1, recordedAt: T1 },
      { id: 'y', seconds: 2, recordedAt: T2 },
    ])
  })

  test('持ち主が決まらない（呼出時点の recording() が null の）保存失敗の記録は送らずに捨てる', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'x', 1, T1)

    const running = h.outbox.flush()
    await settle()
    h.state.recording = null
    await h.outbox.flush(unsentOf('y', 2, T2))
    h.state.recording = 'u-a'

    gate.resolve(ok(1, null))
    await running

    expect(h.calls.map((c) => c.id)).toEqual(['x'])
  })
})

describe('shared-sync-06 / ADR-109 決定 9（新規）: 厳密に新しい応答だけ既存の記録を置き換え、同時刻・時刻なし・古い・記録なしでは変えず記録も作らない', () => {
  type Case = { label: string; remote: RemotePosition; replaced: boolean }
  const cases: ReadonlyArray<Case> = [
    { label: '(a) 厳密に新しい', remote: { positionSeconds: 80, recordedAt: T2 }, replaced: true },
    { label: '(b) 同時刻', remote: { positionSeconds: 80, recordedAt: T1 }, replaced: false },
    { label: '(c) 時刻なし', remote: { positionSeconds: 80, recordedAt: null }, replaced: false },
    { label: '(d) 古い', remote: { positionSeconds: 80, recordedAt: T0 }, replaced: false },
  ]

  test('adopt と PATCH の応答の両方で、規則どおりに置き換え・何もしない・記録を作らない', async () => {
    for (const c of cases) {
      // 入口 1: adopt（一覧・詳細・開始前の再取得が通る関数）。
      const viaAdopt = setup()
      seed(viaAdopt.local, 'u-a', 'a', 30, T1, true)
      viaAdopt.outbox.adopt('u-a', 'a', c.remote)
      expect(viaAdopt.local.read('u-a', 'a'), `adopt ${c.label}`).toEqual(
        c.replaced
          ? { positionSeconds: 80, recordedAt: T2, synced: true }
          : { positionSeconds: 30, recordedAt: T1, synced: true },
      )

      // 入口 2: PATCH の応答。送った記録は成功で送信済みになり、その後に応答が取り込まれる。
      const viaResponse = setup({ fallback: () => ({ ok: true, value: c.remote }) })
      seed(viaResponse.local, 'u-a', 'a', 30, T1)
      await viaResponse.outbox.flush()
      expect(viaResponse.local.read('u-a', 'a'), `response ${c.label}`).toEqual(
        c.replaced
          ? { positionSeconds: 80, recordedAt: T2, synced: true }
          : { positionSeconds: 30, recordedAt: T1, synced: true },
      )
    }
  })

  test('adopt は 2 回目（同時刻）では何も変えない', () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 30, T1, true)

    h.outbox.adopt('u-a', 'a', { positionSeconds: 80, recordedAt: T2 })
    h.outbox.adopt('u-a', 'a', { positionSeconds: 5, recordedAt: T2 })

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 80, recordedAt: T2, synced: true })
  })

  test('記録の無い episode は、新しい値が adopt・PATCH の応答のどちらで届いても記録を作らない', async () => {
    const adopted = setup()
    adopted.outbox.adopt('u-a', 'a', { positionSeconds: 80, recordedAt: T3 })
    expect(adopted.entries.size).toBe(0)

    // 保存に失敗した記録の PATCH の応答（保存庫に記録が無い）。
    const responded = setup({ fallback: () => ok(80, T3) })
    await responded.outbox.flush(unsentOf('a', 30, T1))
    expect(responded.calls).toHaveLength(1)
    expect(responded.entries.size).toBe(0)
  })

  test('adopt は指定した主体の記録だけを置き換え、別の主体の記録は変えない', () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 30, T1, true)
    seed(h.local, 'u-b', 'a', 40, T1, true)

    h.outbox.adopt('u-a', 'a', { positionSeconds: 80, recordedAt: T2 })

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 80, recordedAt: T2, synced: true })
    expect(h.local.read('u-b', 'a')).toEqual({ positionSeconds: 40, recordedAt: T1, synced: true })
  })
})

describe('shared-leave-14 / ADR-109 決定 13（新規）: 応答の時点で sending の主体が変わっていれば印も取り込みもしない', () => {
  test.each<[string, string | null]>([
    ['別の主体 B に直接交代', 'u-b'],
    ['主体が無くなる（logout・失効）', null],
  ])('%s: A の記録に印も取り込みもせず、A の key を作り直さない', async (_name, next) => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)

    const running = h.outbox.flush()
    await settle()
    expect(h.calls).toHaveLength(1)

    h.state.sending = next
    h.state.recording = next
    // 新しい時刻の応答でも取り込まない。
    gate.resolve(ok(80, T3))
    const result = await running

    expect(result.ok).toBe(true)
    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 10, recordedAt: T1, synced: false })
    expect(h.calls).toHaveLength(1)
  })

  test('離脱で A の記録が消えた後に応答が来ても、A の記録は作られない', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)

    const running = h.outbox.flush()
    await settle()
    h.local.clearSubject('u-a')
    h.state.sending = null
    h.state.recording = null
    gate.resolve(ok(80, T3))
    await running

    expect(h.entries.size).toBe(0)
  })

  test('応答の時点でも同じ主体なら、同じ入口から新しい応答が取り込まれる（正方向の対照）', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)

    const running = h.outbox.flush()
    await settle()
    gate.resolve(ok(80, T3))
    await running

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 80, recordedAt: T3, synced: true })
  })
})

describe('shared-leave-14: capture した主体と応答の時点の主体が違えば取り込まない（一覧・詳細の遅い応答が別の主体の記録を書き換えない）', () => {
  const item = { id: 'a', positionSeconds: 80, recordedAt: T2 }

  test('capture の後に主体が別の主体へ変わっていれば、どちらの主体の記録も変えない', () => {
    const h = setup({ sending: 'u-a' })
    seed(h.local, 'u-a', 'a', 30, T1, true)
    seed(h.local, 'u-b', 'a', 30, T1, true)

    const apply = h.outbox.capture()
    h.state.sending = 'u-b'
    apply([item])

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 30, recordedAt: T1, synced: true })
    expect(h.local.read('u-b', 'a')).toEqual({ positionSeconds: 30, recordedAt: T1, synced: true })
  })

  test('capture の後に主体が無くなっていれば取り込まない', () => {
    const h = setup({ sending: 'u-a' })
    seed(h.local, 'u-a', 'a', 30, T1, true)

    const apply = h.outbox.capture()
    h.state.sending = null
    apply([item])

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 30, recordedAt: T1, synced: true })
  })

  test('capture の時点で主体が無ければ、後で主体が確定しても取り込まない', () => {
    const h = setup({ sending: null, recording: null })
    seed(h.local, 'u-a', 'a', 30, T1, true)

    const apply = h.outbox.capture()
    apply([item])
    h.state.sending = 'u-a'
    apply([item])

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 30, recordedAt: T1, synced: true })
  })

  test('同じ主体のままなら、控えた主体の記録だけが厳密に新しいときに置き換わり、記録の無い episode は作られない（正方向の対照）', () => {
    const h = setup({ sending: 'u-a' })
    seed(h.local, 'u-a', 'a', 30, T1, true)
    seed(h.local, 'u-b', 'a', 30, T1, true)

    const apply = h.outbox.capture()
    apply([item, { id: 'none', positionSeconds: 9, recordedAt: T3 }])

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 80, recordedAt: T2, synced: true })
    expect(h.local.read('u-b', 'a')).toEqual({ positionSeconds: 30, recordedAt: T1, synced: true })
    expect(h.local.read('u-a', 'none')).toBeNull()
    expect(h.entries.size).toBe(2)
  })
})

describe('ADR-109 決定 14（新規）: 位置が小さくても時刻が新しければ送り、応答の巻き戻した位置を採用する', () => {
  test('40 の後に 5 へ巻き戻した記録を、位置が小さくても新しい時刻で送る', async () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 40, T1, true)
    seed(h.local, 'u-a', 'a', 5, T2)

    await h.outbox.flush()

    expect(h.calls).toEqual([{ id: 'a', seconds: 5, recordedAt: T2 }])
  })

  test('サーバーが新しい時刻で返した巻き戻した位置を、既存の記録の位置が大きくても採用する', async () => {
    const h = setup({ fallback: () => ok(3, T3) })
    seed(h.local, 'u-a', 'a', 40, T1, true)
    seed(h.local, 'u-a', 'a', 5, T2)

    await h.outbox.flush()

    expect(h.local.read('u-a', 'a')).toEqual({ positionSeconds: 3, recordedAt: T3, synced: true })
  })
})

describe('web-dec-165 / shared-dec-39: onAdopted は取り込みで置き換えたときだけ 1 回呼ばれる（PATCH の応答・capture・開始前の再取得）', () => {
  const replaced = { positionSeconds: 80, recordedAt: T2, synced: true }

  test('adopt（一覧・詳細・開始前の再取得が通る関数）で置き換えると 1 回、(episodeId, remote) で、local.write の後に呼ばれる', () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 30, T1, true)

    h.outbox.adopt('u-a', 'a', { positionSeconds: 80, recordedAt: T2 })

    expect(h.adopted).toEqual([{ episodeId: 'a', remote: { positionSeconds: 80, recordedAt: T2 }, stored: replaced }])
  })

  test('PATCH の応答が厳密に新しければ、送信済みの印の後に置き換えて 1 回呼ばれる', async () => {
    const h = setup({ fallback: () => ok(80, T2) })
    seed(h.local, 'u-a', 'a', 30, T1)

    await h.outbox.flush()

    expect(h.adopted).toEqual([{ episodeId: 'a', remote: { positionSeconds: 80, recordedAt: T2 }, stored: replaced }])
  })

  test('capture の sink が複数の項目を取り込むと、置き換えた項目の分だけ呼ばれる（記録の無い episode は呼ばない）', () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 30, T1, true)

    const apply = h.outbox.capture()
    apply([
      { id: 'a', positionSeconds: 80, recordedAt: T2 },
      { id: 'none', positionSeconds: 9, recordedAt: T3 },
    ])

    expect(h.adopted).toEqual([{ episodeId: 'a', remote: { positionSeconds: 80, recordedAt: T2 }, stored: replaced }])
  })

  test('同じ記録に対する 2 回目の adopt（同時刻）は呼ばない', () => {
    const h = setup()
    seed(h.local, 'u-a', 'a', 30, T1, true)

    h.outbox.adopt('u-a', 'a', { positionSeconds: 80, recordedAt: T2 })
    h.outbox.adopt('u-a', 'a', { positionSeconds: 5, recordedAt: T2 })

    expect(h.adopted).toHaveLength(1)
  })
})

describe('web-dec-165 / shared-dec-39: 同時刻・時刻なし・古い・記録なし・恒久失敗・主体が変わったときは onAdopted を呼ばない', () => {
  type Scenario = { label: string; run: (remote: RemotePosition, withRecord: boolean) => Promise<number> }

  // 同じ remote を 3 つの入口へ渡し、onAdopted が呼ばれた回数を返す。
  const scenarios: ReadonlyArray<Scenario> = [
    {
      label: 'adopt',
      run: async (remote, withRecord) => {
        const h = setup()
        if (withRecord) seed(h.local, 'u-a', 'a', 30, T1, true)
        h.outbox.adopt('u-a', 'a', remote)
        return h.adopted.length
      },
    },
    {
      label: 'PATCH の応答',
      run: async (remote, withRecord) => {
        const h = setup({ fallback: () => ({ ok: true, value: remote }) })
        if (withRecord) seed(h.local, 'u-a', 'a', 30, T1)
        await h.outbox.flush(withRecord ? undefined : unsentOf('a', 30, T1))
        return h.adopted.length
      },
    },
    {
      label: 'capture の sink',
      run: async (remote, withRecord) => {
        const h = setup()
        if (withRecord) seed(h.local, 'u-a', 'a', 30, T1, true)
        h.outbox.capture()([{ id: 'a', positionSeconds: remote.positionSeconds, recordedAt: remote.recordedAt }])
        return h.adopted.length
      },
    },
  ]

  const notReplaced: ReadonlyArray<[string, RemotePosition, boolean]> = [
    ['同時刻', { positionSeconds: 80, recordedAt: T1 }, true],
    ['時刻なし', { positionSeconds: 80, recordedAt: null }, true],
    ['古い', { positionSeconds: 80, recordedAt: T0 }, true],
    ['記録なし', { positionSeconds: 80, recordedAt: T3 }, false],
  ]

  for (const scenario of scenarios) {
    test.each(notReplaced)(`${scenario.label}: %s では 0 回`, async (_name, remote, withRecord) => {
      expect(await scenario.run(remote, withRecord)).toBe(0)
    })

    test(`${scenario.label}: 正方向の対照（同じ fixture で厳密に新しい時刻なら 1 回）`, async () => {
      expect(await scenario.run({ positionSeconds: 80, recordedAt: T2 }, true)).toBe(1)
    })
  }

  test('恒久失敗（404）の応答では取り込まれず 0 回。同じ fixture で新しい時刻の成功応答なら 1 回（正方向の対照）', async () => {
    const failed = setup({ scripted: [() => fail({ kind: 'not_found' })] })
    seed(failed.local, 'u-a', 'a', 30, T1)
    await failed.outbox.flush()
    expect(failed.adopted).toHaveLength(0)

    const control = setup({ scripted: [() => ok(80, T2)] })
    seed(control.local, 'u-a', 'a', 30, T1)
    await control.outbox.flush()
    expect(control.adopted).toHaveLength(1)
  })

  test('応答の時点で主体が変わっていれば 0 回（正方向の対照: 同じ主体なら 1 回）', async () => {
    const gate = deferred<SyncResult>()
    const h = setup({ scripted: [() => gate.promise] })
    seed(h.local, 'u-a', 'a', 10, T1)
    const running = h.outbox.flush()
    await settle()
    h.state.sending = null
    h.state.recording = null
    gate.resolve(ok(80, T3))
    await running
    expect(h.adopted).toHaveLength(0)

    const sameGate = deferred<SyncResult>()
    const control = setup({ scripted: [() => sameGate.promise] })
    seed(control.local, 'u-a', 'a', 10, T1)
    const controlRunning = control.outbox.flush()
    await settle()
    sameGate.resolve(ok(80, T3))
    await controlRunning
    expect(control.adopted).toHaveLength(1)
  })

  test('capture の後に主体が変わった sink は 0 回（正方向の対照: 同じ主体なら 1 回）', () => {
    const h = setup({ sending: 'u-a' })
    seed(h.local, 'u-a', 'a', 30, T1, true)
    const apply = h.outbox.capture()
    h.state.sending = 'u-b'
    apply([{ id: 'a', positionSeconds: 80, recordedAt: T2 }])
    expect(h.adopted).toHaveLength(0)

    const control = setup({ sending: 'u-a' })
    seed(control.local, 'u-a', 'a', 30, T1, true)
    control.outbox.capture()([{ id: 'a', positionSeconds: 80, recordedAt: T2 }])
    expect(control.adopted).toHaveLength(1)
  })
})
