// Catalog domain の article（web-rule-catalog-04）: Star の状態の合成とタブの選択。純関数で、他の module を import しない。
// unit テスト: `lib/catalog/domain/article` だけを値で import する。
//
// RED 理由（実装前）: `@/lib/catalog/domain/article` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import {
  emptyStarState,
  isStarred,
  markStarred,
  mergeServerStars,
  removeLost,
  starredArticles,
  unmarkStarred,
  visibleArticles,
} from '@/lib/catalog/domain/article'
import type { ArticleRef, StarState } from '@/lib/catalog/domain/article'

function ref(id: string): ArticleRef {
  return { id, title: `title ${id}`, source: 'Site', url: `https://example.com/${id}`, score: 1, publishedAt: '2026-05-31T06:00:00Z' }
}

const ART1 = ref('a1')
const ART2 = ref('a2')
const ART3 = ref('a3')

function state(parts: { starredIds?: string[]; serverStarred?: ArticleRef[]; optimistic?: ArticleRef[] }): StarState {
  return {
    starredIds: new Set(parts.starredIds ?? []),
    serverStarred: parts.serverStarred ?? [],
    optimistic: parts.optimistic ?? [],
  }
}

describe('emptyStarState', () => {
  test('verifies: CI-AR1 — 3 要素とも空で、呼ぶたびに新しい値', () => {
    const first = emptyStarState()

    expect(first.starredIds.size).toBe(0)
    expect(first.serverStarred).toEqual([])
    expect(first.optimistic).toEqual([])
    expect(emptyStarState()).not.toBe(first)
    expect(emptyStarState().starredIds).not.toBe(first.starredIds)
  })
})

describe('mergeServerStars', () => {
  test('web-rule-catalog-04 verifies: CI-AR2 — サーバーの is_starred が偽・欠落の更新でも starredIds から外さない（足すだけ）', () => {
    const merged = mergeServerStars(emptyStarState(), { feedStarredIds: ['a1'], serverStarred: null })
    expect(isStarred(merged, 'a1')).toBe(true)

    const refreshed = mergeServerStars(merged, { feedStarredIds: [], serverStarred: null })

    expect(isStarred(refreshed, 'a1')).toBe(true)
    expect([...refreshed.starredIds]).toEqual(['a1'])
  })

  test('web-rule-catalog-04 verifies: CI-AR2 — starredIds は旧 ∪ feedStarredIds（旧 id は残り、新しい id が増える）', () => {
    const merged = mergeServerStars(state({ starredIds: ['a1'] }), { feedStarredIds: ['a2'], serverStarred: null })
    expect([...merged.starredIds].sort()).toEqual(['a1', 'a2'])
  })

  test('web-rule-catalog-04 verifies: CI-AR2・AR3・AR6 — 楽観的な Star は手動更新（merge の再実行）で消えない', () => {
    const marked = markStarred(emptyStarState(), 'a1', [ART1])

    const refreshed = mergeServerStars(marked, { feedStarredIds: [], serverStarred: [] })

    expect(starredArticles(refreshed).map((a) => a.id)).toEqual(['a1'])
    expect(isStarred(refreshed, 'a1')).toBe(true)
  })

  test('web-rule-catalog-04 verifies: CI-AR2 — serverStarred が null なら変えず、配列なら置き換える（順序保持）', () => {
    const before = state({ serverStarred: [ART1] })

    expect(mergeServerStars(before, { feedStarredIds: [], serverStarred: null }).serverStarred).toEqual([ART1])
    expect(mergeServerStars(before, { feedStarredIds: [], serverStarred: [ART3, ART2] }).serverStarred.map((a) => a.id)).toEqual(['a3', 'a2'])
    expect(mergeServerStars(before, { feedStarredIds: [], serverStarred: [] }).serverStarred).toEqual([])
  })

  test('verifies: CI-AR2 — optimistic は変えない', () => {
    const before = state({ optimistic: [ART1] })
    const merged = mergeServerStars(before, { feedStarredIds: ['a2'], serverStarred: [ART2] })
    expect(merged.optimistic.map((a) => a.id)).toEqual(['a1'])
  })
})

describe('markStarred', () => {
  test('web-rule-catalog-04 verifies: CI-AR3 — articles に無い id は starredIds だけに足し、optimistic は変えない', () => {
    const marked = markStarred(emptyStarState(), 'zz', [ART1])

    expect(marked.starredIds.has('zz')).toBe(true)
    expect(marked.optimistic).toEqual([])
  })

  test('verifies: CI-AR3 — articles の中の同じ id の記事を optimistic の末尾に足す。2 回呼んでも 1 件', () => {
    const once = markStarred(state({ optimistic: [ART2] }), 'a1', [ART1, ART2])
    const twice = markStarred(once, 'a1', [ART1, ART2])

    expect(once.optimistic.map((a) => a.id)).toEqual(['a2', 'a1'])
    expect(twice.optimistic.map((a) => a.id)).toEqual(['a2', 'a1'])
    expect([...twice.starredIds]).toEqual(['a1'])
  })
})

describe('removeLost / unmarkStarred', () => {
  const both = state({ starredIds: ['a1', 'a2'], serverStarred: [ART1, ART2], optimistic: [ART1, ART3] })

  test('web-rule-catalog-04 verifies: CI-AR4 — removeLost は serverStarred・optimistic から除き、starredIds は残す', () => {
    const lost = removeLost(both, 'a1')

    expect(lost.serverStarred.map((a) => a.id)).toEqual(['a2'])
    expect(lost.optimistic.map((a) => a.id)).toEqual(['a3'])
    expect([...lost.starredIds].sort()).toEqual(['a1', 'a2'])
  })

  test('web-rule-catalog-04 verifies: CI-AR5 — unmarkStarred は starredIds と 2 つの一覧から除く', () => {
    const unmarked = unmarkStarred(both, 'a1')

    expect(unmarked.serverStarred.map((a) => a.id)).toEqual(['a2'])
    expect(unmarked.optimistic.map((a) => a.id)).toEqual(['a3'])
    expect([...unmarked.starredIds]).toEqual(['a2'])
  })
})

describe('starredArticles', () => {
  test('verifies: CI-AR6 — serverStarred の順のまま、後ろに serverStarred に無い optimistic を順に並べる（重複なし）', () => {
    const s = state({ serverStarred: [ART2], optimistic: [ART1, ART2] })
    expect(starredArticles(s).map((a) => a.id)).toEqual(['a2', 'a1'])
  })
})

describe('isStarred / visibleArticles', () => {
  test('web-rule-catalog-04 verifies: CI-AR7 — isStarred は starredIds だけ・server だけ・どちらも無いの 3 通り', () => {
    expect(isStarred(state({ starredIds: ['a1'] }), 'a1')).toBe(true)
    expect(isStarred(state({ serverStarred: [ART2] }), 'a2')).toBe(true)
    expect(isStarred(state({ starredIds: ['a1'], serverStarred: [ART2] }), 'a3')).toBe(false)
  })

  test('verifies: CI-AR8 — visibleArticles は all で articles の順、starred で starredArticles', () => {
    const s = state({ serverStarred: [ART2], optimistic: [ART1] })
    const articles = [ART3, ART1, ART2]

    expect(visibleArticles('all', articles, s).map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
    expect(visibleArticles('starred', articles, s).map((a) => a.id)).toEqual(['a2', 'a1'])
  })
})
