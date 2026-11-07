// Feed の記事と Star の状態の合成（web-rule-catalog-04）。純関数で、他の module を import しない。
// 生成する値は入力を複製して凍結する（web-check-06）。

export interface ArticleRef {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly url: string
  readonly score: number
  readonly publishedAt: string
}

export type FeedTab = 'all' | 'starred'

export interface StarState {
  readonly starredIds: ReadonlySet<string>
  readonly serverStarred: ReadonlyArray<ArticleRef>
  /** star した時点の記事のスナップショット。feed から消えてもサーバー一覧に反映されるまで Star タブに残す。 */
  readonly optimistic: ReadonlyArray<ArticleRef>
}

const sealRef = (ref: ArticleRef): ArticleRef => Object.freeze({ ...ref })

const sealRefs = (refs: ReadonlyArray<ArticleRef>): ReadonlyArray<ArticleRef> => Object.freeze(refs.map(sealRef))

function sealIds(ids: Iterable<string>): ReadonlySet<string> {
  return Object.freeze(new Set(ids))
}

function build(starredIds: Iterable<string>, serverStarred: ReadonlyArray<ArticleRef>, optimistic: ReadonlyArray<ArticleRef>): StarState {
  return Object.freeze({ starredIds: sealIds(starredIds), serverStarred: sealRefs(serverStarred), optimistic: sealRefs(optimistic) })
}

export function emptyStarState(): StarState {
  return build([], [], [])
}

/** `starredIds` には足すだけ。undefined と false を区別できない backend があるため、サーバー値では外さない。 */
export function mergeServerStars(
  state: StarState,
  next: { readonly feedStarredIds: ReadonlyArray<string>; readonly serverStarred: ReadonlyArray<ArticleRef> | null },
): StarState {
  return build(
    [...state.starredIds, ...next.feedStarredIds],
    next.serverStarred ?? state.serverStarred,
    state.optimistic,
  )
}

export function markStarred(state: StarState, id: string, articles: ReadonlyArray<ArticleRef>): StarState {
  const original = state.optimistic.some((a) => a.id === id) ? undefined : articles.find((a) => a.id === id)
  return build(
    [...state.starredIds, id],
    state.serverStarred,
    original ? [...state.optimistic, original] : state.optimistic,
  )
}

/** Dismiss の成功と Star の 404 用。`starredIds` には触れない。 */
export function removeLost(state: StarState, id: string): StarState {
  return build(
    state.starredIds,
    state.serverStarred.filter((a) => a.id !== id),
    state.optimistic.filter((a) => a.id !== id),
  )
}

/** Unstar の成功と 404 用。 */
export function unmarkStarred(state: StarState, id: string): StarState {
  return removeLost(build([...state.starredIds].filter((v) => v !== id), state.serverStarred, state.optimistic), id)
}

export function starredArticles(state: StarState): ReadonlyArray<ArticleRef> {
  const serverIds = new Set(state.serverStarred.map((a) => a.id))
  return sealRefs([...state.serverStarred, ...state.optimistic.filter((a) => !serverIds.has(a.id))])
}

export function isStarred(state: StarState, id: string): boolean {
  return state.starredIds.has(id) || state.serverStarred.some((a) => a.id === id)
}

export function visibleArticles(tab: FeedTab, articles: ReadonlyArray<ArticleRef>, state: StarState): ReadonlyArray<ArticleRef> {
  return tab === 'starred' ? starredArticles(state) : sealRefs(articles)
}
