// 層の依存の向きを eslint で検査する設定（新 Spec §4 の web-dep-01・D2・D3・D5・D6・D7・D12）。
// 現状の違反は architecture/boundaries.allowlist.json に固定してあり、その行の specifier だけを
// ファイルごとの block で規則から外す（eslint-disable コメントは使わない）。
// 相対 path の別 context の import は lint が拾わず、tests/architecture/boundaries.test.ts が拾う。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import tseslint from 'typescript-eslint'

const ROOT = path.resolve(import.meta.dirname, '..')
const IMPORT_RULES = new Set(['web-dep-01', 'web-dep-02', 'web-dep-05', 'web-dep-06', 'web-dep-07', 'web-dep-12'])
const BOUNDARY_RULE = '@typescript-eslint/no-restricted-imports'

/** 新 Spec §4 web-dep-12 が許す context 間の向き（from → to）。 */
const ALLOWED_CROSS_CONTEXT = [
  ['playback', 'catalog'],
  ['learning', 'catalog'],
  ['admin', 'catalog'],
  ['admin', 'account'],
]

// application 層のディレクトリがまだ無い間の APP の現状の対応ファイル（context つき）。
const LEGACY_APP_FILES = [
  { file: 'lib/passkey.ts', context: 'account' },
  { file: 'lib/push/pushRegistration.ts', context: 'notifications' },
]

const FRAMEWORK_GROUP = ['react', 'react-dom', 'next', 'next/*']

const GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'caches', 'fetch', 'Audio', 'Response', 'Request', 'Headers']

const SYNTAX = [
  { id: 'JSON.parse', selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']" },
  { id: 'JSON.stringify', selector: "CallExpression[callee.object.name='JSON'][callee.property.name='stringify']" },
  { id: 'URL.createObjectURL', selector: "MemberExpression[object.name='URL'][property.name='createObjectURL']" },
]

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const escapeGlob = (text) => text.replace(/[[\]()!{}*?]/g, '\\$&')

function readAllowlist() {
  const file = path.join(ROOT, 'architecture/boundaries.allowlist.json')
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('boundaries.allowlist.json の最上位が配列でない')
  rows.forEach((row, index) => {
    for (const key of ['rule', 'file', 'specifier']) {
      if (typeof row?.[key] !== 'string') throw new Error(`boundaries.allowlist.json の ${index} 行目に文字列の ${key} が無い`)
    }
  })
  return rows
}

function contextsWith(layerDir) {
  return readdirSync(path.join(ROOT, 'lib'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(ROOT, 'lib', e.name, layerDir)))
    .map((e) => e.name)
    .sort()
}

/** 規則の違反に当たる import の regex。`exempt` の specifier（許可リストの行）だけを外す。 */
function regexPattern(body, exempt, message, extra = {}) {
  const guard = exempt.length > 0 ? `(?!(?:${exempt.map(escapeRegex).join('|')})$)` : ''
  return { regex: `^${guard}(?:${body})`, message, ...extra }
}

const LAYER = '(?:domain|application)'

function domainSpec(context) {
  const allowedTargets = [context, ...ALLOWED_CROSS_CONTEXT.filter(([from]) => from === context).map(([, to]) => to)]
  const body = `@/(?!lib/shared(?:/|$)|lib/(?:${allowedTargets.join('|')})/domain(?:/|$))`
  return {
    name: `DOMAIN(${context})`,
    match: (file) => file.startsWith(`lib/${context}/domain/`),
    files: [`lib/${context}/domain/**/*.{ts,tsx}`],
    importPatterns: (exempt) => [
      regexPattern(body, exempt, 'DOMAIN は lib/shared と同じ context の domain（と許された context の domain）だけを import する（web-dep-01・web-dep-12）'),
      { group: FRAMEWORK_GROUP, message: 'DOMAIN は framework を import しない（web-dep-01）' },
    ],
    externalWorld: true,
  }
}

function appSpec({ name, context, files, match }) {
  return {
    name,
    match,
    files,
    importPatterns: (exempt) => [
      regexPattern(`@/(?!lib/shared(?:/|$)|lib/[^/]+/${LAYER}(?:/|$))`, exempt, 'APP は lib/shared と domain・application だけを import する（web-dep-02）'),
      regexPattern(`@/lib/(?!${escapeRegex(context)}/)[^/]+/${LAYER}(?:/|$)`, exempt, '別 context の domain・application は型だけを import する（web-dep-02）', {
        allowTypeImports: true,
      }),
    ],
    externalWorld: true,
  }
}

const presSpec = {
  name: 'PRES',
  match: (file) =>
    (file.startsWith('app/') || file.startsWith('components/') || file.startsWith('hooks/')) &&
    !file.startsWith('app/api/') &&
    file !== 'app/layout.tsx' &&
    file !== 'app/(app)/layout.tsx',
  files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
  ignores: ['app/api/**', 'app/layout.tsx', 'app/(app)/layout.tsx'],
  importPatterns: (exempt) => [
    regexPattern(
      '@/lib/(?:api|platform)(?:/|$)|@/lib/(?:audioCache|sfx|reportClientError|pushBrowserPort|webauthnBrowserPort|swCacheCleanup|config)$|@/lib/[^/]+/infrastructure(?:/|$)',
      exempt,
      'PRES は adapter・infrastructure を直接 import しない（web-dep-05）',
    ),
  ],
  importPaths: [
    {
      name: '@/lib/playback/domain/queue',
      allowTypeImports: true,
      message: 'PRES は再生 domain の値を import しない（web-dep-05）',
    },
    {
      name: '@/lib/playback/application/session',
      allowTypeImports: true,
      message: 'PRES は再生の application の値を import しない（web-dep-05）',
    },
    {
      name: '@/lib/playback/domain/session',
      allowTypeImports: true,
      allowImportNames: ['PLAYBACK_SPEEDS'],
      message: 'PRES は再生 domain の値を import しない（web-dep-05。PLAYBACK_SPEEDS を除く）',
    },
  ],
}

const contextsSpec = {
  name: 'ROOT(contexts)',
  match: (file) => file.startsWith('contexts/'),
  files: ['contexts/**/*.{ts,tsx}'],
  importPatterns: (exempt) => [regexPattern('@/components(?:/|$)', exempt, 'contexts は components を import しない（web-dep-06）')],
}

const platformSpec = {
  name: 'INFRA(lib/platform)',
  match: (file) => file.startsWith('lib/platform/'),
  files: ['lib/platform/**/*.{ts,tsx}'],
  importPatterns: (exempt) => [
    regexPattern(
      `@/lib/[^/]+/${LAYER}(?:/|$)|@/lib/(?:passkey|push/pushRegistration)$`,
      exempt,
      'adapter は domain・application の値を import しない（型だけ）（web-dep-07）',
      { allowTypeImports: true },
    ),
  ],
}

const apiSpec = {
  name: 'INFRA(lib/api)',
  match: (file) => file.startsWith('lib/api/'),
  files: ['lib/api/**/*.{ts,tsx}'],
  importPatterns: (exempt) => [
    regexPattern('@/(?!types(?:/|$)|lib/shared(?:/|$)|lib/platform/cookie$|lib/api(?:/|$))', exempt, 'lib/api は types・lib/shared・lib/platform/cookie・lib/api の中だけを import する（web-dep-07）'),
  ],
}

function buildRules(spec, importExempt, globalExempt) {
  const rules = {
    'no-restricted-imports': 'off',
    [BOUNDARY_RULE]: [
      'error',
      {
        patterns: spec.importPatterns(importExempt),
        ...(spec.importPaths ? { paths: spec.importPaths } : {}),
      },
    ],
  }
  if (spec.externalWorld) {
    rules['no-restricted-globals'] = [
      'error',
      ...GLOBALS.filter((g) => !globalExempt.has(g)).map((name) => ({
        name,
        message: `DOMAIN・APP は外界の識別子 ${name} を参照しない（web-dep-03）`,
      })),
    ]
    rules['no-restricted-syntax'] = [
      'error',
      ...SYNTAX.filter((s) => !globalExempt.has(s.id)).map((s) => ({
        selector: s.selector,
        message: `DOMAIN・APP は ${s.id} を呼ばない（web-dep-03）`,
      })),
    ]
  }
  return rules
}

export function createBoundaryConfigs() {
  const allowlist = readAllowlist()
  const specs = [
    ...contextsWith('domain').map(domainSpec),
    ...contextsWith('application').map((context) =>
      appSpec({
        name: `APP(${context})`,
        context,
        files: [`lib/${context}/application/**/*.{ts,tsx}`],
        match: (file) => file.startsWith(`lib/${context}/application/`),
      }),
    ),
    ...LEGACY_APP_FILES.map(({ file, context }) =>
      appSpec({ name: `APP(${file})`, context, files: [escapeGlob(file)], match: (candidate) => candidate === file }),
    ),
    presSpec,
    contextsSpec,
    platformSpec,
    apiSpec,
  ]

  const configs = specs.map((spec) => ({
    files: spec.files,
    ...(spec.ignores ? { ignores: spec.ignores } : {}),
    rules: buildRules(spec, [], new Set()),
  }))

  // 許可リストの行を持つファイルごとに、層の block と同じ規則を、その行の specifier だけ外して書き直す。
  const byFile = new Map()
  for (const row of allowlist) {
    if (!IMPORT_RULES.has(row.rule) && row.rule !== 'web-dep-03') continue
    byFile.set(row.file, [...(byFile.get(row.file) ?? []), row])
  }
  for (const [file, rows] of [...byFile].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const spec = specs.find((s) => s.match(file))
    if (spec === undefined) throw new Error(`許可リストの ${file} に当たる層の block が無い`)
    const importExempt = rows.filter((r) => IMPORT_RULES.has(r.rule)).map((r) => r.specifier)
    const globalExempt = new Set(rows.filter((r) => r.rule === 'web-dep-03').map((r) => r.specifier))
    configs.push({ files: [escapeGlob(file)], rules: buildRules(spec, importExempt, globalExempt) })
  }
  return tseslint.config(...configs)
}
