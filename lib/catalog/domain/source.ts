// 購読する RSS の ref と規則（web-rule-catalog-07 の形式・web-rule-catalog-08）。
import type { FeaturedCategory } from '@/lib/catalog/domain/featuredCategory'

/** 購読の識別子は url（id は無い）。 */
export interface SourceRef {
  readonly name: string
  readonly url: string
}

export interface FeaturedSourceRef {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly category: FeaturedCategory
  readonly thumbnailUrl: string | null
  readonly description: string | null
}

export type SourceUrlCheck = 'ok' | 'invalid_url'

/** 先頭が http:// か https:// のものだけ受ける。trim・小文字化はしない。 */
export function validateSourceUrl(url: string): SourceUrlCheck {
  return url.startsWith('http://') || url.startsWith('https://') ? 'ok' : 'invalid_url'
}

/** featured のうち、URL が購読済みのどれとも完全一致しないものを入力の順で返す。 */
export function recommendedSources(
  featured: ReadonlyArray<FeaturedSourceRef>,
  subscribed: ReadonlyArray<SourceRef>,
): ReadonlyArray<FeaturedSourceRef> {
  const subscribedUrls = new Set(subscribed.map((source) => source.url))
  return Object.freeze(featured.filter((site) => !subscribedUrls.has(site.url)))
}
