// 再生キュー（プレイリスト）の純粋な状態モデル。
// オーディオ要素に依存しないため、自動次再生・空キュー停止・並べ替えをユニットテストできる。
// 操作契約の正本は docs/design/shared-playback-spec.md。
//
// 不変条件: (1) items の id は一意 (2) currentIndex は null か 0..len-1 の整数 (3) 空なら null。
// QueueState を返す全経路は create を通り、状態を受け取る操作は入口でも検査する（違反は呼出側のバグとして throw）。

type Identified = { readonly id: string }

export interface QueueState<T extends Identified> {
  /** キュー全体（再生済み + 現在 + 待機）。 */
  readonly items: ReadonlyArray<T>
  /** 現在再生中の位置。未再生・空のときは null。 */
  readonly currentIndex: number | null
}

// Queue が複製・凍結した要素の記録。記録にある要素は同じ参照のまま使い、無ければ複製して凍結する。
// 記録に入るのはここで作った写しだけで、呼出側の値は入らない。
const owned = new WeakSet<object>()

function isPlain(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return true
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cloneFrozen(value: unknown): unknown {
  if (!isPlain(value)) return value
  const copy: unknown = Array.isArray(value)
    ? value.map((v: unknown) => cloneFrozen(v))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneFrozen(v)]))
  return Object.freeze(copy)
}

function own<T>(item: T): T {
  if (!isPlain(item) || owned.has(item)) return item
  const copy = cloneFrozen(item) as T & object
  owned.add(copy)
  return copy
}

function assertValid<T extends Identified>(q: QueueState<T>): void {
  const { items, currentIndex } = q
  if (new Set(items.map((p) => p.id)).size !== items.length) {
    throw new Error('QueueState の不変条件違反: podcast id が重複している')
  }
  if (items.length === 0) {
    if (currentIndex !== null) throw new Error('QueueState の不変条件違反: 空のキューの currentIndex は null でなければならない')
  } else if (currentIndex !== null) {
    if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex > items.length - 1) {
      throw new Error('QueueState の不変条件違反: currentIndex が範囲外')
    }
  }
}

function create<T extends Identified>(items: ReadonlyArray<T>, currentIndex: number | null): QueueState<T> {
  assertValid({ items, currentIndex })
  return Object.freeze({ items: Object.freeze(items.map(own)), currentIndex })
}

const emptyItems: ReadonlyArray<never> = Object.freeze([])

/** 空のキュー。 */
export const emptyQueue: QueueState<never> = Object.freeze({ items: emptyItems, currentIndex: null })

/** 現在再生中の要素（なければ null）。 */
export function current<T extends Identified>(q: QueueState<T>): T | null {
  if (q.currentIndex === null) return null
  const item = q.items[q.currentIndex] as T | undefined
  return item === undefined ? null : own(item)
}

/** 再生待ち（現在より後ろ）。 */
export function upNext<T extends Identified>(q: QueueState<T>): ReadonlyArray<T> {
  const rest = q.currentIndex === null ? q.items : q.items.slice(q.currentIndex + 1)
  return Object.freeze(rest.map(own))
}

/** 単一エピソードで開始する（既存キューを置き換える）。 */
export function start<T extends Identified>(_q: QueueState<T>, podcast: T): QueueState<T> {
  return create([podcast], 0)
}

/** 一覧を指定位置から再生する。重複 id は先勝ち、startAt の NaN は 0・小数は切り捨て。 */
export function setQueue<T extends Identified>(items: ReadonlyArray<T>, startAt: number): QueueState<T> {
  if (items.length === 0) return emptyQueue
  const requested = Number.isNaN(startAt) ? 0 : Math.trunc(startAt)
  const startId = items[Math.max(0, Math.min(requested, items.length - 1))].id
  const seen = new Set<string>()
  const unique = items.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
  return create(unique, unique.findIndex((p) => p.id === startId))
}

/** 末尾に追加する（既に含まれていれば無視＝重複防止）。 */
export function add<T extends Identified>(q: QueueState<T>, podcast: T): QueueState<T> {
  assertValid(q)
  if (q.items.some((p) => p.id === podcast.id)) return q
  return create([...q.items, podcast], q.currentIndex)
}

/** 現在の次に挿入する（「次に再生」）。既存の重複（現在再生中を除く）は取り除いてから挿入する。 */
export function playNext<T extends Identified>(q: QueueState<T>, podcast: T): QueueState<T> {
  assertValid(q)
  const currentId = current(q)?.id
  if (podcast.id === currentId) return q
  const items = q.items.filter((p) => p.id !== podcast.id)
  // 削除で currentIndex がずれるため現在 id から再計算する。
  const currentIndex =
    currentId !== undefined ? items.findIndex((p) => p.id === currentId) : null
  const insertAt = currentIndex !== null && currentIndex >= 0 ? currentIndex + 1 : 0
  const next = [...items.slice(0, insertAt), podcast, ...items.slice(insertAt)]
  return create(next, currentIndex === -1 ? null : currentIndex)
}

/** 指定 id が既にキューにあればそれを現在位置にする（見つかれば found=true）。 */
export function jump<T extends Identified>(
  q: QueueState<T>,
  id: string,
): { readonly queue: QueueState<T>; readonly found: boolean } {
  assertValid(q)
  const idx = q.items.findIndex((p) => p.id === id)
  if (idx < 0) return Object.freeze({ queue: q, found: false })
  return Object.freeze({ queue: create(q.items, idx), found: true })
}

/** 次のエピソードへ進む。次があれば currentIndex を進めて返す。無ければ next=null（停止）。 */
export function advance<T extends Identified>(
  q: QueueState<T>,
): { readonly queue: QueueState<T>; readonly next: T | null } {
  assertValid(q)
  if (q.currentIndex === null) {
    if (q.items.length === 0) return Object.freeze({ queue: q, next: null })
    const queue = create(q.items, 0)
    return Object.freeze({ queue, next: queue.items[0] })
  }
  const nextIndex = q.currentIndex + 1
  if (nextIndex >= q.items.length) return Object.freeze({ queue: q, next: null }) // 末尾 → 停止
  const queue = create(q.items, nextIndex)
  return Object.freeze({ queue, next: queue.items[nextIndex] })
}

/** 指定 id をキューから削除する。currentIndex は現在のアイテムを追従して調整する。 */
export function remove<T extends Identified>(q: QueueState<T>, id: string): QueueState<T> {
  assertValid(q)
  const idx = q.items.findIndex((p) => p.id === id)
  if (idx < 0) return q
  const items = [...q.items.slice(0, idx), ...q.items.slice(idx + 1)]
  if (q.currentIndex === null) return create(items, null)
  if (items.length === 0) return create(items, null)
  let currentIndex = q.currentIndex
  if (idx < q.currentIndex) currentIndex = q.currentIndex - 1
  else if (idx === q.currentIndex) currentIndex = Math.min(q.currentIndex, items.length - 1)
  return create(items, currentIndex)
}

/**
 * 待機列（upNext）を削除前オフセット方式で並べ替える（upNext 基準のインデックス）。現在再生中は不変。
 * 意味論 = SwiftUI onMove(fromOffsets:toOffset:) 規約。toOffset ∈ [0, upNextCount]（== count は末尾移動）。
 * 範囲外・非整数・NaN は無変更（同一参照）。
 * @see docs/design/shared-playback-spec.md §2.7 moveUpNext
 */
export function moveUpNext<T extends Identified>(
  q: QueueState<T>,
  fromIndex: number,
  toOffset: number,
): QueueState<T> {
  assertValid(q)
  const base = q.currentIndex === null ? 0 : q.currentIndex + 1
  const up = q.items.slice(base)

  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toOffset) ||
    fromIndex < 0 ||
    fromIndex >= up.length ||
    toOffset < 0 ||
    toOffset > up.length
  ) {
    return q
  }

  const moved = up[fromIndex]
  const rest = [...up.slice(0, fromIndex), ...up.slice(fromIndex + 1)]
  const insertAt = toOffset - (fromIndex < toOffset ? 1 : 0)
  const nextUp = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]
  return create([...q.items.slice(0, base), ...nextUp], q.currentIndex)
}
