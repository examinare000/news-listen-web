// おすすめサイトの表示順の規則（web-rule-admin-02・web-dec-134）。

type Ordered = { readonly order: number }

/** 作成する行の order: 既存の最大 + 1（空なら 0）。欠番・重複があっても最大から数える。 */
export function nextOrder(sites: ReadonlyArray<Ordered>): number {
  return sites.length === 0 ? 0 : Math.max(...sites.map((s) => s.order)) + 1
}

/** 編集は表示順を扱わないので、既存の値を引き継ぐ。無い id は 0。 */
export function orderForUpdate(sites: ReadonlyArray<Ordered & { readonly id: string }>, id: string): number {
  return sites.find((s) => s.id === id)?.order ?? 0
}

/**
 * 隣と入れ替えたとき、配列の位置と order が一致しない行をすべて、位置の昇順で返す
 * （既存データの重複・欠番もこのとき自己修復される）。
 * 何もできない（id が無い・端）なら null、入れ替えても全行が一致するなら空配列。
 */
export function reorderDiff<T extends Ordered & { readonly id: string }>(
  sites: ReadonlyArray<T>,
  id: string,
  direction: 'up' | 'down',
): ReadonlyArray<T> | null {
  const index = sites.findIndex((s) => s.id === id)
  if (index === -1) return null
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= sites.length) return null

  const swapped = [...sites]
  ;[swapped[index], swapped[swapIndex]] = [swapped[swapIndex], swapped[index]]
  return swapped.flatMap((site, position) => (site.order !== position ? [{ ...site, order: position }] : []))
}
