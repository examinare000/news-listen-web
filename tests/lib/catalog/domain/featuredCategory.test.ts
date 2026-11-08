// featured の category の値域と畳み込み（web-rule-catalog-09）。旧 lib の同名テストの観点を移した。
// RED 理由（実装前）: `@/lib/catalog/domain/featuredCategory` が無い（module not found）。
import { describe, test, expect } from 'vitest'
import {
  FEATURED_CATEGORIES,
  normalizeFeaturedCategory,
  groupByCategoryInOrder,
} from '@/lib/catalog/domain/featuredCategory'

interface FeaturedSource {
  id: string
  name: string
  url: string
  order: number
  category?: string | null
}

describe('featured category の値域 (web-rule-catalog-09)', () => {
  test('FEATURED_CATEGORIES has expected order', () => {
    expect(FEATURED_CATEGORIES).toEqual(['tech', 'business', 'sports', 'entertainment', 'culture'])
  })

  describe('normalizeFeaturedCategory', () => {
    test('returns the category as-is for valid values', () => {
      expect(normalizeFeaturedCategory('tech')).toBe('tech')
      expect(normalizeFeaturedCategory('business')).toBe('business')
      expect(normalizeFeaturedCategory('sports')).toBe('sports')
    })

    test('returns tech for undefined', () => {
      expect(normalizeFeaturedCategory(undefined)).toBe('tech')
    })

    test('returns tech for null', () => {
      expect(normalizeFeaturedCategory(null)).toBe('tech')
    })

    test('returns tech for empty string', () => {
      expect(normalizeFeaturedCategory('')).toBe('tech')
    })

    test('returns tech for unknown value', () => {
      expect(normalizeFeaturedCategory('unknown')).toBe('tech')
    })
  })

  describe('groupByCategoryInOrder', () => {
    test('groups items by category', () => {
      const items: FeaturedSource[] = [
        { id: '1', name: 'Tech 1', url: 'https://tech1.com', order: 0, category: 'tech' },
        { id: '2', name: 'Business 1', url: 'https://biz1.com', order: 1, category: 'business' },
        { id: '3', name: 'Tech 2', url: 'https://tech2.com', order: 2, category: 'tech' },
      ]

      const grouped = groupByCategoryInOrder(items)

      expect(grouped.tech).toHaveLength(2)
      expect(grouped.business).toHaveLength(1)
      expect(grouped.sports).toHaveLength(0)
      expect(grouped.entertainment).toHaveLength(0)
      expect(grouped.culture).toHaveLength(0)
    })

    test('normalizes missing category to tech', () => {
      const items: FeaturedSource[] = [
        { id: '1', name: 'Legacy', url: 'https://legacy.com', order: 0 },
        { id: '2', name: 'Explicit Tech', url: 'https://tech.com', order: 1, category: 'tech' },
      ]

      const grouped = groupByCategoryInOrder(items)

      expect(grouped.tech).toHaveLength(2)
      expect(grouped.tech[0].name).toBe('Legacy')
      expect(grouped.tech[1].name).toBe('Explicit Tech')
    })

    test('normalizes unknown category to tech', () => {
      const items: FeaturedSource[] = [
        { id: '1', name: 'Unknown Cat', url: 'https://unknown.com', order: 0, category: 'unknown' },
      ]

      const grouped = groupByCategoryInOrder(items)

      expect(grouped.tech).toHaveLength(1)
      expect(grouped.tech[0].name).toBe('Unknown Cat')
    })

    test('returns all category keys even for empty groups', () => {
      const items: FeaturedSource[] = []
      const grouped = groupByCategoryInOrder(items)

      expect(Object.keys(grouped)).toHaveLength(5)
      FEATURED_CATEGORIES.forEach((cat) => {
        expect(grouped[cat]).toEqual([])
      })
    })

    test('web-rule-catalog-09: does not mutate the input array', () => {
      const items: FeaturedSource[] = [
        { id: '1', name: 'A', url: 'https://a.com', order: 0, category: 'business' },
        { id: '2', name: 'B', url: 'https://b.com', order: 1 },
      ]
      const snapshot = JSON.parse(JSON.stringify(items))

      groupByCategoryInOrder(items)

      expect(items).toEqual(snapshot)
    })

    test('web-rule-catalog-09: returned object and each array are frozen', () => {
      const grouped = groupByCategoryInOrder([
        { id: '1', name: 'A', url: 'https://a.com', order: 0, category: 'sports' },
      ])

      expect(Object.isFrozen(grouped)).toBe(true)
      FEATURED_CATEGORIES.forEach((cat) => {
        expect(Object.isFrozen(grouped[cat])).toBe(true)
      })
    })
  })
})
