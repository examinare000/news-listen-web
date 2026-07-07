import { vi } from 'vitest'

/**
 * jsdom には Cache Storage API (`caches`) が実装されていないため、テスト用モックを提供する。
 * MockAudio (mockAudio.ts) と同様の方針: インメモリ Map で put/match/delete/keys を再現する。
 *
 * WHY string keys only (Request を生成しない): 本物の `Cache.put(url, res)` は文字列を
 * 受け取れる（内部で URL 解決される）。`new Request('/relative/path')` は Node の undici 実装だと
 * base URL 無しで相対パスを解決できず例外になるため、キーは常に文字列で扱い、
 * audioCache.ts 側も `new Request()` を使わず文字列をそのまま渡す設計にしている。
 */
export class MockCache {
  private store: Map<string, Response> = new Map()

  async put(request: Request | string, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url
    this.store.set(key, response)
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url
    const response = this.store.get(key)
    // 実際の Cache API は呼び出しごとに未消費 body の Response を返す。
    // 同じキーに複数回 match する呼び出し元のために clone() して返す。
    return response ? response.clone() : undefined
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url
    return this.store.delete(key)
  }

  /** 実 Cache.keys() は Request[] を返すが、呼び出し元は `.url` しか参照しないため
   *  最小限の duck-typed オブジェクトで代替する。 */
  async keys(): Promise<Array<{ url: string }>> {
    return Array.from(this.store.keys()).map((url) => ({ url }))
  }
}

export class MockCacheStorage {
  private stores: Map<string, MockCache> = new Map()

  async open(name: string): Promise<MockCache> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new MockCache())
    }
    return this.stores.get(name)!
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name)
  }

  /** 実 CacheStorage.keys() 相当。sw.js の activate cleanup が旧世代キャッシュ名を列挙するのに使う。 */
  async keys(): Promise<string[]> {
    return Array.from(this.stores.keys())
  }
}

/**
 * グローバル `caches` をモックに差し替え、インスタンスを返す。
 * テスト終了後は vitest の afterEach で vi.unstubAllGlobals() を呼ぶこと。
 */
export function setupMockCaches(): MockCacheStorage {
  const instance = new MockCacheStorage()
  vi.stubGlobal('caches', instance)
  return instance
}
