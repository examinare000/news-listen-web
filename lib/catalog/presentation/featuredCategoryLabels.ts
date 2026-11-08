import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'

/** category の日本語ラベル。 */
export const FEATURED_CATEGORY_LABELS: Readonly<Record<FeaturedCategory, string>> = {
  tech: 'テクノロジー',
  business: 'ビジネス',
  sports: 'スポーツ',
  entertainment: '芸能',
  culture: 'カルチャー',
}
