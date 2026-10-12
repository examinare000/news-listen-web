// @vitest-environment node
// データモデルの漏れの検査（TA-V3）。TA-D4 (a)(b) と TA-D11（localStorage）の実測 ＝ 許可リスト。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §4 TA-D4・TA-D11、§7 TA-V3。
//
// RED 理由（実装前）: architecture/boundaries.allowlist.json が無い。検出器の正例・負例は helper だけで決まるので green。
import { beforeAll, describe, expect, test } from 'vitest'
import {
  listScanFiles,
  readAllowlistRowsStrict,
  readSource,
  rowKeys,
  type Row,
} from '../helpers/architecture'
import {
  collectOwnDeclaredTypeNames,
  detectDomainTypeReferenceRows,
  detectTypesImportRows,
  findLocalStorageOccurrences,
} from '../helpers/architectureDetectors'

const KEY_VALUE_STORE = 'lib/platform/keyValueStore.ts'

/** TP3: app/layout.tsx の inline の theme script（文字列の中の localStorage）。TA-D11 の規則そのものが除外する（TP3）。 */
const TP3_THEME_SCRIPT = { file: 'app/layout.tsx', stringOccurrences: 1 } as const

let scanFiles: string[]

beforeAll(() => {
  scanFiles = listScanFiles()
})

describe('TA-V3 データモデルの漏れ: 実測 ＝ 許可リスト（多くても少なくても落ちる）', () => {
  test('TA-D4 (a)(b) の実測の集合 ＝ 許可リストの rule TA-D4 の行（(a) は層外の lib/*.ts を含める）', () => {
    const dtoTypeNames = collectOwnDeclaredTypeNames(readSource('types/index.ts'))
    const measured: Row[] = scanFiles.flatMap((file) => {
      const source = readSource(file)
      return [...detectTypesImportRows(file, source), ...detectDomainTypeReferenceRows(file, source, dtoTypeNames)]
    })
    const expected = readAllowlistRowsStrict().filter((r) => r.rule === 'TA-D4')
    expect(rowKeys(measured)).toEqual(rowKeys(expected))
  })

  test('TA-D4 (b): DOMAIN の export する宣言に DTO の型名が 0 件（TP-A3 解消）', () => {
    const dtoTypeNames = collectOwnDeclaredTypeNames(readSource('types/index.ts'))
    const measured = scanFiles
      .filter((f) => /^lib\/[^/]+\/domain\//.test(f))
      .flatMap((f) => detectDomainTypeReferenceRows(f, readSource(f), dtoTypeNames))
    expect(rowKeys(measured)).toEqual([])
  })

  test('TA-D11 の実測の集合 ＝ 許可リストの rule TA-D11 の行。TP3 の除外は実在する（1 箇所）', () => {
    const layoutOccurrences = findLocalStorageOccurrences(TP3_THEME_SCRIPT.file, readSource(TP3_THEME_SCRIPT.file))
    expect(
      layoutOccurrences.filter((o) => o.kind === 'string'),
      'TP3 の除外の対象（inline script の文字列の中の localStorage）が実在しない',
    ).toHaveLength(TP3_THEME_SCRIPT.stringOccurrences)

    const measured: Row[] = []
    for (const file of scanFiles) {
      if (file === KEY_VALUE_STORE) continue
      const occurrences = findLocalStorageOccurrences(file, readSource(file)).filter(
        (o) => !(file === TP3_THEME_SCRIPT.file && o.kind === 'string'),
      )
      if (occurrences.length > 0) measured.push({ rule: 'TA-D11', file, specifier: 'localStorage' })
    }
    const expected = readAllowlistRowsStrict().filter((r) => r.rule === 'TA-D11')
    expect(rowKeys(measured)).toEqual(rowKeys(expected))
  })
})

describe('TA-V3 検出器の自己点検: TA-D4 (a)（INFRA・DOMAIN・APP 以外の @/types の import）', () => {
  const rows = (file: string, source: string): string[] => rowKeys(detectTypesImportRows(file, source))

  test('正例: PRES・ROOT・層外の lib/*.ts が @/types を import する（import type を含む）', () => {
    expect(rows('components/X.tsx', "import type { Podcast } from '@/types/index'")).toEqual(['TA-D4 | components/X.tsx | @/types/index'])
    expect(rows('contexts/AudioPlayerContext.tsx', "import { a } from '@/types'")).toEqual(['TA-D4 | contexts/AudioPlayerContext.tsx | @/types'])
    expect(rows('lib/audioCache.ts', "import type { Podcast } from '@/types'")).toEqual(['TA-D4 | lib/audioCache.ts | @/types'])
  })

  test('負例: INFRA・DOMAIN・APP（TA-D1・TA-D2 の行に載せる）・@/types でない import・コメント', () => {
    expect(rows('lib/api/gateway.ts', "import type { Podcast } from '@/types/index'")).toEqual([])
    expect(rows('lib/playback/domain/session.ts', "import type { Podcast } from '@/types'")).toEqual([])
    expect(rows('lib/passkey.ts', "import type { LoginResponse } from '@/types/index'")).toEqual([])
    expect(rows('components/X.tsx', "import { a } from '@/lib/shared/result'")).toEqual([])
    expect(rows('components/X.tsx', "// import type { Podcast } from '@/types'")).toEqual([])
  })
})

describe('TA-V3 検出器の自己点検: TA-D4 (b)（DOMAIN・APP の export する宣言に現れる DTO の型名）', () => {
  const dto = new Set(['Podcast', 'LoginResponse'])
  const rows = (file: string, source: string): string[] => rowKeys(detectDomainTypeReferenceRows(file, source, dto))

  test('types/index.ts が自分で宣言した名前だけを集める（再 export・値の宣言は除く）', () => {
    const names = collectOwnDeclaredTypeNames(
      [
        'export interface Podcast { id: string }',
        "export type LoginResponse = { token: string }",
        "export type { DifficultyLevel } from '@/lib/shared/difficulty'",
        'export const DEFAULT_DIFFICULTY = 1',
        'interface NotExported { a: string }',
      ].join('\n'),
    )
    expect([...names].sort()).toEqual(['LoginResponse', 'Podcast'])
  })

  test('正例: export する interface・type alias・関数の署名・indexed access の中の型参照', () => {
    expect(rows('lib/playback/domain/s.ts', "export interface E { readonly s: Podcast['segments'] }")).toEqual(['TA-D4 | lib/playback/domain/s.ts | Podcast'])
    expect(rows('lib/playback/domain/s.ts', 'export type T = ReadonlyArray<Podcast>')).toEqual(['TA-D4 | lib/playback/domain/s.ts | Podcast'])
    expect(rows('lib/passkey.ts', 'export function f(p: Podcast): void {}')).toEqual(['TA-D4 | lib/passkey.ts | Podcast'])
    expect(rows('lib/passkey.ts', 'export interface C { get(): Promise<LoginResponse> }')).toEqual(['TA-D4 | lib/passkey.ts | LoginResponse'])
  })

  test('負例: export しない宣言・関数の本体の中・DOMAIN と APP 以外のファイル・DTO でない型名', () => {
    expect(rows('lib/playback/domain/s.ts', 'interface Local { p: Podcast }')).toEqual([])
    expect(rows('lib/playback/domain/s.ts', 'export function f(): number { const p: Podcast | null = null; return p === null ? 0 : 1 }')).toEqual([])
    expect(rows('components/X.tsx', 'export interface E { p: Podcast }')).toEqual([])
    expect(rows('lib/playback/domain/s.ts', 'export interface E { readonly p: ApiFailure }')).toEqual([])
  })

  test('SG-W-T2-1: そのファイル自身が同名の型を宣言していれば DTO の型名として数えない（export の有無を問わない）。@/types から import した同名は数える', () => {
    const own = new Set(['QuizQuestion'])
    const ownRows = (file: string, source: string): string[] => rowKeys(detectDomainTypeReferenceRows(file, source, own))

    // 正方向対照: 宣言が無く、@/types から取った名前は漏れとして数える
    expect(
      ownRows('lib/catalog/domain/s.ts', "import type { QuizQuestion } from '@/types'; export interface E { q: QuizQuestion }"),
    ).toEqual(['TA-D4 | lib/catalog/domain/s.ts | QuizQuestion'])
    // export した自前の宣言
    expect(
      ownRows(
        'lib/catalog/domain/s.ts',
        'export interface QuizQuestion { readonly question: string }; export interface E { readonly q: QuizQuestion }',
      ),
    ).toEqual([])
    // export しない自前の宣言
    expect(
      ownRows(
        'lib/catalog/domain/s.ts',
        'interface QuizQuestion { readonly question: string }; export interface E { readonly q: QuizQuestion }',
      ),
    ).toEqual([])
  })
})

describe('TA-V3 検出器の自己点検: TA-D11（localStorage）', () => {
  const kinds = (source: string): string[] => findLocalStorageOccurrences('hooks/x.ts', source).map((o) => o.kind)

  test('正例: 識別子・property 名・文字列・テンプレートの中の localStorage', () => {
    expect(kinds("const v = localStorage.getItem('k')")).toEqual(['identifier'])
    expect(kinds("const v = window.localStorage.getItem('k')")).toEqual(['identifier'])
    expect(kinds("const s = 'localStorage'")).toEqual(['string'])
    expect(kinds('const s = `var x = localStorage.getItem(1)`')).toEqual(['string'])
  })

  test('負例: コメント・別の識別子・localStorage を含まない文字列', () => {
    expect(kinds('// localStorage を使わない\n/* localStorage */ const a = 1')).toEqual([])
    expect(kinds('const localStorageKey = 1')).toEqual([])
    expect(kinds("const s = 'local storage'")).toEqual([])
  })
})
