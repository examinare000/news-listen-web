export type ApiFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found'; readonly subject?: string }
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'rate_limited'
      readonly retryAfterSeconds: number | undefined
      readonly scope: 'monthly' | 'daily' | 'unknown'
      readonly detail: string
    }
  | { readonly kind: 'validation'; readonly detail: string }
  | { readonly kind: 'server'; readonly status: number }
  | { readonly kind: 'unknown'; readonly status: number }
