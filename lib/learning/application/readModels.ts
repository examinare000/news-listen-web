// Learning の read model: Catalog の語彙と登録済みの集合を合成する（web-query-learning-04・web-rule-learning-04）。
import type { GlossaryEntry } from '@/lib/catalog/domain/episode'
import { isRegistered } from '@/lib/learning/domain/vocabulary'

export interface GlossaryView {
  readonly term: string
  readonly meaning: string
  readonly example: string
  readonly registered: boolean
}

export function toGlossaryViews(
  glossary: ReadonlyArray<GlossaryEntry>,
  registered: ReadonlySet<string>,
): ReadonlyArray<GlossaryView> {
  return Object.freeze(
    glossary.map((entry) =>
      Object.freeze({
        term: entry.term,
        meaning: entry.meaningJa,
        example: entry.example,
        registered: isRegistered(entry.term, registered),
      }),
    ),
  )
}
