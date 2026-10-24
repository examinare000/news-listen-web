// 再生用の本番 adapter（blob URL・保存領域の見積もり）の契約テスト（web-deriv-02）。
//
// RED 理由: `@/lib/platform/objectUrl`・`@/lib/platform/storageEstimate` がまだ存在しない。
import { describe, test, expect, vi, afterEach } from 'vitest'
import { createBrowserObjectUrl } from '@/lib/platform/objectUrl'
import { createBrowserStorageEstimate } from '@/lib/platform/storageEstimate'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('verifies: CI-T50 createBrowserObjectUrl（web-deriv-02）', () => {
  test('create / revoke を URL.createObjectURL / revokeObjectURL へ委譲する', () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:test/1')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
    const blob = new Blob(['x'])
    const adapter = createBrowserObjectUrl()
    expect(adapter.create(blob)).toBe('blob:test/1')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    adapter.revoke('blob:test/1')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1')
  })
})

describe('verifies: CI-T50 createBrowserStorageEstimate（web-deriv-02）', () => {
  test('navigator.storage.estimate が無ければ null', async () => {
    vi.stubGlobal('navigator', {})
    expect(await createBrowserStorageEstimate()()).toBeNull()
  })

  test('estimate が無い storage でも null', async () => {
    vi.stubGlobal('navigator', { storage: {} })
    expect(await createBrowserStorageEstimate()()).toBeNull()
  })

  test('あれば { usage, quota } を返し、欠けた値は 0', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.resolve({ usage: 5, quota: 10 }) } })
    expect(await createBrowserStorageEstimate()()).toEqual({ usage: 5, quota: 10 })
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.resolve({}) } })
    expect(await createBrowserStorageEstimate()()).toEqual({ usage: 0, quota: 0 })
  })
})
