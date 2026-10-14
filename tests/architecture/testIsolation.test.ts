// @vitest-environment node
// テストの隔離の検査（web-check-08）。DOMAIN・APP を検証するテストの母集団を、禁止依存の有無から独立に確定し、
// その全員に API・platform・adapter・module の読み込みや差し替えの検査をかける。
// 対象 = (分類が unit で、到達に DOMAIN・APP を含む) または (path が tests/lib/<context>/{domain,application}/ の下)。
// 到達は test-local の閉包で求め、違反の検出と同じ範囲を走る。禁止依存を足しても対象からは外れない。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-08。
// 台帳: tests/architecture/testIsolation.inventory.ts（全テストの分類・subject の対応・移行許可）。
//
// 既存の自己点検との対応: 正例（domain・shared・相対 helper を import するテストは対象）は維持し、
// 旧版が「対象外」として固定していた欠陥（domain と platform・api・vi.mock の混在）は「対象に残り、違反になる」へ反転した。
// 型だけの import（@/types など）は I/O を生まないので違反にしない。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { WEB_ROOT, listScanFiles, parseSource, readSource } from '../helpers/architecture'
import { evaluateTestIsolation } from '../helpers/architectureDetectors'
import type {
  IsolationFinding,
  MigrationAllowance,
  TestInventoryEntry,
  TestIsolationInput,
  TestIsolationResult,
} from '../helpers/architectureDetectors'
import { MIGRATION_ALLOWANCES, SUBJECT_INVENTORY, TEST_INVENTORY } from './testIsolation.inventory'

/** 空振りの防止: 対象に含まれるべきテスト。 */
const MUST_BE_TARGETS = [
  'tests/lib/playback/session.test.ts',
  'tests/lib/playback/resume.test.ts',
  'tests/lib/playback/source.test.ts',
  'tests/lib/account/adminAccess.test.ts',
]

/** vitest.config.ts の setupFiles と一致させる定数。 */
const SETUP_FILES = ['tests/setup.ts']

/** 移行許可の removeBy・task の値域。増やすときは仕様の改訂として扱う。 */
const ALLOWED_OWNER_TASKS = ['web-slice-account-01', 'web-slice-notify-01', 'web-slice-closure-01']

// ---------------------------------------------------------------------------
// 実ツリーの入力
// ---------------------------------------------------------------------------

function listTestFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: WEB_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const files = out
    .split('\n')
    .filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => !/(^|\/)(node_modules|e2e)\//.test(f))
    .filter((f) => existsSync(path.join(WEB_ROOT, f)))
  return [...new Set(files)].sort()
}

function readSourceOrUndefined(file: string): string | undefined {
  try {
    return readSource(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function realInput(): TestIsolationInput {
  return {
    testFiles: listTestFiles(),
    setupFiles: SETUP_FILES,
    productionFiles: listScanFiles(),
    readSource: readSourceOrUndefined,
    tests: TEST_INVENTORY,
    subjects: SUBJECT_INVENTORY,
    allowances: MIGRATION_ALLOWANCES,
  }
}

// ---------------------------------------------------------------------------
// fixture の組み立て（evaluateTestIsolation に渡す入力を、実ツリーと同じ形で作る）
// ---------------------------------------------------------------------------

/** 土台: learning の context にだけ subject があり、1 本の unit テストがそれを検証する。 */
const TEST = 'tests/lib/learning/queries.test.ts'
const QUERIES = 'lib/learning/application/queries.ts'
const DOMAIN_IMPORT = "import { f } from '@/lib/learning/application/queries'"
const HEADER = "import { describe, expect, vi } from 'vitest'"
const SETUP = 'tests/setup.ts'

const BASE_SOURCES: Readonly<Record<string, string>> = {
  [TEST]: [HEADER, DOMAIN_IMPORT].join('\n'),
  [QUERIES]: 'export const f = (): number => 1',
  [SETUP]: "import { vi } from 'vitest'\nvi.mock('next/navigation', () => ({ useRouter: () => ({}) }))",
}

interface Scenario {
  /** 追加・上書きするファイルの本文（テスト・helper・production・setup）。 */
  readonly sources?: Readonly<Record<string, string>>
  /** 追加・上書きする分類。 */
  readonly tests?: Readonly<Record<string, TestInventoryEntry>>
  /** 台帳から外すテスト。 */
  readonly dropTests?: readonly string[]
  /** 列挙するテスト。省略時は分類のキーすべて。 */
  readonly testFiles?: readonly string[]
  /** subject の対応。省略時は土台のもの。 */
  readonly subjects?: Readonly<Record<string, readonly string[]>>
  readonly extraProduction?: readonly string[]
  readonly allowances?: readonly MigrationAllowance[]
}

function build(scenario: Scenario = {}): TestIsolationInput {
  const sources: Record<string, string> = { ...BASE_SOURCES, ...scenario.sources }
  const tests: Record<string, TestInventoryEntry> = { [TEST]: { class: 'unit' }, ...scenario.tests }
  for (const dropped of scenario.dropTests ?? []) delete tests[dropped]
  return {
    testFiles: scenario.testFiles ?? Object.keys(tests),
    setupFiles: [SETUP],
    productionFiles: [QUERIES, ...(scenario.extraProduction ?? [])],
    readSource: (file) => sources[file],
    tests,
    subjects: scenario.subjects ?? { [QUERIES]: [TEST] },
    allowances: scenario.allowances ?? [],
  }
}

const evaluateScenario = (scenario?: Scenario): TestIsolationResult => evaluateTestIsolation(build(scenario))

/** 土台のテストの本文を差し替える。 */
const withTestSource = (source: string, extra: Scenario = {}): Scenario => ({
  ...extra,
  sources: { ...extra.sources, [TEST]: source },
})

/** 土台のテストに行を足す。 */
const withLines = (...lines: string[]): Scenario => withTestSource([HEADER, DOMAIN_IMPORT, ...lines].join('\n'))

/** subject を検証する別の unit テスト。土台のテストを integration に替えても、subject の検証は残す。 */
const COVERING_UNIT = 'tests/lib/learning/queriesCovering.test.ts'

/**
 * 土台のテストを integration（理由付き）に置き換えて、同じ本文を非対象側にも置く。
 * 既定では別の unit テストが subject を検証し続ける。`covered: false` なら、subject を検証する unit テストが無くなる。
 */
const asIntegration = (source: string, options: { readonly covered?: boolean } = {}): Scenario => {
  const covered = options.covered ?? true
  return {
    ...withTestSource(source),
    tests: {
      [TEST]: { class: 'integration', reason: '結合の確認' },
      ...(covered ? { [COVERING_UNIT]: { class: 'unit' } } : {}),
    },
    subjects: { [QUERIES]: covered ? [COVERING_UNIT] : [] },
    sources: {
      [TEST]: source,
      [QUERIES]: BASE_SOURCES[QUERIES],
      ...(covered ? { [COVERING_UNIT]: [HEADER, DOMAIN_IMPORT].join('\n') } : {}),
    },
  }
}

const brief = (findings: readonly IsolationFinding[]): string[] => findings.map((f) => `${f.kind} | ${f.file} | ${f.detail}`)
const ofKind = (result: TestIsolationResult, kind: string): IsolationFinding[] => result.findings.filter((f) => f.kind === kind)
const detailsOf = (result: TestIsolationResult, kind: string): string[] => ofKind(result, kind).map((f) => f.detail)
const kindsOf = (result: TestIsolationResult): string[] => [...new Set(result.findings.map((f) => f.kind))].sort()

const FORBIDDEN = 'forbidden-dependency'
const MOCK_OR_LOAD = 'module-mock-or-load'
const UNDETERMINABLE = 'undeterminable-module-load'
const UNRESOLVED_LOCAL = 'unresolved-local-import'
const UNCLASSIFIED = 'unclassified-test'
const UNKNOWN_TEST = 'unknown-test'
const INVALID_CLASS = 'invalid-class'
const MISSING_REASON = 'missing-reason'
const ADAPTER_WITHOUT_ADAPTER = 'adapter-without-adapter-import'
const UNREGISTERED_SUBJECT = 'unregistered-subject'
const UNKNOWN_SUBJECT = 'unknown-subject'
const SUBJECT_MISMATCH = 'subject-tests-mismatch'
const SUBJECT_UNTESTED = 'subject-untested'
const STALE_ALLOWANCE = 'stale-allowance'
const SETUP_DEPENDENCY = 'setup-production-dependency'
const DISALLOWED_VI = 'disallowed-vi-call'

/** 前提条件の違反として意図的に投げた Error であること（未実装の呼び出しによる TypeError を合格にしない）。 */
function expectDeliberateThrow(run: () => unknown): void {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(Error)
  expect(thrown).not.toBeInstanceOf(TypeError)
}

const only = (kind: string, detail: string, file: string = TEST): string => `${kind} | ${file} | ${detail}`

// ---------------------------------------------------------------------------
// 実ツリー
// ---------------------------------------------------------------------------

describe('web-check-08 実ツリー: 全テストの分類・全 subject の対応・隔離', () => {
  test('違反 0 件: 全テストが分類済みで、全 subject が対応済みで、対象テストが禁止依存を持たない', () => {
    const result = evaluateTestIsolation(realInput())
    expect(brief(result.findings)).toEqual([])
  })

  test('対象の集合は session・resume・source・adminAccess の 4 つのテストを含む（空振りの防止）', () => {
    const result = evaluateTestIsolation(realInput())
    expect(MUST_BE_TARGETS.filter((f) => !result.targets.includes(f))).toEqual([])
  })

  test('DOMAIN・APP に到達する unit 以外のテストは、閉じた集合と完全に一致する', () => {
    const result = evaluateTestIsolation(realInput())
    expect(result.domainImportingNonUnit).toEqual(['tests/architecture/immutability.catalog.test.ts'])
  })

  test('移行許可は形を満たす: 各欄が空でない、removeBy と task が値域の中、file が列挙にある、重複が無い', () => {
    const listed = new Set(listTestFiles())
    const pairs = MIGRATION_ALLOWANCES.map((a) => `${a.file} | ${a.specifier}`)
    for (const a of MIGRATION_ALLOWANCES) {
      for (const value of [a.file, a.specifier, a.owner, a.reason, a.removeBy, a.task]) {
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true)
      }
      expect(ALLOWED_OWNER_TASKS).toContain(a.removeBy)
      expect(ALLOWED_OWNER_TASKS).toContain(a.task)
      expect(listed.has(a.file)).toBe(true)
    }
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  test('vitest.config.ts の test.setupFiles（AST で読む）が SETUP_FILES と一致する', () => {
    const sf = parseSource('vitest.config.ts', readFileSync(path.join(WEB_ROOT, 'vitest.config.ts'), 'utf8'))
    const found: string[][] = []
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'setupFiles') {
        if (ts.isArrayLiteralExpression(node.initializer)) {
          found.push(node.initializer.elements.map((e) => (ts.isStringLiteralLike(e) ? e.text.replace(/^\.\//, '') : '<non-literal>')))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(found).toEqual([SETUP_FILES])
  })

  test('テストの列挙は空でなく、自分自身を含み、e2e と node_modules の下を含まない', () => {
    const testFiles = listTestFiles()
    expect(testFiles.length).toBeGreaterThan(0)
    expect(testFiles).toContain('tests/architecture/testIsolation.test.ts')
    expect(testFiles.filter((f) => /(^|\/)(e2e|node_modules)\//.test(f))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 検出器の自己点検（fixture）
// ---------------------------------------------------------------------------

describe('web-check-08 自己点検: 禁止依存を足しても、対象に残り、違反として検出される', () => {
  test('新しい context の fixture に domain と api を混ぜると、対象に残り api が違反になる', () => {
    const result = evaluateScenario(withLines("import { g } from '@/lib/api/gateway'"))
    expect(result.targets).toContain(TEST)
    expect(brief(result.findings)).toEqual([only(FORBIDDEN, '@/lib/api/gateway')])
  })

  test('domain と platform を混ぜると platform が違反になる', () => {
    const result = evaluateScenario(withLines("import { k } from '@/lib/platform/keyValueStore'"))
    expect(brief(result.findings)).toEqual([only(FORBIDDEN, '@/lib/platform/keyValueStore')])
  })

  test('domain と vi.mock を混ぜると module の差し替えが違反になる', () => {
    const result = evaluateScenario(withLines("vi.mock('@/lib/api/gateway')"))
    expect(result.targets).toContain(TEST)
    expect(brief(result.findings)).toEqual([only(MOCK_OR_LOAD, "vi.mock('@/lib/api/gateway')")])
  })

  test('禁止 import を足す前後で、fixture は対象集合に残る。純粋な fixture は違反 0 件', () => {
    const variants = [
      withLines(),
      withLines("import { g } from '@/lib/api/gateway'"),
      withLines("import { k } from '@/lib/platform/keyValueStore'"),
      withLines("vi.mock('@/lib/api/gateway')"),
    ]
    const results = variants.map((v) => evaluateScenario(v))
    expect(results.map((r) => r.targets.includes(TEST))).toEqual([true, true, true, true])
    expect(results[0].findings).toEqual([])
  })

  test('相対 path で lib/api を import しても違反になる', () => {
    const result = evaluateScenario(withLines("import { x } from '../../../lib/api'"))
    expect(brief(result.findings)).toEqual([only(FORBIDDEN, '../../../lib/api')])
  })

  test('helper に隠した platform への実行時依存は、helper の path つきで違反になる', () => {
    const result = evaluateScenario({
      ...withLines("import { s } from '../../helpers/learningStore'"),
      sources: {
        [TEST]: [HEADER, DOMAIN_IMPORT, "import { s } from '../../helpers/learningStore'"].join('\n'),
        'tests/helpers/learningStore.ts': "import { s } from '@/lib/platform/keyValueStore'\nexport { s }",
      },
    })
    expect(brief(result.findings)).toEqual([only(FORBIDDEN, 'tests/helpers/learningStore.ts → @/lib/platform/keyValueStore')])
  })

  test('helper の型だけの import と vi.stubGlobal は許可される（手書き fake）', () => {
    const result = evaluateScenario({
      sources: {
        [TEST]: [HEADER, DOMAIN_IMPORT, "import { g } from '../../helpers/gatewayStub'"].join('\n'),
        'tests/helpers/gatewayStub.ts': [
          "import { vi } from 'vitest'",
          "import type { ApiGateway } from '@/lib/api/gateway'",
          "export const g = (): ApiGateway | null => { vi.stubGlobal('x', 1); return null }",
        ].join('\n'),
      },
    })
    expect(result.findings).toEqual([])
  })

  test('production 外部 path（走査集合の外を含む）は、domain・application・shared 以外すべて違反', () => {
    const specifiers = [
      '@/lib/webauthnBrowserPort',
      '@/lib/format',
      '@/components/X',
      '@/public/sw.js',
      '../../../next.config',
      '../../../../outside',
    ]
    const lines = specifiers.map((s, i) => `import { v${i} } from '${s}'`)
    const result = evaluateScenario(withLines(...lines))
    expect(detailsOf(result, FORBIDDEN).sort()).toEqual([...specifiers].sort())
  })

  test('標準ライブラリ（node:fs）の import は違反。vitest 以外のパッケージはすべて違反', () => {
    const result = evaluateScenario(withLines("import fs from 'node:fs'"))
    expect(brief(result.findings)).toEqual([only(FORBIDDEN, 'node:fs')])
  })

  test('型だけの import（@/lib/platform の型・@/types）は違反にならない', () => {
    const result = evaluateScenario(
      withLines("import type { C } from '@/lib/platform/cacheStore'", "import type { T } from '@/types'"),
    )
    expect(result.targets).toContain(TEST)
    expect(result.findings).toEqual([])
  })

  test('存在しない helper は解決失敗、helper 同士の循環は終了して違反なし', () => {
    const missing = evaluateScenario(withLines("import { n } from '../../helpers/nope'"))
    expect(ofKind(missing, UNRESOLVED_LOCAL).map((f) => f.file)).toEqual([TEST])
    const cycle = evaluateScenario({
      sources: {
        [TEST]: [HEADER, DOMAIN_IMPORT, "import '../../helpers/cycleA'"].join('\n'),
        'tests/helpers/cycleA.ts': "import './cycleB'\nexport const a = 1",
        'tests/helpers/cycleB.ts': "import './cycleA'\nexport const b = 1",
      },
    })
    expect(cycle.findings).toEqual([])
  })

  test('行き先を決められない読み込み（非リテラルの import()・vi.mock・require）は 行き先不明の読み込み になる', () => {
    expect(kindsOf(evaluateScenario(withLines('const t = async () => { await import(name) }')))).toContain(UNDETERMINABLE)
    expect(kindsOf(evaluateScenario(withLines('vi.mock(name)')))).toContain(UNDETERMINABLE)
    expect(detailsOf(evaluateScenario(withLines("const r = require('x')")), UNDETERMINABLE)).toContain('require')
  })

  test('静的 import・export from・import()・vi.mock の api・platform を拾い、コメントと domain は拾わない', () => {
    const result = evaluateScenario(
      withLines(
        "import { a } from '@/lib/api/gateway'",
        "export { b } from '@/lib/platform/cacheStore'",
        "const t = async () => { await import('@/lib/api') }",
        "vi.mock('@/lib/platform/keyValueStore')",
        "// import { e } from '@/lib/platform/webauthn'",
      ),
    )
    expect(detailsOf(result, FORBIDDEN).sort()).toEqual(['@/lib/api', '@/lib/api/gateway', '@/lib/platform/cacheStore'])
    expect(detailsOf(result, MOCK_OR_LOAD)).toEqual(["vi.mock('@/lib/platform/keyValueStore')"])
    expect(result.findings).toHaveLength(4)
  })

  test('vi の読み込み系 5 メンバーはそれぞれ module の読み込み・差し替え。importActual は到達する先の違反も出す', () => {
    const forms: Array<[string, string]> = [
      ["vi.unmock('x')", "vi.unmock('x')"],
      ["vi.doUnmock('x')", "vi.doUnmock('x')"],
      ["vi.importMock('x')", "vi.importMock('x')"],
      ["vi.doMock('x')", "vi.doMock('x')"],
    ]
    for (const [line, detail] of forms) {
      expect(detailsOf(evaluateScenario(withLines(line)), MOCK_OR_LOAD)).toEqual([detail])
    }
    const actual = evaluateScenario(withLines("vi.importActual('@/lib/platform/keyValueStore')"))
    expect(detailsOf(actual, MOCK_OR_LOAD)).toEqual(["vi.importActual('@/lib/platform/keyValueStore')"])
    expect(detailsOf(actual, FORBIDDEN)).toEqual(['@/lib/platform/keyValueStore'])
  })

  test('import.meta は、対象・DOMAIN に到達しない unit・integration のどれでも 行き先不明の読み込み になる', () => {
    const line = "const files = import.meta.glob('../../../lib/api/*.ts')"
    expect(kindsOf(evaluateScenario(withLines(line)))).toContain(UNDETERMINABLE)
    const plainUnit = 'tests/lib/learning/plain.test.ts'
    const unitResult = evaluateScenario({
      sources: { [plainUnit]: [HEADER, line].join('\n') },
      tests: { [plainUnit]: { class: 'unit' } },
    })
    expect(ofKind(unitResult, UNDETERMINABLE).map((f) => f.file)).toEqual([plainUnit])
    expect(unitResult.targets).not.toContain(plainUnit)
    expect(kindsOf(evaluateScenario(asIntegration([HEADER, DOMAIN_IMPORT, line].join('\n'))))).toContain(UNDETERMINABLE)
  })

  test('vi の許可集合: stubEnv・hoisted は 許可外の vi 呼び出し。fn・spyOn・useFakeTimers は違反なし', () => {
    const denied = evaluateScenario(withLines("vi.stubEnv('A', '1')", 'vi.hoisted(() => 1)'))
    expect(detailsOf(denied, DISALLOWED_VI).sort()).toEqual(['vi.hoisted', 'vi.stubEnv'])
    const allowed = evaluateScenario(withLines('vi.fn()', "vi.spyOn(console, 'log')", 'vi.useFakeTimers()'))
    expect(allowed.findings).toEqual([])
  })

  test('vi の別名（代入・namespace import・名前付き import の別名）の扱い', () => {
    expect(kindsOf(evaluateScenario(withLines('const v = vi', "v.importActual('x')")))).toContain(UNDETERMINABLE)
    const namespace = evaluateScenario(withLines("import * as vt from 'vitest'"))
    expect(detailsOf(namespace, UNDETERMINABLE)).toEqual(['vitest'])
    const aliased = evaluateScenario(
      withTestSource(["import { describe } from 'vitest'", "import { vi as w } from 'vitest'", DOMAIN_IMPORT, "w.mock('@/lib/api')"].join('\n')),
    )
    expect(brief(aliased.findings)).toEqual([only(MOCK_OR_LOAD, "vi.mock('@/lib/api')")])
  })

  test('vi.importActual だけで DOMAIN に到達する unit テストも対象に含まれる', () => {
    const source = [HEADER, "const t = async () => { await vi.importActual('@/lib/learning/application/queries') }"].join('\n')
    const result = evaluateScenario(withTestSource(source))
    expect(result.targets).toContain(TEST)
    expect(brief(result.findings)).toEqual([only(MOCK_OR_LOAD, "vi.importActual('@/lib/learning/application/queries')")])
  })

  test('production の adapter module に置いた fake の実行時 import は違反。tests/helpers に置いた型実装の fake は許可', () => {
    const production = evaluateScenario(withLines("import { createFakeWebAuthn } from '@/lib/platform/webauthn'"))
    expect(detailsOf(production, FORBIDDEN)).toEqual(['@/lib/platform/webauthn'])
    const helper = evaluateScenario({
      sources: {
        [TEST]: [HEADER, DOMAIN_IMPORT, "import { createFakeWebAuthn } from '../../helpers/fakeWebAuthn'"].join('\n'),
        'tests/helpers/fakeWebAuthn.ts': [
          "import type { WebAuthnPort } from '@/lib/account/application/webauthnPort'",
          'export function createFakeWebAuthn(): WebAuthnPort { return { id: 1 } }',
        ].join('\n'),
      },
    })
    expect(helper.findings).toEqual([])
  })
})

describe('web-check-08 自己点検: 型の位置・import・プロパティ名の vi は違反にしない', () => {
  const CONTROL = [
    'let s: ReturnType<typeof vi.fn> | null = null',
    'type L = ReturnType<typeof vi.importMock>',
    'const o = { vi: 1 }',
    'o.vi',
    'vi.fn()',
  ]

  test('対象でも非対象の integration でも、型の位置・import specifier・プロパティ名・vi.fn は違反 0 件', () => {
    const lines = ["import { describe, it, vi } from 'vitest'", DOMAIN_IMPORT, ...CONTROL]
    const target = evaluateScenario(withTestSource(lines.join('\n')))
    expect(target.targets).toContain(TEST)
    expect(target.findings).toEqual([])
    expect(evaluateScenario(asIntegration(lines.join('\n'))).findings).toEqual([])
  })

  test('読み込み系メンバーを呼び出さずに取り出す形は 行き先不明の読み込み、許可外メンバーの heritage clause は 許可外の vi 呼び出し', () => {
    const forms: Array<[string, string, string]> = [
      ["const load = vi.importActual<typeof import('@/lib/api')>", UNDETERMINABLE, 'vi.importActual'],
      ['const m = vi.doMock', UNDETERMINABLE, 'vi.doMock'],
      ['class K extends vi.stubEnv {}', DISALLOWED_VI, 'vi.stubEnv'],
      ['class J extends vi.importMock<object> {}', UNDETERMINABLE, 'vi.importMock'],
    ]
    for (const [line, kind, detail] of forms) {
      const source = [HEADER, DOMAIN_IMPORT, line, ...CONTROL].join('\n')
      expect(brief(evaluateScenario(withTestSource(source)).findings)).toEqual([only(kind, detail)])
    }
    const nonTargetForms = forms.filter(([, kind]) => kind === UNDETERMINABLE)
    for (const [line, kind, detail] of nonTargetForms) {
      const source = [HEADER, DOMAIN_IMPORT, line, ...CONTROL].join('\n')
      expect(brief(evaluateScenario(asIntegration(source)).findings)).toEqual([only(kind, detail)])
    }
  })
})

describe('web-check-08 自己点検: vi を別の入口から入手する形', () => {
  const sourceOf = (...lines: string[]): string => [HEADER, DOMAIN_IMPORT, ...lines].join('\n')
  const withHelper = (helperPath: string, helperSource: string, ...lines: string[]): Scenario => ({
    sources: { [TEST]: sourceOf(...lines), [helperPath]: helperSource },
  })

  test('helper の export * from vitest は、helper の path つきの 行き先不明の読み込み だけ', () => {
    const result = evaluateScenario(
      withHelper('tests/helpers/vt.ts', "export * from 'vitest'", "import { vi as q } from '../../helpers/vt'", "q.mock('@/lib/api/gateway')"),
    )
    expect(brief(result.findings)).toEqual([only(UNDETERMINABLE, 'tests/helpers/vt.ts → vitest')])
  })

  test('helper の export {vi} from vitest・export * as v from vitest も 行き先不明の読み込み（helper の path つき）', () => {
    const named = evaluateScenario(withHelper('tests/helpers/vtNamed.ts', "export { vi } from 'vitest'", "import { vi as q } from '../../helpers/vtNamed'"))
    // ExportSpecifier の vi は値の受け渡しなので、specifier の vitest とは別に数える
    expect(brief(named.findings)).toEqual([
      only(UNDETERMINABLE, 'tests/helpers/vtNamed.ts → vi'),
      only(UNDETERMINABLE, 'tests/helpers/vtNamed.ts → vitest'),
    ])
    const ns = evaluateScenario(withHelper('tests/helpers/vtNs.ts', "export * as v from 'vitest'", "import { v } from '../../helpers/vtNs'"))
    expect(brief(ns.findings)).toEqual([only(UNDETERMINABLE, 'tests/helpers/vtNs.ts → vitest')])
  })

  test('import("vitest") と import vt = require("vitest") は 行き先不明の読み込み だけ', () => {
    const dynamicImport = evaluateScenario(
      withTestSource(sourceOf('const t = async () => { const vt = await import(\'vitest\'); await vt.vi.importActual(\'@/lib/api\') }')),
    )
    expect(brief(dynamicImport.findings)).toEqual([only(UNDETERMINABLE, 'vitest')])
    const equals = evaluateScenario(withTestSource(sourceOf("import vt = require('vitest')", "vt.vi.mock('@/lib/api')")))
    expect(brief(equals.findings)).toEqual([only(UNDETERMINABLE, 'vitest')])
  })

  test('global の vitest は <vi> として扱われ、mock と importActual を検出する', () => {
    const actual = evaluateScenario(withTestSource(sourceOf("const t = async () => { await vitest.importActual('@/lib/api') }")))
    expect(brief(actual.findings).sort()).toEqual(
      [only(MOCK_OR_LOAD, "vi.importActual('@/lib/api')"), only(FORBIDDEN, '@/lib/api')].sort(),
    )
    const aliased = evaluateScenario(withTestSource(["import { describe } from 'vitest'", "import { vitest as q } from 'vitest'", DOMAIN_IMPORT, "q.mock('x')"].join('\n')))
    expect(brief(aliased.findings)).toEqual([only(MOCK_OR_LOAD, "vi.mock('x')")])
    const stub = evaluateScenario(withTestSource(sourceOf("vitest.stubEnv('A', '1')")))
    expect(brief(stub.findings)).toEqual([only(DISALLOWED_VI, 'vi.stubEnv')])
  })

  test('vitest を名前にする局所宣言は 行き先不明の読み込み（同名で隠す書き方は fail-closed）', () => {
    expect(kindsOf(evaluateScenario(withTestSource(sourceOf('const vitest = 1'))))).toEqual([UNDETERMINABLE])
  })

  test('integration でも入手経路の迂回は 行き先不明の読み込み だけで、サブパスと @vitest/ の import も 行き先不明の読み込み', () => {
    const helperCase = asIntegration(sourceOf("import { vi as q } from '../../helpers/vt'"))
    const result = evaluateScenario({
      ...helperCase,
      sources: { ...helperCase.sources, 'tests/helpers/vt.ts': "export * from 'vitest'" },
    })
    expect(brief(result.findings)).toEqual([only(UNDETERMINABLE, 'tests/helpers/vt.ts → vitest')])
    const subpath = evaluateScenario(asIntegration(sourceOf("import { vi as r } from 'vitest/runtime'")))
    expect(brief(subpath.findings)).toEqual([only(UNDETERMINABLE, 'vitest/runtime')])
    const scoped = evaluateScenario(asIntegration(sourceOf("import { fn } from '@vitest/spy'")))
    expect(brief(scoped.findings)).toEqual([only(UNDETERMINABLE, '@vitest/spy')])
    const requireForm = evaluateScenario(asIntegration(sourceOf("import vt = require('vitest')")))
    expect(brief(requireForm.findings)).toEqual([only(UNDETERMINABLE, 'vitest')])
  })

  test('DOMAIN を import しない unit テストでも、vitest.importActual で到達すれば対象で module の読み込み・差し替え', () => {
    const plain = 'tests/lib/learning/viaGlobal.test.ts'
    const result = evaluateScenario({
      sources: {
        [plain]: "const t = async () => { await vitest.importActual('@/lib/learning/application/queries') }",
      },
      tests: { [plain]: { class: 'unit' } },
      subjects: { [QUERIES]: [TEST, plain] },
    })
    expect(result.targets).toContain(plain)
    expect(brief(result.findings)).toEqual([only(MOCK_OR_LOAD, "vi.importActual('@/lib/learning/application/queries')", plain)])
  })

  test('対照: import { vitest } from vitest と vitest.fn() だけなら違反なし', () => {
    const result = evaluateScenario(
      withTestSource(["import { describe } from 'vitest'", "import { vitest } from 'vitest'", DOMAIN_IMPORT, 'vitest.fn()'].join('\n')),
    )
    expect(result.findings).toEqual([])
  })
})

describe('web-check-08 自己点検: vi を通らない読み込み手段の名前', () => {
  const sourceOf = (...lines: string[]): string => [HEADER, DOMAIN_IMPORT, ...lines].join('\n')
  const FUNCTION_FORMS = [
    "new Function('return 1')",
    "Function('return 1')()",
    'class E extends Function {}',
    "(Function)('return 1')()",
    "globalThis.Function('return 1')()",
    "new globalThis.Function('return 1')",
    "(0, Function)('return 1')",
    'const F = Function',
    "Function.call(null, 'return 1')",
    'Function`return 1`',
    'expect.any((Function))',
  ]
  const NAME_FORMS: Array<{ lines: string[]; expected: Array<[string, string]> }> = [
    {
      lines: [
        'declare const __vitest_mocker__: any',
        "__vitest_mocker__.queueMock('@/lib/api/gateway', '/abs/x.test.ts', () => ({}))",
      ],
      expected: [[UNDETERMINABLE, '__vitest_mocker__']],
    },
    {
      lines: ["globalThis.__vitest_mocker__.importActual('@/lib/api', '/abs/x.test.ts')"],
      expected: [[UNDETERMINABLE, '__vitest_mocker__']],
    },
    { lines: ["await __vite_ssr_dynamic_import__('/lib/api')"], expected: [[UNDETERMINABLE, '__vite_ssr_dynamic_import__']] },
    { lines: ['eval("import(\'@/lib/api\')")'], expected: [[UNDETERMINABLE, 'eval']] },
    {
      lines: ["process.getBuiltinModule('node:module').createRequire(__filename)('@/lib/api')"],
      expected: [
        [UNDETERMINABLE, 'createRequire'],
        [UNDETERMINABLE, 'getBuiltinModule'],
      ],
    },
    { lines: ["const r = require; r('@/lib/api')"], expected: [[UNDETERMINABLE, 'require']] },
    {
      lines: ["module.require('@/lib/api')"],
      expected: [
        [UNDETERMINABLE, 'module'],
        [UNDETERMINABLE, 'require'],
      ],
    },
  ]

  test('ランタイムの内部入口・Node の module API・文字列評価の名前は、形ごとに 行き先不明の読み込み の件数まで一致する', () => {
    for (const { lines, expected } of NAME_FORMS) {
      const result = evaluateScenario(withTestSource(sourceOf(...lines)))
      expect(brief(result.findings)).toEqual(expected.map(([kind, detail]) => only(kind, detail)).sort())
      expect(result.targets).toContain(TEST)
    }
  })

  test('Function の 11 形は、形ごとに 行き先不明の読み込み Function の 1 件だけ', () => {
    for (const form of FUNCTION_FORMS) {
      const result = evaluateScenario(withTestSource(sourceOf(form)))
      expect({ form, found: brief(result.findings) }).toEqual({ form, found: [only(UNDETERMINABLE, 'Function')] })
    }
  })

  test('helper の中の名前は helper の path つきの 行き先不明の読み込み になる', () => {
    const result = evaluateScenario({
      sources: {
        [TEST]: sourceOf("import '../../helpers/mk'"),
        'tests/helpers/mk.ts': [
          'declare const __vitest_mocker__: any',
          "__vitest_mocker__.queueMock('@/lib/api/gateway', '/abs/x.test.ts', () => ({}))",
        ].join('\n'),
      },
    })
    expect(brief(result.findings)).toEqual([only(UNDETERMINABLE, 'tests/helpers/mk.ts → __vitest_mocker__')])
  })

  test('integration でも同じ名前は同じ finding になり、対象の fixture も対象から外れない', () => {
    for (const { lines, expected } of NAME_FORMS) {
      const result = evaluateScenario(asIntegration(sourceOf(...lines)))
      expect(brief(result.findings)).toEqual(expected.map(([kind, detail]) => only(kind, detail)).sort())
    }
  })

  test('対照: process.on・expect.any(Function)・new Set(Function)・instanceof・型の位置・required・{ module: 1 } は違反なし', () => {
    const result = evaluateScenario(
      withTestSource(
        sourceOf(
          "process.on('x', f)",
          'expect.any(Function)',
          'new Set(Function)',
          'value instanceof Function',
          'let fn: Function | null = null',
          'type C = typeof Function',
          'const required = 1',
          'const o = { module: 1 }',
        ),
      ),
    )
    expect(result.targets).toContain(TEST)
    expect(result.findings).toEqual([])
  })
})

describe('web-check-08 自己点検: 母集団・分類・subject・移行許可・前提条件', () => {
  const OTHER = 'tests/lib/learning/other.test.ts'
  const PURE = [HEADER, "export const noop = 1"].join('\n')

  test('台帳に無いテストは 未分類、実在しない台帳のエントリは 存在しないテスト', () => {
    const unclassified = evaluateScenario({ sources: { [OTHER]: PURE }, testFiles: [TEST, OTHER] })
    expect(ofKind(unclassified, UNCLASSIFIED).map((f) => f.file)).toEqual([OTHER])
    const ghost = 'tests/lib/learning/ghost.test.ts'
    const unknown = evaluateScenario({ tests: { [ghost]: { class: 'unit' } }, testFiles: [TEST] })
    expect(ofKind(unknown, UNKNOWN_TEST).map((f) => f.file)).toEqual([ghost])
  })

  test('理由の無い adapter・integration は 理由なし、不正な class は 不正な分類', () => {
    const adapterFile = 'tests/lib/learning/adapterNoReason.test.ts'
    const integrationFile = 'tests/lib/learning/integrationNoReason.test.ts'
    const badClassFile = 'tests/lib/learning/badClass.test.ts'
    const external = "import { g } from '@/lib/api/gateway'"
    const result = evaluateScenario({
      sources: { [adapterFile]: external, [integrationFile]: external, [badClassFile]: external },
      tests: {
        [adapterFile]: { class: 'adapter', reason: '' },
        [integrationFile]: { class: 'integration' },
        [badClassFile]: { class: 'e2e' as unknown as 'unit' },
      },
    })
    expect(ofKind(result, MISSING_REASON).map((f) => f.file).sort()).toEqual([adapterFile, integrationFile].sort())
    expect(ofKind(result, INVALID_CLASS).map((f) => f.file)).toEqual([badClassFile])
  })

  test('adapter が adapter に依存しなければ adapter への依存なし。理由付きで api に依存する adapter は違反なしで対象外', () => {
    const noAdapterDependency = evaluateScenario({
      sources: { [OTHER]: [HEADER, DOMAIN_IMPORT].join('\n') },
      tests: { [OTHER]: { class: 'adapter', reason: '確認' } },
    })
    expect(ofKind(noAdapterDependency, ADAPTER_WITHOUT_ADAPTER).map((f) => f.file)).toEqual([OTHER])
    const withAdapter = evaluateScenario({
      sources: { [OTHER]: [HEADER, "import { g } from '@/lib/api/gateway'"].join('\n') },
      tests: { [OTHER]: { class: 'adapter', reason: 'gateway の契約を検証する' } },
    })
    expect(withAdapter.findings).toEqual([])
    expect(withAdapter.targets).not.toContain(OTHER)
  })

  test('platform を import する domain のテストを integration に分類し直しても、対象外の集合として固定され subject が未検証になる', () => {
    const result = evaluateScenario(
      asIntegration([HEADER, DOMAIN_IMPORT, "import { k } from '@/lib/platform/keyValueStore'"].join('\n'), { covered: false }),
    )
    expect(result.targets).not.toContain(TEST)
    expect(result.domainImportingNonUnit).toContain(TEST)
    expect(ofKind(result, SUBJECT_UNTESTED).map((f) => f.file)).toEqual([QUERIES])
    expect(kindsOf(result)).toEqual([SUBJECT_UNTESTED])
  })

  test('登録の無い DOMAIN の production は 未登録の subject。新しい context は文言で示し、既存の context では示さない', () => {
    const billing = 'lib/billing/domain/invoice.ts'
    const added = evaluateScenario({ sources: { [billing]: 'export const invoice = 1' }, extraProduction: [billing] })
    expect(ofKind(added, UNREGISTERED_SUBJECT).map((f) => f.file)).toEqual([billing])
    expect(detailsOf(added, UNREGISTERED_SUBJECT)[0]).toContain('新しい context: billing')
    const streak = 'lib/learning/domain/streak.ts'
    const known = evaluateScenario({ sources: { [streak]: 'export const streak = 1' }, extraProduction: [streak] })
    expect(ofKind(known, UNREGISTERED_SUBJECT).map((f) => f.file)).toEqual([streak])
    expect(detailsOf(known, UNREGISTERED_SUBJECT)[0]).not.toContain('新しい context')
  })

  test('実在しない subject と DOMAIN・APP でない subject は 存在しない subject', () => {
    const ghost = 'lib/learning/domain/ghost.ts'
    const format = 'lib/format.ts'
    const result = evaluateScenario({
      sources: { [format]: 'export const fmt = 1' },
      extraProduction: [format],
      subjects: { [QUERIES]: [TEST], [ghost]: [], [format]: [] },
    })
    expect(ofKind(result, UNKNOWN_SUBJECT).map((f) => f.file).sort()).toEqual([format, ghost].sort())
  })

  test('subject の対応は到達と完全に一致しなければ 対応の食い違い（過剰も不足も）', () => {
    const extra = evaluateScenario({
      sources: { [OTHER]: PURE },
      tests: { [OTHER]: { class: 'unit' } },
      subjects: { [QUERIES]: [TEST, OTHER] },
    })
    expect(ofKind(extra, SUBJECT_MISMATCH).map((f) => f.file)).toEqual([QUERIES])
    const lacking = evaluateScenario({ subjects: { [QUERIES]: [] } })
    expect(ofKind(lacking, SUBJECT_MISMATCH).map((f) => f.file)).toEqual([QUERIES])
  })

  test('型だけの module は対応が空でよい。実行時の export を持つ module は空だと subject のテスト無し', () => {
    const typeOnly = 'lib/learning/application/ports.ts'
    const runtime = 'lib/learning/application/runtime.ts'
    const typeResult = evaluateScenario({
      sources: { [typeOnly]: ['export interface Port { readonly id: number }', 'export type Id = number'].join('\n') },
      extraProduction: [typeOnly],
      subjects: { [QUERIES]: [TEST], [typeOnly]: [] },
    })
    expect(typeResult.findings).toEqual([])
    const runtimeResult = evaluateScenario({
      sources: { [runtime]: 'export const run = 1' },
      extraProduction: [runtime],
      subjects: { [QUERIES]: [TEST], [runtime]: [] },
    })
    expect(ofKind(runtimeResult, SUBJECT_UNTESTED).map((f) => f.file)).toEqual([runtime])
  })

  test('移行許可: 違反に一致する許可は違反を消し、どの違反にも一致しない許可は 未使用の許可', () => {
    const allowance = (specifier: string): MigrationAllowance => ({
      file: TEST,
      specifier,
      owner: 'user',
      reason: '移行中',
      removeBy: 'web-slice-closure-01',
      task: 'web-slice-closure-01',
    })
    const matched = evaluateScenario({
      ...withLines("import { g } from '@/lib/api/gateway'", "vi.mock('@/lib/platform/cacheStore')"),
      allowances: [allowance('@/lib/api/gateway'), allowance("vi.mock('@/lib/platform/cacheStore')")],
    })
    expect(matched.findings).toEqual([])
    const stale = evaluateScenario({ allowances: [allowance('@/lib/api/gateway')] })
    expect(ofKind(stale, STALE_ALLOWANCE)).toHaveLength(1)
    expect(kindsOf(stale)).toEqual([STALE_ALLOWANCE])
  })

  test('同じ違反の重複は 1 件にし、辞書順で並べ、同じ入力から同じ出力を返し、入力を変更しない', () => {
    const scenario = withLines(
      "import { b } from '@/lib/platform/cacheStore'",
      "import { a } from '@/lib/api/gateway'",
      "import { a2 } from '@/lib/api/gateway'",
    )
    const input = build(scenario)
    const snapshot = JSON.stringify({ ...input, readSource: input.readSource(TEST) })
    const first = evaluateTestIsolation(input)
    const second = evaluateTestIsolation(input)
    expect(brief(first.findings)).toEqual([only(FORBIDDEN, '@/lib/api/gateway'), only(FORBIDDEN, '@/lib/platform/cacheStore')])
    expect(second).toEqual(first)
    expect(JSON.stringify({ ...input, readSource: input.readSource(TEST) })).toBe(snapshot)
  })

  test('前提条件: テストも production も空なら throw。読み込めないファイルがあれば throw', () => {
    const base = build()
    const unreadable = (target: string): TestIsolationInput => ({
      ...base,
      readSource: (f) => (f === target ? undefined : base.readSource(f)),
    })
    expectDeliberateThrow(() => evaluateTestIsolation({ ...base, testFiles: [] }))
    expectDeliberateThrow(() => evaluateTestIsolation({ ...base, productionFiles: [] }))
    expectDeliberateThrow(() => evaluateTestIsolation(unreadable(TEST)))
    expectDeliberateThrow(() => evaluateTestIsolation(unreadable(QUERIES)))
    expectDeliberateThrow(() => evaluateTestIsolation(unreadable(SETUP)))
  })

  test('setup ファイルが production を import・mock すれば setup の production 依存。パッケージの mock は許可', () => {
    const imports = evaluateScenario({ sources: { [SETUP]: "import { api } from '@/lib/api'" } })
    expect(ofKind(imports, SETUP_DEPENDENCY).map((f) => f.file)).toEqual([SETUP])
    const mocksProduction = evaluateScenario({
      sources: { [SETUP]: "import { vi } from 'vitest'\nvi.mock('@/lib/platform/cacheStore')" },
    })
    expect(ofKind(mocksProduction, SETUP_DEPENDENCY).map((f) => f.file)).toEqual([SETUP])
    expect(evaluateScenario().findings).toEqual([])
  })

  test('対象外: shared だけ・相対 path だけ・@/ の import が無い unit テスト', () => {
    const sharedOnly = 'tests/lib/learning/sharedOnly.test.ts'
    const relativeOnly = 'tests/lib/learning/relativeOnly.test.ts'
    const noAlias = 'tests/lib/learning/noAlias.test.ts'
    const result = evaluateScenario({
      sources: {
        [sharedOnly]: "import { ok } from '@/lib/shared/result'",
        [relativeOnly]: "import { pure } from '../../helpers/pure'",
        'tests/helpers/pure.ts': 'export const pure = 1',
        [noAlias]: 'export const plain = 1',
      },
      tests: {
        [sharedOnly]: { class: 'unit' },
        [relativeOnly]: { class: 'unit' },
        [noAlias]: { class: 'unit' },
      },
    })
    expect(result.targets).toEqual([TEST])
    expect(result.findings).toEqual([])
  })

  test('対象: domain・shared の型・clean な相対 helper を import する unit テスト', () => {
    const result = evaluateScenario({
      sources: {
        [TEST]: [
          HEADER,
          DOMAIN_IMPORT,
          "import type { ApiFailure } from '@/lib/shared/apiFailure'",
          "import { MockAudio } from '../../helpers/mockAudio'",
        ].join('\n'),
        'tests/helpers/mockAudio.ts': "import type { AudioElement } from '@/lib/playback/domain/audioElement'\nexport class MockAudio {}",
      },
    })
    expect(result.targets).toContain(TEST)
    expect(result.findings).toEqual([])
  })

  test('helper の re-export で DOMAIN を隠しても対象に残り、禁止依存は検出され、subject の対応は閉包で照合される', () => {
    const reexport = 'tests/helpers/learningReexport.ts'
    const sources = {
      [TEST]: [HEADER, "import { f } from '../../helpers/learningReexport'"].join('\n'),
      [reexport]: "export { f } from '@/lib/learning/application/queries'",
    }
    const clean = evaluateScenario({ sources })
    expect(clean.targets).toContain(TEST)
    expect(clean.findings).toEqual([])
    const dirty = evaluateScenario({
      sources: { ...sources, [TEST]: `${sources[TEST]}\nimport { k } from '@/lib/platform/keyValueStore'` },
    })
    expect(dirty.targets).toContain(TEST)
    expect(brief(dirty.findings)).toEqual([only(FORBIDDEN, '@/lib/platform/keyValueStore')])
    expect(ofKind(evaluateScenario({ sources, subjects: { [QUERIES]: [] } }), SUBJECT_MISMATCH).map((f) => f.file)).toEqual([QUERIES])
  })

  test('DOMAIN・APP のテスト用ディレクトリの下のテストは、DOMAIN を import しなくても、分類によらず対象', () => {
    const streak = 'tests/lib/learning/domain/streak.test.ts'
    const source = "import { g } from '@/lib/api/gateway'"
    const asUnit = evaluateScenario({ sources: { [streak]: source }, tests: { [streak]: { class: 'unit' } } })
    expect(asUnit.targets).toContain(streak)
    expect(brief(asUnit.findings)).toEqual([only(FORBIDDEN, '@/lib/api/gateway', streak)])
    const asIntegrationResult = evaluateScenario({
      sources: { [streak]: source },
      tests: { [streak]: { class: 'integration', reason: '結合の確認' } },
    })
    expect(asIntegrationResult.targets).toContain(streak)
    expect(brief(asIntegrationResult.findings)).toEqual([only(FORBIDDEN, '@/lib/api/gateway', streak)])
  })
})
