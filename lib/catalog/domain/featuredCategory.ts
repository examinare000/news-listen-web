// featured の category の値域と既定値（web-rule-catalog-09）。値域の配列リテラルを置いてよいのはこのファイルだけ。
export const FEATURED_CATEGORIES = ['tech', 'business', 'sports', 'entertainment', 'culture'] as const
export type FeaturedCategory = (typeof FEATURED_CATEGORIES)[number]

/** 値域外・欠落は 'tech' に寄せる。 */
export function normalizeFeaturedCategory(category?: string | null): FeaturedCategory {
  if (!category || !FEATURED_CATEGORIES.includes(category as FeaturedCategory)) {
    return 'tech'
  }
  return category as FeaturedCategory
}

/**
 * 値域の順に分け、入力の順を保つ。0 件の category も key は持つ。
 * 入力は書き換えず、戻りの object と各配列は凍結する。
 */
export function groupByCategoryInOrder<T extends { category?: string | null }>(
  items: ReadonlyArray<T>,
): Readonly<Record<FeaturedCategory, ReadonlyArray<T>>> {
  const result: Record<FeaturedCategory, T[]> = {
    tech: [],
    business: [],
    sports: [],
    entertainment: [],
    culture: [],
  }
  for (const item of items) {
    result[normalizeFeaturedCategory(item.category)].push(item)
  }
  for (const category of FEATURED_CATEGORIES) Object.freeze(result[category])
  return Object.freeze(result)
}
