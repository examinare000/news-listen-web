/**
 * Featured sites のカテゴリ定義と処理ユーティリティ。
 * backend API の category フィールド（tech, business, sports, entertainment, culture）に対応。
 */

export const FEATURED_CATEGORIES = ['tech', 'business', 'sports', 'entertainment', 'culture'] as const
export type FeaturedCategory = (typeof FEATURED_CATEGORIES)[number]

/** カテゴリの日本語ラベル（表示順に対応）。 */
export const FEATURED_CATEGORY_LABELS: Record<FeaturedCategory, string> = {
  tech: 'テクノロジー',
  business: 'ビジネス',
  sports: 'スポーツ',
  entertainment: '芸能',
  culture: 'カルチャー',
}

/**
 * 与えられた category 値を検証し、無効な場合は 'tech' へ正規化する。
 * category が undefined / null / 未知値の場合、'tech' へ統一してフォールバック。
 */
export function normalizeFeaturedCategory(category?: string | null): FeaturedCategory {
  if (!category || !FEATURED_CATEGORIES.includes(category as FeaturedCategory)) {
    return 'tech'
  }
  return category as FeaturedCategory
}

/**
 * FeaturedSource 配列をカテゴリでグループ化。
 * 各カテゴリの配列は表示順（FEATURED_CATEGORIES）に従い、0件のカテゴリは含まれない。
 */
export function groupByCategoryInOrder<T extends { category?: string | null }>(
  items: T[],
): Record<FeaturedCategory, T[]> {
  const result: Record<FeaturedCategory, T[]> = {
    tech: [],
    business: [],
    sports: [],
    entertainment: [],
    culture: [],
  }

  for (const item of items) {
    const normalized = normalizeFeaturedCategory(item.category)
    result[normalized].push(item)
  }

  return result
}
