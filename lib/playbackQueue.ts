// 再生キュー（プレイリスト）の純粋な状態モデル（issue #81）。
// オーディオ要素に依存しないため、自動次再生・空キュー停止・並べ替えをユニットテストできる。
// iOS の PlaybackQueue.swift と同じ責務・規約。

import type { Podcast } from '@/types'

export interface QueueState {
  /** キュー全体（再生済み + 現在 + 待機）。 */
  readonly items: Podcast[]
  /** 現在再生中の位置。未再生・空のときは null。 */
  readonly currentIndex: number | null
}

/** 空のキュー。 */
export const emptyQueue: QueueState = { items: [], currentIndex: null }

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
  return { items: [podcast], currentIndex: 0 }
}

/** 一覧を指定位置から再生する。 */
export function setQueue(items: Podcast[], startAt: number): QueueState {
  if (items.length === 0) return emptyQueue
  return { items: [...items], currentIndex: Math.max(0, Math.min(startAt, items.length - 1)) }
}

/** 末尾に追加する（既に含まれていれば無視＝重複防止）。 */
export function add(q: QueueState, podcast: Podcast): QueueState {
  if (q.items.some((p) => p.id === podcast.id)) return q
  return { ...q, items: [...q.items, podcast] }
}

/** 現在の次に挿入する（「次に再生」）。既存の重複（現在再生中を除く）は取り除いてから挿入する。 */
export function playNext(q: QueueState, podcast: Podcast): QueueState {
  const currentId = current(q)?.id
  if (podcast.id === currentId) return q
  const items = q.items.filter((p) => p.id !== podcast.id)
  // 削除で currentIndex がずれるため現在 id から再計算する。
  const currentIndex =
    currentId !== undefined ? items.findIndex((p) => p.id === currentId) : null
  const insertAt = currentIndex !== null && currentIndex >= 0 ? currentIndex + 1 : 0
  const next = [...items.slice(0, insertAt), podcast, ...items.slice(insertAt)]
  return { items: next, currentIndex: currentIndex === -1 ? null : currentIndex }
}

/** 指定 id が既にキューにあればそれを現在位置にする（見つかれば found=true）。 */
export function jump(q: QueueState, id: string): { queue: QueueState; found: boolean } {
  const idx = q.items.findIndex((p) => p.id === id)
  if (idx < 0) return { queue: q, found: false }
  return { queue: { ...q, currentIndex: idx }, found: true }
}

/** 次のエピソードへ進む。次があれば currentIndex を進めて返す。無ければ next=null（停止）。 */
export function advance(q: QueueState): { queue: QueueState; next: Podcast | null } {
  if (q.currentIndex === null) {
    if (q.items.length === 0) return { queue: q, next: null }
    return { queue: { ...q, currentIndex: 0 }, next: q.items[0] }
  }
  const nextIndex = q.currentIndex + 1
  if (nextIndex >= q.items.length) return { queue: q, next: null } // 末尾 → 停止
  return { queue: { ...q, currentIndex: nextIndex }, next: q.items[nextIndex] }
}

/** 指定 id をキューから削除する。currentIndex は現在のアイテムを追従して調整する。 */
export function remove(q: QueueState, id: string): QueueState {
  const idx = q.items.findIndex((p) => p.id === id)
  if (idx < 0) return q
  const items = [...q.items.slice(0, idx), ...q.items.slice(idx + 1)]
  if (q.currentIndex === null) return { items, currentIndex: null }
  if (items.length === 0) return { items, currentIndex: null }
  let currentIndex = q.currentIndex
  if (idx < q.currentIndex) currentIndex = q.currentIndex - 1
  else if (idx === q.currentIndex) currentIndex = Math.min(q.currentIndex, items.length - 1)
  return { items, currentIndex }
}

/** 待機列（upNext）を「from 番目を to 番目へ」並べ替える（upNext 基準のインデックス）。現在は不変。 */
export function reorderUpNext(q: QueueState, fromIndex: number, toIndex: number): QueueState {
  const base = q.currentIndex === null ? 0 : q.currentIndex + 1
  const up = q.items.slice(base)
  if (fromIndex < 0 || fromIndex >= up.length || toIndex < 0 || toIndex >= up.length) return q
  const [moved] = up.splice(fromIndex, 1)
  up.splice(toIndex, 0, moved)
  return { ...q, items: [...q.items.slice(0, base), ...up] }
}
