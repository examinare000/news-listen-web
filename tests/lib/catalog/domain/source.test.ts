// 購読元 URL の形式検査とおすすめの導出（web-rule-catalog-07・web-rule-catalog-08）。
// RED 理由（実装前）: `@/lib/catalog/domain/source` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { recommendedSources, validateSourceUrl } from '@/lib/catalog/domain/source'
import type { FeaturedSourceRef, SourceRef } from '@/lib/catalog/domain/source'

describe('validateSourceUrl (web-rule-catalog-07)', () => {
  test('web-rule-catalog-07: http:// で始まる URL は ok', () => {
    expect(validateSourceUrl('http://x')).toBe('ok')
  })

  test('web-rule-catalog-07: https:// で始まる URL は ok', () => {
    expect(validateSourceUrl('https://x')).toBe('ok')
  })

  test('web-rule-catalog-07: ftp:// と大文字の HTTP:// は invalid_url', () => {
    expect(validateSourceUrl('ftp://x')).toBe('invalid_url')
    expect(validateSourceUrl('HTTP://x')).toBe('invalid_url')
  })

  test('web-rule-catalog-07: 先頭の空白・空文字・スキーム省略は invalid_url', () => {
    expect(validateSourceUrl(' https://x')).toBe('invalid_url')
    expect(validateSourceUrl('')).toBe('invalid_url')
    expect(validateSourceUrl('//x')).toBe('invalid_url')
  })

  test('web-rule-catalog-07: 末尾の空白は結果に影響しない（現行の写し）', () => {
    expect(validateSourceUrl('https://x ')).toBe('ok')
  })
})

describe('recommendedSources (web-rule-catalog-08)', () => {
  const featured = (id: string, url: string): FeaturedSourceRef => ({
    id,
    name: `name-${id}`,
    url,
    category: 'tech',
    thumbnailUrl: null,
    description: null,
  })
  const sub = (url: string): SourceRef => ({ name: 'sub', url })

  test('web-rule-catalog-08: URL が完全一致する購読済みを除き、入力の順を保つ', () => {
    const f = [featured('1', 'https://a.com'), featured('2', 'https://b.com'), featured('3', 'https://c.com')]
    const result = recommendedSources(f, [sub('https://b.com')])
    expect(result.map((x) => x.id)).toEqual(['1', '3'])
    expect(result[0]).toBe(f[0])
  })

  test('web-rule-catalog-08: 末尾スラッシュが違うだけの URL は除かない', () => {
    const f = [featured('1', 'https://a.com/')]
    expect(recommendedSources(f, [sub('https://a.com')]).map((x) => x.id)).toEqual(['1'])
  })

  test('web-rule-catalog-08: featured が空なら空の凍結配列', () => {
    const result = recommendedSources([], [sub('https://a.com')])
    expect(result).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('web-rule-catalog-08: 購読が空なら featured をすべて返す', () => {
    const f = [featured('1', 'https://a.com'), featured('2', 'https://b.com')]
    expect(recommendedSources(f, []).map((x) => x.id)).toEqual(['1', '2'])
  })

  test('web-rule-catalog-08: 入力を書き換えず、戻りは新しい凍結配列', () => {
    const f = [featured('1', 'https://a.com'), featured('2', 'https://b.com')]
    const s = [sub('https://a.com')]
    const fSnapshot = [...f]
    const sSnapshot = [...s]
    const result = recommendedSources(f, s)
    expect(f).toEqual(fSnapshot)
    expect(s).toEqual(sSnapshot)
    expect(result).not.toBe(f)
    expect(Object.isFrozen(result)).toBe(true)
  })
})
