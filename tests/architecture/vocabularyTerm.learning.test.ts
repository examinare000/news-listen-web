// @vitest-environment node
// Learning の用語の一貫（web-rule-learning-07・shared-dec-25）: domain の語は「登録」で、「習得」は `lib/learning/**` に 1 行も書かない。
// presentation のラベル（page の「習得」ボタン）は `lib/learning/` の外なので対象外。コメントも数える。
// 検出器はこのファイルの中に持つ（`rules.test.ts` の規則の表・`architectureDetectors.ts` は変えない）。
//
// RED 理由（実装前）: 走査集合が `lib/learning/domain/quiz.ts`・`lib/learning/application/commands.ts` を含まない（未実装）。
import { describe, expect, test } from 'vitest'
import { listScanFiles, readSource } from '../helpers/architecture'

const FORBIDDEN_TERM = '習得'

/** 「習得」を含む行の番号（1 始まり）。 */
function linesWithTerm(source: string): number[] {
  return source
    .split('\n')
    .flatMap((line, index) => (line.includes(FORBIDDEN_TERM) ? [index + 1] : []))
}

describe('web-rule-learning-07 lib/learning/** に「習得」を書かない', () => {
  test('verifies: CI-LN21 — 走査集合は空でなく、quiz.ts・commands.ts を含む（空振りの防止）', () => {
    const files = listScanFiles().filter((f) => f.startsWith('lib/learning/'))

    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('lib/learning/domain/quiz.ts')
    expect(files).toContain('lib/learning/application/commands.ts')
  })

  test('verifies: CI-LN21 — lib/learning/** の全ファイルに「習得」を含む行が 0 件', () => {
    const files = listScanFiles().filter((f) => f.startsWith('lib/learning/'))

    const offenders = files.flatMap((file) => linesWithTerm(readSource(file)).map((line) => `${file}:${line}`))

    expect(offenders).toEqual([])
  })

  test('verifies: CI-LN21 — 自己点検: 検出器は「習得」を含む文字列に反応し、「登録」だけの文字列には反応しない', () => {
    expect(linesWithTerm('// この語を習得する\nconst x = 1')).toEqual([1])
    expect(linesWithTerm('const label = "習得"')).toEqual([1])
    expect(linesWithTerm('// 語を登録する\nconst registered = true')).toEqual([])
  })
})
