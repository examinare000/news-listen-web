// @vitest-environment node
// テストの隔離の検査（web-check-08）。DOMAIN・APP を対象にするテストが `@/lib/api`・`@/lib/platform` を import せず、
// `vi.mock('@/lib/api…')` も含まない。対象 = `@/` の import がすべて domain・application・shared で、domain か application を含むテスト。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-08。
//
// 限界（記録）: `@/types` を import する Queue のテスト・APP の 2 ファイルを対象にするテストは対象に入らない。
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { WEB_ROOT, readSource } from '../helpers/architecture'
import { findIsolationViolations, isDomainIsolationTarget } from '../helpers/architectureDetectors'

/** 空振りの防止: 対象に含まれるべきテスト。 */
const MUST_BE_TARGETS = [
  'tests/lib/playback/session.test.ts',
  'tests/lib/playback/resume.test.ts',
  'tests/lib/playback/source.test.ts',
  'tests/lib/account/adminAccess.test.ts',
]

function listTestFiles(dir: string): string[] {
  return readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return listTestFiles(relative)
    return /\.test\.tsx?$/.test(entry.name) ? [relative] : []
  })
}

describe('web-check-08 DOMAIN・APP を対象にするテストの隔離', () => {
  const testFiles = listTestFiles('tests/lib')
  const targets = testFiles.filter((f) => isDomainIsolationTarget(f, readSource(f)))

  test('対象のテストが @/lib/api・@/lib/platform を import せず、vi.mock("@/lib/api…") も含まない（違反 0 件）', () => {
    const violations = targets.flatMap((f) => findIsolationViolations(f, readSource(f)).map((s) => `${f}: ${s}`))
    expect(violations).toEqual([])
  })

  test('対象の集合は session・resume・source・adminAccess の 4 つのテストを含む（空振りの防止）', () => {
    expect(MUST_BE_TARGETS.filter((f) => !targets.includes(f))).toEqual([])
  })
})

describe('web-check-08 検出器の自己点検: 正例を拾い、負例を拾わない', () => {
  const F = 'tests/lib/x.test.ts'

  test('対象の選び方: domain・application・shared だけを import するテストは対象。相対 path とパッケージは数えない', () => {
    const source = [
      "import { describe } from 'vitest'",
      "import { createPlaybackSession } from '@/lib/playback/domain/session'",
      "import type { ApiFailure } from '@/lib/shared/apiFailure'",
      "import { MockAudio } from '../../helpers/mockAudio'",
    ].join('\n')
    expect(isDomainIsolationTarget(F, source)).toBe(true)
  })

  test('対象外: platform・api・types を import するテスト、shared だけのテスト、@/ の import が無いテスト', () => {
    expect(isDomainIsolationTarget(F, "import { a } from '@/lib/playback/domain/session'\nimport { b } from '@/lib/platform/cacheStore'")).toBe(false)
    expect(isDomainIsolationTarget(F, "import { a } from '@/lib/playback/domain/queue'\nimport type { P } from '@/types'")).toBe(false)
    expect(isDomainIsolationTarget(F, "import type { R } from '@/lib/shared/result'")).toBe(false)
    expect(isDomainIsolationTarget(F, "import { a } from './local'")).toBe(false)
    expect(isDomainIsolationTarget(F, "import { a } from '@/lib/playback/domain/session'\nvi.mock('@/lib/api/gateway')")).toBe(false)
  })

  test('違反の検出: 静的 import・動的 import・vi.mock の第 1 引数の @/lib/api・@/lib/platform を拾い、domain は拾わない', () => {
    const source = [
      "import { a } from '@/lib/api/gateway'",
      "import { b } from '@/lib/platform/cacheStore'",
      "const c = await import('@/lib/api')",
      "vi.mock('@/lib/api/gateway')",
      "import { d } from '@/lib/playback/domain/session'",
      "// import { e } from '@/lib/platform/keyValueStore'",
    ].join('\n')
    expect(findIsolationViolations(F, source)).toEqual([
      '@/lib/api/gateway',
      '@/lib/platform/cacheStore',
      '@/lib/api',
      '@/lib/api/gateway',
    ])
    expect(findIsolationViolations(F, "import { d } from '@/lib/playback/domain/session'")).toEqual([])
  })
})
