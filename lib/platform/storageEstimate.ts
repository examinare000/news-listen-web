export interface StorageEstimateResult {
  readonly usage: number
  readonly quota: number
}

export type StorageEstimate = () => Promise<StorageEstimateResult | null>

/** estimate を持たない環境では null。値が欠けたら 0。 */
export function createBrowserStorageEstimate(): StorageEstimate {
  return async () => {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return null
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  }
}
