import { describe, expect, test } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * service worker が掃除・判定するキャッシュ名の prefix 集合を、2 つの実装で固定する (verifies: CI-P4-37; web-test-22)。
 *
 * `public/sw.js`（配布するプレーンスクリプト）と `lib/swCacheCleanup.ts`（ログアウト時の掃除）は
 * 同じ prefix を別々に持つ。片方だけ変わると、掃除が SW の作ったキャッシュを取りこぼす。
 * ビルド時注入か SW の module 化で共有できるまでの暫定の固定（web-temp-02）。
 */

// `url.pathname.startsWith(…)` は `name` を部分文字列に含むので、直前が識別子の一部やプロパティ参照のものを除く。
const CACHE_NAME_PREFIX = /(?<![\w.])name\.startsWith\('([^']*)'\)/g

function prefixesIn(source: string): string[] {
  return [...source.matchAll(CACHE_NAME_PREFIX)].map((match) => match[1])
}

const root = join(__dirname, '../..')
const swPrefixes = prefixesIn(readFileSync(join(root, 'public/sw.js'), 'utf-8'))
const cleanupPrefixes = prefixesIn(readFileSync(join(root, 'lib/swCacheCleanup.ts'), 'utf-8'))

describe('service worker のキャッシュ名の prefix 集合', () => {
  test('sw.js と swCacheCleanup.ts の集合が等しく、api- と shell- だけ (verifies: CI-P4-37; web-test-22)', () => {
    expect([...new Set(swPrefixes)].sort()).toEqual(['api-', 'shell-'])
    expect([...new Set(cleanupPrefixes)].sort()).toEqual(['api-', 'shell-'])
  })

  test('抽出が空振りしていない: どちらのファイルからも 1 件以上取れる (verifies: CI-P4-37)', () => {
    expect(swPrefixes.length).toBeGreaterThan(0)
    expect(cleanupPrefixes.length).toBeGreaterThan(0)
  })

  test('対照: URL の path の prefix は拾わない (verifies: CI-P4-37)', () => {
    expect(prefixesIn("if (url.pathname.startsWith('/_audio/')) return")).toEqual([])
  })

  test('対照: 違う prefix は違う集合として取り出せる (verifies: CI-P4-37)', () => {
    expect(prefixesIn("return name.startsWith('x-')")).toEqual(['x-'])
  })
})
