// featured category の日本語ラベル（web-rule-catalog-09 の値域に対する presentation 側）。
// domain は型だけを import する（値で import すると台帳検査の対象になるため。前例は failureMessage.test.ts）。
// RED 理由（実装前）: `@/lib/catalog/presentation/featuredCategoryLabels` が無い（module not found）。
import { describe, test, expect } from 'vitest'
import { FEATURED_CATEGORY_LABELS } from '@/lib/catalog/presentation/featuredCategoryLabels'
import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'

const FEATURED_CATEGORIES: ReadonlyArray<FeaturedCategory> = ['tech', 'business', 'sports', 'entertainment', 'culture']

describe('featuredCategoryLabels', () => {
  test('FEATURED_CATEGORY_LABELS includes all categories with Japanese labels', () => {
    FEATURED_CATEGORIES.forEach((cat) => {
      expect(FEATURED_CATEGORY_LABELS[cat]).toBeDefined()
      expect(typeof FEATURED_CATEGORY_LABELS[cat]).toBe('string')
    })
    expect(FEATURED_CATEGORY_LABELS.tech).toBe('テクノロジー')
    expect(FEATURED_CATEGORY_LABELS.business).toBe('ビジネス')
    expect(FEATURED_CATEGORY_LABELS.sports).toBe('スポーツ')
    expect(FEATURED_CATEGORY_LABELS.entertainment).toBe('芸能')
    expect(FEATURED_CATEGORY_LABELS.culture).toBe('カルチャー')
  })
})
