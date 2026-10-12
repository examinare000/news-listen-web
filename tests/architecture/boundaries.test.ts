// @vitest-environment node
// 依存の向きの検査（TA-V2）・許可リストの形（TP-A1）・eslint の境界の規則との一致（TA-V1）。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §4・§7。
//
// RED 理由（実装前）: architecture/boundaries.allowlist.json が無い・lib/playback/domain/** と lib/shared/** が無い・
// eslint に境界の規則が無い。検出器の正例・負例（TA-V2 の自己点検）は helper だけで決まるので実装前から green。
import path from 'node:path'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  WEB_ROOT,
  collectImports,
  expectsBoundaryRule,
  layerOf,
  listScanFiles,
  readAllowlistFileSpecifierPairs,
  readAllowlistRowsStrict,
  readAllowlistText,
  readSource,
  rowKeys,
  type AllowlistRow,
  type Row,
} from '../helpers/architecture'
import { detectGlobalRows, detectImportRows } from '../helpers/architectureDetectors'

const BOUNDARY_RULE = '@typescript-eslint/no-restricted-imports'

/** TA-D12 までの依存の向きの規則（TA-V2 が測る rule）。 */
const TA_V2_RULES = ['TA-D1', 'TA-D2', 'TA-D3', 'TA-D5', 'TA-D6', 'TA-D7', 'TA-D12'] as const

/** TP-A1 の `rule` の値域。 */
const ALLOWLIST_RULES = [
  'TA-D1', 'TA-D2', 'TA-D3', 'TA-D4', 'TA-D5', 'TA-D6', 'TA-D7', 'TA-D8', 'TA-D11', 'TA-D12',
  'TA-R-CT-1', 'TA-R-CT-2', 'TA-R-CT-3', 'TA-R-CT-6',
  'TA-R-AC-3', 'TA-R-AC-6', 'TA-R-PB-2', 'TA-R-PF-1',
  'TA-R-LN-1', 'TA-R-LN-2', 'TA-R-LN-3',
]

/** `removeBy` の値域: order の表の slice ID ＋ 新 Spec §3.2 の「動かす slice」（user 承認 2026-10-06）。 */
const REMOVE_BY_VALUES = [
  'W-S2b', 'W-S2c', 'W-S4a', 'W-S4b', 'W-S4c', 'W-S4d1', 'W-S4d3',
  'W-T2', 'W-T3', 'W-T4', 'W-T5', 'W-T6', 'W-T7a', 'W-T8', 'W-T9', 'W-T10a', 'W-T11', 'W-T12', 'W-T13', 'W-T15',
]

const ALLOWLIST_KEYS = ['rule', 'file', 'specifier', 'introducedBy', 'removeBy']

let scanFiles: string[]

beforeAll(() => {
  scanFiles = listScanFiles()
})

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function compareRows(a: AllowlistRow, b: AllowlistRow): number {
  for (const key of ['rule', 'file', 'specifier'] as const) {
    if (a[key] < b[key]) return -1
    if (a[key] > b[key]) return 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// 許可リストの形（TP-A1）
// ---------------------------------------------------------------------------
describe('TP-A1 許可リスト architecture/boundaries.allowlist.json の形', () => {
  test('最上位は配列で、各要素の key は 5 つちょうど・値は空でない文字列・値域は承認された集合（どの行のどの key かを出す）', () => {
    const text = readAllowlistText()
    const rows: unknown = JSON.parse(text)
    expect(Array.isArray(rows), '最上位が配列でない').toBe(true)
    const problems: string[] = []
    ;(rows as Array<Record<string, unknown>>).forEach((row, index) => {
      const keys = Object.keys(row)
      if (keys.join(',') !== ALLOWLIST_KEYS.join(',')) {
        problems.push(`行 ${index}: key が ${ALLOWLIST_KEYS.join('・')} でない（実際: ${keys.join('・')}）`)
      }
      for (const key of ALLOWLIST_KEYS) {
        if (!isNonEmptyString(row[key])) problems.push(`行 ${index} の ${key}: 空でない文字列でない`)
      }
      if (!ALLOWLIST_RULES.includes(row.rule as string)) problems.push(`行 ${index} の rule: 値域の外 (${String(row.rule)})`)
      if (row.introducedBy !== 'W-T1') problems.push(`行 ${index} の introducedBy: W-T1 でない (${String(row.introducedBy)})`)
      if (!REMOVE_BY_VALUES.includes(row.removeBy as string)) {
        problems.push(`行 ${index} の removeBy: 承認された値域の外 (${String(row.removeBy)})`)
      }
    })
    expect(problems).toEqual([])
  })

  test('(rule, file, specifier) に重複が無く、file は走査集合に存在する', () => {
    const rows = readAllowlistRowsStrict()
    const seen = new Set<string>()
    const problems: string[] = []
    const files = new Set(scanFiles)
    rows.forEach((row, index) => {
      const key = [row.rule, row.file, row.specifier].join('\t')
      if (seen.has(key)) problems.push(`行 ${index}: (${row.rule}, ${row.file}, ${row.specifier}) が重複`)
      seen.add(key)
      if (!files.has(row.file)) problems.push(`行 ${index}: file ${row.file} が走査集合に無い`)
    })
    expect(problems).toEqual([])
  })

  test('ファイルの内容が JSON.stringify(rule→file→specifier の辞書順の行, null, 2) + 改行 と一致する', () => {
    const rows = readAllowlistRowsStrict()
    const canonical = [...rows]
      .sort(compareRows)
      .map((r) => ({ rule: r.rule, file: r.file, specifier: r.specifier, introducedBy: r.introducedBy, removeBy: r.removeBy }))
    expect(readAllowlistText()).toBe(`${JSON.stringify(canonical, null, 2)}\n`)
  })

  test('removeBy が W-T2 の行は 0 件（W-T2 で消した）', () => {
    const rows = readAllowlistRowsStrict()
    expect(rows.filter((r) => r.removeBy === 'W-T2')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 走査集合 F・shared kernel
// ---------------------------------------------------------------------------
describe('TA-V2 走査集合 F と配置', () => {
  test('F は空でなく、移した後の domain のファイルを含み、削除したファイルを含まない（未追跡でも数える）', () => {
    expect(scanFiles.length).toBeGreaterThan(0)
    const present = [
      'lib/playback/domain/session.ts',
      'lib/playback/domain/queue.ts',
      'lib/playback/domain/resume.ts',
      'lib/playback/domain/source.ts',
      'lib/playback/domain/audioElement.ts',
      'lib/shared/result.ts',
      'lib/shared/apiFailure.ts',
      'lib/shared/difficulty.ts',
      'lib/account/domain/adminAccess.ts',
      'lib/account/domain/role.ts',
    ]
    const absent = [
      'lib/playback/session.ts',
      'lib/playback/queue.ts',
      'lib/playback/resume.ts',
      'lib/playback/source.ts',
      'lib/playback/ports.ts',
      'lib/account/adminAccess.ts',
    ]
    expect(present.filter((f) => !scanFiles.includes(f))).toEqual([])
    expect(absent.filter((f) => scanFiles.includes(f))).toEqual([])
  })

  test('lib/shared は lib/shared の外（パッケージを含む）を import しない', () => {
    const shared = scanFiles.filter((f) => layerOf(f) === 'SHARED')
    // 空振りの防止: shared kernel の 3 ファイルが実在する
    expect(shared.sort()).toEqual(expect.arrayContaining(['lib/shared/apiFailure.ts', 'lib/shared/difficulty.ts', 'lib/shared/result.ts']))
    const outside = shared.flatMap((f) =>
      collectImports(f, readSource(f))
        .filter((i) => i.resolved === null || !(i.resolved === 'lib/shared' || i.resolved.startsWith('lib/shared/')))
        .map((i) => `${f}: ${i.specifier}`),
    )
    expect(outside).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 実測 ＝ 許可リスト（TA-V2）
// ---------------------------------------------------------------------------
describe('TA-V2 依存の向きの実測は許可リストと一致する（多くても少なくても落ちる）', () => {
  test('TA-D1・D2・D3・D5・D6・D7・D12 の違反の集合 ＝ 許可リストの同じ rule の行', () => {
    const measured: Row[] = []
    for (const file of scanFiles) {
      const source = readSource(file)
      measured.push(...detectImportRows(file, source))
      const layer = layerOf(file)
      if (layer === 'DOMAIN' || layer === 'APP') measured.push(...detectGlobalRows(file, source))
    }
    const expected = readAllowlistRowsStrict().filter((r) => (TA_V2_RULES as readonly string[]).includes(r.rule))
    expect(rowKeys(measured.filter((r) => (TA_V2_RULES as readonly string[]).includes(r.rule)))).toEqual(rowKeys(expected))
  })

  test('DOMAIN の禁止 import（TA-D1・TA-D12）の実測は 0 件', () => {
    const measured = scanFiles
      .filter((f) => layerOf(f) === 'DOMAIN')
      .flatMap((f) => detectImportRows(f, readSource(f)))
      .filter((r) => r.rule === 'TA-D1' || r.rule === 'TA-D12')
    expect(rowKeys(measured)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 検出器の自己点検（正例を拾い、負例を拾わない）
// ---------------------------------------------------------------------------
interface ImportCase {
  readonly name: string
  readonly file: string
  readonly source: string
  readonly expected: readonly string[]
}

const importCases: readonly ImportCase[] = [
  // TA-D2（別 context の domain・application は型だけ許す）
  {
    name: 'TA-D2 正例: account の APP が playback の値を import する（TV-1 の反例そのもの）',
    file: 'lib/passkey.ts',
    source: "import { createPlaybackSession } from '@/lib/playback/domain/session'",
    expected: ['TA-D2 | lib/passkey.ts | @/lib/playback/domain/session'],
  },
  {
    name: 'TA-D2 正例: type の無い指定子を含む',
    file: 'lib/passkey.ts',
    source: "import { type PlaybackState, createPlaybackSession } from '@/lib/playback/domain/session'",
    expected: ['TA-D2 | lib/passkey.ts | @/lib/playback/domain/session'],
  },
  {
    name: 'TA-D2 正例: 相対 path を解いて別 context と判定する（名前空間は値）',
    file: 'lib/catalog/application/x.ts',
    source: "import * as Q from '../../playback/domain/queue'",
    expected: ['TA-D2 | lib/catalog/application/x.ts | ../../playback/domain/queue'],
  },
  {
    name: 'TA-D2 負例: 型だけの 3 つの書き方',
    file: 'lib/passkey.ts',
    source: [
      "import type { PlaybackState } from '@/lib/playback/domain/session'",
      "import { type PlaybackState as S2 } from '@/lib/playback/domain/session'",
      "export type { QueueState } from '@/lib/playback/domain/queue'",
    ].join('\n'),
    expected: [],
  },
  {
    name: 'TA-D2 負例: 同じ context の domain の値',
    file: 'lib/passkey.ts',
    source: "import { adminAccess } from '@/lib/account/domain/adminAccess'",
    expected: [],
  },
  {
    name: 'TA-D2 負例: pushRegistration の context は path の 2 段目（push）ではなく notifications',
    file: 'lib/push/pushRegistration.ts',
    source: "import { x } from '@/lib/notifications/domain/subscription'",
    expected: [],
  },
  {
    name: 'TA-D2 正例: pushRegistration から account の値',
    file: 'lib/push/pushRegistration.ts',
    source: "import { adminAccess } from '@/lib/account/domain/adminAccess'",
    expected: ['TA-D2 | lib/push/pushRegistration.ts | @/lib/account/domain/adminAccess'],
  },
  {
    name: 'TA-D2 正例: APP が @/types・adapter を import する（現状の違反の形）。shared とパッケージは許す',
    file: 'lib/passkey.ts',
    source: [
      "import type { X } from '@/types/index'",
      "import { y } from '@/lib/webauthnBrowserPort'",
      "import { z } from '@/lib/shared/apiFailure'",
      "import { w } from '@simplewebauthn/browser'",
    ].join('\n'),
    expected: ['TA-D2 | lib/passkey.ts | @/lib/webauthnBrowserPort', 'TA-D2 | lib/passkey.ts | @/types/index'],
  },
  // TA-D5（PRES は再生 domain の session・queue の値を import しない。型と PLAYBACK_SPEEDS を除く）
  {
    name: 'TA-D5 正例: components が queue の値を import する（TV-2 の反例そのもの）',
    file: 'components/X.tsx',
    source: "import { start } from '@/lib/playback/domain/queue'",
    expected: ['TA-D5 | components/X.tsx | @/lib/playback/domain/queue'],
  },
  {
    name: 'TA-D5 正例: PLAYBACK_SPEEDS 以外の値を含む・名前空間・副作用だけ',
    file: 'app/(app)/x/page.tsx',
    source: [
      "import { PLAYBACK_SPEEDS, createPlaybackSession } from '@/lib/playback/domain/session'",
      "import * as S from '@/lib/playback/domain/session'",
      "import '@/lib/playback/domain/queue'",
    ].join('\n'),
    expected: [
      'TA-D5 | app/(app)/x/page.tsx | @/lib/playback/domain/queue',
      'TA-D5 | app/(app)/x/page.tsx | @/lib/playback/domain/session',
    ],
  },
  {
    name: 'TA-D5 負例: 型だけ・PLAYBACK_SPEEDS だけ・PLAYBACK_SPEEDS と型',
    file: 'hooks/useX.ts',
    source: [
      "import type { QueueState } from '@/lib/playback/domain/queue'",
      "import { PLAYBACK_SPEEDS } from '@/lib/playback/domain/session'",
      "import { PLAYBACK_SPEEDS as S2, type PlaybackState } from '@/lib/playback/domain/session'",
    ].join('\n'),
    expected: [],
  },
  {
    name: 'TA-D5 負例: 対象外（account の純関数）',
    file: 'components/AdminGate.tsx',
    source: "import { adminAccess } from '@/lib/account/domain/adminAccess'",
    expected: [],
  },
  {
    name: 'TA-D5 負例: ROOT（contexts）は対象外',
    file: 'contexts/X.tsx',
    source: "import { start } from '@/lib/playback/domain/queue'",
    expected: [],
  },
  {
    name: 'TA-D5 正例: PRES が adapter・API を import する（現状の違反の形）',
    file: 'components/Y.tsx',
    source: [
      "import { a } from '@/lib/api'",
      "import { b } from '@/lib/platform/cacheStore'",
      "import { c } from '@/lib/catalog/infrastructure/gateway'",
      "import { d } from '@/lib/config'",
      "import { e } from '@/lib/format'",
    ].join('\n'),
    expected: [
      'TA-D5 | components/Y.tsx | @/lib/api',
      'TA-D5 | components/Y.tsx | @/lib/catalog/infrastructure/gateway',
      'TA-D5 | components/Y.tsx | @/lib/config',
      'TA-D5 | components/Y.tsx | @/lib/platform/cacheStore',
    ],
  },
  // TA-D1・TA-D12（DOMAIN）
  {
    name: 'TA-D1 正例: DOMAIN が @/types・API・フレームワークを import する。同じ dir・shared・他のパッケージは許す',
    file: 'lib/playback/domain/session.ts',
    source: [
      "import type { Podcast } from '@/types'",
      "import type { Result } from '@/lib/api/gateway'",
      "import { useState } from 'react'",
      "import { useRouter } from 'next/navigation'",
      "import type { AudioElement } from './audioElement'",
      "import type { ApiFailure } from '@/lib/shared/apiFailure'",
      "import { z } from 'zod'",
    ].join('\n'),
    expected: [
      'TA-D1 | lib/playback/domain/session.ts | @/lib/api/gateway',
      'TA-D1 | lib/playback/domain/session.ts | @/types',
      'TA-D1 | lib/playback/domain/session.ts | next/navigation',
      'TA-D1 | lib/playback/domain/session.ts | react',
    ],
  },
  {
    name: 'TA-D12 正例・負例: playback → catalog は許し、playback → learning は TA-D12 の行（TA-D1 と重ねない）',
    file: 'lib/playback/domain/x.ts',
    source: [
      "import type { E } from '@/lib/catalog/domain/episode'",
      "import type { Q } from '../../learning/domain/quiz'",
    ].join('\n'),
    expected: ['TA-D12 | lib/playback/domain/x.ts | ../../learning/domain/quiz'],
  },
  {
    name: 'TA-D12 正例: account → playback は許さない。admin → account は許す',
    file: 'lib/account/domain/x.ts',
    source: "import type { S } from '@/lib/playback/domain/session'",
    expected: ['TA-D12 | lib/account/domain/x.ts | @/lib/playback/domain/session'],
  },
  {
    name: 'TA-D12 負例: admin → account・admin → catalog',
    file: 'lib/admin/domain/x.ts',
    source: [
      "import type { U } from '@/lib/account/domain/role'",
      "import type { E } from '@/lib/catalog/domain/episode'",
    ].join('\n'),
    expected: [],
  },
  // TA-D6・TA-D7
  {
    name: 'TA-D6 正例: contexts が components を import する',
    file: 'contexts/AudioPlayerContext.tsx',
    source: "import { useToast } from '@/components/ui/Toast'",
    expected: ['TA-D6 | contexts/AudioPlayerContext.tsx | @/components/ui/Toast'],
  },
  {
    name: 'TA-D7 負例: platform → domain の import type。正例: 値の import',
    file: 'lib/platform/audioElement.ts',
    source: [
      "import type { AudioElement } from '@/lib/playback/domain/audioElement'",
      "import { createPlaybackSession } from '@/lib/playback/domain/session'",
    ].join('\n'),
    expected: ['TA-D7 | lib/platform/audioElement.ts | @/lib/playback/domain/session'],
  },
  {
    name: 'TA-D7 正例: lib/api が shared・types・platform/cookie・lib/api の中以外を import する（lib/api の中の相互 import は数えない）',
    file: 'lib/api/gateway.ts',
    source: [
      "import type { Result } from '@/lib/shared/result'",
      "import type { Podcast } from '@/types/index'",
      "import { getCookie } from '@/lib/platform/cookie'",
      "import { request } from '@/lib/api/legacyRequest'",
      "import { helper } from './helper'",
      "import { c } from '@/lib/cookie'",
      "import { f } from '@/lib/format'",
    ].join('\n'),
    expected: ['TA-D7 | lib/api/gateway.ts | @/lib/cookie', 'TA-D7 | lib/api/gateway.ts | @/lib/format'],
  },
]

describe('TA-V2 検出器の自己点検: import の向き（正例を拾い、負例を拾わない）', () => {
  test.each(importCases)('$name', ({ file, source, expected }) => {
    expect(rowKeys(detectImportRows(file, source))).toEqual([...expected])
  })

  test('import の収集は import type・export … from・import()・import = require と、型だけかの判定（構文）を数える。コメントは数えない', () => {
    const source = [
      "import type { A } from '@/a'",
      "import { type B, type C } from '@/b'",
      "import { D, type E } from '@/c'",
      "import F, { type G } from '@/d'",
      "export type { H } from '@/e'",
      "export { I } from '@/f'",
      "export * from '@/g'",
      "import('@/h')",
      "import J = require('@/i')",
      "// import { K } from '@/comment'",
    ].join('\n')
    const imports = collectImports('lib/x.ts', source).map((i) => `${i.specifier}:${i.typeOnly ? 'type' : 'value'}`)
    expect(imports).toEqual([
      '@/a:type',
      '@/b:type',
      '@/c:value',
      '@/d:value',
      '@/e:type',
      '@/f:value',
      '@/g:value',
      '@/h:value',
      '@/i:value',
    ])
  })
})

describe('TA-V2 検出器の自己点検: TA-D3 のグローバルと呼出', () => {
  const rows = (source: string): string[] => rowKeys(detectGlobalRows('lib/account/domain/x.ts', source))

  test('正例: window・fetch・型の位置の Response・new Response・JSON.parse・JSON.stringify・URL.createObjectURL', () => {
    expect(rows('const w = window.innerWidth')).toEqual(['TA-D3 | lib/account/domain/x.ts | window'])
    expect(rows("void fetch('/x')")).toEqual(['TA-D3 | lib/account/domain/x.ts | fetch'])
    expect(rows('type R = { r: Response }')).toEqual(['TA-D3 | lib/account/domain/x.ts | Response'])
    expect(rows('const r = new Response("")')).toEqual(['TA-D3 | lib/account/domain/x.ts | Response'])
    expect(rows("JSON.parse('{}')")).toEqual(['TA-D3 | lib/account/domain/x.ts | JSON.parse'])
    expect(rows('JSON.stringify({})')).toEqual(['TA-D3 | lib/account/domain/x.ts | JSON.stringify'])
    expect(rows('URL.createObjectURL(blob)')).toEqual(['TA-D3 | lib/account/domain/x.ts | URL.createObjectURL'])
  })

  test('負例: property 名 x.window・object の key { fetch: 1 }・宣言名・コメントの中の JSON.parse', () => {
    expect(rows('const a = x.window')).toEqual([])
    expect(rows('const a = { fetch: 1 }')).toEqual([])
    expect(rows('interface I { fetch(): void; document: string }')).toEqual([])
    expect(rows("// JSON.parse('{}') と書かない\n/* window */ const a = 1")).toEqual([])
    expect(rows("const text = 'JSON.parse'")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 層の判定（helper）
// ---------------------------------------------------------------------------
describe('TA-V2 層の判定（helper）', () => {
  test.each([
    ['lib/playback/domain/queue.ts', 'DOMAIN'],
    ['lib/account/domain/role.ts', 'DOMAIN'],
    ['lib/passkey.ts', 'APP'],
    ['lib/push/pushRegistration.ts', 'APP'],
    ['lib/catalog/application/x.ts', 'APP'],
    ['lib/shared/result.ts', 'SHARED'],
    ['lib/platform/cacheStore.ts', 'INFRA'],
    ['lib/api/gateway.ts', 'INFRA'],
    ['types/index.ts', 'INFRA'],
    ['lib/config.ts', 'INFRA'],
    ['lib/api.ts', 'OUTSIDE'],
    ['lib/audioCache.ts', 'OUTSIDE'],
    ['app/(app)/podcast/[id]/page.tsx', 'PRES'],
    ['components/AdminGate.tsx', 'PRES'],
    ['hooks/useStartPodcast.ts', 'PRES'],
    ['contexts/AppContext.tsx', 'ROOT'],
    ['app/layout.tsx', 'ROOT'],
    ['app/(app)/layout.tsx', 'ROOT'],
    ['app/api/x/route.ts', 'OUTSIDE'],
  ])('%s は %s', (file, layer) => {
    expect(layerOf(file)).toBe(layer)
  })
})

// ---------------------------------------------------------------------------
// eslint の境界の規則（TA-V1）との一致
// ---------------------------------------------------------------------------
const lintPath = (relative: string): string => path.join(WEB_ROOT, relative)

let eslint: ESLint
beforeAll(() => {
  eslint = new ESLint({ cwd: WEB_ROOT })
})

/** 行ごとの `ruleId` を集める（probe は 1 行 1 import）。 */
async function lintLines(relative: string, lines: readonly string[]): Promise<Map<number, string[]>> {
  const results = await eslint.lintText(lines.join('\n'), { filePath: lintPath(relative) })
  const byLine = new Map<number, string[]>()
  for (const message of results[0]?.messages ?? []) {
    if (message.ruleId === null) continue
    byLine.set(message.line, [...(byLine.get(message.line) ?? []), message.ruleId])
  }
  return byLine
}

describe('TA-V1 eslint の境界の規則と、層の判定の一致', () => {
  test(
    '境界の規則が error で有効なのは DOMAIN・APP・PRES・contexts・lib/api・lib/platform のファイルだけ（層外・shared・types は無効）',
    async () => {
      const mismatches: string[] = []
      for (const file of scanFiles) {
        const config = (await eslint.calculateConfigForFile(lintPath(file))) as { rules?: Record<string, unknown> } | undefined
        const entry = config?.rules?.[BOUNDARY_RULE]
        const severity: unknown = Array.isArray(entry) ? (entry as unknown[])[0] : entry
        const enabled = severity === 2 || severity === 'error'
        if (enabled !== expectsBoundaryRule(file)) {
          mismatches.push(`${file}: 規則 ${enabled ? '有効' : '無効'}（層 ${layerOf(file)} の期待は ${expectsBoundaryRule(file) ? '有効' : '無効'}）`)
        }
      }
      expect(mismatches).toEqual([])
    },
    180_000,
  )

  test(
    '許可リストの行を持つファイル（[id]・(app) を含む path を含む）で、その specifier だけが規則から外れ、同じファイルのほかの禁止は残る',
    async () => {
      const rows = readAllowlistRowsStrict().filter((r) => (TA_V2_RULES as readonly string[]).includes(r.rule))
      expect(rows.length, '許可リストに TA-D1・D2・D3・D5・D6・D7・D12 の行が無い').toBeGreaterThan(0)
      const byFile = new Map<string, AllowlistRow[]>()
      for (const row of rows) byFile.set(row.file, [...(byFile.get(row.file) ?? []), row])

      const problems: string[] = []
      for (const [file, fileRows] of byFile) {
        const probes = fileRows.map((row) => probeFor(row))
        const control = controlImportFor(file)
        const lines = [...probes.map((p) => p.code), control]
        const byLine = await lintLines(file, lines)
        fileRows.forEach((row, index) => {
          const hit = (byLine.get(index + 1) ?? []).filter((id) => id === probes[index].ruleId)
          if (hit.length > 0) problems.push(`${file}: 許可リストの行 (${row.rule}, ${row.specifier}) が eslint の設定から外れていない`)
        })
        const controlHit = (byLine.get(lines.length) ?? []).filter((id) => id === BOUNDARY_RULE)
        if (controlHit.length === 0) problems.push(`${file}: 許可リストに無い禁止（${control}）が eslint で指摘されない（規則ごと外れている）`)
      }
      expect(problems).toEqual([])
    },
    300_000,
  )
})

function probeFor(row: AllowlistRow): { code: string; ruleId: string } {
  if (row.rule === 'TA-D3') {
    if (row.specifier === 'JSON.parse' || row.specifier === 'JSON.stringify') {
      return { code: `${row.specifier}('{}')`, ruleId: 'no-restricted-syntax' }
    }
    return { code: `void ${row.specifier}`, ruleId: 'no-restricted-globals' }
  }
  return { code: `import '${row.specifier}'`, ruleId: BOUNDARY_RULE }
}

function controlImportFor(file: string): string {
  if (file.startsWith('contexts/')) return "import '@/components/ControlProbe'"
  if (file.startsWith('lib/api/')) return "import '@/lib/audioCache'"
  if (layerOf(file) === 'PRES') return "import '@/lib/platform/cacheStore'"
  return "import '@/lib/api/gateway'"
}

// ---------------------------------------------------------------------------
// eslint の禁止項目の効き目（filePath は例ごとに、例の path と層・context が同じ実在ファイル）
// ---------------------------------------------------------------------------
interface LintExample {
  readonly name: string
  /** 例の path と層・context が同じ実在ファイル */
  readonly filePath: string
  readonly source: string
  readonly flagged: boolean
}

const SESSION = '@/lib/playback/domain/session'
const QUEUE = '@/lib/playback/domain/queue'

const lintExamples: readonly LintExample[] = [
  { name: 'TA-D2 正例: account の APP が playback の値を import する', filePath: 'lib/passkey.ts', source: `import { createPlaybackSession } from '${SESSION}'`, flagged: true },
  { name: 'TA-D2 正例: type の無い指定子を含む', filePath: 'lib/passkey.ts', source: `import { type PlaybackState, createPlaybackSession } from '${SESSION}'`, flagged: true },
  { name: 'TA-D2 負例: import type', filePath: 'lib/passkey.ts', source: `import type { PlaybackState } from '${SESSION}'`, flagged: false },
  { name: 'TA-D2 負例: すべての指定子が type', filePath: 'lib/passkey.ts', source: `import { type PlaybackState } from '${SESSION}'`, flagged: false },
  { name: 'TA-D2 負例: export type … from', filePath: 'lib/passkey.ts', source: `export type { QueueState } from '${QUEUE}'`, flagged: false },
  { name: 'TA-D2 負例: 同じ context の domain の値', filePath: 'lib/passkey.ts', source: "import { adminAccess } from '@/lib/account/domain/adminAccess'", flagged: false },
  { name: 'TA-D2 負例: pushRegistration（notifications）の同じ context の domain', filePath: 'lib/push/pushRegistration.ts', source: "import { x } from '@/lib/notifications/domain/subscription'", flagged: false },
  { name: 'TA-D2 正例: pushRegistration から account の値', filePath: 'lib/push/pushRegistration.ts', source: "import { adminAccess } from '@/lib/account/domain/adminAccess'", flagged: true },
  { name: 'TA-D5 正例: PRES が queue の値を import する', filePath: 'components/AdminGate.tsx', source: `import { start } from '${QUEUE}'`, flagged: true },
  { name: 'TA-D5 正例: PLAYBACK_SPEEDS 以外の値を含む', filePath: 'app/(app)/podcast/[id]/page.tsx', source: `import { PLAYBACK_SPEEDS, createPlaybackSession } from '${SESSION}'`, flagged: true },
  { name: 'TA-D5 正例: 名前空間', filePath: 'app/(app)/podcast/[id]/page.tsx', source: `import * as S from '${SESSION}'`, flagged: true },
  { name: 'TA-D5 正例: 副作用だけ', filePath: 'app/(app)/podcast/[id]/page.tsx', source: `import '${QUEUE}'`, flagged: true },
  { name: 'TA-D5 負例: import type', filePath: 'hooks/useStartPodcast.ts', source: `import type { QueueState } from '${QUEUE}'`, flagged: false },
  { name: 'TA-D5 負例: PLAYBACK_SPEEDS だけ', filePath: 'hooks/useStartPodcast.ts', source: `import { PLAYBACK_SPEEDS } from '${SESSION}'`, flagged: false },
  { name: 'TA-D5 負例: PLAYBACK_SPEEDS と型', filePath: 'hooks/useStartPodcast.ts', source: `import { PLAYBACK_SPEEDS, type PlaybackState } from '${SESSION}'`, flagged: false },
  { name: 'TA-D5 負例: 対象外（account の純関数）', filePath: 'components/AdminGate.tsx', source: "import { adminAccess } from '@/lib/account/domain/adminAccess'", flagged: false },
  { name: 'TA-D5 負例: ROOT（contexts）は対象外', filePath: 'contexts/AppContext.tsx', source: `import { start } from '${QUEUE}'`, flagged: false },
]

describe('TA-V1 eslint の禁止項目の効き目（反例を実際に lint に通す）', () => {
  test('前提: 例の filePath が実在し、許可リストに (filePath, 例の specifier) の行が無い（許可リストのファイルが無い間は空とみなす）', () => {
    const missing = [...new Set(lintExamples.map((e) => e.filePath))].filter((f) => !scanFiles.includes(f))
    expect(missing, '[precondition: 対応表] 対応表の filePath が実在しない').toEqual([])
    let pairs: ReturnType<typeof readAllowlistFileSpecifierPairs>
    try {
      pairs = readAllowlistFileSpecifierPairs()
    } catch (error) {
      throw new Error(`[precondition: 許可リスト] 許可リストがあるのに読めない・壊れている: ${String(error)}`)
    }
    const overlaps = lintExamples.flatMap((e) => {
      const specifiers = collectImports(e.filePath, e.source).map((i) => i.specifier)
      return pairs.filter((p) => p.file === e.filePath && specifiers.includes(p.specifier)).map((p) => `${p.file}: ${p.specifier}`)
    })
    expect(overlaps, '[precondition: 許可リスト] 許可リストの行が例の specifier と重なる').toEqual([])
  })

  test.each(lintExamples)(
    '$name',
    async ({ filePath, source, flagged }) => {
      let messages: Array<{ ruleId: string | null; fatal?: boolean; message: string }>
      try {
        const results = await eslint.lintText(source, { filePath: lintPath(filePath) })
        messages = results[0]?.messages ?? []
      } catch (error) {
        throw new Error(`[lintText の実行失敗] lintText が throw した（型情報の取得）: ${String(error)}`)
      }
      const fatal = messages.filter((m) => m.fatal === true)
      if (fatal.length > 0) throw new Error(`[lintText の構文エラー] lintText が構文エラーを返した: ${fatal[0].message}`)
      const hits = messages.filter((m) => m.ruleId === BOUNDARY_RULE)
      if (flagged) {
        expect(hits.length, `[正例の検出漏れ] 正例で ${BOUNDARY_RULE} の指摘が 0 件（境界の規則が無いか、禁止項目が欠けている）`).toBeGreaterThan(0)
      } else {
        expect(hits.map((m) => m.message), `負例が ${BOUNDARY_RULE} に指摘された`).toEqual([])
      }
    },
    120_000,
  )
})
