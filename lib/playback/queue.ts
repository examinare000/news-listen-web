// 再生キュー（プレイリスト）の純粋な状態モデル。
// オーディオ要素に依存しないため、自動次再生・空キュー停止・並べ替えをユニットテストできる。
// 操作契約の正本は docs/design/shared-playback-spec.md。
//
// 不変条件: (1) items の id は一意 (2) currentIndex は null か 0..len-1 の整数 (3) 空なら null。
// QueueState を返す全経路は create を通り、状態を受け取る操作は入口でも検査する（違反は呼出側のバグとして throw）。

import type { Podcast } from '@/types'

export interface QueueState {
  /** キュー全体（再生済み + 現在 + 待機）。 */
  readonly items: Podcast[]
  /** 現在再生中の位置。未再生・空のときは null。 */
  readonly currentIndex: number | null
}

function create(items: Podcast[], currentIndex: number | null): QueueState {
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
  return { items, currentIndex }
}

/** 入力の q が不変条件を満たすことを、処理の前に確かめる。 */
function assertValid(q: QueueState): void {
  create(q.items, q.currentIndex)
}

const emptyItems: Podcast[] = []
Object.freeze(emptyItems)

/** 空のキュー。 */
export const emptyQueue: QueueState = Object.freeze({ items: emptyItems, currentIndex: null })

/** 現在再生中の Podcast（なければ null）。 */
export function current(q: QueueState): Podcast | null {
  if (q.currentIndex === null) return null
  return q.items[q.currentIndex] ?? null
}

/** 再生待ち（現在より後ろ）。 */
export function upNext(q: QueueState): Podcast[] {
  if (q.currentIndex === null) return [...q.items]
  return q.items.slice(q.currentIndex + 1)
}

/** 単一エピソードで開始する（既存キューを置き換える）。 */
export function start(_q: QueueState, podcast: Podcast): QueueState {
  return create([podcast], 0)
}

/** 一覧を指定位置から再生する。重複 id は先勝ち、startAt の NaN は 0・小数は切り捨て。 */
export function setQueue(items: Podcast[], startAt: number): QueueState {
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
export function add(q: QueueState, podcast: Podcast): QueueState {
  assertValid(q)
  if (q.items.some((p) => p.id === podcast.id)) return q
  return create([...q.items, podcast], q.currentIndex)
}

/** 現在の次に挿入する（「次に再生」）。既存の重複（現在再生中を除く）は取り除いてから挿入する。 */
export function playNext(q: QueueState, podcast: Podcast): QueueState {
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
export function jump(q: QueueState, id: string): { queue: QueueState; found: boolean } {
  assertValid(q)
  const idx = q.items.findIndex((p) => p.id === id)
  if (idx < 0) return { queue: q, found: false }
  return { queue: create(q.items, idx), found: true }
}

/** 次のエピソードへ進む。次があれば currentIndex を進めて返す。無ければ next=null（停止）。 */
export function advance(q: QueueState): { queue: QueueState; next: Podcast | null } {
  assertValid(q)
  if (q.currentIndex === null) {
    if (q.items.length === 0) return { queue: q, next: null }
    return { queue: create(q.items, 0), next: q.items[0] }
  }
  const nextIndex = q.currentIndex + 1
  if (nextIndex >= q.items.length) return { queue: q, next: null } // 末尾 → 停止
  return { queue: create(q.items, nextIndex), next: q.items[nextIndex] }
}

/** 指定 id をキューから削除する。currentIndex は現在のアイテムを追従して調整する。 */
export function remove(q: QueueState, id: string): QueueState {
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
export function moveUpNext(q: QueueState, fromIndex: number, toOffset: number): QueueState {
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
